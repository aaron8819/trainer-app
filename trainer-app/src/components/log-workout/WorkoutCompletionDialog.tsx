import type { CompletionAction } from "@/components/log-workout/types";

type WorkoutCompletionDialogProps = {
  action: CompletionAction;
  loggedCount: number;
  totalSets: number;
  submitting: boolean;
  onConfirm: (action: CompletionAction) => void;
  onCancel: () => void;
};

function getDialogTitle(action: CompletionAction): string {
  if (action === "mark_completed") {
    return "Complete workout";
  }
  if (action === "mark_partial") {
    return "Mark partial";
  }
  return "Skip workout";
}

export function WorkoutCompletionDialog({
  action,
  loggedCount,
  totalSets,
  submitting,
  onConfirm,
  onCancel,
}: WorkoutCompletionDialogProps) {
  return (
    <div
      aria-label="Workout completion confirmation"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 px-3 pt-3 pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+12px)] sm:items-center sm:p-3"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:p-5">
        <p className="text-sm font-semibold text-slate-900">{getDialogTitle(action)}</p>
        <p className="mt-1 text-sm text-slate-600">
          {loggedCount} of {totalSets} sets logged
        </p>
        {action === "mark_skipped" ? (
          <p className="mt-2 text-xs text-slate-500">
            This will skip the entire workout and not count toward progression.
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => onConfirm(action)}
            disabled={submitting}
            type="button"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span
                  data-testid="completion-spinner"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                />
                Saving...
              </span>
            ) : (
              "Confirm"
            )}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={onCancel}
            disabled={submitting}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
