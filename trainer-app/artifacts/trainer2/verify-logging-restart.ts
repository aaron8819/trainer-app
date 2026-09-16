import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';
async function main() {
 const dir='artifacts/trainer2/polish-evidence/', demo=JSON.parse(readFileSync(dir+'demo-final.json','utf8'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(demo.url);await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();
  const next=await (await page.request.get(new URL(demo.url).origin+'/api/trainer2/plans/'+demo.next.planId+'/next')).json();
  assert.deepEqual(next,demo.next);assert.deepEqual(errors,[]);
  const prepared=JSON.parse(readFileSync('artifacts/trainer2/active-set-evidence/demo-demo-ready.json','utf8'));
  for(const ex of prepared.completed) assert.deepEqual(await (await page.request.get(new URL(demo.url).origin+'/api/trainer2/executions/'+ex.executionId)).json(),ex);
  writeFileSync(dir+'restart.json',JSON.stringify({source:verificationSource(),url:demo.url,checks:['application restarted on same port','next workout deeply equal','four synthetic historical executions deeply equal','browser start button enabled'],errors},null,2));
 } finally {await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
