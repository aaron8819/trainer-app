import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHypertrophyPlan } from './plan-builder';
import { catalog, catalogExercise } from './catalog';
import { amendedOccurrence, backExtensionAmendment, pendingBackExtensionPositions, BODYWEIGHT_BACK_EXTENSION } from './plan-exercise-amendment';
import { amendmentIntent, amendmentContent } from '../../trainer2-contracts/plan-exercise-amendment';
import { startOccurrenceCommand } from '../../trainer2-contracts/execution';
function fixture() {
  const document = createHypertrophyPlan();
  for (const o of document.occurrences) {
    o.positions[0].exercise = catalogExercise(catalog.find(e => e.id === BODYWEIGHT_BACK_EXTENSION)!);
    for (const t of o.positions[0].targets) { t.reps.basis = 'total'; t.measurement = { kind: 'bodyweight', convention: 'bodyweightOnly' }; }
  }
  return document;
}
describe('prospective exercise amendment', () => {
  it('selects only never-started unresolved matching positions', () => {
    const doc = fixture(), excluded = new Set([doc.occurrences[0].id, doc.occurrences[2].id]);
    const candidates = pendingBackExtensionPositions(doc, excluded);
    expect(candidates).toHaveLength(doc.occurrences.length - 2);
    expect(candidates.every(p => !excluded.has(p.occurrenceId))).toBe(true);
  });
  it('preserves original intent and all target meaning except incompatible measurement', () => {
    const doc = fixture(), before = structuredClone(doc), candidates = pendingBackExtensionPositions(doc, new Set());
    const content = amendmentContent.parse(backExtensionAmendment(doc, [candidates[1]]));
    const changed = amendedOccurrence(doc.occurrences[1], [content]);
    expect(changed.positions[0].exercise).toMatchObject({name:'45-Degree Back Extension', loadKind:'addedLoad', convention:'addedExternal'});
    expect(changed.positions[0].targets).toEqual(before.occurrences[1].positions[0].targets.map(t => ({...t,measurement:null})));
    expect(changed.positions.slice(1)).toEqual(before.occurrences[1].positions.slice(1));
    expect(amendedOccurrence(doc.occurrences[0], [content])).toEqual(before.occurrences[0]);
    expect(doc).toEqual(before);
  });
  it('composes distinct batches without replacing untouched positions', () => {
    const doc = fixture(), candidates = pendingBackExtensionPositions(doc,new Set());
    const amendments = [backExtensionAmendment(doc,[candidates[0]]),backExtensionAmendment(doc,[candidates[1]])];
    expect(amendedOccurrence(doc.occurrences[0],amendments).positions[0].exercise.name).toBe('45-Degree Back Extension');
    expect(amendedOccurrence(doc.occurrences[1],amendments).positions[0].exercise.name).toBe('45-Degree Back Extension');
    expect(amendedOccurrence(doc.occurrences[2],amendments)).toEqual(doc.occurrences[2]);
  });
  it('rejects duplicate/empty selections, unsupported replacement and wrong source identity', () => {
    const doc=fixture(), p=pendingBackExtensionPositions(doc,new Set())[0];
    expect(amendmentIntent.safeParse({positions:[p,p],catalogId:'t2:45-degree-back-extension'}).success).toBe(false);
    expect(amendmentIntent.safeParse({positions:[],catalogId:'t2:45-degree-back-extension'}).success).toBe(false);
    expect(amendmentIntent.safeParse({positions:[p],catalogId:'t2:leg-press'}).success).toBe(false);
    expect(()=>backExtensionAmendment(doc,[{...p,positionId:randomUUID()}])).toThrow('INVALID_AMENDMENT_POSITION');
  });
  it('reads old START envelopes without mutating their binding and accepts explicit current version', () => {
    const command={schemaVersion:1,commandType:'StartOccurrence',actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:'account',ownershipEpoch:0,dependsOn:[],target:{planId:randomUUID(),occurrenceId:randomUUID()},expected:{planRevisionId:randomUUID(),instructionEpoch:0},intent:{}};
    expect(startOccurrenceCommand.parse(command)).toEqual(command);
    expect(startOccurrenceCommand.parse({...command,expected:{...command.expected,amendmentVersion:2}}).expected.amendmentVersion).toBe(2);
  });
});
