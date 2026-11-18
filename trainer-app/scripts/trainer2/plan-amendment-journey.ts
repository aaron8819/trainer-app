import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import type { ServerPrincipal } from '../../src/lib/api/trainer2/principal';
import { readExecution } from '../../src/lib/api/trainer2/execution';
import { readDraft } from '../../src/lib/api/trainer2/planning';
import { canonicalJson } from '../../src/lib/api/trainer2/integrity';
const expect = baseExpect.configure({timeout:30_000});
export async function pendingExerciseAmendmentJourney({page,base,artifact,reader,principal,fixture,pass}:{
  page:Page;base:string;artifact:string;reader:PrismaClient;principal:ServerPrincipal;
  fixture:{planId:string;completedExecutionId:string;pendingOccurrenceId:string};pass:(message:string)=>void;
}) {
  const original=(await readDraft(reader,principal,fixture.planId))!;
  const history=(await readExecution(reader,principal,fixture.completedExecutionId))!;
  const home=`${base}/trainer2/dev/drafts?planId=${fixture.planId}`;
  await page.setViewportSize({width:390,height:844});
  await page.goto(home+'&view=program');
  await page.getByRole('button',{name:'Review pending back extensions',exact:true}).click();
  const panel=page.getByRole('region',{name:'Pending exercise update'});
  await expect(panel).toContainText('1 pending exercise positions');
  await page.screenshot({path:resolve(artifact,'pending-amendment-preview-390.png'),fullPage:true});
  await panel.getByRole('button',{name:'Confirm pending exercise update',exact:true}).click();
  await expect(panel).toContainText('Pending back extensions updated.');
  await page.reload();
  const pending=page.locator(`[data-occurrence-id="${fixture.pendingOccurrenceId}"]`);
  await pending.locator('summary').first().click();
  await expect(pending.getByRole('heading',{name:'45-Degree Back Extension',exact:true})).toBeVisible();
  await expect(pending.getByRole('heading',{name:'Bodyweight 45-Degree Back Extension',exact:true})).toHaveCount(0);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:resolve(artifact,`pending-amendment-program-${width}.png`),fullPage:true});
  }
  assert.equal(canonicalJson((await readDraft(reader,principal,fixture.planId))!.intent),canonicalJson(original.intent));
  assert.equal(canonicalJson(await readExecution(reader,principal,fixture.completedExecutionId)),canonicalJson(history));
  await page.goto(home);
  await page.getByRole('button',{name:new RegExp(`Select .*Pending`)}).click();
  await page.getByRole('button',{name:'Start workout',exact:true}).click();
  await page.waitForURL(/\/trainer2\/dev\/executions\//);
  const executionId=page.url().split('/').at(-1)!;
  const started=(await readExecution(reader,principal,executionId))!;
  assert.equal(started.initial.amendment?.version,1);
  assert.equal(started.initial.occurrence.positions[0].exercise.name,'45-Degree Back Extension');
  const active=page.getByRole('region',{name:'Active set'});
  await expect(active.getByLabel('Set 1 Actual load',{exact:true})).toBeVisible();
  await active.getByLabel('Set 1 Actual reps',{exact:true}).fill('12');
  await active.getByLabel('Set 1 Actual load',{exact:true}).fill('0');
  await expect(active.getByRole('button',{name:'Log set',exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(artifact,'pending-amendment-start-bodyweight-320.png'),fullPage:true});
  await active.getByLabel('Set 1 Actual load',{exact:true}).fill('25');
  await active.getByRole('button',{name:'Log set',exact:true}).click();
  await expect.poll(async()=> (await readExecution(reader,principal,executionId))!.results[0]?.result?.measurement).toEqual({kind:'addedLoad',value:'25',unit:'lb',convention:'addedExternal',zeroMeaning:'noAddedLoad'});
  assert.equal(canonicalJson(await readExecution(reader,principal,fixture.completedExecutionId)),canonicalJson(history));
  pass('Program future-only amendment preview/confirm/reload at390/320, unchanged accepted source/completed history, bound START and0/25lb logging');
}
