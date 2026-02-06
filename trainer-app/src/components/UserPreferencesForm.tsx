"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

type PreferenceFormValues = {
  userId?: string;
  favoriteExercisesText: string;
  avoidExercisesText: string;
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
  favoriteExercisesText: "",
  avoidExercisesText: "",
  rpe5to8: 8.5,
  rpe8to12: 7.75,
  rpe12to20: 7.5,
  progressionStyle: "double_progression",
  optionalConditioning: true,
  benchFrequency: 2,
  squatFrequency: 1,
  deadliftFrequency: 1,
};

const toList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function UserPreferencesForm({
  initialValues,
}: {
  initialValues?: Partial<PreferenceFormValues>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<PreferenceFormValues>({
    defaultValues: { ...defaults, ...initialValues },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    setError(null);

    const response = await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: values.userId,
        favoriteExercises: toList(values.favoriteExercisesText),
        avoidExercises: toList(values.avoidExercisesText),
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
          <label className="text-sm">
            Favorite exercises (comma separated)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Barbell Bench Press, Barbell Back Squat, Barbell Deadlift"
              {...form.register("favoriteExercisesText")}
            />
          </label>
          <label className="text-sm">
            Avoid exercises (comma separated)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Incline Dumbbell Curl"
              {...form.register("avoidExercisesText")}
            />
          </label>
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
    </form>
  );
}
