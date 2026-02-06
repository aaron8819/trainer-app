"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

type ProfileFormValues = {
  userId?: string;
  email?: string;
  age?: number;
  sex?: string;
  heightIn?: number;
  weightLb?: number;
  trainingAge: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  primaryGoal: "HYPERTROPHY" | "STRENGTH" | "FAT_LOSS" | "ATHLETICISM" | "GENERAL_HEALTH";
  secondaryGoal: "POSTURE" | "CONDITIONING" | "INJURY_PREVENTION" | "NONE";
  daysPerWeek: number;
  sessionMinutes: number;
  splitType: "PPL" | "UPPER_LOWER" | "FULL_BODY" | "CUSTOM";
  equipmentNotes?: string;
  proteinTarget?: number;
  injuryBodyPart?: string;
  injurySeverity?: number;
  injuryDescription?: string;
  injuryActive?: boolean;
};

const defaultValues: ProfileFormValues = {
  trainingAge: "INTERMEDIATE",
  primaryGoal: "HYPERTROPHY",
  secondaryGoal: "CONDITIONING",
  daysPerWeek: 4,
  sessionMinutes: 55,
  splitType: "UPPER_LOWER",
  injuryActive: true,
};

export default function ProfileForm({
  initialValues,
}: {
  initialValues?: Partial<ProfileFormValues>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ProfileFormValues>({
    defaultValues: { ...defaultValues, ...initialValues },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    setError(null);

    const response = await fetch("/api/profile/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const rawText = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = rawText ? JSON.parse(rawText) : {};
      } catch {
        body = { error: rawText };
      }

      const detail =
        (body as { details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } })
          ?.details?.formErrors?.join?.(", ") ??
        (body as { details?: { fieldErrors?: Record<string, string[]> } })?.details?.fieldErrors
          ? Object.entries(
              (body as { details?: { fieldErrors?: Record<string, string[]> } }).details!
                .fieldErrors ?? {}
            )
              .map(([key, value]) => `${key}: ${(value ?? []).join(", ")}`)
              .join(" · ")
          : null;

      const fallbackDetails =
        detail ??
        ((body as { details?: unknown })?.details
          ? JSON.stringify((body as { details?: unknown }).details)
          : rawText || null);

      const message = [
        (body as { error?: string })?.error ?? "Failed to save profile",
        fallbackDetails,
      ]
        .filter(Boolean)
        .join(" — ");
      setError(message);
      return;
    }

    const body = await response.json().catch(() => ({}));
    setStatus("Saved" + (body.userId ? ` · User ${body.userId}` : ""));
  });

  return (
    <form className="mt-6 space-y-8" onSubmit={onSubmit}>
      <input type="hidden" {...form.register("userId")} />
      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Basics</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Email
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="email"
              placeholder="you@example.com"
              {...form.register("email")}
            />
          </label>
          <label className="text-sm">
            Sex
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Optional"
              {...form.register("sex")}
            />
          </label>
          <label className="text-sm">
            Age
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("age", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Training Age
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register("trainingAge")}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </label>
          <label className="text-sm">
            Height (inches)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("heightIn", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Weight (lbs)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("weightLb", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Goals</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Primary Goal
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register("primaryGoal")}>
              <option value="HYPERTROPHY">Hypertrophy</option>
              <option value="STRENGTH">Strength</option>
              <option value="FAT_LOSS">Fat Loss</option>
              <option value="ATHLETICISM">Athleticism</option>
              <option value="GENERAL_HEALTH">General Health</option>
            </select>
          </label>
          <label className="text-sm">
            Secondary Goal
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register("secondaryGoal")}>
              <option value="POSTURE">Posture</option>
              <option value="CONDITIONING">Conditioning</option>
              <option value="INJURY_PREVENTION">Injury Prevention</option>
              <option value="NONE">None</option>
            </select>
          </label>
          <label className="text-sm">
            Protein Target (g/day)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("proteinTarget", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Schedule & Split</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Days per week
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("daysPerWeek", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Session minutes
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("sessionMinutes", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm">
            Split Type
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register("splitType")}>
              <option value="PPL">Push / Pull / Legs</option>
              <option value="UPPER_LOWER">Upper / Lower</option>
              <option value="FULL_BODY">Full Body</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Equipment notes
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={3}
              placeholder="LA Fitness style full gym, cables, machines"
              {...form.register("equipmentNotes")}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Injury / Irritation</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Body part
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Elbow, shoulder, knee"
              {...form.register("injuryBodyPart")}
            />
          </label>
          <label className="text-sm">
            Severity (1-5)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="number"
              {...form.register("injurySeverity", { valueAsNumber: true })}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Notes
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={3}
              {...form.register("injuryDescription")}
            />
          </label>
          <label className="text-sm md:col-span-2 flex items-center gap-2">
            <input type="checkbox" {...form.register("injuryActive")} />
            Injury is active
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Save profile
        </button>
        {status ? <span className="text-sm text-emerald-600">{status}</span> : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
