import { memo, useEffect, type MutableRefObject } from "react";
import {
  ExerciseSetChipsEditor,
  type ExerciseSetChip,
} from "@/components/log-workout/ExerciseSetChipsEditor";
import { formatSectionLabel } from "@/components/log-workout/useWorkoutLogState";
import type { ExerciseSection } from "@/components/log-workout/types";
import { RUNTIME_ADDED_EXERCISE_BADGE_LABEL } from "@/lib/ui/selection-metadata";

export type WorkoutQueueExerciseRowData = {
  section: ExerciseSection;
  exerciseId: string;
  exerciseName: string;
  isRuntimeAdded: boolean;
  sessionNote?: string;
  loggedCount: number;
  totalSets: number;
  allSetsLogged: boolean;
  isExpanded: boolean;
  nextSetId: string | null;
  chips: ExerciseSetChip[];
  canAddSet: boolean;
  isAddingSet: boolean;
  canSwap: boolean;
  isSwapping: boolean;
  canRemove: boolean;
  isRemoving: boolean;
};

export type WorkoutQueueSectionData = {
  section: ExerciseSection;
  isExpanded: boolean;
  collapsedSummaries: Array<{
    exerciseId: string;
    exerciseName: string;
    loggedCount: number;
    totalSets: number;
  }>;
  exercises: WorkoutQueueExerciseRowData[];
};

type WorkoutExerciseQueueProps = {
  sections: WorkoutQueueSectionData[];
  remainingCount: number;
  sectionRefs: MutableRefObject<Record<ExerciseSection, HTMLDivElement | null>>;
  onToggleSection: (section: ExerciseSection) => void;
  onToggleExercise: (exerciseId: string, nextSetId: string | null) => void;
  onSelectSet: (setId: string) => void;
  onAddSet?: (exerciseId: string, section: ExerciseSection) => void;
  onSwapExercise?: (exerciseId: string) => void;
  onRemoveExercise?: (exerciseId: string) => void;
  onExerciseRowRender?: (exerciseId: string) => void;
};

function areChipsEqual(previous: ExerciseSetChip[], next: ExerciseSetChip[]) {
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((chip, index) => {
    const nextChip = next[index];
    return (
      chip.setId === nextChip?.setId &&
      chip.label === nextChip.label &&
      chip.isLogged === nextChip.isLogged &&
      chip.isActive === nextChip.isActive &&
      chip.isSaving === nextChip.isSaving
    );
  });
}

const ExerciseQueueRow = memo(
  function ExerciseQueueRow({
    row,
    onToggleExercise,
    onSelectSet,
    onAddSet,
    onSwapExercise,
    onRemoveExercise,
    onRender,
  }: {
    row: WorkoutQueueExerciseRowData;
    onToggleExercise: (exerciseId: string, nextSetId: string | null) => void;
    onSelectSet: (setId: string) => void;
    onAddSet?: (exerciseId: string, section: ExerciseSection) => void;
    onSwapExercise?: (exerciseId: string) => void;
    onRemoveExercise?: (exerciseId: string) => void;
    onRender?: (exerciseId: string) => void;
  }) {
    useEffect(() => {
      onRender?.(row.exerciseId);
    });

    return (
      <div
        className="rounded-xl border border-slate-100"
        data-testid={`queue-row-${row.exerciseId}`}
      >
        <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => onToggleExercise(row.exerciseId, row.nextSetId)}
            type="button"
          >
            <span className="block truncate text-sm font-medium">{row.exerciseName}</span>
            {row.isRuntimeAdded ? (
              <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                {RUNTIME_ADDED_EXERCISE_BADGE_LABEL}
              </span>
            ) : null}
            {row.sessionNote ? (
              <span className="mt-0.5 block truncate text-[11px] text-amber-700">
                {row.sessionNote}
              </span>
            ) : null}
          </button>
          <span className="flex shrink-0 items-center gap-2">
            {row.canRemove && onRemoveExercise ? (
              <button
                className="inline-flex min-h-8 items-center justify-center rounded-full border border-red-200 px-3 text-[11px] font-semibold text-red-700 disabled:opacity-60"
                disabled={row.isRemoving}
                onClick={() => onRemoveExercise(row.exerciseId)}
                type="button"
              >
                {row.isRemoving ? "Removing..." : "Remove"}
              </button>
            ) : null}
            {row.canSwap && onSwapExercise ? (
              <button
                className="inline-flex min-h-8 items-center justify-center rounded-full border border-slate-300 px-3 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                disabled={row.isSwapping}
                onClick={() => onSwapExercise(row.exerciseId)}
                type="button"
              >
                {row.isSwapping ? "Swapping..." : "Swap"}
              </button>
            ) : null}
            <span
              className={`text-xs ${
                row.allSetsLogged ? "font-semibold text-emerald-700" : "text-slate-500"
              }`}
            >
              {row.allSetsLogged ? "OK " : ""}
              {row.loggedCount}/{row.totalSets}
            </span>
          </span>
        </div>
        {row.isExpanded ? (
          <ExerciseSetChipsEditor
            chips={row.chips}
            hasLoggedSets={row.loggedCount > 0}
            onSelectSet={onSelectSet}
            trailingAction={
              row.canAddSet && onAddSet
                ? {
                    label: row.isAddingSet ? "Adding..." : "+ Add set",
                    disabled: row.isAddingSet,
                    onClick: () => onAddSet(row.exerciseId, row.section),
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    );
  },
  (previous, next) =>
    previous.row.section === next.row.section &&
    previous.row.exerciseId === next.row.exerciseId &&
    previous.row.exerciseName === next.row.exerciseName &&
    previous.row.isRuntimeAdded === next.row.isRuntimeAdded &&
    previous.row.sessionNote === next.row.sessionNote &&
    previous.row.loggedCount === next.row.loggedCount &&
    previous.row.totalSets === next.row.totalSets &&
    previous.row.allSetsLogged === next.row.allSetsLogged &&
    previous.row.isExpanded === next.row.isExpanded &&
    previous.row.nextSetId === next.row.nextSetId &&
    previous.row.canAddSet === next.row.canAddSet &&
    previous.row.isAddingSet === next.row.isAddingSet &&
    previous.row.canSwap === next.row.canSwap &&
    previous.row.isSwapping === next.row.isSwapping &&
    previous.row.canRemove === next.row.canRemove &&
    previous.row.isRemoving === next.row.isRemoving &&
    areChipsEqual(previous.row.chips, next.row.chips) &&
    previous.onToggleExercise === next.onToggleExercise &&
    previous.onSelectSet === next.onSelectSet &&
    previous.onAddSet === next.onAddSet &&
    previous.onSwapExercise === next.onSwapExercise &&
    previous.onRemoveExercise === next.onRemoveExercise &&
    previous.onRender === next.onRender
);

export function WorkoutExerciseQueue({
  sections,
  remainingCount,
  sectionRefs,
  onToggleSection,
  onToggleExercise,
  onSelectSet,
  onAddSet,
  onSwapExercise,
  onRemoveExercise,
  onExerciseRowRender,
}: WorkoutExerciseQueueProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Exercise queue</h2>
        <p className="text-xs text-slate-500">{remainingCount} sets remaining</p>
      </div>
      {sections.map((section) => (
        <div
          key={section.section}
          ref={(el) => {
            sectionRefs.current[section.section] = el;
          }}
          className="rounded-2xl border border-slate-200 bg-white"
        >
          <button
            className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left"
            onClick={() => onToggleSection(section.section)}
            type="button"
          >
            <span className="text-sm font-semibold">{formatSectionLabel(section.section)}</span>
            <span className="text-xs text-slate-500">{section.isExpanded ? "Hide" : "Show"}</span>
          </button>
          {!section.isExpanded ? (
            <div
              className="border-t border-slate-100 px-4 py-2"
              data-testid={`collapsed-summary-${section.section}`}
            >
              {section.collapsedSummaries.map((exercise) => (
                <div
                  key={exercise.exerciseId}
                  className="flex items-center justify-between py-1 text-xs text-slate-500"
                >
                  <span className="truncate">{exercise.exerciseName}</span>
                  <span className="ml-2 shrink-0">
                    {exercise.loggedCount}/{exercise.totalSets} sets logged
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {section.isExpanded ? (
            <div className="space-y-2 border-t border-slate-100 p-3">
              {section.exercises.map((row) => (
                <ExerciseQueueRow
                  key={row.exerciseId}
                  row={row}
                  onToggleExercise={onToggleExercise}
                  onSelectSet={onSelectSet}
                  onAddSet={onAddSet}
                  onSwapExercise={onSwapExercise}
                  onRemoveExercise={onRemoveExercise}
                  onRender={onExerciseRowRender}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
