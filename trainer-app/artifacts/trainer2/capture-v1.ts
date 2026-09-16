import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

async function main() {
  const [base] = process.argv.slice(2); assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const dir = 'artifacts/trainer2/active-set-evidence/';
  const old = execFileSync('git', ['show', '28e64e6057fcc432e7fca02e0de7629f013d287d:trainer-app/src/components/trainer2/SetResultRow.tsx'], { encoding: 'utf8', windowsHide: true });
  writeFileSync(dir + 'old-set-row.tsx', old.replace("'./DraftEditor'", "'@/components/trainer2/DraftEditor'"));
  writeFileSync(dir + 'pattern-fixture.tsx', `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SetResultRow as Old } from './old-set-row';
import { SetResultRow as New } from '@/components/trainer2/SetResultRow';
import { WorkoutActiveSetCard } from '@/components/log-workout/WorkoutActiveSetCard';
import { WorkoutExerciseQueue } from '@/components/log-workout/WorkoutExerciseQueue';
import { ExerciseSetChipsEditor } from '@/components/log-workout/ExerciseSetChipsEditor';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
const position = createHypertrophyPlan().occurrences[0].positions[0];
const executionId = crypto.randomUUID(), ids = [crypto.randomUUID(), crypto.randomUUID()], saved = new Map<string, import('@/lib/trainer2-contracts/set-results').SavedSetResult>();
window.fetch = async (_url, init) => {
 const c = JSON.parse(init!.body as string), r = { ...c.target, performedSetId: crypto.randomUUID(), version: 1, result: c.intent.result, reason: null, actionId: c.actionId, recordedAt: new Date().toISOString() };
 saved.set(c.target.targetId,r);
 return new Response(JSON.stringify({replayed:false,outcomeCursor:'1',outcome:{status:'Accepted',actionId:c.actionId,commandType:c.commandType,acceptedSequence:'1',result:{...c.target,performedSetId:r.performedSetId,version:1}}}));
};
function App() {
 const [rows,setRows]=useState<import('@/lib/trainer2-contracts/set-results').SavedSetResult[]>([]); const mode=new URL(location.href).searchParams.get('mode');
 if(mode==='v1') {
 const set={setId:'fixture-set',setIndex:1,targetReps:8,targetRepRange:{min:6,max:10},targetLoad:70,actualReps:8,actualLoad:70};
 const exercise={workoutExerciseId:'fixture-exercise',name:'Synthetic barbell squat',isMainLift:true,equipment:['barbell'],sets:[set]};
 const noop=()=>{};
 return <><h1 className="text-xl font-semibold">V1 source components · synthetic presentation fixture</h1><WorkoutActiveSetCard activeSet={{section:'main',sectionLabel:'Main lift',exerciseIndex:0,setIndex:0,exercise,set}} activeSetPanelRef={{current:null}}
 summary={{loggedCount:0,totalSets:13,stickyOffset:0,isEditing:false,editingSetLabel:null,canReturnToLiveSet:false,autoregHintMessage:null,savingSetId:null,status:null}}
 draftState={{draftBuffersBySet:{},prefilledFieldsBySet:{},touchedFieldsBySet:{},restoredSetIds:new Set(),savingDraftSetId:null,lastSavedDraft:null}}
 formActions={new Proxy({}, {get:()=>noop}) as React.ComponentProps<typeof WorkoutActiveSetCard>['formActions']} isDumbbellExercise={()=>false} toInputNumberString={v=>v==null?'':String(v)} parseNullableNumber={v=>v===''?null:Number(v)} resolvedValues={{actualReps:8,actualLoad:70,actualRpe:null}} onLogSet={noop} onReturnToCurrentSet={noop} onSkipSet={noop}/>
 <WorkoutExerciseQueue remainingCount={13} sectionRefs={{current:{warmup:null,main:null,accessory:null}}} onToggleSection={noop} onToggleExercise={noop} onSelectSet={noop} sections={[{section:'main',isExpanded:true,collapsedSummaries:[],exercises:[{section:'main',exerciseId:'squat',exerciseName:'Synthetic barbell squat',muscleTags:[],muscleTagGroups:{primaryMuscles:[],secondaryMuscles:[]},isRuntimeAdded:false,loggedCount:0,totalSets:3,allSetsLogged:false,isExpanded:true,nextSetId:'a',chips:[{setId:'a',label:'Set 1',isLogged:false,isActive:true,isSaving:false},{setId:'b',label:'Set 2',isLogged:false,isActive:false,isSaving:false},{setId:'c',label:'Set 3',isLogged:false,isActive:false,isSaving:false}],canAddSet:false,isAddingSet:false,canSwap:false,isSwapping:false,canRemove:false,isRemoving:false}]}]}/></>;
 }
 const Row=mode==='old'?Old:New;
 return <><h1 className="text-xl font-semibold">{mode} Trainer2 · synthetic recording fixture</h1>{ids.map((id,i)=><Row key={id} accountId="synthetic-patterns" ownershipEpoch={0} executionId={executionId} targetId={id} number={i+1} saved={rows.find(r=>r.targetId===id)} prescription={position.targets[0]} exercise={position.exercise} unitHint={rows.length?'kg':undefined} refresh={async()=>{const next=[...saved.values()];setRows(next);return next;}}/>)}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
`);
  await build({ entryPoints: [dir + 'pattern-fixture.tsx'], bundle: true, outfile: dir + 'pattern-fixture.js', platform: 'browser', jsx: 'automatic', alias: { '@': resolve('src') }, define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/trainer2/dev/drafts');
    const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(l => (l as HTMLLinkElement).href));
    const css = (await Promise.all(styles.map(async url => (await page.request.get(url)).text()))).join('\n');
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="root" class="mx-auto max-w-2xl space-y-4 p-4"></main><script>${readFileSync(dir + 'pattern-fixture.js','utf8')}</script></body></html>`;
    await page.route('**/pattern-fixture?*', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(base + '/pattern-fixture?mode=v1'); await expect(page.getByRole('heading',{name:'Synthetic barbell squat'})).toBeVisible();
    await page.screenshot({ path: dir + 'v1-patterns-mobile.png', fullPage: true });
    await page.setViewportSize({width:1360,height:1000});await page.screenshot({path:dir+'v1-patterns-desktop.png',fullPage:true});
  } finally { await browser.close(); }
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
