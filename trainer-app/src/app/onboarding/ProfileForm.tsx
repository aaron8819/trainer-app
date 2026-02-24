"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  PRIMARY_GOAL_OPTIONS,
  SECONDARY_GOAL_OPTIONS,
} from "@/lib/profile-goal-options";

export type ProfileFormValues = {
  userId?: string;
  email?: string;
  age?: number;
  sex?: string;
  heightIn?: number;
  weightLb?: number;
  trainingAge: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  primaryGoal:
    | "HYPERTROPHY"
    | "STRENGTH"
    | "STRENGTH_HYPERTROPHY"
    | "FAT_LOSS"
    | "ATHLETICISM"
    | "GENERAL_HEALTH";
  secondaryGoal: "POSTURE" | "CONDITIONING" | "INJURY_PREVENTION" | "STRENGTH" | "NONE";
  daysPerWeek: number;
  splitType: "PPL" | "UPPER_LOWER" | "FULL_BODY" | "CUSTOM";
  weeklySchedule?: ("PUSH" | "PULL" | "LEGS" | "UPPER" | "LOWER" | "FULL_BODY" | "BODY_PART")[];
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
  splitType: "PPL",
  weeklySchedule: [],
  injuryActive: false,
};

const SESSION_INTENT_OPTIONS: {
  value: "PUSH" | "PULL" | "LEGS" | "UPPER" | "LOWER" | "FULL_BODY" | "BODY_PART";
  label: string;
}[] = [
  { value: "PUSH", label: "Push" },
  { value: "PULL", label: "Pull" },
  { value: "LEGS", label: "Legs" },
  { value: "UPPER", label: "Upper" },
  { value: "LOWER", label: "Lower" },
  { value: "FULL_BODY", label: "Full Body" },
  { value: "BODY_PART", label: "Body Part" },
];

const SPLIT_TYPE_OPTIONS: { value: ProfileFormValues["splitType"]; label: string }[] = [
  { value: "PPL", label: "Push / Pull / Legs" },
  { value: "UPPER_LOWER", label: "Upper / Lower" },
  { value: "FULL_BODY", label: "Full Body" },
  { value: "CUSTOM", label: "Custom" },
];

export default function ProfileForm({
  initialValues,
  submitLabel = "Save profile",
  onSaved,
  primaryGoalOptions = PRIMARY_GOAL_OPTIONS,
  secondaryGoalOptions = SECONDARY_GOAL_OPTIONS,
}: {
  initialValues?: Partial<ProfileFormValues>;
  submitLabel?: string;
  onSaved?: (values: {
    primaryGoal: ProfileFormValues["primaryGoal"];
    splitType: ProfileFormValues["splitType"];
  }) => void;
  primaryGoalOptions?: ReadonlyArray<{ value: ProfileFormValues["primaryGoal"]; label: string }>;
  secondaryGoalOptions?: ReadonlyArray<{ value: ProfileFormValues["secondaryGoal"]; label: string }>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeklyAnalysisSummary, setWeeklyAnalysisSummary] = useState<string | null>(null);

  const initialDayCount = useMemo(
    () =>
      Math.max(
        1,
        Math.min(
          7,
          Number.isFinite(initialValues?.daysPerWeek)
            ? Number(initialValues?.daysPerWeek)
            : defaultValues.daysPerWeek
        )
      ),
    [initialValues?.daysPerWeek]
  );
  const initialWeeklySchedule = useMemo(
    () =>
      Array.isArray(initialValues?.weeklySchedule)
        ? initialValues.weeklySchedule
        : defaultValues.weeklySchedule ?? [],
    [initialValues?.weeklySchedule]
  );

  const form = useForm<ProfileFormValues>({
    defaultValues: {
      ...defaultValues,
      ...initialValues,
      daysPerWeek: initialDayCount,
      weeklySchedule: initialWeeklySchedule.slice(0, initialDayCount),
    },
  });

  const sectionClassName = "rounded-2xl border border-slate-200 p-4 sm:p-6";
  const fieldClassName = "h-11 w-full rounded-xl border border-slate-300 px-3 text-sm";
  const labelClassName = "space-y-1 text-sm font-medium text-slate-700";
  const watchedDaysPerWeek = form.watch("daysPerWeek");
  const watchedWeeklySchedule = form.watch("weeklySchedule");

  useEffect(() => {
    const dayCount = Number.isFinite(watchedDaysPerWeek)
      ? Math.max(1, Math.min(7, watchedDaysPerWeek))
      : initialDayCount;
    const current = Array.isArray(watchedWeeklySchedule) ? watchedWeeklySchedule : [];
    const next = Array.from(
      { length: dayCount },
      (_, index) =>
        current[index] ??
        initialWeeklySchedule[index] ??
        SESSION_INTENT_OPTIONS[0]?.value ??
        "PUSH"
    );
    const changed = next.length !== current.length || next.some((value, index) => current[index] !== value);
    if (changed) {
      form.setValue("weeklySchedule", next, { shouldDirty: false });
    }
  }, [form, initialDayCount, initialWeeklySchedule, watchedDaysPerWeek, watchedWeeklySchedule]);

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    setError(null);

    setWeeklyAnalysisSummary(null);
    const dayCount = Math.max(1, Math.min(7, values.daysPerWeek));
    const normalizedWeeklySchedule = (values.weeklySchedule ?? [])
      .slice(0, dayCount)
      .map((entry) => entry ?? "PUSH");

    const response = await fetch("/api/profile/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        weeklySchedule: normalizedWeeklySchedule,
      }),
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
    onSaved?.({
      primaryGoal: values.primaryGoal,
      splitType: values.splitType,
    });
    const summary = body.weeklyAnalysis as
      | { overallScore?: number; overallLabel?: string; suggestions?: string[] }
      | undefined;
    if (summary?.overallScore !== undefined && summary?.overallLabel) {
      const firstSuggestion =
        Array.isArray(summary.suggestions) && summary.suggestions.length > 0
          ? ` ${summary.suggestions[0]}`
          : "";
      setWeeklyAnalysisSummary(
        `Weekly program score ${summary.overallScore}/100 (${summary.overallLabel}).${firstSuggestion}`
      );
    }
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
              {primaryGoalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            Secondary Goal
            <select className={fieldClassName} {...form.register("secondaryGoal")}>
              {secondaryGoalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
            Split type
            <select className={fieldClassName} {...form.register("splitType")}>
              {SPLIT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Weekly intent schedule (ordered)
          </p>
          <div className="grid gap-3.5 sm:gap-4 md:grid-cols-2">
            {Array.from(
              { length: Math.max(1, Math.min(7, Number.isFinite(watchedDaysPerWeek) ? watchedDaysPerWeek : 4)) },
              (_, index) => index
            ).map((dayIndex) => (
              <label key={dayIndex} className={labelClassName}>
                Day {dayIndex + 1}
                <select className={fieldClassName} {...form.register(`weeklySchedule.${dayIndex}` as const)}>
                  {SESSION_INTENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
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
          {submitLabel}
        </button>
        {status ? <span className="text-sm text-emerald-600">{status}</span> : null}
        {weeklyAnalysisSummary ? <span className="text-sm text-slate-600">{weeklyAnalysisSummary}</span> : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
