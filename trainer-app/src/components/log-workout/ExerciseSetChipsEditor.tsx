import type { ChipEditDraft } from "@/components/log-workout/useWorkoutChipEditor";
import type { LogExerciseInput } from "@/components/log-workout/types";

function buildSetChipLabel(
  set: LogExerciseInput["sets"][number],
  isLogged: boolean,
  isDumbbell: boolean
): string {
  if (!isLogged) {
    return `Set ${set.setIndex}`;
  }
  if (set.wasSkipped) {
    return `Set ${set.setIndex} · Skipped`;
  }

  const parts: string[] = [`Set ${set.setIndex}`];
  if (set.actualLoad != null) {
    const displayLoad = set.actualLoad;
    const loadSuffix = isDumbbell ? " ea" : "";
    parts.push(`${displayLoad}${loadSuffix}×${set.actualReps ?? "?"}`);
  } else if (set.actualReps != null) {
    parts.push(`${set.actualReps} reps`);
  }
  if (set.actualRpe != null) {
    parts.push(`RPE ${set.actualRpe}`);
  }

  return parts.join(" · ");
}

type ExerciseSetChipsEditorProps = {
  exercise: LogExerciseInput;
  loggedSetIds: Set<string>;
  resolvedActiveSetId: string | null;
  chipEditSetId: string | null;
  chipEditDraft: ChipEditDraft | null;
  savingSetId: string | null;
  isDumbbell: boolean;
  onOpenChipEditor: (setId: string) => void;
  onSetActiveSetId: (setId: string) => void;
  onChipDraftChange: (updater: (prev: ChipEditDraft | null) => ChipEditDraft | null) => void;
  onChipLoadBlur: (setId: string, isDumbbell: boolean) => void;
  onChipEditSave: (setId: string) => void;
  onCloseChipEditor: () => void;
};

export function ExerciseSetChipsEditor({
  exercise,
  loggedSetIds,
  resolvedActiveSetId,
  chipEditSetId,
  chipEditDraft,
  savingSetId,
  isDumbbell,
  onOpenChipEditor,
  onSetActiveSetId,
  onChipDraftChange,
  onChipLoadBlur,
  onChipEditSave,
  onCloseChipEditor,
}: ExerciseSetChipsEditorProps) {
  const hasLoggedSets = exercise.sets.some((set) => loggedSetIds.has(set.setId));
  const editingSet = chipEditSetId
    ? exercise.sets.find((set) => set.setId === chipEditSetId) ?? null
    : null;

  return (
    <>
      <div className="border-t border-slate-100 p-3">
        {hasLoggedSets ? (
          <p className="mb-2 text-[11px] text-slate-500">
            Dark chip is the current set. Green chips are logged and can be tapped to edit.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {exercise.sets.map((set) => {
            const isLogged = loggedSetIds.has(set.setId);
            const isActive = resolvedActiveSetId === set.setId;
            return (
              <button
                key={set.setId}
                className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm ring-2 ring-slate-200"
                    : isLogged
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 text-slate-700"
                }`}
                onClick={() => {
                  if (isLogged && !isActive) {
                    onOpenChipEditor(set.setId);
                    return;
                  }
                  onSetActiveSetId(set.setId);
                }}
                type="button"
              >
                {buildSetChipLabel(set, isLogged, isDumbbell)}
              </button>
            );
          })}
        </div>
      </div>
      {editingSet && chipEditDraft ? (
        <div className="border-t border-slate-100 p-3" data-testid="chip-edit-form">
          <p className="mb-2 text-xs font-semibold text-slate-500">Edit Set {editingSet.setIndex}</p>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Reps</label>
              <input
                aria-label="Chip edit reps"
                className="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-1.5 py-1 text-base text-slate-900"
                type="number"
                inputMode="numeric"
                value={chipEditDraft.reps}
                onChange={(event) =>
                  onChipDraftChange((prev) => (prev ? { ...prev, reps: event.target.value } : prev))
                }
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {isDumbbell ? "Load ea" : "Load"}
              </label>
              <input
                aria-label="Chip edit load"
                className="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-1.5 py-1 text-base text-slate-900"
                type="number"
                step="0.5"
                inputMode="decimal"
                value={chipEditDraft.load}
                onBlur={() => onChipLoadBlur(editingSet.setId, isDumbbell)}
                onChange={(event) =>
                  onChipDraftChange((prev) => (prev ? { ...prev, load: event.target.value } : prev))
                }
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-400">RPE</label>
              <input
                aria-label="Chip edit RPE"
                className="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-1.5 py-1 text-base text-slate-900"
                type="number"
                step="0.5"
                inputMode="decimal"
                value={chipEditDraft.rpe}
                onChange={(event) =>
                  onChipDraftChange((prev) => (prev ? { ...prev, rpe: event.target.value } : prev))
                }
              />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-60"
              onClick={() => onChipEditSave(editingSet.setId)}
              disabled={savingSetId === editingSet.setId}
              type="button"
            >
              {savingSetId === editingSet.setId ? "Saving..." : "Save"}
            </button>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-4 text-xs font-semibold text-slate-700"
              onClick={onCloseChipEditor}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
