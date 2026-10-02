import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createHypertrophyPlan } from './plan-builder';
import { catalog, catalogExercise, library } from './catalog';
import { executionPositions } from './execution-targets';
import { effectiveOccurrence, replacementContent, swapEligible } from './exercise-swap';
import { addExerciseCommand, ADD_EXERCISE_POLICY } from '../../trainer2-contracts/add-exercise';
import { reviewedResults, unrecordedTargets } from '../../trainer2-contracts/workout-finish';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
function fixture() {
 const occurrence=createHypertrophyPlan().occurrences[0];
 const x={executionId:randomUUID(),contentHash:'a'.repeat(64),lifecycle:'Open',results:[],history:[],skips:[],swaps:[],finish:null,
 initial:{occurrence,positions:occurrence.positions.map(p=>({id:randomUUID(),sourcePositionId:p.id,targets:p.targets.map(t=>({id:randomUUID(),sourceTargetId:t.id}))}))}} as unknown as ExecutionRead;
 x.exerciseAdditions=Array.from({length:2},(_,i)=>({executionId:x.executionId,actionId:randomUUID(),contentHash:'b'.repeat(64),recordedAt:new Date().toISOString(),content:{policyVersion:ADD_EXERCISE_POLICY,ordinal:x.initial.positions.length+i+1,position:{id:randomUUID(),role:'Accessory',exercise:catalogExercise(catalog.find(e=>e.id==='t2:leg-press')!) as ReturnType<typeof catalogExercise> & {kind:'catalogSnapshot'},targets:Array.from({length:2},()=>({id:randomUUID(),classification:'working',required:true,reps:{min:8,max:12,basis:'total'},rir:'2',restSeconds:'120',measurement:{kind:'externalLoad',value:'0.00',unit:'lb',convention:'machineDisplayed',zeroMeaning:'validZero'}}))}}}));
 return x;
}
describe('execution-local exercise additions',()=>{
 it('keeps duplicate positions distinct with no source identity and requires their sets at finish',()=>{
  const x=fixture(), frozen=structuredClone(x.initial), positions=executionPositions(x), added=positions.slice(x.initial.positions.length);
  expect(added.map(p=>p.sourcePositionId)).toEqual([null,null]);
  expect(new Set(added.flatMap(p=>[p.id,...p.targets.map(t=>t.id)])).size).toBe(6);
  expect(effectiveOccurrence(x).positions.slice(-2).map(p=>p.exercise.name)).toEqual(['Leg Press','Leg Press']);
  expect(reviewedResults(x).results.filter(r=>added.some(p=>p.targets.some(t=>t.id===r.targetId)))).toHaveLength(4);
  expect(unrecordedTargets(x).slice(-4).every(t=>t.required)).toBe(true);
  expect(x.initial).toEqual(frozen);
 });
 it('restores accepted authored targets and zero load after replacements and locks retained evidence',()=>{
  const x=fixture(), p=x.exerciseAdditions![0].content.position;
  expect(replacementContent(x,p.id,null).targets).toEqual(p.targets);
  const changed=replacementContent(x,p.id,catalog.find(e=>e.id==='t2:push-up')!);
  expect(changed.targets.every(t=>t.measurement?.kind==='bodyweight')).toBe(true);
  expect(swapEligible(x,p.id)).toBe(true);
  x.history=[{targetId:p.targets[0].id,result:null} as never];
  expect(swapEligible(x,p.id)).toBe(false);
 });
 it('rejects invalid counts, rep ranges and zero semantics while preserving the 59 exclusions',()=>{
  const x=fixture();const command={schemaVersion:1,commandType:'AddExercise',actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:'account',ownershipEpoch:0,dependsOn:[],target:{executionId:x.executionId},expected:{contentHash:x.contentHash},intent:{catalogId:'t2:leg-press',sets:2,reps:{min:8,max:12,basis:'total'},rir:'2',startingLoad:null}};
  expect(addExerciseCommand.safeParse(command).success).toBe(true);
  expect(addExerciseCommand.safeParse({...command,intent:{...command.intent,sets:0}}).success).toBe(false);
  expect(addExerciseCommand.safeParse({...command,intent:{...command.intent,reps:{min:12,max:8,basis:'total'}}}).success).toBe(false);
  expect(library.filter(e=>!e.selectable)).toHaveLength(59);
 });
});
