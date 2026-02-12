"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ExercisePicker } from "@/components/library/ExercisePicker";
import { TemplateAnalysisPanel } from "@/components/templates/TemplateAnalysisPanel";
import { MUSCLE_GROUP_LABELS } from "@/lib/exercise-library/constants";
import { smartBuild, type SmartBuildExercise } from "@/lib/engine/smart-build";
import type { ExerciseListItem, MuscleGroup } from "@/lib/exercise-library/types";

type SelectedExercise = {
  exerciseId: string;
  name: string;
  orderIndex: number;
  supersetGroup?: number;
};

type TemplateIntent =
  | "FULL_BODY"
  | "UPPER_LOWER"
  | "PUSH_PULL_LEGS"
  | "BODY_PART"
  | "CUSTOM";

type TemplateFormProps = {
  mode: "create" | "edit";
  templateId?: string;
  initialName?: string;
  initialTargetMuscles?: string[];
  initialIntent?: TemplateIntent;
  initialIsStrict?: boolean;
  initialExercises?: SelectedExercise[];
  exercises: ExerciseListItem[];
};

const MUSCLE_GROUPS = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];
const TEMPLATE_INTENT_OPTIONS: { value: TemplateIntent; label: string }[] = [
  { value: "CUSTOM", label: "Custom" },
  { value: "FULL_BODY", label: "Full Body" },
  { value: "UPPER_LOWER", label: "Upper/Lower" },
  { value: "PUSH_PULL_LEGS", label: "Push/Pull/Legs" },
  { value: "BODY_PART", label: "Body Part" },
];

export function TemplateForm({
  mode,
  templateId,
  initialName = "",
  initialTargetMuscles = [],
  initialIntent = "CUSTOM",
  initialIsStrict = false,
  initialExercises = [],
  exercises,
}: TemplateFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [targetMuscles, setTargetMuscles] = useState<string[]>(initialTargetMuscles);
  const [selectedExercises, setSelectedExercises] = useState<SelectedExercise[]>(initialExercises);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trainingGoal, setTrainingGoal] = useState<string | undefined>(undefined);
  const [timeBudgetMinutes, setTimeBudgetMinutes] = useState<number | undefined>(undefined);
  const [isStrict, setIsStrict] = useState(initialIsStrict);
  const [intent, setIntent] = useState<TemplateIntent>(initialIntent);

  const exerciseByName = useMemo(
    () => new Map(exercises.map((e) => [e.name, e])),
    [exercises]
  );

  const selectedNames = useMemo(
    () => selectedExercises.map((e) => e.name),
    [selectedExercises]
  );

  const handleSelectionChange = (names: string[]) => {
    // Merge: keep existing order for exercises still selected, append new ones at end
    const existing = selectedExercises.filter((e) => names.includes(e.name));
    const existingNames = new Set(existing.map((e) => e.name));
    const newNames = names.filter((n) => !existingNames.has(n));
    const newExercises: SelectedExercise[] = newNames.map((n) => {
      const ex = exerciseByName.get(n);
      return {
        exerciseId: ex?.id ?? "",
        name: n,
        orderIndex: 0,
        supersetGroup: undefined,
      };
    });
    const merged = [...existing, ...newExercises].map((e, i) => ({
      ...e,
      orderIndex: i,
    }));
    setSelectedExercises(merged);
  };

  const moveExercise = (index: number, direction: "up" | "down") => {
    const newList = [...selectedExercises];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newList.length) return;
    [newList[index], newList[swapIndex]] = [newList[swapIndex], newList[index]];
    setSelectedExercises(newList.map((e, i) => ({ ...e, orderIndex: i })));
  };

  const removeExercise = (index: number) => {
    setSelectedExercises((prev) =>
      prev.filter((_, i) => i !== index).map((e, i) => ({ ...e, orderIndex: i }))
    );
  };

  const updateSupersetGroup = (index: number, value: string) => {
    const next = value.trim() === "" ? undefined : Number.parseInt(value, 10);
    setSelectedExercises((prev) =>
      prev.map((exercise, i) =>
        i !== index
          ? exercise
          : {
              ...exercise,
              supersetGroup: Number.isFinite(next) && (next ?? 0) > 0 ? next : undefined,
            }
      )
    );
  };

  const toggleMuscle = (muscle: string) => {
    setTargetMuscles((prev) =>
      prev.includes(muscle) ? prev.filter((m) => m !== muscle) : [...prev, muscle]
    );
  };

  const handleSmartBuild = useCallback(() => {
    const exercisePool: SmartBuildExercise[] = exercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      isCompound: ex.isCompound,
      movementPatterns: ex.movementPatterns,
      splitTags: ex.splitTags,
      jointStress: ex.jointStress,
      equipment: ex.equipment,
      primaryMuscles: ex.primaryMuscles,
      secondaryMuscles: ex.secondaryMuscles,
      sfrScore: ex.sfrScore,
      lengthPositionScore: ex.lengthPositionScore,
      isFavorite: ex.isFavorite,
      isAvoided: ex.isAvoided,
    }));

    const result = smartBuild({
      targetMuscleGroups: targetMuscles,
      exercisePool,
      seed: Date.now(),
      trainingGoal,
      timeBudgetMinutes,
    });

    const newExercises: SelectedExercise[] = result.exercises.map((ex, i) => ({
      exerciseId: ex.id,
      name: ex.name,
      orderIndex: i,
    }));

    setSelectedExercises(newExercises);
  }, [exercises, targetMuscles, trainingGoal, timeBudgetMinutes]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (selectedExercises.length === 0) {
      setError("Add at least one exercise");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      targetMuscles,
      isStrict,
      intent,
      exercises: selectedExercises.map((e) => ({
        exerciseId: e.exerciseId,
        orderIndex: e.orderIndex,
        supersetGroup: e.supersetGroup,
      })),
    };

    const url = mode === "create" ? "/api/templates" : `/api/templates/${templateId}`;
    const method = mode === "create" ? "POST" : "PUT";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save template");
      setSaving(false);
      return;
    }

    router.push("/templates");
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Template Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Upper Body Hypertrophy"
          className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          maxLength={100}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Target Muscles (optional)
        </label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {MUSCLE_GROUPS.map((group) => (
            <button
              key={group}
              onClick={() => toggleMuscle(group)}
              className={`inline-flex min-h-10 items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                targetMuscles.includes(group)
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {MUSCLE_GROUP_LABELS[group]}
            </button>
          ))}
        </div>
      </div>

      {/* Training Goal & Time Budget */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Training Goal
          </label>
          <select
            value={trainingGoal ?? ""}
            onChange={(e) => setTrainingGoal(e.target.value || undefined)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
            <option value="fat_loss">Fat Loss</option>
            <option value="general_health">General Health</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Time Budget (min)
          </label>
          <input
            type="number"
            value={timeBudgetMinutes ?? ""}
            onChange={(e) =>
              setTimeBudgetMinutes(e.target.value ? parseInt(e.target.value, 10) : undefined)
            }
            placeholder="No limit"
            min={15}
            max={180}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isStrict}
            onChange={(e) => setIsStrict(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Strict mode
        </label>
        <span className="text-xs text-slate-400">
          {isStrict ? "No exercise substitutions" : "Allow substitutions when needed"}
        </span>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Template Intent
        </label>
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value as TemplateIntent)}
          className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          {TEMPLATE_INTENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {targetMuscles.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            onClick={handleSmartBuild}
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white
              transition-colors hover:bg-indigo-700"
          >
            Smart Build
          </button>
          <span className="text-xs text-slate-400">
            Auto-pick exercises for selected muscles
          </span>
        </div>
      )}

      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Exercises ({selectedExercises.length})
          </label>
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 sm:min-h-0 sm:border-0 sm:p-0 sm:hover:bg-transparent sm:hover:underline"
          >
            Add exercises
          </button>
        </div>

        {selectedExercises.length === 0 ? (
          <div className="mt-2 rounded-xl border-2 border-dashed border-slate-200 p-5 text-center sm:p-6">
            <p className="text-xs text-slate-400">No exercises added yet</p>
            <button
              onClick={() => setPickerOpen(true)}
              className="mt-2 text-xs font-semibold text-slate-900 hover:underline"
            >
              Browse exercise library
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {selectedExercises.map((exercise, index) => (
              <div
                key={exercise.exerciseId}
                className="rounded-lg border border-slate-100 px-3 py-3"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-5 text-center text-xs text-slate-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-slate-800 break-words">
                    {exercise.name}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Superset
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={exercise.supersetGroup ?? ""}
                      onChange={(e) => updateSupersetGroup(index, e.target.value)}
                      placeholder="SS"
                      aria-label="Superset group"
                      className="mt-1 block min-h-10 w-16 rounded-md border border-slate-200 px-2 py-1 text-xs"
                    />
                  </label>
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => moveExercise(index, "up")}
                      disabled={index === 0}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveExercise(index, "down")}
                      disabled={index === selectedExercises.length - 1}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeExercise(index)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50"
                      aria-label="Remove"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TemplateAnalysisPanel
        selectedExerciseIds={selectedExercises.map((e) => e.exerciseId)}
        exerciseLibrary={exercises}
        intent={intent}
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid gap-2 sm:flex sm:gap-3">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : mode === "create" ? "Create Template" : "Save Changes"}
        </button>
        <button
          onClick={() => router.push("/templates")}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>

      <ExercisePicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedNames={selectedNames}
        onSelectionChange={handleSelectionChange}
        mode="multi"
        exercises={exercises}
      />
    </div>
  );
}
