"use client";
/* eslint-disable react-hooks/incompatible-library */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { ExercisePicker } from "./library/ExercisePicker";
import { ExercisePickerTrigger } from "./library/ExercisePickerTrigger";
import type { ExerciseListItem } from "@/lib/exercise-library/types";

type PreferenceFormValues = {
  userId?: string;
  favoriteExercises: string[];
  avoidExercises: string[];
  optionalConditioning: boolean;
};

const defaults: PreferenceFormValues = {
  favoriteExercises: [],
  avoidExercises: [],
  optionalConditioning: true,
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
        optionalConditioning: values.optionalConditioning,
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
          These influence exercise selection.
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
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" {...form.register("optionalConditioning")} />
            Suggest conditioning finishers if time remains
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
