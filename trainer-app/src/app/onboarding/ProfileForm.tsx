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

  const sectionClassName = "rounded-2xl border border-slate-200 p-4 sm:p-6";
  const fieldClassName = "h-11 w-full rounded-xl border border-slate-300 px-3 text-sm";
  const labelClassName = "space-y-1 text-sm font-medium text-slate-700";

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
    <form className="mt-5 space-y-5 sm:mt-6 sm:space-y-6" onSubmit={onSubmit}>
      <input type="hidden" {...form.register("userId")} />
      <section className={sectionClassName}>
        <h2 className="text-base font-semibold sm:text-lg">Basics</h2>
        <div className="mt-3 grid gap-3.5 sm:mt-4 sm:gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            Email
            <input
              className={fieldClassName}
              type="email"
              placeholder="you@example.com"
              {...form.register("email")}
            />
          </label>
          <label className={labelClassName}>
            Sex
            <input
              className={fieldClassName}
              placeholder="Optional"
              {...form.register("sex")}
            />
          </label>
          <label className={labelClassName}>
            Age
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("age", { valueAsNumber: true })}
            />
          </label>
          <label className={labelClassName}>
            Training Age
            <select className={fieldClassName} {...form.register("trainingAge")}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </label>
          <label className={labelClassName}>
            Height (inches)
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("heightIn", { valueAsNumber: true })}
            />
          </label>
          <label className={labelClassName}>
            Weight (lbs)
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("weightLb", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-base font-semibold sm:text-lg">Goals</h2>
        <div className="mt-3 grid gap-3.5 sm:mt-4 sm:gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            Primary Goal
            <select className={fieldClassName} {...form.register("primaryGoal")}>
              <option value="HYPERTROPHY">Hypertrophy</option>
              <option value="STRENGTH">Strength</option>
              <option value="FAT_LOSS">Fat Loss</option>
              <option value="ATHLETICISM">Athleticism</option>
              <option value="GENERAL_HEALTH">General Health</option>
            </select>
          </label>
          <label className={labelClassName}>
            Secondary Goal
            <select className={fieldClassName} {...form.register("secondaryGoal")}>
              <option value="POSTURE">Posture</option>
              <option value="CONDITIONING">Conditioning</option>
              <option value="INJURY_PREVENTION">Injury Prevention</option>
              <option value="NONE">None</option>
            </select>
          </label>
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-base font-semibold sm:text-lg">Schedule</h2>
        <div className="mt-3 grid gap-3.5 sm:mt-4 sm:gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            Days per week
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("daysPerWeek", { valueAsNumber: true })}
            />
          </label>
          <label className={labelClassName}>
            Session minutes
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("sessionMinutes", { valueAsNumber: true })}
            />
          </label>
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-base font-semibold sm:text-lg">Injury / Irritation</h2>
        <div className="mt-3 grid gap-3.5 sm:mt-4 sm:gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            Body part
            <input
              className={fieldClassName}
              placeholder="Elbow, shoulder, knee"
              {...form.register("injuryBodyPart")}
            />
          </label>
          <label className={labelClassName}>
            Severity (1-5)
            <input
              className={fieldClassName}
              type="number"
              inputMode="numeric"
              {...form.register("injurySeverity", { valueAsNumber: true })}
            />
          </label>
          <label className={`${labelClassName} md:col-span-2`}>
            Notes
            <textarea
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              {...form.register("injuryDescription")}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
            <input type="checkbox" {...form.register("injuryActive")} />
            Injury is active
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          className="h-11 w-full rounded-full bg-slate-900 px-6 text-sm font-semibold text-white sm:w-auto"
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
