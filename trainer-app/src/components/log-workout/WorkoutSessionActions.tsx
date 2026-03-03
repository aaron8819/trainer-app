import Link from "next/link";

type WorkoutSessionActionsProps = {
  loggedCount: number;
  totalSets: number;
  completed: boolean;
  skipped: boolean;
  showSkipOptions: boolean;
  skipReason: string;
  sessionActionPending: boolean;
  onFinish: () => void;
  onLeaveForNow: () => void;
  onToggleSkipOptions: () => void;
  onSkipReasonChange: (value: string) => void;
  onConfirmSkip: () => void;
};

export function WorkoutSessionActions({
  loggedCount,
  totalSets,
  completed,
  skipped,
  showSkipOptions,
  skipReason,
  sessionActionPending,
  onFinish,
  onLeaveForNow,
  onToggleSkipOptions,
  onSkipReasonChange,
  onConfirmSkip,
}: WorkoutSessionActionsProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">{loggedCount}/{totalSets} sets logged</div>
          {!completed && !skipped && loggedCount > 0 ? (
            <span className="text-[11px] text-slate-500">Use the footer only when you are done for now.</span>
          ) : null}
        </div>
        <div className="grid gap-2 md:flex md:flex-wrap md:items-center md:gap-3">
          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            onClick={onFinish}
            disabled={completed || skipped || sessionActionPending}
            type="button"
          >
            {completed ? "Workout completed" : "Finish workout"}
          </button>
          {!completed && !skipped && loggedCount > 0 ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
              onClick={onLeaveForNow}
              disabled={sessionActionPending}
              type="button"
            >
              Leave for now
            </button>
          ) : null}
          {!completed && !skipped ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
              onClick={onToggleSkipOptions}
              disabled={sessionActionPending}
              type="button"
            >
              {showSkipOptions ? "Hide skip option" : "Can't finish?"}
            </button>
          ) : null}
        </div>
        {!completed && !skipped && showSkipOptions ? (
          <div className="mt-2">
            <label className="block text-xs font-medium text-slate-500">
              Skip reason (optional)
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                placeholder="Travel, low energy, time constraints"
                value={skipReason}
                onChange={(event) => onSkipReasonChange(event.target.value)}
              />
            </label>
            <button
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-rose-300 px-4 text-sm font-semibold text-rose-700 disabled:opacity-60"
              onClick={onConfirmSkip}
              disabled={completed || skipped || sessionActionPending}
              type="button"
            >
              Confirm skip workout
            </button>
          </div>
        ) : null}
        {!completed && !skipped ? (
          <div className="mt-2 text-[11px] text-slate-500">
            {showSkipOptions
              ? "Skipping will not count this session toward progression."
              : "Leave for now keeps your logged sets without ending the session."}
          </div>
        ) : null}
      </div>
      {skipped ? (
        <div className="text-sm text-slate-600">
          <Link className="font-semibold text-slate-900" href="/">
            Generate a replacement session
          </Link>
        </div>
      ) : null}
    </div>
  );
}
