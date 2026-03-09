"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import type { SaveWorkoutRequestPayload } from "@/components/log-workout/api";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

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

type GeneratedMetadata = Pick<
  GenerateFromIntentResponse,
  "selectionMode" | "sessionIntent" | "selectionMetadata" | "filteredExercises" | "selectionSummary"
>;

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
  if (!intent) return undefined;
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
  if (!set) return "";
  if (set.targetRepRange && set.targetRepRange.min !== set.targetRepRange.max) {
    return `${set.targetRepRange.min}-${set.targetRepRange.max} reps`;
  }
  return `${set.targetReps} reps`;
}

function parseTargetMuscles(input: string): string[] {
  return input
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

type IntentWorkoutCardProps = {
  initialIntent?: SessionIntent;
};

export function IntentWorkoutCard({ initialIntent = "push" }: IntentWorkoutCardProps) {
  const [intent, setIntent] = useState<SessionIntent>(initialIntent);
  const [targetMusclesInput, setTargetMusclesInput] = useState("");
  const [supplementalMode, setSupplementalMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [generatedMetadata, setGeneratedMetadata] = useState<GeneratedMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    setIntent(initialIntent);
  }, [initialIntent]);

  useEffect(() => {
    if (intent !== "body_part") {
      setSupplementalMode(false);
    }
  }, [intent]);

  const allExercises = useMemo(
    () => [...(workout?.mainLifts ?? []), ...(workout?.accessories ?? [])],
    [workout]
  );

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
        supplementalDeficitSession: intent === "body_part" ? supplementalMode : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate workout");
      setLoading(false);
      return;
    }

    const body: GenerateFromIntentResponse = await response.json();
    setWorkout(body.workout);
    setGeneratedMetadata({
      selectionMode: body.selectionMode,
      sessionIntent: body.sessionIntent,
      selectionMetadata: body.selectionMetadata,
      filteredExercises: body.filteredExercises ?? [],
      selectionSummary: body.selectionSummary,
    });
    setLoading(false);
  };

  const handleSave = async () => {
    if (!workout) return;
    setSaving(true);
    setError(null);
    const isSupplementalSession = isStrictSupplementalDeficitSession({
      selectionMetadata: generatedMetadata?.selectionMetadata,
      selectionMode: generatedMetadata?.selectionMode,
      sessionIntent: toDbSessionIntent(generatedMetadata?.sessionIntent ?? intent),
    });

    const payload: SaveWorkoutRequestPayload = {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode: generatedMetadata?.selectionMode ?? "INTENT",
      sessionIntent: toDbSessionIntent(generatedMetadata?.sessionIntent ?? intent),
      selectionMetadata: generatedMetadata?.selectionMetadata,
      filteredExercises: generatedMetadata?.filteredExercises,
      advancesSplit: isSupplementalSession ? false : true,
      exercises: [
        ...workout.warmup.map((exercise) => ({ ...exercise, section: "WARMUP" as const })),
        ...workout.mainLifts.map((exercise) => ({ ...exercise, section: "MAIN" as const })),
        ...workout.accessories.map((exercise) => ({ ...exercise, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: (exercise as { section: "WARMUP" | "MAIN" | "ACCESSORY" }).section,
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

  const readinessPreview = generatedMetadata?.selectionMetadata?.sessionDecisionReceipt?.readiness;
  const showReadinessPreview =
    Boolean(readinessPreview?.rationale) || readinessPreview?.signalAgeHours != null;

  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold">Generate Workout</h2>
      <p className="mt-2 text-slate-600">
        Pick an intent and generate a session. Use Templates for fixed, reusable sessions.
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
          <>
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
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={supplementalMode}
                onChange={(event) => setSupplementalMode(event.target.checked)}
              />
              <span>
                Supplemental deficit session
              </span>
            </label>
          </>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <button
          type="button"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? "Generating..." : "Generate"}
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
        <Link
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
          href="/templates"
        >
          Open Templates
        </Link>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {showReadinessPreview ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {readinessPreview?.rationale ? <p>{readinessPreview.rationale}</p> : null}
          {readinessPreview?.signalAgeHours != null ? (
            <p className={readinessPreview.rationale ? "mt-1" : undefined}>
              Signal age: {readinessPreview.signalAgeHours.toFixed(1)}h
            </p>
          ) : null}
        </div>
      ) : null}

      {generatedMetadata?.selectionSummary ? (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <summary
            className="cursor-pointer font-semibold text-slate-900"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            Advanced details
          </summary>
          {showAdvanced ? (
            <p className="mt-1">
              Selected {generatedMetadata.selectionSummary.selectedCount}, pinned{" "}
              {generatedMetadata.selectionSummary.pinnedCount}, set-target overrides{" "}
              {generatedMetadata.selectionSummary.setTargetCount}.
            </p>
          ) : null}
        </details>
      ) : null}

      {savedId ? (
        <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="text-emerald-600">Saved.</span>
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
                  {section.items.map((exercise) => (
                    <div key={exercise.id} className="rounded-lg border border-slate-100 p-3">
                      <p className="text-sm font-semibold">{exercise.exercise.name}</p>
                      <p className="text-xs text-slate-500">
                        {exercise.sets.length} sets - {formatTargetReps(exercise.sets[0])}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null
          )}

          {allExercises.length === 0 ? (
            <p className="text-sm text-slate-500">No exercises returned.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
