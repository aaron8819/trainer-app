import Link from "next/link";
import type { ProgramDashboardData } from "@/lib/api/program";

type TrainingStatusCardProps = {
  data: ProgramDashboardData | null;
};

const BLOCK_COACHING_CUES: Record<string, string> = {
  accumulation: "Accumulation phase - build volume, work within 2-3 RIR.",
  intensification: "Intensification phase - heavier loads, push to 0-1 RIR.",
  realization: "Peak week - express your strength today.",
  deload: "Deload week - keep loads light, focus on technique and recovery.",
};

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getTargetRir(currentWeek: number, durationWeeks: number): string {
  if (currentWeek >= durationWeeks) return "4-6 RIR";
  if (currentWeek === durationWeeks - 1) return "0-1 RIR";
  if (currentWeek >= durationWeeks - 2) return "1-2 RIR";
  if (currentWeek >= 2) return "2-3 RIR";
  return "3-4 RIR";
}

function getVolumeDotClass(directSets: number, mev: number, mav: number, mrv: number): string {
  if (directSets >= mrv) return "bg-rose-500";
  if (directSets > mav && directSets < mrv) return "bg-amber-400";
  if (directSets >= mev && directSets <= mav) return "bg-emerald-500";
  return "bg-slate-300";
}

export default function TrainingStatusCard({ data }: TrainingStatusCardProps) {
  if (!data || !data.activeMeso) {
    return (
      <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Training Program</h2>
        <p className="mt-2 text-sm text-slate-600">No active mesocycle. Set up a program to track cycle progress.</p>
        <Link className="mt-3 inline-block text-sm font-semibold text-slate-900" href="/program">
          Set up program
        </Link>
      </div>
    );
  }

  const { activeMeso, currentWeek, sessionsUntilDeload, deloadReadiness, volumeThisWeek } = data;
  const durationWeeks = activeMeso.durationWeeks;
  const progressPct = Math.max(0, Math.min(100, (currentWeek / Math.max(1, durationWeeks)) * 100));
  const totalSessions = Math.max(0, (durationWeeks - 1) * data.daysPerWeek);
  const blockType = activeMeso.currentBlockType ?? "accumulation";
  const coachingCue = BLOCK_COACHING_CUES[blockType] ?? BLOCK_COACHING_CUES.accumulation;
  const visibleVolumeRows = volumeThisWeek.filter((row) => row.mav > 0).slice(0, 8);

  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">{activeMeso.focus}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {toTitleCase(blockType)}
        </span>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-slate-700">
          Week {currentWeek} of {durationWeeks}
        </p>
        <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-slate-900" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Session {activeMeso.completedSessions} of ~{totalSessions}
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Target RIR this week</p>
        <p className="mt-1 text-sm font-semibold text-slate-900">{getTargetRir(currentWeek, durationWeeks)}</p>
      </div>

      <p
        className={`mt-4 text-sm font-medium ${
          sessionsUntilDeload <= 3 ? "text-amber-700" : "text-slate-700"
        }`}
      >
        {sessionsUntilDeload === 0 ? "Deload week" : `${sessionsUntilDeload} sessions until deload`}
      </p>

      {deloadReadiness?.shouldDeload ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-center justify-between gap-2">
            <p>{deloadReadiness.reason}</p>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {deloadReadiness.urgency}
            </span>
          </div>
        </div>
      ) : null}

      {visibleVolumeRows.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {visibleVolumeRows.map((row) => (
            <div key={row.muscle} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
              <p className="truncate text-slate-700">{toTitleCase(row.muscle)}</p>
              <p className="text-slate-600">
                {row.directSets} / {row.target}
              </p>
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${getVolumeDotClass(row.directSets, row.mev, row.mav, row.mrv)}`}
              />
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-4 text-xs italic text-slate-600">{coachingCue}</p>
    </div>
  );
}
