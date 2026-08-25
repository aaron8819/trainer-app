"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import SessionCheckInForm from "@/components/SessionCheckInForm";
import { TemplateScoreBadge } from "@/components/templates/TemplateScoreBadge";
import {
  getSelectionStepLabel,
  getTopComponentLabels,
  parseExplainabilitySelectionMetadata,
} from "@/lib/ui/explainability";
import {
  buildCanonicalSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import type { ActiveBlockPhase } from "@/lib/api/program";
import type { GenerateFromTemplateResponse } from "@/lib/api/template-session/types";
import type { SaveWorkoutRequestPayload } from "@/components/log-workout/api";
import { formatRepPrescriptionInline } from "@/lib/ui/rep-target-display";
import { formatFrozenLoadValue } from "@/lib/exercise-measurement/load-entry-policy";

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
  measurement?: import("@/lib/exercise-measurement/semantics").MeasurementSemantics;
  zeroLoadMeaning?: import("@/lib/exercise-measurement/semantics").ZeroLoadMeaning | null;
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
  placementId: string;
  originalExerciseId: string;
  originalName: string;
  reason: string;
  alternatives: SubstitutionAlternative[];
};

type AppliedTemplateSubstitution = {
  placementId: string;
  orderIndex: number;
  originalExerciseId: string;
  replacementExerciseId: string;
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

type ReadinessSubmitPayload = {
  subjective: {
    readiness: number;
    motivation: number;
    soreness: Record<string, 1 | 2>;
  };
};

type GenerateFromTemplateCardProps = {
  templates: TemplateSummary[];
  blockPhase?: ActiveBlockPhase;
};

type GeneratedMetadata = Pick<
  GenerateFromTemplateResponse,
  "selectionMode" | "sessionIntent" | "selectionMetadata"
>;

function formatTargetReps(set: WorkoutSet | undefined, showAim: boolean): string {
  if (!set) {
    return "";
  }
  return formatRepPrescriptionInline(set, { showAim });
}

function hasBodyweightEquipment(equipment?: string[]): boolean {
  return (equipment ?? []).some((item) => item.toLowerCase() === "bodyweight");
}

function formatTargetLoadLabel(exercise: WorkoutExercise, set?: WorkoutSet): string | null {
  if (!set) {
    return null;
  }
  if (set.targetLoad !== undefined && set.targetLoad !== null) {
    return formatFrozenLoadValue(
      {
        load: set.targetLoad,
        snapshot: {
          measurement: exercise.measurement ?? null,
          zeroLoadMeaning: exercise.zeroLoadMeaning ?? null,
        },
      },
      (load) => `${load} lbs`,
    );
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

const BLOCK_PHASE_STYLE: Record<string, string> = {
  accumulation: "border-blue-200 bg-blue-50 text-blue-800",
  intensification: "border-purple-200 bg-purple-50 text-purple-800",
  realization: "border-orange-200 bg-orange-50 text-orange-800",
  deload: "border-slate-200 bg-slate-50 text-slate-700",
};

function normalizeBlockPhaseType(blockType: string | null | undefined): string {
  if (!blockType) {
    return "accumulation";
  }
  return blockType.toLowerCase();
}

function toReadinessSubmitPayload(payload: SessionCheckInPayload): ReadinessSubmitPayload {
  return {
    subjective: {
      readiness: payload.readiness,
      motivation: payload.readiness,
      soreness: Object.fromEntries(
        Object.entries(payload.painFlags).map(([key, value]) => [key, value > 0 ? 2 : 1])
      ) as Record<string, 1 | 2>,
    },
  };
}

export function GenerateFromTemplateCard({ templates, blockPhase }: GenerateFromTemplateCardProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");
  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [sraWarnings, setSraWarnings] = useState<SraWarning[]>([]);
  const [substitutions, setSubstitutions] = useState<SubstitutionSuggestion[]>([]);
  const [dismissedSubstitutions, setDismissedSubstitutions] = useState<Set<string>>(new Set());
  const [appliedSubstitutions, setAppliedSubstitutions] = useState<
    AppliedTemplateSubstitution[]
  >([]);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [regenerationPending, setRegenerationPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [generatedMetadata, setGeneratedMetadata] = useState<GeneratedMetadata | null>(null);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<number | null>(null);
  const canonicalSubstitutionsRef = useRef<AppliedTemplateSubstitution[]>([]);
  const intendedSubstitutionsRef = useRef<AppliedTemplateSubstitution[]>([]);

  const generateWorkout = async (
    exerciseReplacements: AppliedTemplateSubstitution[] = [],
  ) => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    activeRequestRef.current = requestId;
    intendedSubstitutionsRef.current = exerciseReplacements;
    setRegenerationPending(true);

    try {
      const response = await fetch("/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          ...(exerciseReplacements.length > 0 ? { exerciseReplacements } : {}),
        }),
      });

      if (activeRequestRef.current !== requestId) {
        return false;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (activeRequestRef.current === requestId) {
          intendedSubstitutionsRef.current = canonicalSubstitutionsRef.current;
          setError(body.error ?? "Failed to generate workout");
        }
        return false;
      }

      const body: GenerateFromTemplateResponse = await response.json();
      if (activeRequestRef.current !== requestId) {
        return false;
      }
      setWorkout(body.workout);
      setSraWarnings(body.sraWarnings ?? []);
      setSubstitutions(body.substitutions ?? []);
      setGeneratedMetadata({
        selectionMode: body.selectionMode,
        sessionIntent: body.sessionIntent,
        selectionMetadata: buildCanonicalSelectionMetadata(body.selectionMetadata),
      });
      canonicalSubstitutionsRef.current = exerciseReplacements;
      intendedSubstitutionsRef.current = exerciseReplacements;
      setAppliedSubstitutions(exerciseReplacements);
      return true;
    } catch {
      if (activeRequestRef.current === requestId) {
        intendedSubstitutionsRef.current = canonicalSubstitutionsRef.current;
        setError("Failed to generate workout");
      }
      return false;
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null;
        setRegenerationPending(false);
      }
    }
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
    setAppliedSubstitutions([]);
    canonicalSubstitutionsRef.current = [];
    intendedSubstitutionsRef.current = [];
    setShowCheckIn(true);
  };

  const handleDismissSubstitution = (placementId: string) => {
    setDismissedSubstitutions((prev) => {
      const next = new Set(prev);
      next.add(placementId);
      return next;
    });
  };

  const handleApplySubstitution = async (
    suggestion: SubstitutionSuggestion,
    replacement: SubstitutionAlternative
  ) => {
    if (saving || !workout) {
      return;
    }
    const placement = [...workout.mainLifts, ...workout.accessories].find(
      (exercise) => exercise.id === suggestion.placementId,
    );
    if (!placement) {
      setError("The exercise placement changed. Regenerate and retry the substitution.");
      return;
    }

    const nextSubstitutions = [
      ...intendedSubstitutionsRef.current.filter(
        (entry) => entry.placementId !== suggestion.placementId,
      ),
      {
        placementId: suggestion.placementId,
        orderIndex: placement.orderIndex,
        originalExerciseId: suggestion.originalExerciseId,
        replacementExerciseId: replacement.id,
      },
    ];
    setError(null);
    await generateWorkout(nextSubstitutions);
  };

  const handleCheckInSubmit = async (payload: SessionCheckInPayload) => {
    setCheckInSubmitting(true);
    setError(null);
    setSavedId(null);

    const response = await fetch("/api/readiness/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toReadinessSubmitPayload(payload)),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save check-in");
      setCheckInSubmitting(false);
      return;
    }

    const generated = await generateWorkout();
    setCheckInSubmitting(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleCheckInSkip = async () => {
    setCheckInSubmitting(true);
    setError(null);
    setSavedId(null);

    const generated = await generateWorkout();
    setCheckInSubmitting(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleSave = async () => {
    if (!workout || activeRequestRef.current !== null) return;

    setSaving(true);
    setError(null);

    const payload: SaveWorkoutRequestPayload = {
      workoutId: workout.id,
      templateId: selectedTemplateId,
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode: generatedMetadata?.selectionMode ?? "AUTO",
      sessionIntent:
        generatedMetadata?.selectionMode === "INTENT"
          ? toDbSessionIntent(generatedMetadata.sessionIntent)
          : undefined,
      selectionMetadata: generatedMetadata?.selectionMetadata,
      advancesSplit: false,
      exercises: [
        ...workout.mainLifts.map((e) => ({ ...e, section: "MAIN" as const })),
        ...workout.accessories.map((e) => ({ ...e, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: (exercise as { section: "MAIN" | "ACCESSORY" }).section,
        placementId: exercise.id,
        exerciseId: exercise.exercise.id,
        ...(exercise.measurement ? { measurement: exercise.measurement } : {}),
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
      !dismissedSubstitutions.has(suggestion.placementId) &&
      !appliedSubstitutions.some(
        (replacement) => replacement.placementId === suggestion.placementId,
      )
  );
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const normalizedBlockType = normalizeBlockPhaseType(blockPhase?.blockType);
  const blockTypeLabel = `${normalizedBlockType.charAt(0).toUpperCase()}${normalizedBlockType.slice(1)}`;
  const selectionMetadata = parseExplainabilitySelectionMetadata(
    generatedMetadata?.selectionMetadata
  );
  const selectedCount =
    selectionMetadata.selectedExerciseIds?.length ??
    Object.keys(selectionMetadata.rationale ?? {}).length;
  const pinCount = Object.values(selectionMetadata.rationale ?? {}).filter(
    (entry) => entry.selectedStep === "pin"
  ).length;
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

  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold">Template Workout</h2>
      <p className="mt-2 text-slate-600">
        Generate a workout from one of your saved templates.
      </p>

      {blockPhase && (
        <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs ${BLOCK_PHASE_STYLE[normalizedBlockType] ?? BLOCK_PHASE_STYLE.accumulation}`}>
          <p className="font-semibold">
            Week {blockPhase.weekInMeso} of {blockPhase.mesoDurationWeeks}
            {" · "}{blockTypeLabel}
          </p>
          <p className="mt-0.5 opacity-90">{blockPhase.coachingCue}</p>
          {blockPhase.sessionsUntilDeload > 0 ? (
            <p className="mt-0.5 opacity-75">
              {blockPhase.sessionsUntilDeload} session{blockPhase.sessionsUntilDeload === 1 ? "" : "s"} until deload.
            </p>
          ) : (
            <p className="mt-0.5 font-medium">This is your deload session.</p>
          )}
        </div>
      )}

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
              disabled={saving || regenerationPending}
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
          isSubmitting={checkInSubmitting || regenerationPending}
        />
      ) : (
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            onClick={handleGenerateClick}
            disabled={saving || checkInSubmitting || regenerationPending}
          >
            {checkInSubmitting || regenerationPending ? "Generating..." : "Generate Workout"}
          </button>
          {workout && (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-900 px-5 py-2 text-sm font-semibold disabled:opacity-60 sm:w-auto"
              onClick={handleSave}
              disabled={saving || regenerationPending}
            >
              {saving ? "Saving..." : regenerationPending ? "Regenerating..." : "Save Workout"}
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {selectedCount > 0 && !savedId ? (
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
                key={suggestion.placementId}
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
                    disabled={saving}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-900"
                    onClick={() => handleDismissSubstitution(suggestion.placementId)}
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
                          {exercise.sets.length} sets - {formatTargetReps(exercise.sets[0], exercise.isMainLift)}
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
