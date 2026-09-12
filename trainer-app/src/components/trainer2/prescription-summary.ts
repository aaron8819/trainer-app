import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
type Target = DraftDocument['occurrences'][number]['positions'][number]['targets'][number];

function setSummary(t: Target) {
  const basis = t.reps.basis === 'perSide' ? ' per side' : t.reps.basis === 'alternating' ? ' alternating' : '';
  return `${t.reps.min}–${t.reps.max}${basis} · ${t.rir ?? '–'} left`;
}
export function prescriptionSummary(targets: Target[]): string {
  if (!targets.length) return 'No sets';
  const summaries = targets.map(setSummary);
  if (summaries.every(s => s === summaries[0])) return `${targets.length} × ${summaries[0]}`;
  return `Mixed sets · ${summaries.map((s, i) => `Set ${i + 1}: ${s}`).join('; ')}`;
}
