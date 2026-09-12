import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { changeSetCount, createHypertrophyPlan, SetCountConflict, type Position } from './plan-builder';
import { catalog, catalogExercise } from './catalog';
import { draftDocument, editDraftCommand } from '../../trainer2-contracts/draft';
import { draftEdits } from '../../../components/trainer2/draft-edits';
import { editDocument, identities } from './planning';

function fixture(custom = false) {
  const doc = createHypertrophyPlan(), occurrence = doc.occurrences[8];
  const position: Position = structuredClone(occurrence.positions[0]);
  position.id = randomUUID(); delete position.sourceKey;
  position.exercise = custom ? { kind: 'authoredDescription', name: 'Synthetic custom', variation: '' }
    : catalogExercise(catalog.find(e => e.id === 't2:front-squat')!);
  position.targets.forEach(t => { t.id = randomUUID(); });
  occurrence.positions.push(position);
  const scope = { occurrenceId: occurrence.id, key: position.id };
  return { doc: changeSetCount(doc, scope, 5), scope };
}
function accepted(before: ReturnType<typeof fixture>['doc'], after: typeof before) {
  const command = editDraftCommand.parse({ schemaVersion: 1, actionId: randomUUID(), originatingAccountId: 'test', deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], commandType: 'EditDraft', target: { planId: randomUUID() }, expected: { planRevisionId: randomUUID() }, intent: { operations: draftEdits(before, after) } });
  return editDocument(before, command, new Set(identities(before).map(i => i.id)));
}
describe('independent set reduction', () => {
  it('reproduces Lower A / Week 3 Front Squat, five sets, Set 5 rest 123.00 after reload', () => {
    const { doc, scope } = fixture(); doc.occurrences[8].positions[5].targets[4].restSeconds = '123.00';
    const loaded = draftDocument.parse(JSON.parse(JSON.stringify(doc)));
    expect(() => changeSetCount(loaded, scope, 3)).toThrow(SetCountConflict);
    try { changeSetCount(loaded, scope, 3); } catch (error) {
      expect((error as SetCountConflict).affected.join('; ')).toContain('Week 3, Lower A, Front Squat, Set 5');
      expect((error as SetCountConflict).affected.join('; ')).toContain('123.00');
    }
  });
  it.each([false, true])('cancel/confirm retains exact authored data and unrelated edits; regrowth has fresh IDs (custom=%s)', custom => {
    const { doc, scope } = fixture(custom), o = doc.occurrences[8], p = o.positions[5];
    p.targets[0].restSeconds = '77.00';
    p.targets[3].reps = { min: 9, max: 19, basis: custom ? 'perSide' : 'total' };
    p.targets[3].rir = '0'; p.targets[4].rir = '1.50'; p.targets[4].restSeconds = '123.00';
    p.targets[4].measurement = { kind: 'externalLoad', value: '42.500', unit: 'lb', convention: custom ? 'perImplement' : 'barbellTotal', zeroMeaning: 'notAllowed' };
    p.targets[4].classification = 'optionalFinisher'; p.targets[4].required = false;
    doc.name = 'Pending unrelated edit';
    const other = o.positions[1]; o.overrides = { removed: [], order: true, fields: { [other.id]: ['rir'] }, values: { [other.id]: { rir: '0' } } };
    other.targets.forEach(t => { t.rir = '0'; });
    const before = structuredClone(doc);
    expect(() => changeSetCount(doc, scope, 3)).toThrow(SetCountConflict);
    expect(doc).toEqual(before);
    const next = changeSetCount(doc, scope, 3, true);
    const expected = structuredClone(before); expected.occurrences[8].positions[5].targets.splice(3);
    expect(next).toEqual(expected);
    const saved = accepted(doc, next), reloaded = draftDocument.parse(JSON.parse(JSON.stringify(saved)));
    expect(reloaded).toEqual(expected);
    const grown = changeSetCount(reloaded, scope, 5), targets = grown.occurrences[8].positions[5].targets;
    expect(targets.slice(0, 3)).toEqual(p.targets.slice(0, 3));
    for (const t of targets.slice(3)) {
      expect(p.targets.map(t => t.id)).not.toContain(t.id);
      expect({ ...t, id: '' }).toEqual({ ...p.targets[2], id: '' });
    }
    expect(accepted(reloaded, grown)).toEqual(grown);
  });
  it('conservatively confirms equal prescriptions because independent edit history is unknown', () => {
    const { doc, scope } = fixture();
    expect(() => changeSetCount(doc, scope, 3)).toThrow(SetCountConflict);
    expect(changeSetCount(doc, scope, 5)).toEqual(doc);
    expect(changeSetCount(doc, scope, null)).toEqual(doc); // no false reset source
    expect(changeSetCount(doc, scope, 6).occurrences[8].positions[5].targets).toHaveLength(6);
  });
  it('also protects older independent workouts with retained source keys', () => {
    const doc = createHypertrophyPlan(), o = doc.occurrences[8]; o.weekOverride = true;
    expect(() => changeSetCount(doc, { occurrenceId: o.id, key: o.positions[0].id }, 2)).toThrow(SetCountConflict);
  });
  it('ordinary inherited reduction needs no warning; shared changes and resets still protect explicit target edits', () => {
    const doc = createHypertrophyPlan(), o = doc.occurrences[8], p = o.positions[0];
    const shared = { workoutKey: o.workoutKey, key: p.sourceKey! }, local = { occurrenceId: o.id, key: p.id };
    expect(changeSetCount(doc, shared, 2).occurrences[8].positions[0].targets).toHaveLength(2);
    const extended = changeSetCount(doc, local, 5);
    expect(changeSetCount(extended, local, null).occurrences[8].positions[0].targets).toHaveLength(3);
    const eo = extended.occurrences[8], ep = eo.positions[0]; ep.targets[4].rir = '0';
    eo.overrides!.targets = { [ep.targets[4].id]: ['rir'] };
    expect(() => changeSetCount(extended, local, null)).toThrow(SetCountConflict);
    const reset = changeSetCount(extended, local, null, true);
    expect(reset.occurrences[8].overrides!.targets).toEqual({});
    o.overrides = { removed: [], order: false, fields: {}, targets: { [p.targets[2].id]: ['restSeconds'] } };
    expect(() => changeSetCount(doc, shared, 2)).toThrow(SetCountConflict);
  });
});
