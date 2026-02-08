"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { ExercisePicker } from "./library/ExercisePicker";
import { ExercisePickerTrigger } from "./library/ExercisePickerTrigger";
import type { ExerciseListItem } from "@/lib/exercise-library/types";

type PreferenceFormValues = {
  userId?: string;
  favoriteExercises: string[];
  avoidExercises: string[];
  rpe5to8: number;
  rpe8to12: number;
  rpe12to20: number;
  progressionStyle: string;
  optionalConditioning: boolean;
  benchFrequency?: number;
  squatFrequency?: number;
  deadliftFrequency?: number;
};

const defaults: PreferenceFormValues = {
  favoriteExercises: [],
  avoidExercises: [],
  rpe5to8: 8.5,
  rpe8to12: 7.75,
  rpe12to20: 7.5,
  progressionStyle: "double_progression",
  optionalConditioning: true,
  benchFrequency: 2,
  squatFrequency: 1,
  deadliftFrequency: 1,
};

export default function UserPreferencesForm({
  initialValues,
  exercises,
}: {
  initialValues?: Partial<PreferenceFormValues>;
  exercises?: ExerciseListItem[];
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [favPickerOpen, setFavPickerOpen] = useState(false);
  const [avoidPickerOpen, setAvoidPickerOpen] = useState(false);

  const form = useForm<PreferenceFormValues>({
    defaultValues: { ...defaults, ...initialValues },
  });

  const favorites = form.watch("favoriteExercises");
  const avoids = form.watch("avoidExercises");

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    setError(null);

    const response = await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: values.userId,
        favoriteExercises: values.favoriteExercises,
        avoidExercises: values.avoidExercises,
        rpeTargets: [
          { min: 5, max: 8, targetRpe: values.rpe5to8 },
          { min: 8, max: 12, targetRpe: values.rpe8to12 },
          { min: 12, max: 20, targetRpe: values.rpe12to20 },
        ],
        progressionStyle: values.progressionStyle,
        optionalConditioning: values.optionalConditioning,
        benchFrequency: values.benchFrequency ?? null,
        squatFrequency: values.squatFrequency ?? null,
        deadliftFrequency: values.deadliftFrequency ?? null,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save preferences");
      return;
    }

    setStatus("Preferences saved");
  });

  return (
    <form className="mt-8 space-y-8" onSubmit={onSubmit}>
      <input type="hidden" {...form.register("userId")} />

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Training Preferences</h2>
        <p className="mt-1 text-sm text-slate-600">
          These influence exercise selection and target RPEs.
        </p>
        <div className="mt-4 grid gap-4">
          <div>
            <label className="text-sm font-medium">Favorite exercises</label>
            <div className="mt-1">
              <ExercisePickerTrigger
                selectedNames={favorites}
                onRemove={(name) =>
                  form.setValue(
                    "favoriteExercises",
                    favorites.filter((n) => n !== name)
                  )
                }
                onAdd={() => setFavPickerOpen(true)}
                label="Add exercises"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Avoid exercises</label>
            <div className="mt-1">
              <ExercisePickerTrigger
                selectedNames={avoids}
                onRemove={(name) =>
                  form.setValue(
                    "avoidExercises",
                    avoids.filter((n) => n !== name)
                  )
                }
                onAdd={() => setAvoidPickerOpen(true)}
                label="Add exercises"
              />
            </div>
          </div>
          <label className="text-sm">
            Progression style
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              {...form.register("progressionStyle")}
            >
              <option value="double_progression">Double progression</option>
              <option value="rpe_autoregulation">RPE autoregulation</option>
              <option value="weekly_increase">Weekly load increase</option>
            </select>
          </label>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" {...form.register("optionalConditioning")} />
            Suggest conditioning finishers if time remains
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">RPE Targets by Rep Range</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            5-8 reps
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              step="0.1"
              {...form.register("rpe5to8", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            8-12 reps
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              step="0.1"
              {...form.register("rpe8to12", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            12-20 reps
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              step="0.1"
              {...form.register("rpe12to20", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Big Three Frequency</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            Bench per week
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("benchFrequency", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Squat per week
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("squatFrequency", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Deadlift per week
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("deadliftFrequency", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Save preferences
        </button>
        {status ? <span className="text-sm text-emerald-600">{status}</span> : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>

      <ExercisePicker
        isOpen={favPickerOpen}
        onClose={() => setFavPickerOpen(false)}
        selectedNames={favorites}
        onSelectionChange={(names) => form.setValue("favoriteExercises", names)}
        mode="multi"
        exercises={exercises}
      />
      <ExercisePicker
        isOpen={avoidPickerOpen}
        onClose={() => setAvoidPickerOpen(false)}
        selectedNames={avoids}
        onSelectionChange={(names) => form.setValue("avoidExercises", names)}
        mode="multi"
        exercises={exercises}
      />
    </form>
  );
}
