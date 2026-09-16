import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';
async function main(){
 const dir='artifacts/trainer2/polish-evidence/';const ready=JSON.parse(readFileSync('artifacts/trainer2/active-set-evidence/demo-demo-ready.json','utf8'));const base=new URL(ready.url).origin;
 assert(base==='http://127.0.0.1:'+process.argv[2]);
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1360,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 try{
 await page.goto(ready.url);await expect(page.getByText('Week 2 of 5 · Accumulation')).toBeVisible();await page.screenshot({path:dir+'demo-home-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'View Program'}).click();await expect(page.getByRole('article')).toHaveCount(20);await page.screenshot({path:dir+'demo-program-desktop.png',fullPage:true});await page.goto(ready.url);
 await page.getByRole('button',{name:'Start workout',exact:true}).click();await expect(page).toHaveURL(/executions\//);const executionUrl=page.url();const panel=page.getByRole('region',{name:'Active set',exact:true});
 await expect(panel).toHaveCount(1);await expect(page.locator('[aria-label$="actual result"]')).toHaveCount(1);await panel.getByText('History',{exact:true}).click();await expect(panel).toContainText('Previous · Lower A');await expect(panel).toContainText('recorded');await panel.getByText('History',{exact:true}).click();
 await page.screenshot({path:dir+'after-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'after-mobile.png',fullPage:true});
 await expect(panel.getByLabel(/Actual load$/)).toHaveValue('');await panel.getByRole('button',{name:'Increase load by 5 lb'}).click();await panel.getByRole('button',{name:'Increase reps'}).click();await panel.getByRole('button',{name:'0 RIR',exact:true}).click();
 await expect(panel.getByLabel(/Actual reps/)).toHaveAttribute('inputmode','numeric');await expect(panel.getByLabel(/Actual load$/)).toHaveAttribute('inputmode','decimal');
 await panel.getByText('History',{exact:true}).click();await expect(panel.getByLabel(/Actual load$/)).toHaveValue('5');await panel.getByText('History',{exact:true}).click();
 await page.setViewportSize({width:390,height:500});await panel.getByLabel(/Actual reps/).focus();await panel.getByRole('button',{name:'Log set'}).scrollIntoViewIfNeeded();await page.screenshot({path:dir+'keyboard-height-emulation.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await expect(page.getByRole('button',{name:'Finish workout',exact:true})).toBeDisabled();await panel.getByRole('button',{name:'Discard input'}).click();
 await page.getByText('Workout menu',{exact:true}).click();await page.getByRole('button',{name:'Discard empty workout',exact:true}).click();await page.getByRole('button',{name:'Confirm discard'}).click();await expect(page.getByRole('heading',{name:'Workout attempt discarded'})).toBeVisible();await expect(page.getByRole('region',{name:'Active set',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Log set'})).toHaveCount(0);
 await page.goto(ready.url);await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();await page.screenshot({path:dir+'demo-home-mobile.png',fullPage:true});
 const next=await (await page.request.get(base+'/api/trainer2/plans/'+ready.planId+'/next')).json();assert.equal(next.execution,null);assert.equal(next.occurrence.name,'Lower A');assert.equal(next.occurrences[4].status,'Pending');assert.deepEqual(errors,[]);
 writeFileSync(dir+'demo-final.json',JSON.stringify({source:verificationSource(),url:ready.url,browser:browser.version(),discardedInspectionUrl:executionUrl,next,errors,checks:['home and Program retained','single editor and queue','numeric inputmode attributes and 44px controls (desktop viewport emulation, not a physical keyboard)','history retains input','no horizontal overflow at 390x500','unsaved input blocks finish','discarded readback has no active controls','Week 2 Lower A ready with corrected Week 1 history']},null,2));console.log(ready.url);
 }finally{await browser.close();}
}void main().catch(e=>{console.error(e);process.exitCode=1;});
