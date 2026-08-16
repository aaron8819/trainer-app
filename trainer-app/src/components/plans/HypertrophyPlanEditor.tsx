"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  CANONICAL_MOVEMENT_PATTERN_VALUES,
  type MovementPatternV2,
} from "@/lib/engine/types";
import {
  CANONICAL_MUSCLE_IDS,
  MUSCLE_POLICY_BY_ID,
  type CanonicalMuscleId,
} from "@/lib/engine/muscle-policy";
import {
  isExerciseAvailableForHypertrophyPlan,
  isExerciseEligibleForIntent,
  type AcceptedExerciseIntentV2,
  type HypertrophyPlanDraftV1,
  type HypertrophySessionFocus,
  type HypertrophyUserRole,
} from "@/lib/engine/hypertrophy-plan-authoring";
import type {
  HypertrophyPlanEditorData,
  HypertrophyPlanEditorDataV1,
  HypertrophyPlanEditorDataV2,
} from "@/lib/api/hypertrophy-plan-drafts";
import {
  HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
  isHypertrophyPlanHealthResult,
  type HypertrophyPlanHealthResult,
} from "@/lib/engine/hypertrophy-plan-health";
import { WeeklyHypertrophyPlanEditor } from "./WeeklyHypertrophyPlanEditor";
import { PlanHealthPanel } from "./PlanHealthPanel";
import {
  importantWarningConfirmationPrompt,
  planHealthContextKey,
} from "./plan-health-client";

type SaveState = "saved" | "saving" | "failed";

const ROLE_LABEL: Record<HypertrophyUserRole, string> = {
  PRIMARY_LIFT: "Primary lift",
  SECONDARY_LIFT: "Secondary lift",
  MUSCLE_ISOLATION: "Muscle isolation",
  ACCESSORY: "Accessory",
};

const FOCUS_LABEL: Record<HypertrophySessionFocus, string> = {
  PUSH: "Push",
  PULL: "Pull",
  LEGS: "Legs",
  UPPER: "Upper body",
  LOWER: "Lower body",
  FULL_BODY: "Full body",
  BODY_PART: "Custom",
};

function targetLabel(intent: AcceptedExerciseIntentV2): string {
  return intent.target.kind === "muscle"
    ? MUSCLE_POLICY_BY_ID[intent.target.muscleId].displayName
    : intent.target.movementPattern.replaceAll("_", " ");
}

function defaultIntent(role: HypertrophyUserRole): AcceptedExerciseIntentV2 {
  if (role === "PRIMARY_LIFT" || role === "SECONDARY_LIFT") {
    return {
      userRole: role,
      target: { kind: "movement_pattern", movementPattern: "horizontal_push" },
    };
  }
  return {
    userRole: role,
    target: { kind: "muscle", muscleId: "chest" },
  };
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((entry, entryIndex) =>
    entryIndex === index ? value : entry,
  );
}

function move<T>(values: T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length) return values;
  const next = [...values];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

function mergeRegeneratedWithLocalChanges<T>(
  requestDraft: T,
  regeneratedDraft: T,
  localDraft: T,
): T {
  if (JSON.stringify(localDraft) === JSON.stringify(requestDraft)) {
    return regeneratedDraft;
  }
  if (
    Array.isArray(requestDraft) &&
    Array.isArray(regeneratedDraft) &&
    Array.isArray(localDraft)
  ) {
    const merged: unknown[] = [];
    const length = Math.max(
      requestDraft.length,
      regeneratedDraft.length,
      localDraft.length,
    );
    for (let index = 0; index < length; index += 1) {
      if (index < localDraft.length) {
        if (index < requestDraft.length) {
          merged.push(
            mergeRegeneratedWithLocalChanges(
              requestDraft[index],
              regeneratedDraft[index],
              localDraft[index],
            ),
          );
        } else {
          merged.push(localDraft[index]);
        }
      } else if (index >= requestDraft.length && index < regeneratedDraft.length) {
        merged.push(regeneratedDraft[index]);
      }
    }
    return merged as T;
  }
  if (
    requestDraft != null &&
    regeneratedDraft != null &&
    localDraft != null &&
    typeof requestDraft === "object" &&
    typeof regeneratedDraft === "object" &&
    typeof localDraft === "object"
  ) {
    const requestRecord = requestDraft as Record<string, unknown>;
    const regeneratedRecord = regeneratedDraft as Record<string, unknown>;
    const localRecord = localDraft as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(requestRecord),
      ...Object.keys(regeneratedRecord),
      ...Object.keys(localRecord),
    ])) {
      if (!(key in localRecord)) {
        if (!(key in requestRecord) && key in regeneratedRecord) {
          merged[key] = regeneratedRecord[key];
        }
        continue;
      }
      if (!(key in requestRecord)) {
        merged[key] = localRecord[key];
        continue;
      }
      const value = mergeRegeneratedWithLocalChanges(
        requestRecord[key],
        regeneratedRecord[key],
        localRecord[key],
      );
      if (value !== undefined) merged[key] = value;
    }
    return merged as T;
  }
  return localDraft;
}

async function responseBody(response: Response) {
  return response.json().catch(() => ({})) as Promise<{
    error?: string;
    code?: string;
    revision?: number;
    draft?: HypertrophyPlanDraftV1;
    health?: HypertrophyPlanHealthResult;
    confirmationStatus?: "MISSING" | "MISMATCH";
  }>;
}

export function HypertrophyPlanEditor({
  initialData,
}: {
  initialData: HypertrophyPlanEditorData;
}) {
  return isWeeklyEditorData(initialData) ? (
    <WeeklyHypertrophyPlanEditor key={initialData.planId} initialData={initialData} />
  ) : (
    <LegacyHypertrophyPlanEditor key={initialData.planId} initialData={initialData} />
  );
}

function isWeeklyEditorData(
  data: HypertrophyPlanEditorData,
): data is HypertrophyPlanEditorDataV2 {
  return data.draft.version === 2;
}

function LegacyHypertrophyPlanEditor({
  initialData,
}: {
  initialData: HypertrophyPlanEditorDataV1;
}) {
  const router = useRouter();
  const currentHealthContextKey = useMemo(
    () => planHealthContextKey(initialData),
    [initialData],
  );
  const [name, setName] = useState(initialData.name);
  const [draft, setDraft] = useState(initialData.draft);
  const [revision, setRevision] = useState(initialData.revision);
  const [health, setHealth] = useState(initialData.health);
  const [installedHealthContextKey, setInstalledHealthContextKey] = useState(
    currentHealthContextKey,
  );
  const [selectedSlotId, setSelectedSlotId] = useState(
    initialData.draft.sessions[0]!.slotId,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [searchAllExercises, setSearchAllExercises] = useState(false);
  const [newIntent, setNewIntent] = useState<AcceptedExerciseIntentV2>(
    defaultIntent("PRIMARY_LIFT"),
  );
  const [newExerciseId, setNewExerciseId] = useState("");
  const [makingReady, setMakingReady] = useState(false);
  const lastSavedSignature = useRef(
    JSON.stringify({ name: initialData.name, draft: initialData.draft }),
  );
  const currentSignature = JSON.stringify({ name, draft });
  const unsaved = currentSignature !== lastSavedSignature.current;
  const inFlight = useRef(false);
  const queued = useRef(false);
  const latest = useRef({ name, draft, revision });
  const healthRef = useRef(initialData.health);
  const installedHealthContextKeyRef = useRef(currentHealthContextKey);
  const currentHealthContextKeyRef = useRef(currentHealthContextKey);
  const healthContextGeneration = useRef(0);
  const mountedRef = useRef(true);
  const lastPropsContextKey = useRef(currentHealthContextKey);
  const initialHealthIdentity =
    initialData.health.status === "AVAILABLE"
      ? initialData.health.confirmationScope
      : `${initialData.health.policyVersion}:${initialData.health.draftId}:${initialData.health.draftRevision}:${initialData.health.reason}`;
  const lastInitialHealthIdentity = useRef(initialHealthIdentity);
  latest.current = { name, draft, revision };
  currentHealthContextKeyRef.current = currentHealthContextKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const contextChanged = lastPropsContextKey.current !== currentHealthContextKey;
    const assessmentChanged =
      lastInitialHealthIdentity.current !== initialHealthIdentity;
    if (contextChanged) {
      healthContextGeneration.current += 1;
      lastPropsContextKey.current = currentHealthContextKey;
    }
    if (assessmentChanged) {
      lastInitialHealthIdentity.current = initialHealthIdentity;
      healthRef.current = initialData.health;
      installedHealthContextKeyRef.current = currentHealthContextKey;
      setHealth(initialData.health);
      setInstalledHealthContextKey(currentHealthContextKey);
    }
  }, [currentHealthContextKey, initialData.health, initialHealthIdentity]);
  const selectedIndex = Math.max(
    0,
    draft.sessions.findIndex((session) => session.slotId === selectedSlotId),
  );
  const session = draft.sessions[selectedIndex]!;
  const duration =
    health.status === "AVAILABLE"
      ? health.sessionEstimates[selectedIndex]?.estimatedMinutes
      : undefined;

  const save = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return false;
    }
    const snapshot = latest.current;
    const signature = JSON.stringify({
      name: snapshot.name,
      draft: snapshot.draft,
    });
    if (signature === lastSavedSignature.current) {
      setSaveState("saved");
      return true;
    }
    inFlight.current = true;
    setSaveState("saving");
    setError(null);
    const requestContextGeneration = healthContextGeneration.current;
    const requestHealthContextKey = currentHealthContextKey;
    try {
      const response = await fetch(`/api/plans/${initialData.planId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: snapshot.revision,
          name: snapshot.name,
          draft: snapshot.draft,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok || body.revision == null) {
        setError(body.error ?? "Could not save the draft.");
        setSaveState("failed");
        return false;
      }
      setRevision(body.revision);
      latest.current.revision = body.revision;
      lastSavedSignature.current = signature;
      const nextHealth =
        isHypertrophyPlanHealthResult(body.health) &&
        body.health.draftId === initialData.planId &&
        body.health.draftRevision === body.revision
          ? body.health
          : {
              status: "UNAVAILABLE" as const,
              policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
              draftId: initialData.planId,
              draftRevision: body.revision,
              reason: "RESULT_INVALID" as const,
            };
      if (requestContextGeneration === healthContextGeneration.current) {
        healthRef.current = nextHealth;
        installedHealthContextKeyRef.current = requestHealthContextKey;
        setHealth(nextHealth);
        setInstalledHealthContextKey(requestHealthContextKey);
      }
      setSaveState("saved");
      return true;
    } catch {
      setError("Could not save the draft.");
      setSaveState("failed");
      return false;
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        window.setTimeout(() => void save(), 0);
      }
    }
  }, [currentHealthContextKey, initialData.planId]);

  useEffect(() => {
    if (!unsaved || saveState === "failed") return;
    setSaveState("saving");
    const timer = window.setTimeout(() => void save(), 750);
    return () => window.clearTimeout(timer);
  }, [currentSignature, save, saveState, unsaved]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const updateSession = (
    updater: (value: HypertrophyPlanDraftV1["sessions"][number]) =>
      HypertrophyPlanDraftV1["sessions"][number],
  ) => {
    setDraft((current) => ({
      ...current,
      sessions: replaceAt(
        current.sessions,
        selectedIndex,
        updater(current.sessions[selectedIndex]!),
      ),
    }));
  };

  const eligibleExercises = useMemo(() => {
    const query = search.trim().toLowerCase();
    return initialData.exercises
      .filter((exercise) => {
        const eligibility = {
          exercise,
          equipmentProfile: draft.settings.equipmentProfile,
          limitationKeys: initialData.limitationKeys,
        };
        return searchAllExercises
          ? isExerciseAvailableForHypertrophyPlan(eligibility)
          : isExerciseEligibleForIntent({ ...eligibility, intent: newIntent });
      })
      .filter((exercise) => !query || exercise.name.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite)) ||
          left.name.localeCompare(right.name),
      );
  }, [
    draft.settings.equipmentProfile,
    initialData.exercises,
    initialData.limitationKeys,
    newIntent,
    search,
    searchAllExercises,
  ]);

  const addSession = () => {
    if (draft.sessions.length >= 6) return;
    const slotId = crypto.randomUUID();
    setDraft((current) => ({
      ...current,
      sessions: [
        ...current.sessions,
        {
          slotId,
          name: `Session ${current.sessions.length + 1}`,
          focus: "BODY_PART",
          exercises: [],
        },
      ],
    }));
    setSelectedSlotId(slotId);
  };

  const removeSession = () => {
    if (draft.sessions.length <= 2) return;
    if (
      session.exercises.length > 0 &&
      !window.confirm(
        `Remove “${session.name}” and its ${session.exercises.length} exercises?`,
      )
    ) {
      return;
    }
    const next = draft.sessions.filter((entry) => entry.slotId !== session.slotId);
    setDraft((current) => ({ ...current, sessions: next }));
    setSelectedSlotId(next[Math.max(0, selectedIndex - 1)]!.slotId);
  };

  const addExercise = () => {
    if (!newExerciseId) return;
    updateSession((current) => ({
      ...current,
      exercises: [
        ...current.exercises,
        { exerciseId: newExerciseId, workingSets: 3, intent: newIntent },
      ],
    }));
    setNewExerciseId("");
    setSearch("");
    setSearchAllExercises(false);
    setShowAdd(false);
  };

  const updateExerciseIntent = (
    exerciseIndex: number,
    intent: AcceptedExerciseIntentV2,
  ) =>
    updateSession((current) => ({
      ...current,
      exercises: replaceAt(current.exercises, exerciseIndex, {
        ...current.exercises[exerciseIndex]!,
        intent,
      }),
    }));

  const flushSave = async () => {
    if (!unsaved && saveState === "saved") return true;
    return save();
  };

  const makeReady = async () => {
    const saved = await flushSave();
    if (!saved) return;
    const currentHealth = healthRef.current;
    if (
      installedHealthContextKeyRef.current !== currentHealthContextKey ||
      currentHealth.draftRevision !== latest.current.revision
    ) {
      setShowHealth(true);
      setError("Plan Health is stale. Wait for the current authoritative context before making the plan ready.");
      return;
    }
    if (currentHealth.status === "UNAVAILABLE") {
      setShowHealth(true);
      setError("Plan Health must refresh successfully before making the plan ready.");
      return;
    }
    if (currentHealth.summary.blockingSafety > 0) {
      setShowHealth(true);
      setError("Resolve the Plan Health blockers before making it ready.");
      return;
    }
    if (currentHealth.summary.importantWarnings > 0) {
      if (
        !window.confirm(
          importantWarningConfirmationPrompt(
            currentHealth,
            "Confirm these exact warnings and make the plan ready? This freezes the initial block and will not activate it.",
          ),
        )
      ) {
        return;
      }
    } else if (
      !window.confirm(
        "Make this plan ready? This freezes the initial block and will not activate it.",
      )
    ) {
      return;
    }
    const requestRevision = latest.current.revision;
    const requestContextGeneration = healthContextGeneration.current;
    const requestHealthContextKey = currentHealthContextKey;
    setMakingReady(true);
    setError(null);
    try {
      const response = await fetch(`/api/plans/${initialData.planId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedDraftRevision: latest.current.revision,
          ...(currentHealth.summary.importantWarnings > 0
            ? { warningConfirmationScope: currentHealth.confirmationScope }
            : {}),
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        if (
          body.code === "PLAN_WARNING_CONFIRMATION_REQUIRED" &&
          requestContextGeneration === healthContextGeneration.current &&
          latest.current.revision === requestRevision &&
          isHypertrophyPlanHealthResult(body.health) &&
          body.health.draftId === initialData.planId &&
          body.health.draftRevision === requestRevision
        ) {
          healthRef.current = body.health;
          installedHealthContextKeyRef.current = requestHealthContextKey;
          setHealth(body.health);
          setInstalledHealthContextKey(requestHealthContextKey);
          setShowHealth(true);
          setError(
            body.confirmationStatus === "MISMATCH"
              ? "The plan or its authoritative context changed. Review the current Plan Health warnings and confirm again."
              : body.error ?? "Review the current warnings before making the plan ready.",
          );
          return;
        }
        setError(body.error ?? "The plan wasn’t made ready. Your draft is unchanged.");
        return;
      }
      lastSavedSignature.current = JSON.stringify({ name, draft });
      router.push(`/plans/${initialData.planId}/review`);
      router.refresh();
    } catch {
      setError("The plan wasn’t made ready. Your draft is unchanged.");
    } finally {
      setMakingReady(false);
    }
  };

  const regenerate = async () => {
    if (
      !window.confirm(
        "Replace this draft with a new generated starting plan? Your current sessions, exercises, roles, order, and sets will be replaced.",
      )
    ) {
      return;
    }
    if (!(await flushSave())) return;
    setError(null);
    const requestContextGeneration = healthContextGeneration.current;
    const requestHealthContextKey = currentHealthContextKeyRef.current;
    const requestSnapshot = latest.current;
    const requestSignature = JSON.stringify({
      name: requestSnapshot.name,
      draft: requestSnapshot.draft,
    });
    const response = await fetch(`/api/plans/${initialData.planId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: requestSnapshot.revision,
        replaceConfirmed: true,
      }),
    });
    const body = await responseBody(response);
    if (!mountedRef.current) return;
    if (!response.ok || !body.draft || body.revision == null) {
      setError(body.error ?? "Generation failed. Your draft is unchanged.");
      return;
    }
    const currentSnapshot = latest.current;
    const currentSignature = JSON.stringify({
      name: currentSnapshot.name,
      draft: currentSnapshot.draft,
    });
    const hasNewerLocalEdits = currentSignature !== requestSignature;
    const serverSignature = JSON.stringify({
      name: requestSnapshot.name,
      draft: body.draft,
    });
    if (!hasNewerLocalEdits) {
      setDraft(body.draft);
      latest.current = {
        name: requestSnapshot.name,
        draft: body.draft,
        revision: body.revision,
      };
      setSelectedSlotId(body.draft.sessions[0]!.slotId);
    } else {
      const mergedDraft = mergeRegeneratedWithLocalChanges(
        requestSnapshot.draft,
        body.draft,
        currentSnapshot.draft,
      );
      setDraft(mergedDraft);
      latest.current = {
        name: currentSnapshot.name,
        draft: mergedDraft,
        revision: body.revision,
      };
    }
    setRevision(body.revision);
    lastSavedSignature.current = serverSignature;
    const nextHealth =
      isHypertrophyPlanHealthResult(body.health) &&
      body.health.draftId === initialData.planId &&
      body.health.draftRevision === body.revision
        ? body.health
        : {
            status: "UNAVAILABLE" as const,
            policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
            draftId: initialData.planId,
            draftRevision: body.revision,
            reason: "RESULT_INVALID" as const,
          };
    const currentContextKey = currentHealthContextKeyRef.current;
    const responseContextIsCurrent =
      requestContextGeneration === healthContextGeneration.current &&
      requestHealthContextKey === currentContextKey;
    const installedHealthIsCurrent =
      !hasNewerLocalEdits &&
      installedHealthContextKeyRef.current === currentContextKey &&
      healthRef.current.draftId === initialData.planId &&
      healthRef.current.draftRevision === body.revision;

    if (responseContextIsCurrent && !hasNewerLocalEdits) {
      healthRef.current = nextHealth;
      installedHealthContextKeyRef.current = requestHealthContextKey;
      setHealth(nextHealth);
      setInstalledHealthContextKey(requestHealthContextKey);
    } else if (!installedHealthIsCurrent) {
      const unavailableHealth = {
        status: "UNAVAILABLE" as const,
        policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
        draftId: initialData.planId,
        draftRevision: body.revision,
        reason: "RESULT_INVALID" as const,
      };
      healthRef.current = unavailableHealth;
      installedHealthContextKeyRef.current = currentContextKey;
      setHealth(unavailableHealth);
      setInstalledHealthContextKey(currentContextKey);
    }
    setSaveState(hasNewerLocalEdits ? "saving" : "saved");
    if (!responseContextIsCurrent && !installedHealthIsCurrent) router.refresh();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 pb-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            <span className="sr-only">Plan name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="w-full max-w-xl border-0 bg-transparent p-0 text-xl font-semibold text-slate-950 outline-none focus:ring-0 sm:text-2xl"
            />
          </label>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={
                saveState === "failed" ? "text-rose-700" : "text-slate-600"
              }
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "failed"
                  ? "Save failed — Retry"
                  : "Saved"}
            </span>
            {saveState === "failed" ? (
              <Button size="touch" variant="secondary" onClick={() => void save()}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {draft.sessions.map((entry) => (
            <button
              key={entry.slotId}
              type="button"
              onClick={() => setSelectedSlotId(entry.slotId)}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
                entry.slotId === session.slotId
                  ? "border-blue-500 bg-blue-50 text-blue-800"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <aside className="hidden rounded-2xl border border-slate-200 bg-white p-3 lg:block">
          <h2 className="px-2 text-sm font-semibold text-slate-900">Sessions</h2>
          <div className="mt-2 space-y-1">
            {draft.sessions.map((entry, index) => (
              <button
                key={entry.slotId}
                type="button"
                onClick={() => setSelectedSlotId(entry.slotId)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  entry.slotId === session.slotId
                    ? "bg-blue-50 font-semibold text-blue-900"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {index + 1}. {entry.name}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="touch"
            className="mt-3 w-full"
            onClick={addSession}
            disabled={draft.sessions.length >= 6}
          >
            + Session
          </Button>
          {draft.sessions.length >= 6 ? (
            <p className="mt-2 text-xs text-slate-500">Maximum six sessions.</p>
          ) : null}
        </aside>

        <main className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <label className="text-sm font-medium text-slate-700">
              Session name
              <input
                value={session.name}
                maxLength={60}
                onChange={(event) =>
                  updateSession((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Focus
              <select
                value={session.focus}
                onChange={(event) =>
                  updateSession((current) => ({
                    ...current,
                    focus: event.target.value as HypertrophySessionFocus,
                  }))
                }
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
              >
                {Object.entries(FOCUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-1">
              <Button
                variant="secondary"
                size="touch"
                onClick={() => {
                  const nextIndex = selectedIndex - 1;
                  if (nextIndex < 0) return;
                  setDraft((current) => ({
                    ...current,
                    sessions: move(current.sessions, selectedIndex, nextIndex),
                  }));
                }}
                disabled={selectedIndex === 0}
                aria-label="Move session up"
              >
                ↑
              </Button>
              <Button
                variant="secondary"
                size="touch"
                onClick={() => {
                  const nextIndex = selectedIndex + 1;
                  if (nextIndex >= draft.sessions.length) return;
                  setDraft((current) => ({
                    ...current,
                    sessions: move(current.sessions, selectedIndex, nextIndex),
                  }));
                }}
                disabled={selectedIndex === draft.sessions.length - 1}
                aria-label="Move session down"
              >
                ↓
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>
              {FOCUS_LABEL[session.focus]} · about {duration ?? 0} min
            </span>
            <Button
              variant="ghost"
              size="touch"
              onClick={removeSession}
              disabled={draft.sessions.length <= 2}
              className="text-rose-700"
            >
              Remove session
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {session.exercises.map((row, exerciseIndex) => {
              const exercise = initialData.exercises.find(
                (candidate) => candidate.id === row.exerciseId,
              );
              return (
                <article
                  key={`${row.exerciseId}-${exerciseIndex}`}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {exercise?.name ?? "Unavailable exercise"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {ROLE_LABEL[row.intent.userRole]} · {targetLabel(row.intent)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="secondary"
                        size="touch"
                        aria-label={`Move ${exercise?.name ?? "exercise"} up`}
                        disabled={exerciseIndex === 0}
                        onClick={() =>
                          updateSession((current) => ({
                            ...current,
                            exercises: move(
                              current.exercises,
                              exerciseIndex,
                              exerciseIndex - 1,
                            ),
                          }))
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        size="touch"
                        aria-label={`Move ${exercise?.name ?? "exercise"} down`}
                        disabled={exerciseIndex === session.exercises.length - 1}
                        onClick={() =>
                          updateSession((current) => ({
                            ...current,
                            exercises: move(
                              current.exercises,
                              exerciseIndex,
                              exerciseIndex + 1,
                            ),
                          }))
                        }
                      >
                        ↓
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-xs font-medium text-slate-600">
                      Role
                      <select
                        value={row.intent.userRole}
                        onChange={(event) =>
                          updateExerciseIntent(
                            exerciseIndex,
                            defaultIntent(event.target.value as HypertrophyUserRole),
                          )
                        }
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2 text-sm"
                      >
                        {Object.entries(ROLE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TargetSelect
                      intent={row.intent}
                      onChange={(intent) => updateExerciseIntent(exerciseIndex, intent)}
                    />
                    <label className="text-xs font-medium text-slate-600">
                      Working sets
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={row.workingSets}
                        onChange={(event) =>
                          updateSession((current) => ({
                            ...current,
                            exercises: replaceAt(current.exercises, exerciseIndex, {
                              ...row,
                              workingSets: Math.max(
                                1,
                                Math.min(10, Number(event.target.value)),
                              ),
                            }),
                          }))
                        }
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-xs font-medium text-slate-600">
                    Swap exercise (keeps role, target, sets, and order)
                    <select
                      value={row.exerciseId}
                      onChange={(event) =>
                        updateSession((current) => ({
                          ...current,
                          exercises: replaceAt(current.exercises, exerciseIndex, {
                            ...row,
                            exerciseId: event.target.value,
                          }),
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    >
                      {initialData.exercises
                        .filter(
                          (candidate) =>
                            candidate.id === row.exerciseId ||
                            isExerciseEligibleForIntent({
                              exercise: candidate,
                              intent: row.intent,
                              equipmentProfile: draft.settings.equipmentProfile,
                              limitationKeys: initialData.limitationKeys,
                            }),
                        )
                        .sort(
                          (left, right) =>
                            Number(Boolean(right.isFavorite)) -
                              Number(Boolean(left.isFavorite)) ||
                            left.name.localeCompare(right.name),
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.isFavorite ? "★ " : ""}
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    variant="ghost"
                    size="touch"
                    className="mt-2 text-rose-700"
                    onClick={() =>
                      updateSession((current) => ({
                        ...current,
                        exercises: current.exercises.filter(
                          (_, index) => index !== exerciseIndex,
                        ),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </article>
              );
            })}
          </div>

          {showAdd ? (
            <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <h3 className="font-semibold text-slate-900">Add exercise</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Role
                  <select
                    value={newIntent.userRole}
                    onChange={(event) => {
                      setNewIntent(
                        defaultIntent(event.target.value as HypertrophyUserRole),
                      );
                      setNewExerciseId("");
                    }}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                  >
                    {Object.entries(ROLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <TargetSelect
                  intent={newIntent}
                  onChange={(intent) => {
                    setNewIntent(intent);
                    setNewExerciseId("");
                  }}
                />
              </div>
              <label className="mt-3 block text-sm font-medium text-slate-700">
                Search eligible exercises
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
                  placeholder="Search"
                />
              </label>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={searchAllExercises}
                  onChange={(event) => {
                    setSearchAllExercises(event.target.checked);
                    setNewExerciseId("");
                  }}
                />
                Search all exercises that match equipment and limitations
              </label>
              <label className="mt-3 block text-sm font-medium text-slate-700">
                Exercise
                <select
                  value={newExerciseId}
                  onChange={(event) => setNewExerciseId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
                >
                  <option value="">
                    {eligibleExercises.length
                      ? "Choose an exercise"
                      : "No eligible exercises"}
                  </option>
                  {eligibleExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.isFavorite ? "★ " : ""}
                      {exercise.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex gap-2">
                <Button size="touch" onClick={addExercise} disabled={!newExerciseId}>
                  Add exercise
                </Button>
                <Button variant="secondary" size="touch" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
              </div>
            </section>
          ) : (
            <Button className="mt-4 w-full" size="touch" onClick={() => setShowAdd(true)}>
              + Add exercise
            </Button>
          )}

          <div className="mt-4 flex flex-wrap gap-2 lg:hidden">
            <Button
              variant="secondary"
              size="touch"
              onClick={addSession}
              disabled={draft.sessions.length >= 6}
            >
              + Session
            </Button>
            <Button variant="secondary" size="touch" onClick={() => setShowHealth((value) => !value)}>
              Plan health
            </Button>
          </div>
        </main>

        <aside className={`${showHealth ? "block" : "hidden"} lg:block`}>
          <PlanHealthPanel
            health={health}
            stale={
              unsaved ||
              saveState !== "saved" ||
              health.draftRevision !== revision ||
              installedHealthContextKey !== currentHealthContextKey
            }
            updating={unsaved && saveState === "saving"}
          />
        </aside>
      </div>

      <footer className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="touch"
            onClick={() => void regenerate()}
            disabled={draft.sessions.length !== 4 || makingReady}
          >
            Generate a new starting plan
          </Button>
          <Button
            size="touch"
            onClick={() => void makeReady()}
            disabled={
              makingReady ||
              unsaved ||
              saveState !== "saved" ||
              health.status !== "AVAILABLE" ||
              health.draftRevision !== revision ||
              installedHealthContextKey !== currentHealthContextKey
            }
          >
            {makingReady ? "Making ready…" : "Make plan ready"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function TargetSelect({
  intent,
  onChange,
}: {
  intent: AcceptedExerciseIntentV2;
  onChange: (intent: AcceptedExerciseIntentV2) => void;
}) {
  const showMovement = intent.userRole !== "MUSCLE_ISOLATION";
  const showMuscle =
    intent.userRole === "MUSCLE_ISOLATION" || intent.userRole === "ACCESSORY";
  return (
    <label className="text-xs font-medium text-slate-600">
      Target
      <select
        value={
          intent.target.kind === "muscle"
            ? `muscle:${intent.target.muscleId}`
            : `movement:${intent.target.movementPattern}`
        }
        onChange={(event) => {
          const [kind, value] = event.target.value.split(":") as [
            "muscle" | "movement",
            string,
          ];
          onChange({
            userRole: intent.userRole,
            target:
              kind === "muscle"
                ? { kind: "muscle", muscleId: value as CanonicalMuscleId }
                : {
                    kind: "movement_pattern",
                    movementPattern: value as MovementPatternV2,
                  },
          });
        }}
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2 text-sm capitalize"
      >
        {showMovement
          ? CANONICAL_MOVEMENT_PATTERN_VALUES.filter((pattern) =>
              intent.userRole === "PRIMARY_LIFT"
                ? [
                    "horizontal_push",
                    "horizontal_pull",
                    "vertical_push",
                    "vertical_pull",
                    "squat",
                    "hinge",
                  ].includes(pattern)
                : true,
            ).map((pattern) => (
              <option key={pattern} value={`movement:${pattern}`}>
                {pattern.replaceAll("_", " ")}
              </option>
            ))
          : null}
        {showMuscle
          ? CANONICAL_MUSCLE_IDS.map((muscleId) => (
              <option key={muscleId} value={`muscle:${muscleId}`}>
                {MUSCLE_POLICY_BY_ID[muscleId].displayName}
              </option>
            ))
          : null}
      </select>
    </label>
  );
}
