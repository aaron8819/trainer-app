"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  BaselinePrimaryGoal,
  BaselineSplitType,
  StarterExercise,
  StarterExerciseCandidate,
} from "@/lib/baseline/starter-exercises";
import { resolveBaselineContextForGoal, selectStarterExercises } from "@/lib/baseline/starter-exercises";

type BaselineRow = {
  workingWeight: string;
  topSetWeight: string;
  topSetReps: string;
  error?: string;
};

type ExistingBaseline = {
  exerciseId: string;
  context: string;
  workingWeightMin?: number | null;
  workingWeightMax?: number | null;
  topSetWeight?: number | null;
  topSetReps?: number | null;
};

function formatWeightCandidate(baseline: ExistingBaseline | undefined): string {
  if (!baseline) return "";
  const { workingWeightMin, workingWeightMax } = baseline;
  if (typeof workingWeightMin === "number" && typeof workingWeightMax === "number") {
    return workingWeightMin === workingWeightMax
      ? String(workingWeightMin)
      : String(Math.round(((workingWeightMin + workingWeightMax) / 2) * 10) / 10);
  }
  if (typeof workingWeightMin === "number") return String(workingWeightMin);
  if (typeof workingWeightMax === "number") return String(workingWeightMax);
  return "";
}

function toPositiveNumber(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export default function BaselineSetupCard({
  title,
  description,
  splitType,
  primaryGoal,
  exercisePool,
  existingBaselines,
  onSkipAll,
  showStartTrainingCta = false,
}: {
  title: string;
  description: string;
  splitType: BaselineSplitType | undefined;
  primaryGoal: BaselinePrimaryGoal | undefined;
  exercisePool: StarterExerciseCandidate[];
  existingBaselines: ExistingBaseline[];
  onSkipAll?: () => void;
  showStartTrainingCta?: boolean;
}) {
  const [rows, setRows] = useState<Record<string, BaselineRow>>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const context = useMemo(() => resolveBaselineContextForGoal(primaryGoal), [primaryGoal]);

  const starterExercises = useMemo<StarterExercise[]>(() => {
    return selectStarterExercises(exercisePool, splitType, undefined);
  }, [exercisePool, splitType]);

  useEffect(() => {
    const nextRows: Record<string, BaselineRow> = {};
    for (const exercise of starterExercises) {
      const matchingContext = existingBaselines.find(
        (baseline) => baseline.exerciseId === exercise.id && baseline.context === context
      );
      const fallback = existingBaselines.find((baseline) => baseline.exerciseId === exercise.id);
      const seed = matchingContext ?? fallback;
      nextRows[exercise.id] = {
        workingWeight: formatWeightCandidate(seed),
        topSetWeight: seed?.topSetWeight ? String(seed.topSetWeight) : "",
        topSetReps: seed?.topSetReps ? String(seed.topSetReps) : "",
      };
    }
    setRows(nextRows);
  }, [context, existingBaselines, starterExercises]);

  const setRow = (exerciseId: string, patch: Partial<BaselineRow>) => {
    setRows((current) => ({
      ...current,
      [exerciseId]: {
        ...(current[exerciseId] ?? { workingWeight: "", topSetWeight: "", topSetReps: "" }),
        ...patch,
      },
    }));
  };

  const clearExercise = (exerciseId: string) => {
    setRow(exerciseId, {
      workingWeight: "",
      topSetWeight: "",
      topSetReps: "",
      error: undefined,
    });
  };

  const saveAll = async () => {
    setSaveStatus(null);
    setSaveError(null);
    setIsSaving(true);

    const prepared = starterExercises.map((exercise) => {
      const row = rows[exercise.id] ?? { workingWeight: "", topSetWeight: "", topSetReps: "" };
      const workingWeight = toPositiveNumber(row.workingWeight);
      const topSetWeight = toPositiveNumber(row.topSetWeight);
      const topSetReps = toPositiveNumber(row.topSetReps);
      return { exercise, row, workingWeight, topSetWeight, topSetReps };
    });

    let hasError = false;
    for (const entry of prepared) {
      const onlyOneTopSetField =
        (entry.topSetWeight !== undefined && entry.topSetReps === undefined) ||
        (entry.topSetWeight === undefined && entry.topSetReps !== undefined);
      if (onlyOneTopSetField) {
        hasError = true;
        setRow(entry.exercise.id, {
          error: "Enter both top set weight and reps, or leave both blank.",
        });
      } else {
        setRow(entry.exercise.id, { error: undefined });
      }
    }

    if (hasError) {
      setIsSaving(false);
      setSaveError("Some entries need both top-set weight and reps.");
      return;
    }

    const payloads = prepared.map((entry) => ({
        exerciseId: entry.exercise.id,
        context,
        ...(entry.workingWeight !== undefined
          ? {
              workingWeightMin: entry.workingWeight,
              workingWeightMax: entry.workingWeight,
            }
          : {}),
        ...(entry.topSetWeight !== undefined && entry.topSetReps !== undefined
          ? {
              topSetWeight: entry.topSetWeight,
              topSetReps: Math.round(entry.topSetReps),
            }
          : {}),
      }));

    try {
      for (const payload of payloads) {
        const response = await fetch("/api/baselines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to save baseline.");
        }
      }
      setSaveStatus(
        `Saved ${payloads.length} baseline row${payloads.length === 1 ? "" : "s"} (${context} context).`
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save baselines.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 p-4 sm:p-6">
      <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
      <p className="mt-1.5 text-sm text-slate-600">{description}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
        Baseline context: <span className="font-semibold">{context}</span>
      </p>

      <div className="mt-4 space-y-4">
        {starterExercises.map((exercise) => {
          const row = rows[exercise.id] ?? { workingWeight: "", topSetWeight: "", topSetReps: "" };
          return (
            <article key={exercise.id} className="rounded-xl border border-slate-200 p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{exercise.name}</h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                  onClick={() => clearExercise(exercise.id)}
                >
                  Skip exercise
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Primary muscles: {exercise.primaryMuscles.length > 0 ? exercise.primaryMuscles.join(", ") : "N/A"}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Working weight (lbs)
                  <input
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                    type="number"
                    inputMode="decimal"
                    value={row.workingWeight}
                    onChange={(event) => setRow(exercise.id, { workingWeight: event.target.value, error: undefined })}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Top set weight (lbs)
                  <input
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                    type="number"
                    inputMode="decimal"
                    value={row.topSetWeight}
                    onChange={(event) => setRow(exercise.id, { topSetWeight: event.target.value, error: undefined })}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Top set reps
                  <input
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                    type="number"
                    inputMode="numeric"
                    value={row.topSetReps}
                    onChange={(event) => setRow(exercise.id, { topSetReps: event.target.value, error: undefined })}
                  />
                </label>
              </div>
              {row.error ? <p className="mt-2 text-xs text-rose-600">{row.error}</p> : null}
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          type="button"
          className="h-11 w-full rounded-full bg-slate-900 px-6 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
          disabled={isSaving || starterExercises.length === 0}
          onClick={saveAll}
        >
          {isSaving ? "Saving..." : "Save starting weights"}
        </button>
        {onSkipAll ? (
          <button
            type="button"
            className="h-11 w-full rounded-full border border-slate-300 px-6 text-sm font-semibold sm:w-auto"
            onClick={onSkipAll}
          >
            Skip this step
          </button>
        ) : null}
        {saveStatus ? <span className="text-sm text-emerald-600">{saveStatus}</span> : null}
        {showStartTrainingCta && saveStatus ? (
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-6 text-sm font-semibold"
          >
            Start Training
          </Link>
        ) : null}
        {saveError ? <span className="text-sm text-rose-600">{saveError}</span> : null}
      </div>
    </section>
  );
}
