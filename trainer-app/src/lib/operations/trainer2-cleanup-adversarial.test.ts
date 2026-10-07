// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCleanupCommand, ownedProcessTree, terminateOwnedProcesses, waitForWorker } from '../../../scripts/trainer2/disposable-cleanup';

const artifact=resolve('artifacts/equipment-cleanup/adversarial');
const native=resolve('scripts/trainer2/browser-tree.ps1');
const entry=(pid:number,parentPid:number,created:string)=>({pid,parentPid,created,executable:'C:\\node.exe',lastSeen:'900000000000000000'});
describe.skipIf(process.platform!=='win32')('native ownership adversarial controls',()=>{
  it('rejects older children and replacement-root descendants for living and exited reused creators',async()=>{
    mkdirSync(artifact,{recursive:true});
    const root=entry(100,10,'700000000000000000');
    for(const replacement of [false,true]){
      const rows=[entry(101,100,'699999999999999999'),entry(102,100,'700000000000000010'),entry(103,100,'800000000000000001')];
      if(replacement) rows.push(entry(100,10,'800000000000000000'));
      // Inject only OS boundary observations. The actual production lineage and
      // creation comparison remains unchanged; inventory mode never terminates.
      let script=readFileSync(native,'utf8');
      script=script.replace(/function Inventory \{[\s\S]*?\n\}/,`function Inventory { return @('${JSON.stringify(rows)}' | ConvertFrom-Json) }`);
      script=script.replace(/function Pin-Handle\(\$Row\) \{[\s\S]*?\n\}/,'function Pin-Handle($Row) {}');
      script=script.replace(/function Native-Exited\(\$Key\) \{[\s\S]*?\n\}/,'function Native-Exited($Key) { return $true }');
      const path=resolve(artifact,`creator-${replacement}.ps1`);writeFileSync(path,script);
      const ownership={rootPid:100,runnerPid:10,executable:root.executable,profile:'',processes:[root]};
      const result=await runCleanupCommand('powershell.exe',['-NoProfile','-File',path,'-Mode','inventory','-OwnershipBase64',Buffer.from(JSON.stringify(ownership)).toString('base64'),'-DeadlineUnixMs',String(Date.now()+9000)],10000);
      writeFileSync(path+'.json',JSON.stringify(result,null,2));expect(result.status).toBe(0);
      const observed=JSON.parse(result.stdout.trim()).ownership.processes.map((p:{pid:number})=>p.pid);
      expect(observed).not.toContain(101);expect(observed).toContain(102);
      if(replacement)expect(observed).not.toContain(103);
    }
  },30000);
  it('rejects a root older than its reused creator and refuses an ambiguous exited-parent child',async()=>{
    mkdirSync(artifact,{recursive:true});
    const root=entry(100,10,'700000000000000000');root.lastSeen='700000000000000100';
    for(const exited of [false,true]){
      const rows=exited?[entry(102,100,'700000000000000200')]:[root,entry(10,1,'800000000000000000')];
      const path=resolve(artifact,`reused-creator-${exited}.ps1`);
      const script=readFileSync(native,'utf8').replace(/function Inventory \{[\s\S]*?\n\}/,`function Inventory { return @('${JSON.stringify(rows)}' | ConvertFrom-Json) }`);
      writeFileSync(path,script);
      const ownership={rootPid:100,runnerPid:10,executable:root.executable,profile:'',processes:exited?[root]:[]};
      const result=await runCleanupCommand('powershell.exe',['-NoProfile','-File',path,'-Mode',exited?'inventory':'capture','-OwnershipBase64',Buffer.from(JSON.stringify(ownership)).toString('base64'),'-DeadlineUnixMs',String(Date.now()+9000)],10000);
      writeFileSync(path+'.json',JSON.stringify(result,null,2));expect(result.status).toBe(1);
      expect(result.stderr).toContain(exited?'Ambiguous browser descendant ownership':'Root predates its captured creator');
      expect(result.stdout).toBe('');
    }
  },30000);
  it('waits for a nonsignaled generation even with empty enumeration',async()=>{
    const child=spawn(process.execPath,['-e',"process.stdin.once('data',()=>setTimeout(()=>process.exit(0),300))"],{windowsHide:true,stdio:['pipe','ignore','ignore']});
    const completion=waitForWorker(child,20000);let captured:number[]=[];
    try{
      captured=ownedProcessTree(child.pid!);
      const ownershipScript=readFileSync(native,'utf8');
      const capture=await runCleanupCommand('powershell.exe',['-NoProfile','-File',native,'-Mode','capture','-OwnershipBase64',Buffer.from(JSON.stringify({rootPid:child.pid,runnerPid:process.pid,executable:process.execPath,profile:'',processes:[]})).toString('base64'),'-DeadlineUnixMs',String(Date.now()+9000)],10000);
      expect(capture.status).toBe(0);const ownership=JSON.parse(capture.stdout.trim()).ownership;
      const path=resolve(artifact,'negative-enumeration.ps1');writeFileSync(path,ownershipScript.replace(/function Inventory \{[\s\S]*?\n\}/,'function Inventory { return @() }'));
      const result=await runCleanupCommand('powershell.exe',['-NoProfile','-File',path,'-Mode','observe','-OwnershipBase64',Buffer.from(JSON.stringify(ownership)).toString('base64'),'-DeadlineUnixMs',String(Date.now()+12000)],13000,undefined,line=>{if(JSON.parse(line).survivors.length)child.stdin.write('exit');});
      writeFileSync(path+'.json',JSON.stringify(result,null,2));expect(result.status).toBe(0);
      const observations=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
      expect(observations[0].survivors.some((p:{pid:number})=>p.pid===child.pid)).toBe(true);
      expect(observations.at(-1).survivors).toEqual([]);expect((await completion).exitCode).toBe(0);
    }finally{if(captured.length)await terminateOwnedProcesses(captured);child.kill();}
  },45000);
});
