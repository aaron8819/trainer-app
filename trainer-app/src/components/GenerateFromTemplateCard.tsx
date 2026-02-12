"use client";

import { useState } from "react";
import Link from "next/link";
import SessionCheckInForm from "@/components/SessionCheckInForm";
import { TemplateScoreBadge } from "@/components/templates/TemplateScoreBadge";

type WorkoutSet = {
  setIndex: number;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetRpe?: number;
  targetLoad?: number;
  restSeconds?: number;
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

type SraWarning = {
  muscle: string;
  recoveryPercent: number;
};

type SubstitutionAlternative = {
  id: string;
  name: string;
  score: number;
};

type SubstitutionSuggestion = {
  originalExerciseId: string;
  originalName: string;
  reason: string;
  alternatives: SubstitutionAlternative[];
};

type TemplateSummary = {
  id: string;
  name: string;
  exerciseCount: number;
  score?: number;
  scoreLabel?: string;
};

type SessionCheckInPayload = {
  readiness: number;
  painFlags: Record<"shoulder" | "elbow" | "low_back" | "knee" | "wrist", 0 | 2>;
  notes?: string;
};

type GenerateFromTemplateCardProps = {
  templates: TemplateSummary[];
};

type GeneratedMetadata = {
  selectionMode?: "AUTO" | "INTENT";
  sessionIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  selection?: unknown;
};

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

function formatTemplateOptionLabel(template: TemplateSummary): string {
  const maxNameLength = 44;
  const trimmedName =
    template.name.length > maxNameLength
      ? `${template.name.slice(0, maxNameLength - 1).trimEnd()}...`
      : template.name;
  const exerciseLabel = template.exerciseCount === 1 ? "exercise" : "exercises";
  return `${trimmedName} (${template.exerciseCount} ${exerciseLabel})`;
}

function toDbSessionIntent(
  intent?: GeneratedMetadata["sessionIntent"]
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

function applyExerciseSwap(
  workout: WorkoutPlan,
  originalExerciseId: string,
  replacement: SubstitutionAlternative
): WorkoutPlan {
  const swapExercises = (exercises: WorkoutExercise[]) =>
    exercises.map((exercise) =>
      exercise.exercise.id === originalExerciseId
        ? {
            ...exercise,
            exercise: {
              id: replacement.id,
              name: replacement.name,
            },
          }
        : exercise
    );

  return {
    ...workout,
    mainLifts: swapExercises(workout.mainLifts),
    accessories: swapExercises(workout.accessories),
  };
}

export function GenerateFromTemplateCard({ templates }: GenerateFromTemplateCardProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");
  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [sraWarnings, setSraWarnings] = useState<SraWarning[]>([]);
  const [substitutions, setSubstitutions] = useState<SubstitutionSuggestion[]>([]);
  const [dismissedSubstitutions, setDismissedSubstitutions] = useState<Set<string>>(new Set());
  const [appliedSubstitutions, setAppliedSubstitutions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [generatedMetadata, setGeneratedMetadata] = useState<GeneratedMetadata | null>(null);

  const generateWorkout = async () => {
    const response = await fetch("/api/workouts/generate-from-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: selectedTemplateId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate workout");
      return false;
    }

    const body = await response.json();
    setWorkout(body.workout as WorkoutPlan);
    setSraWarnings(body.sraWarnings ?? []);
    setSubstitutions((body.substitutions ?? []) as SubstitutionSuggestion[]);
    setGeneratedMetadata({
      selectionMode: body.selectionMode,
      sessionIntent: body.sessionIntent,
      selection: body.selection,
    });
    setDismissedSubstitutions(new Set());
    setAppliedSubstitutions(new Set());
    return true;
  };

  const handleGenerateClick = () => {
    if (!selectedTemplateId) {
      setError("Select a template first");
      return;
    }
    setError(null);
    setSavedId(null);
    setWorkout(null);
    setSraWarnings([]);
    setSubstitutions([]);
    setGeneratedMetadata(null);
    setDismissedSubstitutions(new Set());
    setAppliedSubstitutions(new Set());
    setShowCheckIn(true);
  };

  const handleDismissSubstitution = (exerciseId: string) => {
    setDismissedSubstitutions((prev) => {
      const next = new Set(prev);
      next.add(exerciseId);
      return next;
    });
  };

  const handleApplySubstitution = (
    suggestion: SubstitutionSuggestion,
    replacement: SubstitutionAlternative
  ) => {
    if (!workout) {
      return;
    }
    setWorkout((prev) =>
      prev ? applyExerciseSwap(prev, suggestion.originalExerciseId, replacement) : prev
    );
    setAppliedSubstitutions((prev) => {
      const next = new Set(prev);
      next.add(suggestion.originalExerciseId);
      return next;
    });
  };

  const handleCheckInSubmit = async (payload: SessionCheckInPayload) => {
    setLoading(true);
    setError(null);
    setSavedId(null);

    const response = await fetch("/api/session-checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save check-in");
      setLoading(false);
      return;
    }

    const generated = await generateWorkout();
    setLoading(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleCheckInSkip = async () => {
    setLoading(true);
    setError(null);
    setSavedId(null);

    const generated = await generateWorkout();
    setLoading(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleSave = async () => {
    if (!workout) return;

    setSaving(true);
    setError(null);

    const payload = {
      workoutId: workout.id,
      templateId: selectedTemplateId,
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode: generatedMetadata?.selectionMode ?? "AUTO",
      sessionIntent:
        generatedMetadata?.selectionMode === "INTENT"
          ? toDbSessionIntent(generatedMetadata.sessionIntent)
          : undefined,
      selectionMetadata: generatedMetadata?.selection,
      advancesSplit: false,
      exercises: [
        ...workout.mainLifts.map((e) => ({ ...e, section: "MAIN" as const })),
        ...workout.accessories.map((e) => ({ ...e, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: (exercise as { section: "MAIN" | "ACCESSORY" }).section,
        exerciseId: exercise.exercise.id,
        sets: exercise.sets.map((set) => ({
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRepRange: set.targetRepRange,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
          restSeconds: set.restSeconds,
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

  if (templates.length === 0) {
    return (
      <div className="w-full min-w-0 rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">Template Workout</h2>
        <p className="mt-2 text-slate-600">No templates yet. Create one to get started.</p>
        <Link
          href="/templates/new"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
        >
          Create Template
        </Link>
      </div>
    );
  }

  const activeSubstitutions = substitutions.filter(
    (suggestion) =>
      suggestion.alternatives.length > 0 &&
      !dismissedSubstitutions.has(suggestion.originalExerciseId) &&
      !appliedSubstitutions.has(suggestion.originalExerciseId)
  );
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold">Template Workout</h2>
      <p className="mt-2 text-slate-600">
        Generate a workout from one of your saved templates.
      </p>

      <div className="mt-4">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Template
          </span>
          <div className="relative">
            <select
              className="min-h-11 w-full min-w-0 max-w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {formatTemplateOptionLabel(template)}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500"
            >
              v
            </span>
          </div>
        </label>
        {selectedTemplate ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>
              {selectedTemplate.exerciseCount}{" "}
              {selectedTemplate.exerciseCount === 1 ? "exercise" : "exercises"}
            </span>
            {selectedTemplate.score !== undefined && selectedTemplate.scoreLabel ? (
              <TemplateScoreBadge
                score={selectedTemplate.score}
                label={selectedTemplate.scoreLabel}
                size="sm"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {showCheckIn ? (
        <SessionCheckInForm
          onSubmit={handleCheckInSubmit}
          onSkip={handleCheckInSkip}
          isSubmitting={loading}
        />
      ) : (
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            onClick={handleGenerateClick}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate Workout"}
          </button>
          {workout && (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-900 px-5 py-2 text-sm font-semibold disabled:opacity-60 sm:w-auto"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Workout"}
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {savedId && (
        <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="text-emerald-600">Saved!</span>
          <Link className="font-semibold text-slate-900" href={`/workout/${savedId}`}>
            View workout
          </Link>
          <Link className="font-semibold text-slate-900" href={`/log/${savedId}`}>
            Start logging
          </Link>
        </div>
      )}

      {sraWarnings.length > 0 && !savedId && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="font-semibold">Recovery note:</span>{" "}
          {sraWarnings.map((w) => `${w.muscle} (${w.recoveryPercent}%)`).join(", ")} may still be recovering.
        </div>
      )}

      {activeSubstitutions.length > 0 && !savedId && (
        <div className="mt-3 space-y-2">
          {activeSubstitutions.map((suggestion) => {
            const primaryAlternative = suggestion.alternatives[0];
            if (!primaryAlternative) {
              return null;
            }

            return (
              <div
                key={suggestion.originalExerciseId}
                className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"
              >
                <p>
                  <span className="font-semibold">{suggestion.reason}:</span>{" "}
                  consider swapping {suggestion.originalName} for {primaryAlternative.name}.
                </p>
                <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center justify-center rounded-full bg-sky-900 px-3 py-1 text-xs font-semibold text-white"
                    onClick={() => handleApplySubstitution(suggestion, primaryAlternative)}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-900"
                    onClick={() => handleDismissSubstitution(suggestion.originalExerciseId)}
                  >
                    Dismiss
                  </button>
                  {suggestion.alternatives.length > 1 && (
                    <span className="text-sky-800">
                      Other options:{" "}
                      {suggestion.alternatives
                        .slice(1)
                        .map((alt) => alt.name)
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {workout && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">Estimated time</p>
            <p className="text-lg font-semibold">{workout.estimatedMinutes} minutes</p>
          </div>
          {workout.notes && (
            <p className="text-xs text-slate-500">{workout.notes}</p>
          )}
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
      )}
    </div>
  );
}
