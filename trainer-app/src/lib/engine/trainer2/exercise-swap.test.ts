import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHypertrophyPlan } from './plan-builder';
import { catalog } from './catalog';
import { currentAssignment, effectiveOccurrence, replacementContent, swapEligible } from './exercise-swap';
import { startingPounds } from './logging-prefill';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import { library } from './catalog';

function fixture() {
  const document = createHypertrophyPlan();
  const occurrence = document.occurrences[0];
  occurrence.positions[0].targets[0].measurement = { kind: 'externalLoad', value: '60.00', unit: 'kg', convention: 'barbellTotal', zeroMeaning: 'validZero' };
  return { executionId: randomUUID(), contentHash: 'a'.repeat(64), lifecycle: 'Open', results: [], history: [], skips: [], swaps: [], finish: null,
    initial: { occurrence, positions: occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) } } as unknown as ExecutionRead;
}
describe('execution-owned swaps', () => {
  it('derives every replacement from START and restores original load without drift', () => {
    const x = fixture(), positionId = x.initial.positions[0].id;
    const before = structuredClone(x.initial);
    const first = replacementContent(x, positionId, catalog.find(e => e.id === 't2:leg-press')!);
    expect(first.targets.every(t => t.measurement === null)).toBe(true);
    x.swaps = [{ executionId:x.executionId, positionId, version:1, actionId:randomUUID(), previousActionId:null,
      instructionEpoch:0, content:first, contentHash:'b'.repeat(64), recordedAt:new Date().toISOString() }];
    const next = replacementContent(x, positionId, catalog.find(e => e.id === 't2:bulgarian-split-squat')!);
    expect(next.targets[0].reps.basis).toBe('perSide');
    const restore = replacementContent(x,positionId,null);
    expect(restore.targets[0].measurement).toEqual(before.occurrence.positions[0].targets[0].measurement);
    expect(restore.targets.map(t=>t.id)).toEqual(x.initial.positions[0].targets.map(t=>t.id));
    expect(x.initial).toEqual(before);
    expect(replacementContent(x,positionId,catalog.find(e=>e.id==='t2:leg-press')!)).toEqual(first);
  });
  it('retains set role, order, classification, required status, RIR and rest', () => {
    const x=fixture(), original=x.initial.occurrence.positions[0];
    const content=replacementContent(x,x.initial.positions[0].id,catalog.find(e=>e.id==='t2:leg-press')!);
    expect(content.targets.map(t=>({classification:t.classification,required:t.required,rir:t.rir,restSeconds:t.restSeconds})))
      .toEqual(original.targets.map(t=>({classification:t.classification,required:t.required,rir:t.rir,restSeconds:t.restSeconds})));
    expect(content.targets[0].reps).toEqual(original.targets[0].reps);
  });
  it('locks the entire position after retained cleared evidence or explicit skip', () => {
    const x=fixture(), p=x.initial.positions[0];
    expect(swapEligible(x,p.id)).toBe(true);
    x.results=[{targetId:p.targets[1].id,result:null} as ExecutionRead['results'][number]];x.history=x.results;
    expect(swapEligible(x,p.id)).toBe(false);expect(swapEligible(x,x.initial.positions[1].id)).toBe(true);
    x.results=[];x.history=[];x.skips=[{targetId:p.targets[0].id} as NonNullable<ExecutionRead['skips']>[number]];
    expect(swapEligible(x,p.id)).toBe(false);x.skips=[];x.lifecycle='Finished';expect(swapEligible(x,p.id)).toBe(false);
  });
  it('reads immutable snapshots independently of today’s catalog', () => {
    const x=fixture(), positionId=x.initial.positions[0].id;
    const content=replacementContent(x,positionId,catalog[0]);
    if(content.exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
    content.exercise={...content.exercise,catalogId:'t2:retired-unavailable-key',name:'Retired saved snapshot'};
    x.swaps=[{executionId:x.executionId,positionId,version:1,actionId:randomUUID(),previousActionId:null,instructionEpoch:0,content,contentHash:'b'.repeat(64),recordedAt:new Date().toISOString()}];
    expect(effectiveOccurrence(x).positions[0].exercise.name).toBe('Retired saved snapshot');expect(currentAssignment(x,positionId).version).toBe(1);
  });
  it('uses explicit unique catalog keys and leaves unqualified entries unavailable', () => {
    expect(new Set(library.map(e=>e.catalogKey)).size).toBe(library.length);
    expect(library.filter(e=>e.selectable).map(e=>e.catalogId).sort()).toEqual(catalog.map(e=>e.id).sort());
    expect(library.length).toBeGreaterThan(catalog.length);
    expect(library.filter(e=>!e.selectable).every(e=>!!e.unavailableReason)).toBe(true);
  });
  it('rounds suggestions only and retains explicit zero meaning and stored decimal evidence', () => {
    const load={kind:'externalLoad' as const,value:'60.00',unit:'kg' as const,convention:'barbellTotal' as const,zeroMeaning:'validZero' as const};
    expect(startingPounds(load)).toBe('130');expect(load.value).toBe('60.00');
    expect(startingPounds({...load,value:'12.5',unit:'lb'})).toBe('15');expect(startingPounds({...load,value:'0',unit:'lb'})).toBe('0');
  });
});
