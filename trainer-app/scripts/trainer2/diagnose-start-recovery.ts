import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import assert from 'node:assert/strict';
export async function diagnoseStartRecovery(context: BrowserContext, home: string, artifact: string, restart: () => Promise<void>) {
  const page=await context.newPage(),events:Record<string,unknown>[]=[];
  page.on('console',m=>{if(m.text().includes('[Fast Refresh]'))events.push({event:'refresh',at:new Date().toISOString(),text:m.text()});});
  await page.addInitScript(()=>{
    const prior=window.fetch;
    (window as unknown as {startFailures:number}).startFailures=0;
    window.fetch=async(...args)=>{try{return await prior(...args);}catch(error){if(String(args[0]).includes('/executions/start'))(window as unknown as {startFailures:number}).startFailures++;throw error;}};
  });
  try {
    await page.goto(home);await page.getByRole('button',{name:'Start workout',exact:true}).waitFor();
    let body='';
    const trial=async(label:string,button:string)=>{
      await page.route('**/api/trainer2/executions/start',async route=>{
        const request=route.request().postData()!;if(body)assert.equal(request,body);else body=request;
        const response=await route.fetch();assert.equal(response.status(),200);
        events.push({label,event:'committed-response',at:new Date().toISOString()});
        await route.abort('failed');events.push({label,event:'abort-dispatched',at:new Date().toISOString()});
      },{times:1});
      await page.getByRole('button',{name:button,exact:true}).click();
      let observed=false;
      try{await page.waitForFunction(()=>(window as unknown as {startFailures:number}).startFailures>0,{},{timeout:30000});observed=true;}catch{}
      events.push({label,event:'client-observation',at:new Date().toISOString(),observed,disabled:await page.getByRole('button',{name:'Check again',exact:true}).isDisabled()});
    };
    await trial('cold','Start workout');
    await page.reload();await page.getByRole('button',{name:'Check again',exact:true}).waitFor();
    await trial('warm-exact-envelope','Check again');
    await page.getByRole('button',{name:'Check again',exact:true}).click();
    await page.waitForURL('**/trainer2/dev/executions/*');
    const executionUrl=page.url();await page.close();await restart();
    const resumed=await context.newPage();
    await resumed.exposeFunction('diagnosticInput',(event:string)=>events.push({event,at:new Date().toISOString()}));
    await resumed.addInitScript(()=>{
      const send=(window as unknown as {diagnosticInput:(name:string)=>Promise<void>}).diagnosticInput;
      for(const name of ['pointerdown','pointerup','click','submit'])document.addEventListener(name,()=>void send(name),true);
    });
    await resumed.goto(executionUrl);
    const finish=resumed.getByRole('button',{name:'Finish workout',exact:true});
    await finish.waitFor();
    try {await finish.click({timeout:30000});await resumed.getByRole('button',{name:'Finish anyway',exact:true}).waitFor();events.push({event:'finish-review-observed',at:new Date().toISOString()});}
    catch(error){events.push({event:'finish-input-failed',at:new Date().toISOString(),error:(error as Error).message});}
    finally {await resumed.close();}
    return {diagnosis:true,events};
  } finally {writeFileSync(resolve(artifact,'start-recovery.json'),JSON.stringify(events,null,2));await page.close();}
}
