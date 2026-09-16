import muscles from './catalog-muscles.json';
import type { WorkoutIntent } from './training-summary';

// Display-only V1 metadata, joined offline by catalogKey → t2:catalogKey.
// Source: prisma/exercises_comprehensive.json at 15783474 (catalog version 1).
// Names were checked during extraction, never used for runtime matching.
export function MuscleTags({ exercise }: { exercise: WorkoutIntent['positions'][number]['exercise'] }) {
  if (exercise.kind !== 'catalogSnapshot' || exercise.catalogVersion !== 1) return null;
  const groups = (muscles as Record<string, { primary: string[]; secondary: string[] }>)[exercise.catalogId];
  if (!groups) return null;
  return <div className="mt-1 flex flex-wrap gap-1 text-[11px] leading-5">
    {groups.primary.map(name => <span key={name} className="rounded-full bg-emerald-100 px-2 font-medium text-emerald-900">Primary · {name}</span>)}
    {groups.secondary.map(name => <span key={name} className="rounded-full border border-slate-200 px-2 text-slate-600">Secondary · {name}</span>)}
  </div>;
}
