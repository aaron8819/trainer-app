import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { PendingExerciseAmendment } from './PendingExerciseAmendment';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import { backExtensionAmendment } from '@/lib/engine/trainer2/plan-exercise-amendment';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import type { AmendPendingExerciseCommand } from '@/lib/trainer2-contracts/plan-exercise-amendment';
const doc=createHypertrophyPlan(), o=doc.occurrences[0], p=o.positions[0];
p.exercise=catalogExercise(catalog.find(e=>e.id==='t2:bodyweight-45-degree-back-extension')!);
p.targets.forEach(t=>{t.reps.basis='total';t.measurement={kind:'bodyweight',convention:'bodyweightOnly'};});
const next: NextWorkoutRead={accountId:'amendment-test',planId:randomUUID(),revisionId:randomUUID(),acceptedSequence:'2',instructionEpoch:0,lifecycle:'Active',execution:null,occurrence:o,
  occurrences:[{occurrenceId:o.id,name:o.name,stageName:'Week 1',status:'Pending',skip:null}],amendmentCandidates:[{occurrenceId:o.id,positionId:p.id}]};
const key=`trainer2-amendment:${next.accountId}:${next.planId}`;
const preview={planId:next.planId,expected:{planRevisionId:next.revisionId,amendmentVersion:0,instructionEpoch:0,effectiveHash:'a'.repeat(64)},content:backExtensionAmendment(doc,next.amendmentCandidates!)};
const response=(body:unknown)=>new Response(JSON.stringify(body));
let command:AmendPendingExerciseCommand;
const fetch=vi.fn(async(url:string,init:RequestInit)=>{
  if(url.endsWith('-preview'))return response(preview);
  command=JSON.parse(init.body as string);
  return response({replayed:false,outcomeCursor:'3',outcome:{status:'Accepted',commandType:'AmendPendingExercise',actionId:command.actionId,acceptedSequence:'3',result:{planId:next.planId,version:1,contentHash:'a'.repeat(64)}}});
});
const refresh=vi.fn(async()=>({...next,acceptedSequence:'3',amendment:{version:1,actionId:command.actionId,contentHash:'a'.repeat(64)}}));
const props={next,ownershipEpoch:0,refresh,onLock:vi.fn()};
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function review(){fireEvent.click(await screen.findByRole('button',{name:'Review pending back extensions'}));await screen.findByRole('button',{name:'Confirm pending exercise update'});}
it('previews explicitly, saves exact positions and unlocks only on bound readback',async()=>{
  render(<PendingExerciseAmendment {...props}/>);await review();expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Confirm pending exercise update'}));
  await screen.findByText('Pending back extensions updated. Completed and started workouts are unchanged.');
  expect(command.intent.positions).toEqual(next.amendmentCandidates);expect(sessionStorage.getItem(key)).toBeNull();
});
it('retains accepted request on stale readback and retries identical envelope after reload',async()=>{
  refresh.mockResolvedValueOnce(next as typeof next & {amendment:{version:number;actionId:string;contentHash:string}});
  const view=render(<PendingExerciseAmendment {...props}/>);await review();fireEvent.click(screen.getByRole('button',{name:'Confirm pending exercise update'}));
  await screen.findByText('Update could not be confirmed. Check again to recover the same request.');
  const exact=sessionStorage.getItem(key);expect(exact).not.toBeNull();view.unmount();
  render(<PendingExerciseAmendment {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Check exercise update'}));
  await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());expect(fetch.mock.calls.at(-1)![1].body).toBe(exact);
});
it('ignores response after unmount and leaves recoverable original envelope',async()=>{
  let deliver!:(value:Response)=>void;
  const view=render(<PendingExerciseAmendment {...props}/>);await review();fetch.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm pending exercise update'}));const exact=sessionStorage.getItem(key);view.unmount();deliver(response({}));
  await new Promise(resolve=>setTimeout(resolve,0));expect(sessionStorage.getItem(key)).toBe(exact);expect(refresh).not.toHaveBeenCalled();
});
