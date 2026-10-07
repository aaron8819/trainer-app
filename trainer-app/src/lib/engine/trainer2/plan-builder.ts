import type { DraftDocument } from '../../trainer2-contracts/draft';
import { catalog, catalogExercise, swapPrescription } from './catalog';

export type Builder = NonNullable<DraftDocument['builder']>;
export type Row = Builder['workouts'][number]['rows'][number];
export type Position = DraftDocument['occurrences'][number]['positions'][number];
type IdFactory = () => string;
export const hypertrophyTemplate = { name: 'My hypertrophy plan', workouts: ['Lower A', 'Upper A', 'Lower B', 'Upper B'], effort: ['3', '3', '2', '1', '4'] } as const;

// Only initialization reads template constants. Subsequent edits use plan-owned values.
export function createHypertrophyPlan(id: IdFactory = () => crypto.randomUUID(), blank = false): DraftDocument {
  const stages = hypertrophyTemplate.effort.map((_, i) => ({ id: id(), name: i === 4 ? 'Week 5 · Deload' : `Week ${i + 1}` }));
  const builder: Builder = { version: 1, template: 'hypertrophy', starterVersion: 1,
    weeks: stages.map((s, i) => ({ stageId: s.id, deload: i === 4, rir: hypertrophyTemplate.effort[i] })),
    workouts: hypertrophyTemplate.workouts.map((name, index) => ({ key: id(), name, rows: blank ? [] : starter[index].map(([key, sets, min, max, role]) => {
      const row = newRow(key, id); row.exercise = catalogExercise(catalog.find(e => e.id === `t2:${key}`)!);
      row.sets = sets; row.role = role; row.prescription.reps = { min, max, basis: row.exercise.kind === 'catalogSnapshot' ? row.exercise.repBasis : 'total' }; return row;
    }) })) };
  return expandWorkoutDefaults({ schemaVersion: 1, name: hypertrophyTemplate.name,
    progression: { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} },
    endpoint: 'endOfOrderedOccurrences', stages, builder,
    occurrences: stages.flatMap(s => builder.workouts.map(w => ({ id: id(), stageId: s.id, name: w.name, workoutKey: w.key, weekOverride: false, positions: [] }))) }, id);
}
const starter: [string, number, number, number, NonNullable<Row['role']>][][] = [
  [['barbell-back-squat',3,6,10,'Main lift'],['barbell-romanian-deadlift',3,8,10,'Secondary lift'],['seated-leg-curl',2,10,15,'Accessory'],['selectorized-standing-calf-raise',3,10,15,'Calves'],['cable-crunch',2,10,15,'Core']],
  [['barbell-bench-press',3,6,10,'Main lift'],['chest-supported-dumbbell-row',3,8,12,'Secondary lift'],['lat-pulldown',2,8,12,'Accessory'],['dumbbell-lateral-raise',2,12,20,'Accessory'],['cable-triceps-pushdown',2,10,15,'Accessory'],['dumbbell-curl',2,10,15,'Accessory']],
  [['leg-press',3,8,12,'Main lift'],['bulgarian-split-squat',2,8,12,'Secondary lift'],['lying-leg-curl',3,10,15,'Accessory'],['seated-calf-raise',3,12,20,'Calves'],['machine-crunch',2,10,15,'Core']],
  [['incline-dumbbell-bench-press',3,8,12,'Main lift'],['seated-cable-row',3,8,12,'Secondary lift'],['dumbbell-overhead-press',2,8,12,'Secondary lift'],['lat-pulldown',2,10,15,'Accessory'],['reverse-pec-deck',2,12,20,'Accessory'],['overhead-cable-triceps-extension',2,10,15,'Accessory'],['cable-curl',2,10,15,'Accessory']],
];
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
    const previous = o.positions;
    const shared = workout.rows.filter(row => !o.overrides?.removed.includes(row.key)).map(row => {
      const old = o.positions.find(p => p.sourceKey === row.key);
      const flags = old ? o.overrides?.fields[old.id] ?? [] : [];
      const basePrescription = flags.includes('exercise') && old ? swapPrescription(row.exercise, old.exercise, row.prescription) : row.prescription;
      const count = flags.includes('sets') && old ? old.targets.length : week.deload && row.prescription.classification === 'working' ? Math.max(1, Math.ceil(row.sets / 2)) : row.sets;
      const p: Position = { id: old?.id ?? id(), sourceKey: row.key, exercise: structuredClone(flags.includes('exercise') && old ? old.exercise : row.exercise),
        ...(row.role !== undefined || old?.role !== undefined ? { role: flags.includes('role') ? old?.role : row.role } : {}),
        targets: Array.from({ length: count }, (_, i) => {
          const t = { ...structuredClone(basePrescription), id: old?.targets[i]?.id ?? id(), rir: week.deload ? week.rir : row.prescription.rir ?? week.rir };
          const prior = old?.targets[i] ?? old?.targets[0];
          if (prior) for (const field of flags) {
            if (field !== 'sets' && field !== 'exercise' && field !== 'role') {
              const values = old && o.overrides?.values?.[old.id];
              Object.assign(t, { [field]: structuredClone(values && field in values ? values[field] : prior[field]) });
            }
          }
          if (prior) for (const field of o.overrides?.targets?.[t.id] ?? []) Object.assign(t, { [field]: structuredClone(prior[field]) });
          return t;
        }) };
      return p;
    });
    const additions = previous.filter(p => !p.sourceKey);
    const all = [...shared, ...additions];
    o.positions = o.overrides?.order ? [...previous.flatMap(p => all.find(n => n.id === p.id) ?? []), ...all.filter(p => !previous.some(n => n.id === p.id))] : all;
  }
  return doc;
}
export function restoreWeek(document: DraftDocument, occurrenceId: string): DraftDocument {
  const doc = structuredClone(document);
  const occurrence = doc.occurrences.find(o => o.id === occurrenceId);
  if (!occurrence) throw new Error('Unknown workout');
  occurrence.weekOverride = false;
  delete occurrence.overrides;
  occurrence.positions = occurrence.positions.filter(p => p.sourceKey);
  return expandWorkoutDefaults(doc);
}
export type OverrideField = 'exercise' | 'role' | 'sets' | 'reps' | 'measurement' | 'rir' | 'restSeconds' | 'classification' | 'required';
export function markOverride(o: DraftDocument['occurrences'][number], positionId: string, fields: OverrideField[], values?: Partial<Row['prescription']>) {
  if (o.weekOverride || !o.positions.find(p => p.id === positionId)?.sourceKey) return;
  o.overrides ??= { removed: [], order: false, fields: {} };
  o.overrides.fields[positionId] = [...new Set([...(o.overrides.fields[positionId] ?? []), ...fields])];
  if (values) { o.overrides.values ??= {}; o.overrides.values[positionId] = { ...o.overrides.values[positionId], ...structuredClone(values) }; }
  for (const t of o.positions.find(p => p.id === positionId)?.targets ?? []) {
    if (o.overrides.targets?.[t.id]) {
      o.overrides.targets[t.id] = o.overrides.targets[t.id].filter(f => !fields.includes(f));
      if (!o.overrides.targets[t.id].length) delete o.overrides.targets[t.id];
    }
  }
}
export function resetField(document: DraftDocument, occurrenceId: string, positionId: string, field: OverrideField) {
  if (field === 'sets') return changeSetCount(document, { occurrenceId, key: positionId }, null);
  const d = structuredClone(document), o = d.occurrences.find(o => o.id === occurrenceId)!;
  if (!o.positions.find(p => p.id === positionId)?.sourceKey) return d;
  if (o.overrides?.fields[positionId]) {
    for (const key of Object.keys(o.overrides.values?.[positionId] ?? {})) {
      if (key === field || (field === 'exercise' && ['reps', 'measurement'].includes(key))) delete o.overrides.values![positionId][key as keyof Row['prescription']];
    }
    if (o.overrides.values?.[positionId] && !Object.keys(o.overrides.values[positionId]).length) delete o.overrides.values[positionId];
    if (field === 'exercise') for (const t of o.positions.find(p => p.id === positionId)!.targets) {
      if (o.overrides.targets?.[t.id]) {
        o.overrides.targets[t.id] = o.overrides.targets[t.id].filter(f => !['reps', 'measurement'].includes(f));
        if (!o.overrides.targets[t.id].length) delete o.overrides.targets[t.id];
      }
    }
    o.overrides.fields[positionId] = o.overrides.fields[positionId].filter(f => field === 'exercise' ? !['exercise', 'reps', 'measurement'].includes(f) : f !== field);
    if (!o.overrides.fields[positionId].length) delete o.overrides.fields[positionId];
  }
  return expandWorkoutDefaults(d);
}

type Occurrence = DraftDocument['occurrences'][number];
// Deleting a position deletes its dependent metadata as one domain operation.
export function removePositionContent(o: Occurrence, p: Position) {
  if (o.overrides) {
    delete o.overrides.fields[p.id];
    if (o.overrides.values) delete o.overrides.values[p.id];
    for (const t of p.targets) if (o.overrides.targets) delete o.overrides.targets[t.id];
  }
  o.positions = o.positions.filter(item => item.id !== p.id);
}
export function removeBuilderRow(document: DraftDocument, scope: { key: string; occurrenceId?: string; workoutKey?: string }) {
  const d = structuredClone(document);
  if (scope.occurrenceId) {
    const o = d.occurrences.find(o => o.id === scope.occurrenceId)!;
    const p = o.positions.find(p => p.id === scope.key)!;
    if (!o.weekOverride && p.sourceKey) {
      o.overrides ??= { removed: [], order: false, fields: {} };
      o.overrides.removed.push(p.sourceKey);
    }
    removePositionContent(o, p);
  } else {
    const w = d.builder!.workouts.find(w => w.key === scope.workoutKey)!;
    w.rows = w.rows.filter(r => r.key !== scope.key);
    for (const o of d.occurrences.filter(o => o.workoutKey === w.key && !o.weekOverride)) {
      for (const p of o.positions.filter(p => p.sourceKey === scope.key)) removePositionContent(o, p);
      if (o.overrides) o.overrides.removed = o.overrides.removed.filter(key => key !== scope.key);
    }
  }
  return expandWorkoutDefaults(d);
}

export class SetCountConflict extends Error {
  constructor(public readonly affected: string[], public readonly independent = false) { super('Set count discards authored set prescriptions'); }
}
function discardedPrescription(t: Position['targets'][number]): string {
  const m = t.measurement;
  const basis = { total: 'total', perSide: 'per side', alternating: 'alternating' }[t.reps.basis];
  const classification = { preparation: 'preparation', rampUp: 'ramp-up', working: 'working', optionalFinisher: 'optional finisher' }[t.classification];
  const details = [`${t.reps.min}–${t.reps.max} reps ${basis}`, `${classification}, ${t.required ? 'required' : 'optional'}`];
  if (t.rir !== null) details.push(`${t.rir} reps left`);
  if (t.restSeconds !== null) details.push(`${t.restSeconds} seconds rest`);
  if (m?.kind === 'bodyweight') details.push('bodyweight only');
  else if (m) {
    const convention = { barbellTotal: 'barbell total', perImplement: 'per implement', machinePlatesPerArm: 'plates added per arm', smithPlatesTotal: 'total Smith plates added', machineDisplayed: 'machine displayed', addedExternal: 'added load', displayedAssistance: 'displayed assistance' }[m.convention];
    const zero = { validZero: 'zero is valid', notAllowed: 'zero not allowed', noAddedLoad: 'zero means no added load', noAssistance: 'zero means no assistance' }[m.zeroMeaning];
    details.push(`${m.value} ${m.unit} ${convention} (${zero})`);
  }
  return details.join(', ');
}
// Both ordinary count changes and resets preview the same effective expansion.
// No mutation is exposed until the caller explicitly confirms discarded edits.
export function changeSetCount(document: DraftDocument, scope: { key: string; occurrenceId?: string; workoutKey?: string }, count: number | null, confirmed = false): DraftDocument {
  const d = structuredClone(document);
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 20)) return d;
  if (scope.occurrenceId) {
    const o = d.occurrences.find(o => o.id === scope.occurrenceId)!;
    const p = o.positions.find(p => p.id === scope.key)!;
    if (count === null) {
      if (o.weekOverride || !p.sourceKey) return d;
      if (o.overrides?.fields[p.id]) {
        o.overrides.fields[p.id] = o.overrides.fields[p.id].filter(f => f !== 'sets');
        if (!o.overrides.fields[p.id].length) delete o.overrides.fields[p.id];
      }
    } else {
      markOverride(o, p.id, ['sets']);
      while (p.targets.length < count) p.targets.push({ ...structuredClone(p.targets.at(-1) ?? newRow('').prescription), id: crypto.randomUUID() });
      p.targets.splice(count);
    }
  } else {
    if (count === null) throw new Error('Set reset requires a week');
    d.builder!.workouts.find(w => w.key === scope.workoutKey)!.rows.find(r => r.key === scope.key)!.sets = count;
  }
  const next = expandWorkoutDefaults(d);
  const affected: string[] = [];
  let independent = false;
  for (const o of document.occurrences) {
    const after = next.occurrences.find(n => n.id === o.id)!;
    const retained = new Set(after.positions.flatMap(p => p.targets.map(t => t.id)));
    for (const p of o.positions) p.targets.forEach((t, i) => {
      if (retained.has(t.id)) return;
      // Independent content has no inherited baseline or reliable edit history.
      // Even equal prescriptions may be individually authored: confirm every
      // discarded independent target, without inventing inheritance/provenance.
      const independentTarget = !p.sourceKey || o.weekOverride === true;
      if (independentTarget || o.overrides?.targets?.[t.id]?.length) {
        independent ||= independentTarget;
        affected.push(`${document.stages.find(s => s.id === o.stageId)!.name}, ${o.name}, ${p.exercise.name}, Set ${i + 1}${independentTarget ? `: ${discardedPrescription(t)}` : ''}`);
      }
      if (after.overrides?.targets) delete after.overrides.targets[t.id];
    });
  }
  if (affected.length && !confirmed) throw new SetCountConflict(affected, independent);
  return next;
}

// Explicit recovery of only the two metadata defects the old builder could save.
// Executable content and legitimate shared overrides are never rewritten.
export function repairBuilderMetadata(document: DraftDocument): DraftDocument {
  const d = structuredClone(document);
  const positions = new Set(d.occurrences.flatMap(o => o.positions.map(p => p.id)));
  for (const o of d.occurrences) {
    if (!o.overrides) continue;
    for (const key of Object.keys(o.overrides.values ?? {})) if (!positions.has(key)) delete o.overrides.values![key];
    for (const p of o.positions.filter(p => !p.sourceKey)) {
      delete o.overrides.fields[p.id];
      if (o.overrides.values) delete o.overrides.values[p.id];
      for (const t of p.targets) if (o.overrides.targets) delete o.overrides.targets[t.id];
    }
  }
  return d;
}
export function sharedSwapConflicts(doc: DraftDocument, rowKey: string, next: Position['exercise']) {
  return doc.occurrences.flatMap(o => o.positions.flatMap(p => {
    const flags = [...(o.overrides?.fields[p.id] ?? []), ...p.targets.flatMap(t=>o.overrides?.targets?.[t.id] ?? [])];
    if (o.weekOverride || p.sourceKey !== rowKey || flags.includes('exercise')) return [];
    const fields: OverrideField[] = [];
    if (flags.includes('measurement') && p.targets.some(t => t.measurement !== null)) fields.push('measurement');
    if (flags.includes('reps') && next.kind === 'catalogSnapshot' && p.targets.some(t => t.reps.basis !== next.repBasis)) fields.push('reps');
    return fields.length ? [{ occurrenceId: o.id, positionId: p.id, fields }] : [];
  }));
}
