import type { DraftDocument } from '../../trainer2-contracts/draft';

export type Builder = NonNullable<DraftDocument['builder']>;
export type Row = Builder['workouts'][number]['rows'][number];
export type Position = DraftDocument['occurrences'][number]['positions'][number];
type IdFactory = () => string;
export const hypertrophyTemplate = { name: 'My hypertrophy plan', workouts: ['Lower A', 'Upper A', 'Lower B', 'Upper B'], effort: ['3', '3', '2', '1', '4'] } as const;

// Only initialization reads template constants. Subsequent edits use plan-owned values.
export function createHypertrophyPlan(id: IdFactory = () => crypto.randomUUID()): DraftDocument {
  const stages = hypertrophyTemplate.effort.map((_, i) => ({ id: id(), name: i === 4 ? 'Week 5 · Deload' : `Week ${i + 1}` }));
  const builder: Builder = { version: 1, template: 'hypertrophy',
    weeks: stages.map((s, i) => ({ stageId: s.id, deload: i === 4, rir: hypertrophyTemplate.effort[i] })),
    workouts: hypertrophyTemplate.workouts.map(name => ({ key: id(), name, rows: [] })) };
  return { schemaVersion: 1, name: hypertrophyTemplate.name, endpoint: 'endOfOrderedOccurrences', stages, builder,
    occurrences: stages.flatMap(s => builder.workouts.map(w => ({ id: id(), stageId: s.id, name: w.name, workoutKey: w.key, weekOverride: false, positions: [] }))) };
}
export function newRow(name: string, id: IdFactory = () => crypto.randomUUID()): Row {
  return { key: id(), exercise: { kind: 'authoredDescription', name, variation: '' }, sets: 3,
    prescription: { classification: 'working', required: true, reps: { min: 8, max: 12, basis: 'total' }, measurement: null, rir: null, restSeconds: null } };
}
// Explicit source keys establish correspondence; names and array indices never do.
export function expandWorkoutDefaults(document: DraftDocument, id: IdFactory = () => crypto.randomUUID()): DraftDocument {
  const doc = structuredClone(document);
  if (!doc.builder) return doc;
  for (const o of doc.occurrences) {
    if (o.weekOverride) continue;
    const workout = doc.builder.workouts.find(w => w.key === o.workoutKey);
    const week = doc.builder.weeks.find(w => w.stageId === o.stageId);
    if (!workout || !week) throw new Error('Missing workout relationship');
    o.name = workout.name;
    o.positions = workout.rows.map(row => {
      const old = o.positions.find(p => p.sourceKey === row.key);
      const count = week.deload && row.prescription.classification === 'working' ? Math.max(1, Math.ceil(row.sets / 2)) : row.sets;
      return { id: old?.id ?? id(), sourceKey: row.key, exercise: structuredClone(row.exercise),
        targets: Array.from({ length: count }, (_, i) => ({ ...structuredClone(row.prescription),
          id: old?.targets[i]?.id ?? id(), rir: week.deload ? week.rir : row.prescription.rir ?? week.rir })) };
    });
  }
  return doc;
}
export function restoreWeek(document: DraftDocument, occurrenceId: string): DraftDocument {
  const doc = structuredClone(document);
  const occurrence = doc.occurrences.find(o => o.id === occurrenceId);
  if (!occurrence) throw new Error('Unknown workout');
  occurrence.weekOverride = false;
  return expandWorkoutDefaults(doc);
}
