"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getSelectionStepLabel,
  getTopComponentLabels,
  parseExplainabilitySelectionMetadata,
} from "@/lib/ui/explainability";
import { AutoregulationDisplay } from "./AutoregulationDisplay";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";

type SessionIntent = "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";

type WorkoutSet = {
  setIndex: number;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetRpe?: number;
  targetLoad?: number;
};

type WorkoutExercise = {
  id: string;
  orderIndex: number;
  isMainLift: boolean;
  exercise: { id: string; name: string; equipment?: string[] };
  sets: WorkoutSet[];
};

type WorkoutPlan = {
  id: string;
  scheduledDate: string;
  warmup: WorkoutExercise[];
  mainLifts: WorkoutExercise[];
  accessories: WorkoutExercise[];
  estimatedMinutes: number;
  notes?: string;
};

type GeneratedMetadata = {
  selectionMode?: "AUTO" | "INTENT";
  sessionIntent?: SessionIntent;
  selection?: unknown;
  filteredExercises?: FilteredExerciseSummary[];
};

type FatigueScore = {
  overall: number;
  perMuscle: Record<string, number>;
  weights: { whoop: number; subjective: number; performance: number };
  components: {
    whoopContribution: number;
    subjectiveContribution: number;
    performanceContribution: number;
  };
};

type AutoregulationModification = {
  type: "intensity_scale" | "volume_reduction" | "deload_trigger";
  exerciseId?: string;
  exerciseName?: string;
  direction?: "up" | "down";
  scalar?: number;
  originalLoad?: number;
  adjustedLoad?: number;
  originalRpe?: number;
  adjustedRpe?: number;
  setsCut?: number;
  originalSetCount?: number;
  adjustedSetCount?: number;
  reason: string;
};

type AutoregulationData = {
  wasAutoregulated: boolean;
  fatigueScore: FatigueScore | null;
  modifications: AutoregulationModification[];
  rationale: string;
};

type ExerciseOption = {
  id: string;
  name: string;
  splitTags: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  isFavorite: boolean;
};

const INTENT_OPTIONS: { value: SessionIntent; label: string }[] = [
  { value: "push", label: "Push" },
  { value: "pull", label: "Pull" },
  { value: "legs", label: "Legs" },
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
  { value: "full_body", label: "Full Body" },
  { value: "body_part", label: "Body Part" },
];

function toDbSessionIntent(
  intent?: SessionIntent
):
  | "PUSH"
  | "PULL"
  | "LEGS"
  | "UPPER"
  | "LOWER"
  | "FULL_BODY"
  | "BODY_PART"
  | undefined {
  if (!intent) {
    return undefined;
  }
  return intent.toUpperCase() as
    | "PUSH"
    | "PULL"
    | "LEGS"
    | "UPPER"
    | "LOWER"
    | "FULL_BODY"
    | "BODY_PART";
}

function formatTargetReps(set?: WorkoutSet): string {
  if (!set) {
    return "";
  }
  if (set.targetRepRange && set.targetRepRange.min !== set.targetRepRange.max) {
    return `${set.targetRepRange.min}-${set.targetRepRange.max} reps`;
  }
  return `${set.targetReps} reps`;
}

function hasBodyweightEquipment(equipment?: string[]): boolean {
  return (equipment ?? []).some((item) => item.toLowerCase() === "bodyweight");
}

function formatTargetLoadLabel(exercise: WorkoutExercise, set?: WorkoutSet): string | null {
  if (!set) {
    return null;
  }
  if (set.targetLoad !== undefined && set.targetLoad !== null) {
    return `${set.targetLoad} lbs`;
  }
  if (hasBodyweightEquipment(exercise.exercise.equipment)) {
    return "BW";
  }
  return null;
}

function parseTargetMuscles(input: string): string[] {
  return input
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

const UPPER_INTENT_MUSCLES = new Set([
  "chest",
  "front delts",
  "side delts",
  "triceps",
  "lats",
  "upper back",
  "rear delts",
  "biceps",
  "forearms",
]);

const LOWER_INTENT_MUSCLES = new Set([
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
  "core",
  "lower back",
]);

function normalizeMuscleKey(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function getIntentFilteredExerciseOptions(
  options: ExerciseOption[],
  intent: SessionIntent,
  targetMusclesInput: string
): ExerciseOption[] {
  if (intent === "full_body") {
    return options;
  }

  if (intent === "push" || intent === "pull" || intent === "legs") {
    return options.filter((exercise) => exercise.splitTags.includes(intent));
  }

  const resolveExerciseMuscles = (exercise: ExerciseOption) =>
    new Set(
      [...exercise.primaryMuscles, ...exercise.secondaryMuscles].map((muscle) =>
        normalizeMuscleKey(muscle)
      )
    );

  if (intent === "upper") {
    return options.filter((exercise) => {
      const muscles = resolveExerciseMuscles(exercise);
      return Array.from(UPPER_INTENT_MUSCLES).some((muscle) => muscles.has(muscle));
    });
  }

  if (intent === "lower") {
    return options.filter((exercise) => {
      const muscles = resolveExerciseMuscles(exercise);
      return Array.from(LOWER_INTENT_MUSCLES).some((muscle) => muscles.has(muscle));
    });
  }

  const targetMuscles = new Set(parseTargetMuscles(targetMusclesInput).map(normalizeMuscleKey));
  if (targetMuscles.size === 0) {
    return options;
  }

  return options.filter((exercise) => {
    const muscles = resolveExerciseMuscles(exercise);
    return Array.from(targetMuscles).some((muscle) => muscles.has(muscle));
  });
}

export function IntentRoundTripValidatorCard() {
  const [intent, setIntent] = useState<SessionIntent>("push");
  const [targetMusclesInput, setTargetMusclesInput] = useState("");
  const [exerciseOptions, setExerciseOptions] = useState<ExerciseOption[]>([]);
  const [pinnedExerciseIds, setPinnedExerciseIds] = useState<string[]>([]);
  const [exerciseLoading, setExerciseLoading] = useState(false);

  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [generatedMetadata, setGeneratedMetadata] = useState<GeneratedMetadata | null>(null);
  const [autoregulation, setAutoregulation] = useState<AutoregulationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    const loadOptions = async () => {
      setExerciseLoading(true);
      const response = await fetch("/api/exercises");
      if (!response.ok) {
        if (!ignore) {
          setExerciseLoading(false);
        }
        return;
      }
      const body = await response.json().catch(() => ({}));
      const options = Array.isArray(body.exercises)
        ? (body.exercises as {
            id?: unknown;
            name?: unknown;
            splitTags?: unknown;
            primaryMuscles?: unknown;
            secondaryMuscles?: unknown;
            isFavorite?: unknown;
          }[])
            .filter(
              (
                exercise
              ): exercise is {
                id: string;
                name: string;
                splitTags: string[];
                primaryMuscles: string[];
                secondaryMuscles: string[];
                isFavorite: boolean;
              } =>
                typeof exercise.id === "string" && typeof exercise.name === "string"
            )
            .map((exercise) => ({
              id: exercise.id,
              name: exercise.name,
              splitTags: Array.isArray(exercise.splitTags)
                ? exercise.splitTags.filter((tag): tag is string => typeof tag === "string")
                : [],
              primaryMuscles: Array.isArray(exercise.primaryMuscles)
                ? exercise.primaryMuscles.filter((muscle): muscle is string => typeof muscle === "string")
                : [],
              secondaryMuscles: Array.isArray(exercise.secondaryMuscles)
                ? exercise.secondaryMuscles.filter((muscle): muscle is string => typeof muscle === "string")
                : [],
              isFavorite: exercise.isFavorite === true,
            }))
        : [];

      if (!ignore) {
        setExerciseOptions(options);
        setExerciseLoading(false);
      }
    };

    loadOptions().catch(() => {
      if (!ignore) {
        setExerciseLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, []);

  const selectionMetadata = useMemo(
    () => parseExplainabilitySelectionMetadata(generatedMetadata?.selection),
    [generatedMetadata?.selection]
  );
  const selectedCount =
    selectionMetadata.selectedExerciseIds?.length ??
    Object.keys(selectionMetadata.rationale ?? {}).length;
  const pinCount = Object.values(selectionMetadata.rationale ?? {}).filter(
    (entry) => entry.selectedStep === "pin"
  ).length;
  const targetCount = Object.keys(selectionMetadata.perExerciseSetTargets ?? {}).length;
  const topRationaleRows = Object.entries(selectionMetadata.rationale ?? {})
    .slice(0, 3)
    .map(([exerciseId, entry]) => {
      const allExercises = [...(workout?.mainLifts ?? []), ...(workout?.accessories ?? [])];
      const exerciseName =
        allExercises.find((exercise) => exercise.exercise.id === exerciseId)?.exercise.name ??
        "Exercise";
      const topReasons = getTopComponentLabels(entry.components, 2);
      return {
        exerciseId,
        exerciseName,
        stepLabel: getSelectionStepLabel(entry.selectedStep),
        reasonLine:
          topReasons.length > 0
            ? topReasons.join(" • ")
            : "Selected for overall fit against session constraints.",
      };
    });

  const filteredExerciseOptions = useMemo(
    () => getIntentFilteredExerciseOptions(exerciseOptions, intent, targetMusclesInput),
    [exerciseOptions, intent, targetMusclesInput]
  );
  const filteredPinnedExerciseIds = useMemo(() => {
    const allowedIds = new Set(filteredExerciseOptions.map((exercise) => exercise.id));
    return pinnedExerciseIds.filter((id) => allowedIds.has(id));
  }, [filteredExerciseOptions, pinnedExerciseIds]);

  const handlePinSelectionChange = (value: string[]) => {
    setPinnedExerciseIds(value);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setSavedId(null);

    const targetMuscles = parseTargetMuscles(targetMusclesInput);

    const response = await fetch("/api/workouts/generate-from-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent,
        targetMuscles: intent === "body_part" ? targetMuscles : undefined,
        pinnedExerciseIds:
          filteredPinnedExerciseIds.length > 0 ? filteredPinnedExerciseIds : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate workout from intent");
      setLoading(false);
      return;
    }

    const body = await response.json();
    setWorkout(body.workout as WorkoutPlan);
    setGeneratedMetadata({
      selectionMode: body.selectionMode,
      sessionIntent: body.sessionIntent,
      selection: body.selection,
      filteredExercises: body.filteredExercises ?? [],
    });
    setAutoregulation(body.autoregulation ?? null);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!workout) {
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode: generatedMetadata?.selectionMode ?? "INTENT",
      sessionIntent: toDbSessionIntent(generatedMetadata?.sessionIntent ?? intent),
      selectionMetadata: generatedMetadata?.selection,
      filteredExercises: generatedMetadata?.filteredExercises,
      advancesSplit: true,
      exercises: [
        ...workout.mainLifts.map((exercise) => ({ ...exercise, section: "MAIN" as const })),
        ...workout.accessories.map((exercise) => ({ ...exercise, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: (exercise as { section: "MAIN" | "ACCESSORY" }).section,
        exerciseId: exercise.exercise.id,
        sets: exercise.sets.map((set) => ({
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRepRange: set.targetRepRange,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
        })),
      })),
    };

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save workout");
      setSaving(false);
      return;
    }

    const body = await response.json().catch(() => ({}));
    setSavedId(body.workoutId ?? workout.id);
    setSaving(false);
  };

  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold">Intent Pipeline Validator</h2>
      <p className="mt-2 text-slate-600">
        Explicit scope: intent pick, optional pins, generate, save, and workout metadata visibility.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Out of scope: weekly schedule setup, cold-start gating, and automation policies.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Intent</span>
          <select
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={intent}
            onChange={(event) => setIntent(event.target.value as SessionIntent)}
          >
            {INTENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {intent === "body_part" ? (
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target Muscles (comma-separated)
            </span>
            <input
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={targetMusclesInput}
              onChange={(event) => setTargetMusclesInput(event.target.value)}
              placeholder="e.g., chest, triceps"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional Pinned Exercises
          </span>
          <select
            multiple
            className="min-h-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={filteredPinnedExerciseIds}
            onChange={(event) =>
              handlePinSelectionChange(
                Array.from(event.target.selectedOptions).map((option) => option.value)
              )
            }
          >
            {filteredExerciseOptions.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.isFavorite ? `* ${exercise.name}` : exercise.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            {exerciseLoading
              ? "Loading exercises..."
              : `${filteredPinnedExerciseIds.length} pinned`}
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <button
          type="button"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? "Generating..." : "Generate Intent Workout"}
        </button>
        {workout ? (
          <button
            type="button"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-900 px-5 py-2 text-sm font-semibold disabled:opacity-60 sm:w-auto"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Workout"}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {generatedMetadata ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p>
            Returned metadata: mode {(generatedMetadata.selectionMode ?? "unknown").toLowerCase()},
            intent {(generatedMetadata.sessionIntent ?? intent).replaceAll("_", " ")}.
          </p>
          <p className="mt-1">
            Selection snapshot: {selectedCount} selected, {pinCount} pinned picks, {targetCount} set-target overrides.
          </p>
        </div>
      ) : null}
      {selectedCount > 0 ? (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-900">Why this selection</summary>
          <p className="mt-1">
            {selectedCount} selected, {pinCount} pinned, {Math.max(0, selectedCount - pinCount)} auto-selected.
          </p>
          {topRationaleRows.length > 0 ? (
            <div className="mt-2 space-y-1">
              {topRationaleRows.map((row) => (
                <p key={row.exerciseId}>
                  <span className="font-semibold">{row.exerciseName}</span> ({row.stepLabel}): {row.reasonLine}
                </p>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {savedId ? (
        <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="text-emerald-600">Saved!</span>
          <Link className="font-semibold text-slate-900" href={`/workout/${savedId}`}>
            View workout
          </Link>
          <Link className="font-semibold text-slate-900" href={`/log/${savedId}`}>
            Start logging
          </Link>
        </div>
      ) : null}

      {workout ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">Estimated time</p>
            <p className="text-lg font-semibold">{workout.estimatedMinutes} minutes</p>
          </div>

          {/* Phase 3: Autoregulation Display */}
          {autoregulation && autoregulation.fatigueScore !== null ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-900 mb-3">
                Autoregulation Applied
              </h3>
              <AutoregulationDisplay
                fatigueScore={autoregulation.fatigueScore}
                modifications={autoregulation.modifications}
                rationale={autoregulation.rationale}
                wasAutoregulated={autoregulation.wasAutoregulated}
              />
            </div>
          ) : null}

          {[
            { label: "Main Lifts", items: workout.mainLifts },
            { label: "Accessories", items: workout.accessories },
          ].map((section) =>
            section.items.length > 0 ? (
              <div key={section.label} className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {section.label}
                </h3>
                <div className="mt-3 space-y-3">
                  {section.items.map((exercise) => {
                    const loadLabel = formatTargetLoadLabel(exercise, exercise.sets[0]);
                    return (
                      <div key={exercise.id} className="rounded-lg border border-slate-100 p-3">
                        <p className="text-sm font-semibold">{exercise.exercise.name}</p>
                        <p className="text-xs text-slate-500">
                          {exercise.sets.length} sets - {formatTargetReps(exercise.sets[0])}
                          {loadLabel ? ` - ${loadLabel}` : ""}
                          {exercise.sets[0]?.targetRpe ? ` - RPE ${exercise.sets[0].targetRpe}` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}

