import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';

export type WorkoutIntent = DraftDocument['occurrences'][number];
export type Target = WorkoutIntent['positions'][number]['targets'][number];
export function targetLabel(t: Target) {
  const m = t.measurement;
  return [
    `${t.reps.min === t.reps.max ? t.reps.min : `${t.reps.min}–${t.reps.max}`} reps${t.reps.basis === 'total' ? '' : t.reps.basis === 'perSide' ? ' per side' : ' alternating'}`,
    t.rir === null ? null : `${t.rir} RIR`,
    m === null ? null : m.kind === 'bodyweight' ? 'Bodyweight' : `${m.value} ${m.unit} ${m.kind === 'addedLoad' ? 'added' : m.kind === 'assistance' ? 'assistance' : m.convention === 'perImplement' ? 'per implement' : m.convention === 'barbellTotal' ? 'barbell total' : 'machine displayed'}`,
    t.restSeconds === null ? null : `${t.restSeconds}s rest`,
    t.classification === 'working' ? null : t.classification === 'rampUp' ? 'Ramp-up' : t.classification === 'preparation' ? 'Preparation' : 'Finisher',
    t.required ? null : 'Optional',
  ].filter(Boolean).join(' · ');
}
// Only consecutive sets with exactly equal authored meaning may be collapsed.
export function targetGroups(targets: Target[]) {
  const groups: { label: string; count: number; first: number; signature: string }[] = [];
  targets.forEach((t, i) => {
    const signature = canonicalJson({ ...t, id: '' }), prior = groups.at(-1);
    if (prior?.signature === signature) prior.count++;
    else groups.push({ label: targetLabel(t), count: 1, first: i + 1, signature });
  });
  return groups;
}
export function effortSummary(workout?: WorkoutIntent | null) {
  const targets = workout?.positions.flatMap(p => p.targets) ?? [];
  const values = [...new Set(targets.flatMap(t => t.rir === null ? [] : [Number(t.rir)]))].sort((a, b) => a - b);
  if (!values.length) return 'Effort not prescribed';
  return `Target ${values.length === 1 ? values[0] : `${values[0]}–${values.at(-1)}`} RIR${values.length > 1 ? ' · varies by set' : ''}${targets.some(t => t.rir === null) ? ' · some sets unspecified' : ''}`;
}
export const trainingUrl = (planId: string) => `/trainer2/dev/drafts?planId=${encodeURIComponent(planId)}`;
