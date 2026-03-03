import { ExerciseSetChipsEditor } from "@/components/log-workout/ExerciseSetChipsEditor";
import type { ChipEditDraft } from "@/components/log-workout/useWorkoutSessionFlow";
import { formatSectionLabel } from "@/components/log-workout/useWorkoutLogState";
import type {
  ExerciseSection,
  LogExerciseInput,
  NormalizedExercises,
} from "@/components/log-workout/types";

type WorkoutExerciseQueueProps = {
  data: NormalizedExercises;
  sectionOrder: ExerciseSection[];
  remainingCount: number;
  loggedSetIds: Set<string>;
  expandedSections: Record<ExerciseSection, boolean>;
  expandedExerciseId: string | null;
  resolvedActiveSetId: string | null;
  chipEditSetId: string | null;
  chipEditDraft: ChipEditDraft | null;
  savingSetId: string | null;
  sectionRefs: React.MutableRefObject<Record<ExerciseSection, HTMLDivElement | null>>;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<ExerciseSection, boolean>>>;
  setExpandedExerciseId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveSetId: (setId: string) => void;
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
  openChipEditor: (setId: string) => void;
  setChipEditDraft: React.Dispatch<React.SetStateAction<ChipEditDraft | null>>;
  handleChipLoadBlur: (setId: string, isDumbbell: boolean) => void;
  handleChipEditSave: (setId: string) => void;
  closeChipEditor: () => void;
};

export function WorkoutExerciseQueue({
  data,
  sectionOrder,
  remainingCount,
  loggedSetIds,
  expandedSections,
  expandedExerciseId,
  resolvedActiveSetId,
  chipEditSetId,
  chipEditDraft,
  savingSetId,
  sectionRefs,
  setExpandedSections,
  setExpandedExerciseId,
  setActiveSetId,
  isDumbbellExercise,
  openChipEditor,
  setChipEditDraft,
  handleChipLoadBlur,
  handleChipEditSave,
  closeChipEditor,
}: WorkoutExerciseQueueProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Exercise queue</h2>
        <p className="text-xs text-slate-500">{remainingCount} sets remaining</p>
      </div>
      {sectionOrder.map((section) => {
        const sectionItems = data[section];
        if (sectionItems.length === 0) {
          return null;
        }
        const isExpanded = expandedSections[section];
        return (
          <div
            key={section}
            ref={(el) => {
              sectionRefs.current[section] = el;
            }}
            className="rounded-2xl border border-slate-200 bg-white"
          >
            <button
              className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))}
              type="button"
            >
              <span className="text-sm font-semibold">{formatSectionLabel(section)}</span>
              <span className="text-xs text-slate-500">{isExpanded ? "Hide" : "Show"}</span>
            </button>
            {!isExpanded ? (
              <div className="border-t border-slate-100 px-4 py-2" data-testid={`collapsed-summary-${section}`}>
                {sectionItems.map((exercise) => {
                  const exerciseLogged = exercise.sets.filter((set) => loggedSetIds.has(set.setId)).length;
                  return (
                    <div
                      key={exercise.workoutExerciseId}
                      className="flex items-center justify-between py-1 text-xs text-slate-500"
                    >
                      <span className="truncate">{exercise.name}</span>
                      <span className="ml-2 shrink-0">
                        {exerciseLogged}/{exercise.sets.length} sets logged
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {isExpanded ? (
              <div className="space-y-2 border-t border-slate-100 p-3">
                {sectionItems.map((exercise) => {
                  const exerciseLogged = exercise.sets.filter((set) => loggedSetIds.has(set.setId)).length;
                  const allExerciseSetsLogged =
                    exerciseLogged === exercise.sets.length && exercise.sets.length > 0;
                  const nextSet = exercise.sets.find((set) => !loggedSetIds.has(set.setId)) ?? exercise.sets[0];
                  const isExerciseExpanded = expandedExerciseId === exercise.workoutExerciseId;
                  return (
                    <div key={exercise.workoutExerciseId} className="rounded-xl border border-slate-100">
                      <button
                        className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left"
                        onClick={() => {
                          if (nextSet) {
                            setActiveSetId(nextSet.setId);
                          }
                          setExpandedExerciseId((prev) =>
                            prev === exercise.workoutExerciseId ? null : exercise.workoutExerciseId
                          );
                        }}
                        type="button"
                      >
                        <span className="text-sm font-medium">{exercise.name}</span>
                        <span
                          className={`text-xs ${
                            allExerciseSetsLogged ? "font-semibold text-emerald-700" : "text-slate-500"
                          }`}
                        >
                          {allExerciseSetsLogged ? "✓ " : ""}
                          {exerciseLogged}/{exercise.sets.length}
                        </span>
                      </button>
                      {isExerciseExpanded ? (
                        <ExerciseSetChipsEditor
                          exercise={exercise}
                          loggedSetIds={loggedSetIds}
                          resolvedActiveSetId={resolvedActiveSetId}
                          chipEditSetId={chipEditSetId}
                          chipEditDraft={chipEditDraft}
                          savingSetId={savingSetId}
                          isDumbbell={isDumbbellExercise(exercise)}
                          onOpenChipEditor={openChipEditor}
                          onSetActiveSetId={setActiveSetId}
                          onChipDraftChange={setChipEditDraft}
                          onChipLoadBlur={handleChipLoadBlur}
                          onChipEditSave={handleChipEditSave}
                          onCloseChipEditor={closeChipEditor}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
