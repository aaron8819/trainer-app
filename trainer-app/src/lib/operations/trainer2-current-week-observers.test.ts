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
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { observeWebReadiness } from '../../../scripts/trainer2/web-readiness';

const child=()=>Object.assign(new EventEmitter(),{pid:123,exitCode:null,signalCode:null}) as ChildProcess;
describe('current-week readiness observation',()=>{
  it('lets cold rendering finish within the original total bound and consumes the auth body',async()=>{
    const server=createServer((_req,res)=>setTimeout(()=>res.end('<h1>Trainer2 sign in</h1>'),80));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address() as {port:number}, base='http://127.0.0.1:'+address.port;
    const rows:Record<string,unknown>[]=[];
    try {
      await expect(fetch(base,{signal:AbortSignal.timeout(20)})).rejects.toThrow();
      await observeWebReadiness(base,child(),r=>rows.push(r),1000);
      expect(rows.at(-1)).toMatchObject({status:200,authHeading:true,pid:123,origin:base});
      expect(rows.at(-1)?.bytes).toBeGreaterThan(0);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each([302,200])('rejects a redirect or wrong body at status %s without retrying',async status=>{
    let requests=0;
    const server=createServer((_req,res)=>{requests++;res.writeHead(status,{location:'/elsewhere'});res.end('other page');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,child(),()=>{},1000)).rejects.toThrow('did not match');
      expect(requests).toBe(1);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('aborts an in-flight observation when its exact child exits',async()=>{
    const task=child(),server=createServer(()=>setTimeout(()=>task.emit('exit',1),20));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {await expect(observeWebReadiness('http://127.0.0.1:'+(server.address() as {port:number}).port,task,()=>{},1000)).rejects.toThrow('exited');}
    finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
