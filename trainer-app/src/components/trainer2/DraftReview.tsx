import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { orderedWorkoutGroups } from '@/lib/engine/trainer2/ordered-workouts';
const readable: Record<string, string> = { barbellTotal: 'barbell total', perImplement: 'per implement', machinePlatesPerArm: 'plates added per arm', smithPlatesTotal: 'total Smith plates added', machineDisplayed: 'machine display', addedExternal: 'added weight', displayedAssistance: 'assistance', rampUp: 'ramp-up', optionalFinisher: 'optional finisher', preparation: 'preparation' };
export function DraftReview({ intent }: { intent: DraftDocument }) {
  let groups: ReturnType<typeof orderedWorkoutGroups>;
  try { groups = orderedWorkoutGroups(intent); }
  catch { return <p role="alert">Couldn’t display the saved workout order. Reload this plan.</p>; }
  return <section aria-label="Saved plan review" className="space-y-4">
    <h2 className="text-lg font-semibold">{intent.name}</h2>
    {groups.map(({ stage: s, deload, workouts }) => <section key={workouts[0].occurrence.id} className="rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">{s.name}{deload && !s.name.toLowerCase().includes('deload') ? ' · Deload' : ''}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{workouts.map(({ occurrence: o, sequence }) => <div key={o.id} data-occurrence-id={o.id}>
        <p className="text-xs text-slate-500">Workout {sequence}</p>
        <h4 className="font-medium">{o.name}{o.weekOverride ? ' · Week-only edits' : ''}</h4>
        {!o.positions.length && <p className="text-sm text-slate-500">No exercises yet</p>}
        {o.positions.map(p => <div key={p.id} className="mt-2 text-sm"><p className="font-medium">{p.exercise.name || 'Unnamed exercise'} {p.exercise.variation}</p>
          {p.targets.map((t, i) => <p key={t.id} className="text-slate-600">Set {i + 1}: {t.reps.min}–{t.reps.max} reps{t.reps.basis !== 'total' ? ` (${t.reps.basis === 'perSide' ? 'per side' : 'alternating'})` : ''}{t.rir !== null ? ` · ${t.rir} reps left` : ''}{t.measurement && t.measurement.kind !== 'bodyweight' ? ` · ${t.measurement.value} ${t.measurement.unit} (${readable[t.measurement.convention] ?? t.measurement.convention})` : t.measurement ? ' · Bodyweight' : ''}{t.measurement && t.measurement.kind !== 'bodyweight' && <span> · {t.measurement.zeroMeaning === 'notAllowed' ? 'zero not allowed' : t.measurement.zeroMeaning === 'noAssistance' ? 'zero means no assistance' : t.measurement.zeroMeaning === 'noAddedLoad' ? 'zero means no added load' : 'zero is valid'}</span>}{t.restSeconds !== null ? ` · Rest ${t.restSeconds}s` : ''}{t.classification !== 'working' ? ` · ${readable[t.classification] ?? t.classification}` : ''}{!t.required ? ' · Optional' : ''}</p>)}
        </div>)}
      </div>)}</div>
    </section>)}
  </section>;
}
