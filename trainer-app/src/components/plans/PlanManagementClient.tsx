"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanManagementData, PlanSummary } from "@/lib/ui/plan-management";
import { Button, buttonClassName } from "@/components/ui/Button";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import {
  planTypeDescription,
  planTypeLabel,
  type SupportedPlanType,
} from "@/lib/plan-types";

const STATUS_COPY: Record<
  PlanSummary["status"],
  { label: string; detail: string; tone: StatusBadgeTone }
> = {
  DRAFT: {
    label: "Draft",
    detail: "Editable and autosaved. Make it ready when the plan is executable.",
    tone: "warning",
  },
  PREPARING: {
    label: "Preparing",
    detail: "Generated and waiting for review and finalization.",
    tone: "warning",
  },
  READY: {
    label: "Ready",
    detail: "Finalized and available for activation.",
    tone: "positive",
  },
  HANDOFF_PENDING: {
    label: "Handoff pending",
    detail: "Review and accept the next mesocycle before execution resumes.",
    tone: "warning",
  },
  COMPLETED: {
    label: "Completed",
    detail: "This plan is complete and retained for history.",
    tone: "neutral",
  },
  INVALID: {
    label: "Needs attention",
    detail: "This plan has an inconsistent lifecycle state and cannot be activated.",
    tone: "critical",
  },
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function planGroup(plan: PlanSummary): { rank: number; label: string } {
  if (plan.isActive) return { rank: 0, label: "Active plan" };
  if (plan.status === "DRAFT") return { rank: 1, label: "Drafts" };
  if (plan.status === "READY") return { rank: 2, label: "Ready to activate" };
  return { rank: 3, label: "Other plans" };
}

async function responseBody(response: Response): Promise<{
  error?: string;
  code?: string;
  [key: string]: unknown;
}> {
  return response.json().catch(() => ({}));
}

export function PlanManagementClient({
  initialData,
  customHypertrophyEnabled = false,
}: {
  initialData: PlanManagementData;
  customHypertrophyEnabled?: boolean;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialData.plans);
  const [activeMacroCycleId, setActiveMacroCycleId] = useState(
    initialData.activeMacroCycleId,
  );
  const [showCreate, setShowCreate] = useState(initialData.plans.length === 0);
  const [newPlanType, setNewPlanType] =
    useState<SupportedPlanType>("HYPERTROPHY");
  const [authorMethod, setAuthorMethod] = useState<"MANUAL" | "V2">("MANUAL");
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [manualPreset, setManualPreset] = useState("UPPER_LOWER_4");
  const [creating, setCreating] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultStartDate = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );
  const displayedPlans = useMemo(
    () =>
      customHypertrophyEnabled
        ? [...plans].sort(
            (left, right) =>
              planGroup(left).rank - planGroup(right).rank ||
              right.createdAt.localeCompare(left.createdAt),
          )
        : plans,
    [customHypertrophyEnabled, plans],
  );

  const createPlan = async (formData: FormData) => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          newPlanType === "HYPERTROPHY"
            ? customHypertrophyEnabled
              ? {
                  planType: "HYPERTROPHY",
                  name: formData.get("name"),
                  sessionsPerWeek: Number(formData.get("sessionsPerWeek")),
                  sessionDurationMinutes: Number(
                    formData.get("sessionDurationMinutes"),
                  ),
                  equipmentProfile: formData.get("equipmentProfile"),
                  authorMethod,
                  ...(authorMethod === "MANUAL"
                    ? { preset: formData.get("preset") }
                    : {}),
                }
              : {
                planType: "HYPERTROPHY",
                name: formData.get("name"),
                startDate: formData.get("startDate"),
                durationWeeks: Number(formData.get("durationWeeks")),
              }
            : {
                planType: "STRENGTH",
                name: formData.get("name"),
                startDate: formData.get("startDate"),
                configuration: {
                  emphasis: formData.get("emphasis"),
                  daysPerWeek: Number(formData.get("daysPerWeek")),
                  sessionDurationMinutes: Number(
                    formData.get("sessionDurationMinutes"),
                  ),
                  equipmentProfile: formData.get("equipmentProfile"),
                  preferredLifts: {
                    squat: formData.get("squatPreference"),
                    press: formData.get("pressPreference"),
                    hinge: formData.get("hingePreference"),
                  },
                },
              },
        ),
      });
      const body = await responseBody(response);
      if (!response.ok || body.error) {
        setError(body.error ?? "Could not create the plan.");
        return;
      }
      const plan = body.plan as PlanSummary;
      router.push(
        plan.status === "DRAFT"
          ? `/plans/${plan.id}/edit`
          : `/plans/${plan.id}/review`,
      );
    } catch {
      setError("Could not create the plan.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (plan: PlanSummary) => {
    const name = window.prompt("Name the editable copy", `${plan.name} Copy`);
    if (!name) return;
    setBusyPlanId(plan.id);
    setError(null);
    try {
      const response = await fetch(`/api/plans/${plan.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await responseBody(response);
      if (!response.ok || typeof body.planId !== "string") {
        setError(body.error ?? "Could not create an editable copy.");
        return;
      }
      router.push(`/plans/${body.planId}/edit`);
      router.refresh();
    } catch {
      setError("Could not create an editable copy.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const activate = async (plan: PlanSummary) => {
    if (
      !window.confirm(
        `Switch your active training plan to “${plan.name}”? Your workout history will stay with its original plan.`,
      )
    ) {
      return;
    }
    setBusyPlanId(plan.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/plans/${plan.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedActiveMacroCycleId: activeMacroCycleId,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        setError(body.error ?? "Could not switch plans.");
        return;
      }
      setActiveMacroCycleId(plan.id);
      setPlans((current) =>
        current.map((item) => ({
          ...item,
          isActive: item.id === plan.id,
        })),
      );
      setMessage(`${plan.name} is now your active plan.`);
      router.refresh();
    } catch {
      setError("Could not switch plans.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const rename = async (plan: PlanSummary, formData: FormData) => {
    const name = String(formData.get("name") ?? "");
    setBusyPlanId(plan.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          expectedUpdatedAt: plan.updatedAt,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        setError(body.error ?? "Could not rename the plan.");
        return;
      }
      const updated = body.plan as { name: string; updatedAt: string };
      setPlans((current) =>
        current.map((item) =>
          item.id === plan.id ? { ...item, ...updated } : item,
        ),
      );
      setEditingPlanId(null);
      setMessage(`Renamed plan to ${updated.name}.`);
      router.refresh();
    } catch {
      setError("Could not rename the plan.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const archive = async (plan: PlanSummary) => {
    if (
      !window.confirm(
        `Archive “${plan.name}”? It will leave this list, but its workouts and history will be preserved.`,
      )
    ) {
      return;
    }
    setBusyPlanId(plan.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/plans/${plan.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: plan.updatedAt }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        setError(body.error ?? "Could not archive the plan.");
        return;
      }
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setMessage(`${plan.name} was archived. Its history is unchanged.`);
      router.refresh();
    } catch {
      setError("Could not archive the plan.");
    } finally {
      setBusyPlanId(null);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Your plans</h2>
          <p className="mt-1 text-sm text-slate-600">
            Only the plan marked Active drives Home, Program, and new workouts.
          </p>
        </div>
        <Button
          size="touch"
          onClick={() => {
            setShowCreate((current) => !current);
            setError(null);
            setMessage(null);
          }}
        >
          {showCreate ? "Cancel" : "Create another plan"}
        </Button>
      </div>

      <div aria-live="polite" className="mt-4">
        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {error}
          </p>
        ) : null}
      </div>

      {showCreate ? (
        <form
          className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
          action={createPlan}
        >
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">
              What do you want this plan to prioritize?
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["HYPERTROPHY", "STRENGTH"] as const).map((planType) => (
                <label
                  key={planType}
                  className={`cursor-pointer rounded-xl border p-3 ${
                    newPlanType === planType
                      ? "border-blue-400 bg-blue-50 ring-1 ring-blue-200"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="planType"
                    value={planType}
                    checked={newPlanType === planType}
                    onChange={() => setNewPlanType(planType)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">
                    {planTypeLabel(planType)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">
                    {planTypeDescription(planType)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900">
                New {planTypeLabel(newPlanType).toLowerCase()} plan
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {customHypertrophyEnabled && newPlanType === "HYPERTROPHY"
                  ? "Create one editable five-week draft, then make it ready separately."
                  : "We’ll generate the plan first. You’ll review it before it becomes READY."}
              </p>
            </div>
            <StatusBadge tone="neutral">
              {planTypeLabel(newPlanType)}
            </StatusBadge>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-800">
              Plan name
              <input
                name="name"
                key={newPlanType}
                required
                maxLength={60}
                defaultValue={`${planTypeLabel(newPlanType)} Plan ${
                  plans.filter(
                    (plan) => plan.primaryGoal === newPlanType,
                  ).length + 1
                }`}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
              />
            </label>
            {!customHypertrophyEnabled || newPlanType === "STRENGTH" ? (
              <label className="text-sm font-medium text-slate-800">
                Start date
                <input
                  name="startDate"
                  type="date"
                  required
                  defaultValue={defaultStartDate}
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                />
              </label>
            ) : null}
            {newPlanType === "HYPERTROPHY" && !customHypertrophyEnabled ? (
              <label className="text-sm font-medium text-slate-800">
                Duration
                <select
                  name="durationWeeks"
                  defaultValue="24"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="16">16 weeks</option>
                  <option value="24">24 weeks</option>
                  <option value="32">32 weeks</option>
                  <option value="48">48 weeks</option>
                </select>
              </label>
            ) : null}
          </div>
          {newPlanType === "HYPERTROPHY" && customHypertrophyEnabled ? (
            <div className="mt-5 border-t border-slate-200 pt-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-slate-800">
                  Sessions per week
                  <select name="sessionsPerWeek" value={sessionsPerWeek} onChange={(event) => {
                    const value = Number(event.target.value);
                    setSessionsPerWeek(value);
                    setAuthorMethod((current) => value === 4 ? current : "MANUAL");
                    setManualPreset(value === 2 ? "FULL_BODY_2" : value === 3 ? "FULL_BODY_3" : value === 4 ? "UPPER_LOWER_4" : value === 6 ? "PPL_6" : "BLANK");
                  }} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base">
                    {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} sessions</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Time per session
                  <select name="sessionDurationMinutes" defaultValue="60" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base">
                    {[45, 60, 75, 90].map((value) => <option key={value} value={value}>About {value} minutes</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Available equipment
                  <select name="equipmentProfile" defaultValue="FULL_GYM" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base">
                    <option value="FULL_GYM">Full gym</option>
                    <option value="BARBELL_HOME">Barbell home gym</option>
                    <option value="DUMBBELLS">Dumbbells and bench</option>
                    <option value="MACHINES">Machines and cables</option>
                    <option value="BODYWEIGHT">Bodyweight and bands</option>
                  </select>
                </label>
              </div>
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold text-slate-900">Starting method</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="rounded-xl border border-slate-200 bg-white p-3">
                    <input type="radio" checked={authorMethod === "MANUAL"} onChange={() => setAuthorMethod("MANUAL")} />{" "}
                    <span className="font-medium">Build it myself</span>
                    <span className="mt-1 block text-sm text-slate-600">Start with editable sessions and choose every exercise.</span>
                  </label>
                  <label className="rounded-xl border border-slate-200 bg-white p-3">
                    <input type="radio" checked={authorMethod === "V2"} disabled={sessionsPerWeek !== 4} onChange={() => setAuthorMethod("V2")} />{" "}
                    <span className="font-medium">Generate a starting plan</span>
                    <span className="mt-1 block text-sm text-slate-600">Creates an editable four-session Upper/Lower draft.</span>
                  </label>
                </div>
              </fieldset>
              {authorMethod === "MANUAL" ? (
                <label className="mt-4 block text-sm font-medium text-slate-800">
                  Session structure
                  <select name="preset" value={manualPreset} onChange={(event) => setManualPreset(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base sm:max-w-sm">
                    <option value="BLANK">Blank sessions</option>
                    {sessionsPerWeek === 2 ? <option value="FULL_BODY_2">2-day Full Body</option> : null}
                    {sessionsPerWeek === 3 ? <option value="FULL_BODY_3">3-day Full Body</option> : null}
                    {sessionsPerWeek === 3 ? <option value="PPL_3">3-day Push / Pull / Legs</option> : null}
                    {sessionsPerWeek === 4 ? <option value="UPPER_LOWER_4">4-day Upper / Lower</option> : null}
                    {sessionsPerWeek === 6 ? <option value="PPL_6">6-day Push / Pull / Legs</option> : null}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">Choose a preset matching the selected frequency, or use blank sessions.</span>
                </label>
              ) : (
                <p className="mt-4 text-sm text-slate-600">Generated starting plans currently require four sessions per week.</p>
              )}
            </div>
          ) : null}
          {newPlanType === "STRENGTH" ? (
            <div className="mt-5 border-t border-slate-200 pt-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-slate-800">
                  Main emphasis
                  <select
                    name="emphasis"
                    defaultValue="BALANCED"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="BALANCED">Balanced strength</option>
                    <option value="SQUAT">Improve my squat</option>
                    <option value="BENCH">Improve my bench press</option>
                    <option value="DEADLIFT">Improve my deadlift</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Training days
                  <select
                    name="daysPerWeek"
                    defaultValue="4"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="2">2 days per week</option>
                    <option value="3">3 days per week</option>
                    <option value="4">4 days per week</option>
                    <option value="5">5 days per week</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Time per session
                  <select
                    name="sessionDurationMinutes"
                    defaultValue="60"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="45">About 45 minutes</option>
                    <option value="60">About 60 minutes</option>
                    <option value="75">About 75 minutes</option>
                    <option value="90">About 90 minutes</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Available equipment
                  <select
                    name="equipmentProfile"
                    defaultValue="FULL_GYM"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="FULL_GYM">Full gym</option>
                    <option value="BARBELL_HOME">Barbell, rack, and bench</option>
                    <option value="DUMBBELLS">Dumbbells and bench</option>
                    <option value="MACHINES">Machines and cables</option>
                    <option value="BODYWEIGHT">Bodyweight and bands</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Squat pattern
                  <select
                    name="squatPreference"
                    defaultValue="AUTO"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="AUTO">Choose the best fit</option>
                    <option value="BACK_SQUAT">Back squat</option>
                    <option value="FRONT_SQUAT">Front squat</option>
                    <option value="LEG_PRESS">Leg press</option>
                    <option value="GOBLET_SQUAT">Goblet squat</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Main press
                  <select
                    name="pressPreference"
                    defaultValue="AUTO"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="AUTO">Choose the best fit</option>
                    <option value="BARBELL_BENCH">Barbell bench press</option>
                    <option value="DUMBBELL_BENCH">Dumbbell bench press</option>
                    <option value="OVERHEAD_PRESS">Overhead press</option>
                    <option value="MACHINE_PRESS">Machine press</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-800">
                  Hinge pattern
                  <select
                    name="hingePreference"
                    defaultValue="AUTO"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                  >
                    <option value="AUTO">Choose the best fit</option>
                    <option value="CONVENTIONAL_DEADLIFT">
                      Conventional deadlift
                    </option>
                    <option value="TRAP_BAR_DEADLIFT">
                      Trap-bar deadlift
                    </option>
                    <option value="ROMANIAN_DEADLIFT">
                      Romanian deadlift
                    </option>
                  </select>
                </label>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Your saved experience level and active exercise limitations are
                applied automatically. Strength recognizes left/right and common
                phrasing for low or lower back, knee, shoulder, hip, elbow, and
                wrist limitations. Unrecognized active limitations must be
                updated before a plan can be created. If a preferred lift is
                incompatible, the plan uses the closest safe
                equipment-compatible option.
              </p>
            </div>
          ) : null}
          <Button
            type="submit"
            size="touch"
            className="mt-4 w-full sm:w-auto"
            disabled={creating}
          >
            {creating
              ? authorMethod === "V2" ? "Building draft…" : "Creating draft…"
              : customHypertrophyEnabled && newPlanType === "HYPERTROPHY"
                ? authorMethod === "V2" ? "Generate starting plan" : "Create draft"
                : "Generate and review"}
          </Button>
        </form>
      ) : null}

      {plans.length === 0 && !showCreate ? (
        <section className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <h3 className="font-semibold text-slate-900">No plans yet</h3>
          <p className="mt-2 text-sm text-slate-600">
            Create a plan to review and finalize your first program.
          </p>
        </section>
      ) : (
        <div className="mt-5 grid gap-4">
          {displayedPlans.map((plan, planIndex) => {
            const status = STATUS_COPY[plan.status];
            const busy = busyPlanId === plan.id;
            const group = planGroup(plan);
            const previous = displayedPlans[planIndex - 1];
            const showGroup = customHypertrophyEnabled &&
              (!previous || planGroup(previous).rank !== group.rank);
            return (
              <section key={plan.id} className="contents">
              {showGroup ? (
                <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {group.label}
                </h3>
              ) : null}
              <article
                className={`rounded-2xl border p-4 sm:p-5 ${
                  plan.isActive
                    ? "border-blue-300 bg-blue-50/40 ring-1 ring-blue-200"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-lg font-semibold text-slate-900">
                        {plan.name}
                      </h3>
                      {plan.isActive ? (
                        <StatusBadge tone="positive">Active</StatusBadge>
                      ) : null}
                      <StatusBadge tone="neutral">
                        {planTypeLabel(plan.primaryGoal)}
                      </StatusBadge>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{status.detail}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {plan.status === "DRAFT"
                        ? `${plan.sessionsPerWeek ?? 0} sessions per week · last saved ${formatDate(plan.updatedAt)}`
                        : plan.editableCopyAvailable && !plan.isActive
                          ? `${plan.sessionsPerWeek ?? 0} sessions per week · five-week block starts on activation`
                          : `${plan.durationWeeks} weeks · ${plan.mesocycleCount} mesocycle${plan.mesocycleCount === 1 ? "" : "s"} · starts ${formatDate(plan.startDate)}`}
                    </p>
                  </div>
                </div>

                {editingPlanId === plan.id ? (
                  <form
                    className="mt-4 flex flex-col gap-2 sm:flex-row"
                    action={(formData) => rename(plan, formData)}
                  >
                    <label className="sr-only" htmlFor={`plan-name-${plan.id}`}>
                      Plan name
                    </label>
                    <input
                      id={`plan-name-${plan.id}`}
                      name="name"
                      required
                      maxLength={60}
                      defaultValue={plan.name}
                      className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-base"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="touch" disabled={busy}>
                        {busy ? "Saving…" : "Save name"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="touch"
                        onClick={() => setEditingPlanId(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {plan.status === "PREPARING" ? (
                      <Link
                        href={`/plans/${plan.id}/review`}
                        className={buttonClassName({ size: "touch" })}
                      >
                        Review and finalize
                      </Link>
                    ) : null}
                    {plan.status === "DRAFT" ? (
                      <Link href={`/plans/${plan.id}/edit`} className={buttonClassName({ size: "touch" })}>
                        Resume editing
                      </Link>
                    ) : null}
                    {plan.status === "READY" && !plan.isActive ? (
                      <Button
                        size="touch"
                        onClick={() => activate(plan)}
                        disabled={busy}
                      >
                        {busy ? "Switching…" : "Make active"}
                      </Button>
                    ) : null}
                    {plan.isActive && plan.status === "READY" ? (
                      <Link
                        href="/program"
                        className={buttonClassName({
                          variant: "secondary",
                          size: "touch",
                        })}
                      >
                        View program
                      </Link>
                    ) : null}
                    {customHypertrophyEnabled && plan.editableCopyAvailable ? (
                      <Button variant="secondary" size="touch" onClick={() => void copy(plan)} disabled={busy}>
                        Create editable copy
                      </Button>
                    ) : null}
                    {plan.status === "HANDOFF_PENDING" &&
                    plan.reviewMesocycleId ? (
                      <Link
                        href={`/mesocycles/${plan.reviewMesocycleId}/review`}
                        className={buttonClassName({
                          variant: "secondary",
                          size: "touch",
                        })}
                      >
                        Review handoff
                      </Link>
                    ) : null}
                    {plan.status !== "DRAFT" ? (
                      <Button
                        variant="secondary"
                        size="touch"
                        onClick={() => setEditingPlanId(plan.id)}
                        disabled={busy}
                      >
                        Rename
                      </Button>
                    ) : null}
                    {!plan.isActive ? (
                      <Button
                        variant="ghost"
                        size="touch"
                        onClick={() => archive(plan)}
                        disabled={busy}
                        className="text-rose-700 hover:bg-rose-50"
                      >
                        {busy ? "Archiving…" : "Archive"}
                      </Button>
                    ) : null}
                  </div>
                )}
              </article>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
