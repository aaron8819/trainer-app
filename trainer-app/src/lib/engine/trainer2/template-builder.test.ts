import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { draftDocument, editDraftCommand, type DraftDocument } from '../../trainer2-contracts/draft';
import { createHypertrophyPlan, expandWorkoutDefaults, markOverride, resetField, restoreWeek, sharedSwapConflicts } from './plan-builder';
import { catalog, catalogExercise, browseCatalog, swapPrescription } from './catalog';
import { editDocument, identities, validateWorkoutDefaults } from './planning';
import { draftEdits } from '../../../components/trainer2/draft-edits';
const exercise = (key: string) => catalogExercise(catalog.find(e=>e.id===`t2:${key}`)!);
function roundTrip(before: DraftDocument, after: DraftDocument) {
  const command = editDraftCommand.parse({ schemaVersion:1,commandType:'EditDraft',actionId:randomUUID(),originatingAccountId:'test',deviceId:randomUUID(),ownershipEpoch:0,dependsOn:[],target:{planId:randomUUID()},expected:{planRevisionId:randomUUID()},intent:{operations:draftEdits(before,after)} });
  return draftDocument.parse(JSON.parse(JSON.stringify(editDocument(before,command,new Set(identities(before).map(i=>i.id))))));
}
describe('populated Trainer2 template and explicit inheritance',()=>{
  it('resets individual set overrides to the explicit row value even when all sets were overridden',()=>{
    const before=createHypertrophyPlan(),d=structuredClone(before),o=d.occurrences[0],p=o.positions[0];
    markOverride(o,p.id,['restSeconds'],{restSeconds:'90'});
    o.overrides!.targets=Object.fromEntries(p.targets.map(t=>[t.id,['restSeconds']]));
    p.targets.forEach(t=>{t.restSeconds='123';});
    const saved=roundTrip(before,expandWorkoutDefaults(d)),reset=structuredClone(saved);
    delete reset.occurrences[0].overrides!.targets![p.targets[0].id];
    const result=roundTrip(saved,expandWorkoutDefaults(reset));
    expect(result.occurrences[0].positions[0].targets.map(t=>t.restSeconds)).toEqual(['90','123','123']);
  });
  it('requires explicit removal of affected week edits for a shared removal',()=>{
    const d=createHypertrophyPlan(),o=d.occurrences[0],p=o.positions[0];markOverride(o,p.id,['reps']);
    const removed=structuredClone(d);removed.builder!.workouts[0].rows.shift();
    expect(draftDocument.safeParse(expandWorkoutDefaults(removed)).success).toBe(false);
    delete removed.occurrences[0].overrides!.fields[p.id];
    expect(roundTrip(d,expandWorkoutDefaults(removed)).occurrences[0].positions.some(x=>x.id===p.id)).toBe(false);
  });
  it('copies a complete versioned program with actual deload and unique occurrence identities',()=>{
    const d=draftDocument.parse(createHypertrophyPlan()); validateWorkoutDefaults(d);
    expect(d.builder!.workouts.map(w=>w.rows.length)).toEqual([5,6,5,7]);
    expect(d.occurrences.every(o=>o.positions.every(p=>p.exercise.kind==='catalogSnapshot'&&p.targets.length))).toBe(true);
    expect(d.occurrences.filter(o=>o.name==='Lower A').map(o=>[o.positions[0].targets.length,o.positions[0].targets[0].rir])).toEqual([[3,'3'],[3,'3'],[3,'2'],[3,'1'],[2,'4']]);
    expect(new Set(identities(d).map(i=>i.id)).size).toBe(identities(d).length);
    expect(expandWorkoutDefaults(d)).toEqual(d);
  });
  it('persists explicit equal-valued overrides, propagates unrelated fields, and resets to current shared values',()=>{
    const initial=createHypertrophyPlan(), d=structuredClone(initial), o=d.occurrences[8], p=o.positions[0];
    markOverride(o,p.id,['reps']); // No value comparison: explicitly equal to the original default.
    const saved=roundTrip(initial,d), next=structuredClone(saved);
    next.builder!.workouts[0].rows[0].prescription.reps.min=7;
    next.builder!.workouts[0].rows[0].prescription.restSeconds='120';
    const changed=roundTrip(saved,expandWorkoutDefaults(next));
    expect(changed.occurrences[8].positions[0].targets[0]).toMatchObject({reps:{min:6},restSeconds:'120'});
    expect(changed.occurrences[0].positions[0].targets[0].reps.min).toBe(7);
    const reset=roundTrip(changed,resetField(changed,o.id,p.id,'reps'));
    expect(reset.occurrences[8].positions[0].targets[0].reps.min).toBe(7);
    expect(identities(reset)).toEqual(identities(initial));
  });
  it('keeps week swaps stable and measurement-safe while unrelated defaults continue to propagate',()=>{
    const before=createHypertrophyPlan(), d=structuredClone(before), o=d.occurrences[8], p=o.positions[0];
    const next=exercise('bulgarian-split-squat');
    markOverride(o,p.id,['exercise','reps','measurement']);
    p.targets=p.targets.map(t=>({...swapPrescription(p.exercise,next,t),id:t.id}));p.exercise=next;
    d.builder!.workouts[0].rows[0].sets=4;
    const saved=roundTrip(before,expandWorkoutDefaults(d));
    expect(saved.occurrences[8].positions[0]).toMatchObject({id:p.id,exercise:{catalogId:'t2:bulgarian-split-squat'}});
    expect(saved.occurrences[8].positions[0].targets).toHaveLength(4);
    expect(saved.occurrences[8].positions[0].targets.every(t=>t.reps.basis==='perSide'&&t.measurement===null)).toBe(true);
    const reset=roundTrip(saved,resetField(saved,o.id,p.id,'exercise'));
    expect(reset.occurrences[8].positions[0].exercise).toEqual(before.occurrences[8].positions[0].exercise);
  });
  it('preserves week additions/removals/order through shared structural edits and resets deliberately',()=>{
    const before=createHypertrophyPlan(),d=structuredClone(before),o=d.occurrences[4],removed=o.positions[1];
    o.overrides={removed:[removed.sourceKey!],order:true,fields:{}};o.positions.splice(1,1);o.positions.reverse();
    const custom={id:randomUUID(),exercise:{kind:'authoredDescription' as const,name:'My exercise',variation:''},targets:[]};o.positions.push(custom);
    d.builder!.workouts[0].rows.reverse();
    const saved=roundTrip(before,expandWorkoutDefaults(d));
    expect(saved.occurrences[4].positions.map(p=>p.id)).toEqual(o.positions.map(p=>p.id));
    const restored=roundTrip(saved,restoreWeek(saved,o.id));
    expect(restored.occurrences[4].positions.some(p=>p.id===custom.id)).toBe(false);
    expect(restored.occurrences[4].positions.find(p=>p.sourceKey===removed.sourceKey)!.id).not.toBe(removed.id);
  });
  it('identifies destructive swap conflicts and rejects incompatible saved measurement meaning',()=>{
    const d=createHypertrophyPlan(),o=d.occurrences[0],p=o.positions[0];
    markOverride(o,p.id,['measurement']);p.targets.forEach(t=>{t.measurement={kind:'externalLoad',value:'20',unit:'kg',convention:'barbellTotal',zeroMeaning:'notAllowed'};});
    expect(sharedSwapConflicts(d,p.sourceKey!,exercise('goblet-squat'))).toHaveLength(1);
    p.exercise=exercise('goblet-squat');expect(draftDocument.safeParse(d).success).toBe(false);
  });
  it('preserves legacy detached content without inferred catalog or override provenance',()=>{
    const d=createHypertrophyPlan(undefined,true);delete d.builder!.starterVersion;
    d.occurrences[0].weekOverride=true;d.occurrences[0].positions.push({id:randomUUID(),exercise:{kind:'authoredDescription',name:'Barbell Back Squat',variation:'My wording'},targets:[]});
    const parsed=draftDocument.parse(JSON.parse(JSON.stringify(d)));
    expect(expandWorkoutDefaults(parsed)).toEqual(d);
    expect(parsed.occurrences[0].positions[0].exercise.kind).toBe('authoredDescription');
  });
});
describe('bounded catalog',()=>{
  it('searches aliases, distinguishes equipment, and ranks purpose before shared muscles',()=>{
    expect(browseCatalog('RDL',[]).map(e=>e.name)).toEqual(expect.arrayContaining(['Barbell Romanian Deadlift','Dumbbell Romanian Deadlift']));
    expect(browseCatalog('',[],exercise('barbell-back-squat'))[0].purpose).toBe('squat');
    expect(browseCatalog('', ['Dumbbell','Bench']).every(e=>e.equipment.every(x=>['Dumbbell','Bench'].includes(x)))).toBe(true);
    expect(browseCatalog('no-such-exercise',[])).toEqual([]);
  });
  it('clears load even for compatible swaps and never transfers assistance or unilateral conventions',()=>{
    const row=createHypertrophyPlan().builder!.workouts[0].rows[0];
    row.prescription.measurement={kind:'externalLoad',value:'60.00',unit:'lb',convention:'barbellTotal',zeroMeaning:'notAllowed'};
    expect(swapPrescription(row.exercise,exercise('front-squat'),row.prescription)).toMatchObject({measurement:null,reps:row.prescription.reps});
    expect(swapPrescription(row.exercise,exercise('bulgarian-split-squat'),row.prescription).reps.basis).toBe('perSide');
    expect(swapPrescription(exercise('machine-assisted-pull-up'),exercise('pull-up'),row.prescription).measurement).toEqual({kind:'bodyweight',convention:'bodyweightOnly'});
  });
});
