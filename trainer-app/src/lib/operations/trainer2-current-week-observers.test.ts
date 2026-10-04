// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { removeOwnedContainer } from '../../../scripts/trainer2/container-cleanup';
import { runCleanupCommand } from '../../../scripts/trainer2/disposable-cleanup';
const result=(status:number|null,stdout='',stderr='',error?:string)=>({status,stdout,stderr,error,signal:null,startedAt:'test'});
describe('current-week container cleanup',()=>{
  it('observes absence after timed-out removal and preserves the first failure',async()=>{
    const calls:string[][]=[], rows:Record<string,unknown>[]=[];
    const replies=[result(0,'a'.repeat(64)+' owner'),result(null,'','','Cleanup command deadline exceeded'),result(1,'','No such object')];
    const command:typeof runCleanupCommand=async(_file,args)=>{calls.push(args);return replies.shift()!;};
    await expect(removeOwnedContainer('task','owner',r=>rows.push(r),command)).rejects.toThrow('Cleanup command deadline exceeded');
    expect(calls).toHaveLength(3);expect(calls[1]).toEqual(['rm','-f','a'.repeat(64)]);
    expect(rows.at(-1)).toMatchObject({phase:'absence',absent:true});
  });
  it('does not delete an adjacent owner or confuse command success with absence',async()=>{
    const command:typeof runCleanupCommand=async()=>result(0,'a'.repeat(64)+' other');
    await expect(removeOwnedContainer('task','owner',()=>{},command)).rejects.toThrow('unowned');
    const replies=[result(0,'a'.repeat(64)+' owner'),result(0),result(0,'still exists')];
    await expect(removeOwnedContainer('task','owner',()=>{},async()=>replies.shift()!)).rejects.toThrow('absence is unqualified');
  });
});
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createHmac, randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { observeWebReadiness } from '../../../scripts/trainer2/web-readiness';

const child=()=>Object.assign(new EventEmitter(),{pid:123,exitCode:null,signalCode:null}) as ChildProcess;
const key=randomBytes(32).toString('hex');
const html='<!doctype html><html><head><title>Trainer</title></head><body><main><h1>Trainer2 sign in</h1><p>Signed out.</p><form action="/trainer2/auth/sign-in" method="post"><label>Passcode<input name="passcode" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><button type="submit">Sign in</button></form></main></body></html>';
function signed(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, signingKey=key) {
  const challenge=new URL(request.url!,'http://localhost').searchParams.get('readiness');
  response.setHeader('content-type','text/html; charset=utf-8');
  response.setHeader('x-trainer2-readiness-pid',String(process.pid));
  response.setHeader('x-trainer2-readiness-proof',createHmac('sha256',signingKey).update(challenge+'\n123\n'+process.pid).digest('hex'));
}
describe('current-week readiness observation',()=>{
  it('lets cold rendering finish within the original total bound and consumes the auth body',async()=>{
    const server=createServer((req,res)=>{signed(req,res);setTimeout(()=>res.end(html),80);});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address() as {port:number}, base='http://127.0.0.1:'+address.port;
    const rows:Record<string,unknown>[]=[];
    try {
      await expect(fetch(base,{signal:AbortSignal.timeout(20)})).rejects.toThrow();
      await observeWebReadiness(base,child(),r=>rows.push(r),{key,budgetMs:2000});
      expect(rows.at(-1)).toMatchObject({status:200,authPageMatched:true,instanceMatched:true,launcherPid:123,responderPid:process.pid,origin:base});
      expect(rows.at(-1)?.bytes).toBeGreaterThan(0);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each([302,404,500])('rejects an unsuccessful response at status %s without retrying',async status=>{
    let requests=0;
    const server=createServer((_req,res)=>{requests++;res.writeHead(status,{location:'/elsewhere'});res.end('other page');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),()=>{},{key,budgetMs:1000})).rejects.toThrow('unsuccessful');
      expect(requests).toBe(1);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('aborts an in-flight observation when its exact child exits',async()=>{
    const task=child(),server=createServer(()=>setTimeout(()=>task.emit('exit',1),20));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,task,()=>{},{key,budgetMs:1000})).rejects.toThrow('exited');}
    finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each([
    ['heading only','<!doctype html><html><body><main><h1>Trainer2 sign in</h1></main></body></html>'],
    ['script string','<!doctype html><html><body><script>'+JSON.stringify(html)+'</script></body></html>'],
    ['error marker',html.replace('<main>','<main data-next-error-message="render failed">')],
    ['wrong form',html.replace('/trainer2/auth/sign-in','/other')],
    ['hidden form',html.replace('<form ','<form hidden ')],
    ['truncated',html.replace('</body></html>','')],
  ])('rejects misleading HTML: %s',async(_name,body)=>{
    const server=createServer((req,res)=>{signed(req,res);res.end(body);});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),()=>{},{key,budgetMs:2000})).rejects.toThrow('auth page mismatch');}
    finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('rejects the exact unrelated-process 40-byte text-error counterexample without attributing its PID',async()=>{
    const task=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
    const completion=waitForWorker(task,10000), rows:Record<string,unknown>[]=[];
    const server=createServer((_req,res)=>{res.setHeader('content-type','text/plain');res.end('Trainer2 sign in: upstream render failed');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,task,r=>rows.push(r),{key,budgetMs:2000})).rejects.toThrow('instance mismatch');
      expect(rows.at(-1)).toMatchObject({launcherPid:task.pid,responderPid:null,htmlContentType:false,instanceMatched:false});
      expect(JSON.stringify(rows)).not.toContain(key);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));task.kill();await completion;}
  });
  it.each(['other key','missing proof','text content type','200 redirect','replayed proof','forged PID'])('rejects a misleading response with %s',async variant=>{
    const server=createServer((req,res)=>{
      signed(req,res,variant==='other key'?'b'.repeat(64):key);
      if(variant==='missing proof')res.removeHeader('x-trainer2-readiness-proof');
      if(variant==='text content type')res.setHeader('content-type','text/plain');
      if(variant==='200 redirect')res.setHeader('location','/secret?token=do-not-record');
      if(variant==='replayed proof')res.setHeader('x-trainer2-readiness-proof',createHmac('sha256',key).update('previous-challenge\n123\n'+process.pid).digest('hex'));
      if(variant==='forged PID')res.setHeader('x-trainer2-readiness-pid','42');
      res.end(html);
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const rows:Record<string,unknown>[]=[];
    try {
      await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),r=>rows.push(r),{key,budgetMs:2000})).rejects.toThrow();
      expect(JSON.stringify(rows)).not.toContain('do-not-record');expect(JSON.stringify(rows)).not.toContain(key);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('rejects an already-dead launched instance before probing',async()=>{
    const task=child();Object.assign(task,{exitCode:1});
    await expect(observeWebReadiness('http://127.0.0.1:1',task,()=>{},{key,budgetMs:1000})).rejects.toThrow('exited');
  });
  it('bounds a connected request that never completes',async()=>{
    const server=createServer(()=>{});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),()=>{},{key,budgetMs:80})).rejects.toThrow('deadline');}
    finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('qualifies a real launched instance and distinguishes its inherited HTTP child PID',async()=>{
    const task=spawn(process.execPath,['--require',resolve('scripts/trainer2/web-readiness-preload.cjs'),resolve('scripts/fixtures/trainer2-ready-server.cjs')],{
      env:{...process.env,TRAINER2_READINESS_KEY:key},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const completion=waitForWorker(task,15000);
    try {
      const [message]=await once(task,'message',{signal:AbortSignal.timeout(5000)});const {port,pid}=message as {port:number;pid:number};
      const rows:Record<string,unknown>[]=[];
      await observeWebReadiness('http://127.0.0.1:'+port,task,r=>rows.push(r),{key,budgetMs:2000});
      expect(pid).not.toBe(task.pid);expect(rows.at(-1)).toMatchObject({launcherPid:task.pid,responderPid:pid,instanceMatched:true,authPageMatched:true});
      const mismatched=child();
      await expect(observeWebReadiness('http://127.0.0.1:'+port,mismatched,()=>{},{key,budgetMs:2000})).rejects.toThrow('instance mismatch');
    }finally{task.send('stop');expect(await completion).toMatchObject({exitCode:0,timedOut:false});}
  },20000);
});

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForWorker } from '../../../scripts/trainer2/disposable-cleanup';
it.skipIf(process.platform !== 'win32')('does not count a stale CIM row after native absence is established for the captured identity',async()=>{
  const task=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const completion=waitForWorker(task,15000), artifact=resolve('artifacts/trainer2/verification-correction');
  mkdirSync(artifact,{recursive:true});
  const metadata=await runCleanupCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${task.pid}' | Select-Object ProcessId,ParentProcessId,@{n='created';e={$_.CreationDate.ToUniversalTime().Ticks.ToString()}},ExecutablePath | ConvertTo-Json -Compress`],5000);
  expect(metadata.status).toBe(0);
  const row=JSON.parse(metadata.stdout), created=String(row.created);
  task.kill();expect((await completion).timedOut).toBe(false);
  const ownership={rootPid:task.pid,runnerPid:process.pid,executable:row.ExecutablePath,profile:'C:\\unused-fixture',processes:[{pid:task.pid,parentPid:row.ParentProcessId,created,executable:row.ExecutablePath,lastSeen:created}]};
  const fixture=resolve(artifact,'stale-cim-fixture.ps1');
  const quote=(x:string)=>"'"+x.replaceAll("'","''")+"'";
  writeFileSync(fixture,`function Get-CimInstance { [pscustomobject]@{ProcessId=${task.pid};ParentProcessId=${row.ParentProcessId};CreationDate=[datetime]::new(${created},[DateTimeKind]::Utc);ExecutablePath=${quote(row.ExecutablePath)};Name='node.exe';CommandLine='fixture'} }\n& ${quote(resolve('scripts/trainer2/browser-tree.ps1'))} -Mode observe -OwnershipBase64 ${quote(Buffer.from(JSON.stringify(ownership)).toString('base64'))} -DeadlineUnixMs ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+2500)\n`);
  const result=await runCleanupCommand('powershell.exe',['-NoProfile','-NonInteractive','-File',fixture],5000);
  writeFileSync(resolve(artifact,'stale-cim-result.json'),JSON.stringify(result,null,2));
  expect(result.status,result.stderr||result.error).toBe(0);
  expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({survivors:[]});
},20000);

it('rejects late readiness even when blocked scheduling delays the abort callback',async()=>{
  const server=createServer((req,res)=>{signed(req,res);res.end(html);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100),{key,budgetMs:80})).rejects.toThrow('deadline exceeded');
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
