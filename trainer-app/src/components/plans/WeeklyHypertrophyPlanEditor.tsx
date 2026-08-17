"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  HypertrophyBulkProgressionEditor,
  HypertrophyProgressionEditor,
  type BulkProgressionCandidate,
} from "./HypertrophyProgressionEditor";
import {
  inferHypertrophyExerciseIntent,
  isExerciseEligibleForIntent,
  isHypertrophyRecommendationCustomized,
  materializeHypertrophyExerciseRecommendation,
  type AcceptedExerciseIntentV2,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanDraftV2,
  type HypertrophySessionFocus,
  type WeeklyPrescriptionV4,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { recognizeHypertrophyPrescriptionPattern } from "@/lib/engine/hypertrophy-prescription-patterns";
import type {
  HypertrophyPlanEditorDataV2,
  HypertrophyPlanV4Preview,
} from "@/lib/api/hypertrophy-plan-drafts";
import {
  displayAssessmentIdentity,
  HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
  isHypertrophyPlanHealthResult,
  type HypertrophyPlanHealthResult,
} from "@/lib/engine/hypertrophy-plan-health";
import { PlanHealthPanel } from "./PlanHealthPanel";
import {
  importantWarningConfirmationPrompt,
  planHealthContextKey,
} from "./plan-health-client";

type WeeklyEditorData = HypertrophyPlanEditorDataV2;
type SaveState = "saved" | "saving" | "failed" | "incomplete";
type LeaveState = "idle" | "saving" | "save_failed" | "incomplete";

const ROLE_LABEL: Record<AcceptedExerciseIntentV2["userRole"], string> = {
  PRIMARY_LIFT: "Primary",
  SECONDARY_LIFT: "Secondary",
  MUSCLE_ISOLATION: "Supporting",
  ACCESSORY: "Supporting",
};

type DisplayRole = "PRIMARY" | "SECONDARY" | "SUPPORTING";

const FOCUS_LABEL: Record<HypertrophySessionFocus, string> = {
  PUSH: "Push",
  PULL: "Pull",
  LEGS: "Legs",
  UPPER: "Upper body",
  LOWER: "Lower body",
  FULL_BODY: "Full body",
  BODY_PART: "Custom",
};

function displayRole(intent: AcceptedExerciseIntentV2): DisplayRole {
  if (intent.userRole === "PRIMARY_LIFT") return "PRIMARY";
  if (intent.userRole === "SECONDARY_LIFT") return "SECONDARY";
  return "SUPPORTING";
}

function intentForDisplayRole(
  exercise: HypertrophyAuthoringExercise,
  role: DisplayRole,
): AcceptedExerciseIntentV2 {
  const movementPattern = exercise.movementPatterns[0];
  const muscleId =
    exercise.primaryMuscleIds[0] ?? exercise.secondaryMuscleIds[0];
  if ((role === "PRIMARY" || role === "SECONDARY") && movementPattern) {
    return {
      userRole: role === "PRIMARY" ? "PRIMARY_LIFT" : "SECONDARY_LIFT",
      target: { kind: "movement_pattern", movementPattern },
    };
  }
  if (exercise.isCompound && movementPattern) {
    return {
      userRole: "ACCESSORY",
      target: { kind: "movement_pattern", movementPattern },
    };
  }
  if (!muscleId) {
    throw new Error(`CUSTOM_PLAN_RECOMMENDATION_TARGET_MISSING:${exercise.id}`);
  }
  return {
    userRole: "MUSCLE_ISOLATION",
    target: { kind: "muscle", muscleId },
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

function defaultPrescription(week: number): WeeklyPrescriptionV4 {
  return {
    week,
    status: "PRESCRIBE",
    setCount: 3,
    reps: { kind: "RANGE", min: 8, max: 12 },
    rir: { kind: "TARGET_RANGE", min: 2, max: 3 },
  };
}

function prescriptionForWeek(
  source: WeeklyPrescriptionV4 | undefined,
  week: number,
): WeeklyPrescriptionV4 {
  if (!source || source.status === "OMIT") return defaultPrescription(week);
  return { ...source, week };
}

function formatRepTarget(prescription: WeeklyPrescriptionV4): string {
  if (prescription.status === "OMIT") return "omitted";
  return prescription.reps.kind === "EXACT"
    ? String(prescription.reps.reps)
    : `${prescription.reps.min}–${prescription.reps.max}`;
}

function formatRirTarget(prescription: WeeklyPrescriptionV4): string {
  if (prescription.status === "OMIT") return "omitted";
  return prescription.rir.kind === "NOT_APPLICABLE"
    ? "n/a"
    : prescription.rir.min === prescription.rir.max
      ? String(prescription.rir.min)
      : `${prescription.rir.min}–${prescription.rir.max}`;
}

function compactPrescriptionSummary(input: {
  intent: AcceptedExerciseIntentV2;
  prescriptions: WeeklyPrescriptionV4[];
  weeks: HypertrophyPlanDraftV2["weeks"];
}): string {
  const accumulation = input.prescriptions.filter(
    (_, index) => input.weeks[index]?.phase === "ACCUMULATION",
  );
  const first = accumulation[0];
  const last = accumulation.at(-1);
  const deloadIndex = input.weeks.findIndex((week) => week.phase === "DELOAD");
  const deload = deloadIndex >= 0 ? input.prescriptions[deloadIndex] : undefined;
  if (!first || !last || first.status === "OMIT" || last.status === "OMIT") {
    return ROLE_LABEL[input.intent.userRole];
  }
  const deloadLabel = !deload
    ? "No deload"
    : deload.status === "OMIT"
      ? `W${deload.week} omitted`
      : `W${deload.week} ${deload.setCount} set${deload.setCount === 1 ? "" : "s"} deload`;
  return [
    ROLE_LABEL[input.intent.userRole],
    `${first.setCount} × ${formatRepTarget(first)}`,
    `RIR ${formatRirTarget(first)} → ${formatRirTarget(last)}`,
    deloadLabel,
  ].join(" · ");
}

function supportsProgressionPatterns(draft: HypertrophyPlanDraftV2): boolean {
  return (
    draft.weeks.length === 5 &&
    draft.weeks.every(
      (week, index) =>
        week.week === index + 1 &&
        week.phase === (index === 4 ? "DELOAD" : "ACCUMULATION"),
    )
  );
}

function draftSignature(value: {
  name: string;
  draft: HypertrophyPlanDraftV2;
}): string {
  return JSON.stringify({ name: value.name, draft: value.draft });
}

function reconfigureWeeks(
  draft: HypertrophyPlanDraftV2,
  accumulationWeekCount: number,
  includeDeload: boolean,
): HypertrophyPlanDraftV2 {
  const oldDeloadIndex = draft.weeks.findIndex(
    (week) => week.phase === "DELOAD",
  );
  const weeks = [
    ...Array.from({ length: accumulationWeekCount }, (_, index) => ({
      week: index + 1,
      phase: "ACCUMULATION" as const,
    })),
    ...(includeDeload
      ? [
          {
            week: accumulationWeekCount + 1,
            phase: "DELOAD" as const,
          },
        ]
      : []),
  ];
  return {
    ...draft,
    weeks,
    sessions: draft.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => {
        const oldAccumulation = draft.weeks.flatMap((week, index) =>
          week.phase === "ACCUMULATION"
            ? [exercise.prescriptions[index]!]
            : [],
        );
        const lastAccumulation = oldAccumulation.at(-1);
        const oldDeload =
          oldDeloadIndex >= 0
            ? exercise.prescriptions[oldDeloadIndex]
            : undefined;
        return {
          ...exercise,
          recommendationBaseline: undefined,
          prescriptions: weeks.map((week) =>
            week.phase === "DELOAD"
              ? oldDeload
                ? { ...oldDeload, week: week.week }
                : prescriptionForWeek(lastAccumulation, week.week)
              : prescriptionForWeek(
                  oldAccumulation[week.week - 1] ?? lastAccumulation,
                  week.week,
                ),
          ),
        };
      }),
    })),
  };
}

async function responseBody(response: Response) {
  return response.json().catch(() => ({})) as Promise<{
    error?: string;
    code?: string;
    revision?: number;
    preview?: HypertrophyPlanV4Preview;
    health?: HypertrophyPlanHealthResult;
    confirmationStatus?: "MISSING" | "MISMATCH";
  }>;
}

function matchingHealthResult(
  health: HypertrophyPlanHealthResult | undefined,
  planId: string,
  revision: number,
): health is HypertrophyPlanHealthResult {
  return Boolean(
    isHypertrophyPlanHealthResult(health) &&
      health.draftId === planId &&
      health.draftRevision === revision,
  );
}

export function WeeklyHypertrophyPlanEditor({
  initialData,
}: {
  initialData: WeeklyEditorData;
}) {
  return (
    <WeeklyHypertrophyPlanEditorStateful
      key={initialData.planId}
      initialData={initialData}
    />
  );
}

function WeeklyHypertrophyPlanEditorStateful({
  initialData,
}: {
  initialData: WeeklyEditorData;
}) {
  const router = useRouter();
  const currentHealthContextKey = useMemo(
    () => planHealthContextKey(initialData),
    [initialData],
  );
  const [name, setName] = useState(initialData.name);
  const [draft, setDraft] = useState(initialData.draft);
  const [revision, setRevision] = useState(initialData.revision);
  const [preview, setPreview] = useState(initialData.preview);
  const [health, setHealth] = useState(initialData.health);
  const [installedHealthContextKey, setInstalledHealthContextKey] = useState(
    currentHealthContextKey,
  );
  const [selectedSlotId, setSelectedSlotId] = useState(
    initialData.draft.sessions[0]!.slotId,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [leaveState, setLeaveState] = useState<LeaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [weekCountInput, setWeekCountInput] = useState(
    String(
      initialData.draft.weeks.filter(
        (week) => week.phase === "ACCUMULATION",
      ).length,
    ),
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newExerciseId, setNewExerciseId] = useState("");
  const [editingPlacementId, setEditingPlacementId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [prescriptionResetRevision, setPrescriptionResetRevision] = useState<
    Record<string, number>
  >({});

  const [savedSignature, setSavedSignature] = useState(() =>
    draftSignature({ name: initialData.name, draft: initialData.draft }),
  );
  const lastSavedSignature = useRef(savedSignature);
  const currentSignature = draftSignature({ name, draft });
  const unsaved = currentSignature !== savedSignature;
  const activeSave = useRef<Promise<boolean> | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const leaving = useRef(false);
  const invalidFieldCount = invalidFields.size;
  const displayedSaveState: SaveState =
    invalidFieldCount > 0
      ? "incomplete"
      : unsaved && saveState === "saved"
        ? "saving"
        : saveState;
  const invalidFieldCountRef = useRef(invalidFieldCount);
  const latest = useRef({ name, draft, revision });
  const latestHealthRevision = useRef(initialData.health.draftRevision);
  const healthContextGeneration = useRef(0);
  const lastPropsContextKey = useRef(currentHealthContextKey);
  const initialDisplayAssessmentIdentity = displayAssessmentIdentity(
    initialData.health,
  );
  const lastInitialDisplayAssessmentIdentity = useRef(
    initialDisplayAssessmentIdentity,
  );
  const initialWarningConfirmationScope =
    initialData.health.status === "AVAILABLE"
      ? initialData.health.confirmationScope
      : null;
  const lastInitialWarningConfirmationScope = useRef(
    initialWarningConfirmationScope,
  );

  useLayoutEffect(() => {
    const contextChanged = lastPropsContextKey.current !== currentHealthContextKey;
    const assessmentChanged =
      lastInitialDisplayAssessmentIdentity.current !==
      initialDisplayAssessmentIdentity;
    const warningAuthorityChanged =
      lastInitialWarningConfirmationScope.current !==
      initialWarningConfirmationScope;
    if (contextChanged) {
      healthContextGeneration.current += 1;
      lastPropsContextKey.current = currentHealthContextKey;
    }
    if (assessmentChanged || warningAuthorityChanged) {
      lastInitialDisplayAssessmentIdentity.current =
        initialDisplayAssessmentIdentity;
      lastInitialWarningConfirmationScope.current =
        initialWarningConfirmationScope;
      latestHealthRevision.current = initialData.health.draftRevision;
      setHealth(initialData.health);
      setInstalledHealthContextKey(currentHealthContextKey);
    }
  }, [
    currentHealthContextKey,
    initialData.health,
    initialDisplayAssessmentIdentity,
    initialWarningConfirmationScope,
  ]);

  useLayoutEffect(() => {
    invalidFieldCountRef.current = invalidFieldCount;
    latest.current = { name, draft, revision };
  }, [draft, invalidFieldCount, name, revision]);

  const selectedIndex = Math.max(
    0,
    draft.sessions.findIndex((session) => session.slotId === selectedSlotId),
  );
  const session = draft.sessions[selectedIndex]!;
  const includeDeload = draft.weeks.at(-1)?.phase === "DELOAD";
  const progressionPatternsSupported = supportsProgressionPatterns(draft);
  const maxAccumulationWeeks = includeDeload ? 51 : 52;
  const exerciseById = useMemo(
    () => new Map(initialData.exercises.map((exercise) => [exercise.id, exercise])),
    [initialData.exercises],
  );

  const setFieldValidity = useCallback((key: string, valid: boolean) => {
    setInvalidFields((current) => {
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      return next.size === current.size && [...next].every((item) => current.has(item))
        ? current
        : next;
    });
  }, []);

  const remountPrescriptionFields = (placementId: string) => {
    setPrescriptionResetRevision((current) => ({
      ...current,
      [placementId]: (current[placementId] ?? 0) + 1,
    }));
  };

  const performSave = useCallback(async () => {
    while (true) {
      if (invalidFieldCountRef.current > 0) {
        setSaveState("incomplete");
        return false;
      }
      const snapshot = latest.current;
      const signature = draftSignature(snapshot);
      if (signature === lastSavedSignature.current) {
        setSaveState("saved");
        return true;
      }
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
        if (!response.ok || body.revision == null || !body.preview) {
          setError(body.error ?? "Could not save the weekly draft.");
          setSaveState("failed");
          return false;
        }
        setRevision(body.revision);
        latest.current.revision = body.revision;
        lastSavedSignature.current = signature;
        setSavedSignature(signature);
        setPreview(body.preview);
        if (
          requestContextGeneration === healthContextGeneration.current &&
          body.revision >= latestHealthRevision.current
        ) {
          const nextHealth = matchingHealthResult(
            body.health,
            initialData.planId,
            body.revision,
          )
            ? body.health
            : {
                status: "UNAVAILABLE" as const,
                policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
                draftId: initialData.planId,
                draftRevision: body.revision,
                reason: "RESULT_INVALID" as const,
              };
          latestHealthRevision.current = body.revision;
          setHealth(nextHealth);
          setInstalledHealthContextKey(requestHealthContextKey);
        }
      } catch {
        setError("Could not save the weekly draft.");
        setSaveState("failed");
        return false;
      }
      if (invalidFieldCountRef.current > 0) {
        setSaveState("incomplete");
        return false;
      }
      if (draftSignature(latest.current) !== lastSavedSignature.current) {
        setSaveState("saving");
        continue;
      }
      setSaveState("saved");
      return true;
    }
  }, [currentHealthContextKey, initialData.planId]);

  const save = useCallback(() => {
    if (activeSave.current) return activeSave.current;
    const operation = performSave();
    const tracked = operation.finally(() => {
      if (activeSave.current === tracked) activeSave.current = null;
    });
    activeSave.current = tracked;
    return tracked;
  }, [performSave]);

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimer.current != null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
  }, []);

  useEffect(() => {
    cancelPendingAutosave();
    if (invalidFieldCount > 0) return;
    if (!unsaved) return;
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void save();
    }, 750);
    return cancelPendingAutosave;
  }, [cancelPendingAutosave, currentSignature, invalidFieldCount, save, unsaved]);

  useEffect(() => {
    if (!unsaved && invalidFieldCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [invalidFieldCount, unsaved]);

  const updateSession = (
    updater: (value: HypertrophyPlanDraftV2["sessions"][number]) =>
      HypertrophyPlanDraftV2["sessions"][number],
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

  const eligibleExercises = useMemo(
    () =>
      initialData.exercises
        .filter((exercise) => {
          if (!exercise.measurement) return false;
          const intent = inferHypertrophyExerciseIntent({
            exercise,
            existingIntents: session.exercises.map((row) => row.intent),
          });
          return isExerciseEligibleForIntent({
            exercise,
            intent,
            equipmentProfile: draft.settings.equipmentProfile,
            limitationKeys: initialData.limitationKeys,
          });
        })
        .sort(
          (left, right) =>
            Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite)) ||
            left.name.localeCompare(right.name),
        ),
    [
      draft.settings.equipmentProfile,
      initialData.exercises,
      initialData.limitationKeys,
      session.exercises,
    ],
  );

  const newRecommendation = useMemo(() => {
    const exercise = exerciseById.get(newExerciseId);
    return exercise
      ? materializeHypertrophyExerciseRecommendation({
          exercise,
          weeks: draft.weeks,
          existingIntents: session.exercises.map((row) => row.intent),
        })
      : null;
  }, [draft.weeks, exerciseById, newExerciseId, session.exercises]);

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

  useEffect(() => {
    setSelectionMode(false);
    setSelectedPlacementIds(new Set());
    setBulkEditorOpen(false);
    setEditingPlacementId(null);
  }, [selectedSlotId]);

  const removeSession = () => {
    if (draft.sessions.length <= 2) return;
    if (
      session.exercises.length > 0 &&
      !window.confirm(`Remove “${session.name}” and all of its prescriptions?`)
    ) {
      return;
    }
    const next = draft.sessions.filter((entry) => entry.slotId !== session.slotId);
    setDraft((current) => ({ ...current, sessions: next }));
    setSelectedSlotId(next[Math.max(0, selectedIndex - 1)]!.slotId);
  };

  const addExercise = () => {
    if (!newExerciseId || !newRecommendation) return;
    updateSession((current) => ({
      ...current,
      exercises: [
        ...current.exercises,
        {
          placementId: crypto.randomUUID(),
          exerciseId: newExerciseId,
          ...newRecommendation,
        },
      ],
    }));
    setNewExerciseId("");
    setShowAdd(false);
  };

  const applyPlacementProgression = (
    placementId: string,
    prescriptions: WeeklyPrescriptionV4[],
  ) => {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((currentSession) =>
        currentSession.slotId !== selectedSlotId
          ? currentSession
          : {
              ...currentSession,
              exercises: currentSession.exercises.map((exercise) =>
                exercise.placementId === placementId
                  ? { ...exercise, prescriptions }
                  : exercise,
              ),
            },
      ),
    }));
    remountPrescriptionFields(placementId);
  };

  const applyBulkProgression = (
    changes: Map<string, WeeklyPrescriptionV4[]>,
  ) => {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((currentSession) =>
        currentSession.slotId !== selectedSlotId
          ? currentSession
          : {
              ...currentSession,
              exercises: currentSession.exercises.map((exercise) => {
                const prescriptions = changes.get(exercise.placementId);
                return prescriptions ? { ...exercise, prescriptions } : exercise;
              }),
            },
      ),
    }));
    for (const placementId of changes.keys()) remountPrescriptionFields(placementId);
    setSelectionMode(false);
    setSelectedPlacementIds(new Set());
  };

  const discardAndLeave = () => {
    cancelPendingAutosave();
    leaving.current = true;
    router.push("/plans");
  };

  const stayOnEditor = () => {
    leaving.current = false;
    setLeaveState("idle");
  };

  const handleBack = async () => {
    if (leaving.current) return;
    cancelPendingAutosave();
    if (invalidFieldCountRef.current > 0) {
      setLeaveState("incomplete");
      return;
    }
    leaving.current = true;
    setLeaveState("saving");
    while (invalidFieldCountRef.current === 0) {
      const saved = await save();
      if (!saved) {
        leaving.current = false;
        setLeaveState(
          invalidFieldCountRef.current > 0 ? "incomplete" : "save_failed",
        );
        return;
      }
      if (draftSignature(latest.current) === lastSavedSignature.current) {
        router.push("/plans");
        return;
      }
    }
    leaving.current = false;
    setLeaveState("incomplete");
  };

  const previewCurrent =
    !unsaved && invalidFieldCount === 0 && displayedSaveState === "saved";
  const healthCurrent =
    previewCurrent &&
    health.draftRevision === revision &&
    installedHealthContextKey === currentHealthContextKey;
  const healthStale = !healthCurrent;
  const healthUpdating =
    healthStale && invalidFieldCount === 0 && displayedSaveState === "saving";
  const healthBlocksFinalization =
    !healthCurrent ||
    health.status === "UNAVAILABLE" ||
    health.summary.blockingSafety > 0;
  const supportedTopology =
    draft.sessions.length === 4 &&
    draft.sessions.every((entry) => entry.exercises.length > 0) &&
    draft.weeks.length === 5 &&
    draft.weeks.every((week, index) =>
      week.week === index + 1 &&
      week.phase === (index === 4 ? "DELOAD" : "ACCUMULATION"),
    );
  const editingRow = editingPlacementId
    ? session.exercises.find((entry) => entry.placementId === editingPlacementId)
    : undefined;
  const bulkCandidates: BulkProgressionCandidate[] = session.exercises.flatMap(
    (entry) =>
      selectedPlacementIds.has(entry.placementId)
        ? [{
            placementId: entry.placementId,
            exerciseName: exerciseById.get(entry.exerciseId)?.name ?? "Unavailable exercise",
            prescriptions: entry.prescriptions,
          }]
        : [],
  );

  const finalize = async (): Promise<void> => {
    if (
      !previewCurrent ||
      !healthCurrent ||
      health.status !== "AVAILABLE" ||
      preview.status !== "ELIGIBLE" ||
      !supportedTopology
    ) {
      return;
    }
    const warningConfirmationScope =
      health.summary.importantWarnings > 0
        ? health.confirmationScope
        : undefined;
    if (
      warningConfirmationScope &&
      !window.confirm(
        importantWarningConfirmationPrompt(
          health,
          "Confirm these exact warnings and finalize the plan?",
        ),
      )
    ) {
      return;
    }
    const requestRevision = revision;
    const requestContextGeneration = healthContextGeneration.current;
    const requestHealthContextKey = currentHealthContextKey;
    setFinalizing(true);
    setError(null);
    try {
      const response = await fetch(`/api/plans/${initialData.planId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedDraftRevision: revision,
          ...(warningConfirmationScope ? { warningConfirmationScope } : {}),
          confirmedPreviewHash: preview.hash,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        if (
          body.code === "PLAN_WARNING_CONFIRMATION_REQUIRED" &&
          requestContextGeneration === healthContextGeneration.current &&
          latest.current.revision === requestRevision &&
          matchingHealthResult(body.health, initialData.planId, requestRevision)
        ) {
          latestHealthRevision.current = requestRevision;
          setHealth(body.health);
          setInstalledHealthContextKey(requestHealthContextKey);
          setError(
            body.confirmationStatus === "MISMATCH"
              ? "The plan or its authoritative context changed. Review the current Plan Health warnings and confirm again."
              : body.error ?? "Review the current warnings before finalizing.",
          );
          return;
        }
        setError(body.error ?? "Could not finalize the weekly plan.");
        return;
      }
      router.push("/plans");
      router.refresh();
    } catch {
      setError("Could not finalize the weekly plan.");
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 pb-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Plan name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="w-full max-w-xl border-0 bg-transparent p-0 text-xl font-semibold text-slate-950 outline-none focus:ring-0 sm:text-2xl"
            />
          </label>
          <div className="flex items-center gap-2 text-sm" aria-live="polite">
            <span
              className={
                displayedSaveState === "failed" || displayedSaveState === "incomplete"
                  ? "text-rose-700"
                  : "text-slate-600"
              }
            >
              {displayedSaveState === "saving"
                ? "Saving…"
                : displayedSaveState === "failed"
                  ? "Save failed"
                  : displayedSaveState === "incomplete"
                    ? "Incomplete — not saved"
                    : "Saved"}
            </span>
            {displayedSaveState === "failed" ? (
              <Button size="touch" variant="secondary" onClick={() => void save()}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          The supported four-session, five-week profile can be finalized after its saved preview is confirmed.
        </p>
        <nav aria-label="Session navigation" className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1 lg:hidden">
          {draft.sessions.map((entry) => (
            <button
              key={entry.slotId}
              type="button"
              onClick={() => setSelectedSlotId(entry.slotId)}
              className={`min-h-11 shrink-0 snap-start rounded-full border px-4 text-sm font-medium ${
                entry.slotId === session.slotId
                  ? "border-blue-500 bg-blue-50 text-blue-800"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </nav>
      </header>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="font-semibold text-slate-950">Plan weeks</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium text-slate-700">
            Accumulation weeks
            <input
              type="number"
              min={1}
              max={maxAccumulationWeeks}
              value={weekCountInput}
              onChange={(event) => {
                const value = event.target.value;
                setWeekCountInput(value);
                const count = Number(value);
                const valid =
                  Number.isInteger(count) &&
                  count >= 1 &&
                  count <= maxAccumulationWeeks;
                setFieldValidity("plan-weeks", valid);
                if (valid) {
                  setDraft((current) =>
                    reconfigureWeeks(current, count, includeDeload),
                  );
                }
              }}
              className="mt-1 block min-h-11 w-28 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={includeDeload}
              onChange={(event) => {
                const count = Number(weekCountInput);
                const max = event.target.checked ? 51 : 52;
                const nextCount = Math.min(Number.isInteger(count) ? count : 4, max);
                setWeekCountInput(String(nextCount));
                setFieldValidity("plan-weeks", true);
                setDraft((current) =>
                  reconfigureWeeks(current, nextCount, event.target.checked),
                );
              }}
            />
            Add a final deload week
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Weeks stay contiguous. Only the final deload can omit an exercise.
        </p>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
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
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
              >
                {Object.entries(FOCUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-1">
              <Button
                variant="secondary"
                size="touch"
                aria-label="Move session up"
                disabled={selectedIndex === 0}
                onClick={() => {
                  const nextIndex = selectedIndex - 1;
                  setDraft((current) => ({
                    ...current,
                    sessions: move(current.sessions, selectedIndex, nextIndex),
                  }));
                }}
              >↑</Button>
              <Button
                variant="secondary"
                size="touch"
                aria-label="Move session down"
                disabled={selectedIndex === draft.sessions.length - 1}
                onClick={() => {
                  const nextIndex = selectedIndex + 1;
                  setDraft((current) => ({
                    ...current,
                    sessions: move(current.sessions, selectedIndex, nextIndex),
                  }));
                }}
              >↓</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">{session.exercises.length} exercise placements</p>
            <Button
              variant="ghost"
              size="touch"
              className="text-rose-700"
              disabled={draft.sessions.length <= 2}
              onClick={removeSession}
            >
              Remove session
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Exercise progressions</p>
              <p className="mt-1 text-xs text-slate-600">
                {progressionPatternsSupported
                  ? "Edit one exercise or select placements for a session-only effort and deload update."
                  : "Progression commands require four accumulation weeks and a final Week 5 deload. Exact weekly editing remains available."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectionMode ? (
                <>
                  <Button
                    size="touch"
                    disabled={selectedPlacementIds.size === 0 || !progressionPatternsSupported}
                    onClick={() => setBulkEditorOpen(true)}
                  >
                    Preview bulk ({selectedPlacementIds.size})
                  </Button>
                  <Button
                    variant="secondary"
                    size="touch"
                    onClick={() => {
                      setSelectionMode(false);
                      setSelectedPlacementIds(new Set());
                    }}
                  >
                    Cancel selection
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="touch"
                  disabled={session.exercises.length === 0 || !progressionPatternsSupported}
                  onClick={() => setSelectionMode(true)}
                >
                  Select for bulk edit
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {session.exercises.map((row, exerciseIndex) => {
              const exercise = exerciseById.get(row.exerciseId);
              const customized = isHypertrophyRecommendationCustomized(row);
              const hasBaseline =
                row.recommendationBaseline?.exerciseId === row.exerciseId;
              const pattern = progressionPatternsSupported
                ? recognizeHypertrophyPrescriptionPattern({
                    weeks: draft.weeks,
                    prescriptions: row.prescriptions,
                  })
                : null;
              return (
                <article key={row.placementId} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {selectionMode ? (
                        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            aria-label={`Select ${exercise?.name ?? "exercise"} for bulk progression`}
                            checked={selectedPlacementIds.has(row.placementId)}
                            onChange={(event) =>
                              setSelectedPlacementIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(row.placementId);
                                else next.delete(row.placementId);
                                return next;
                              })
                            }
                          />
                          <span className="sr-only">Select</span>
                        </label>
                      ) : null}
                      <div className="min-w-0">
                      <h3 className="font-semibold text-slate-950">
                        {exercise?.name ?? "Unavailable exercise"}
                      </h3>
                      <p className="mt-1 text-sm text-slate-700">
                        {pattern?.summary ?? compactPrescriptionSummary({
                            intent: row.intent,
                            prescriptions: row.prescriptions,
                            weeks: draft.weeks,
                          })}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {ROLE_LABEL[row.intent.userRole]} · {pattern?.deloadSummary ?? "Exact weekly prescription"}
                      </p>
                      {pattern ? (
                        <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${pattern.isCustom ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"}`}>
                          {pattern.classificationLabel}
                        </span>
                      ) : null}
                      {customized ? (
                        <span className="ml-2 mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                          Recommendation customized
                        </span>
                      ) : !hasBaseline ? (
                        <span className="ml-2 mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          Manual
                        </span>
                      ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        size="touch"
                        disabled={!progressionPatternsSupported}
                        onClick={() => setEditingPlacementId(row.placementId)}
                      >
                        Edit progression
                      </Button>
                      <Button
                        variant="secondary"
                        size="touch"
                        aria-label={`Move ${exercise?.name ?? "exercise"} up`}
                        disabled={exerciseIndex === 0}
                        onClick={() =>
                          updateSession((current) => ({
                            ...current,
                            exercises: move(current.exercises, exerciseIndex, exerciseIndex - 1),
                          }))
                        }
                      >↑</Button>
                      <Button
                        variant="secondary"
                        size="touch"
                        aria-label={`Move ${exercise?.name ?? "exercise"} down`}
                        disabled={exerciseIndex === session.exercises.length - 1}
                        onClick={() =>
                          updateSession((current) => ({
                            ...current,
                            exercises: move(current.exercises, exerciseIndex, exerciseIndex + 1),
                          }))
                        }
                      >↓</Button>
                    </div>
                  </div>

                  <details className="mt-3">
                    <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      Advanced weekly exceptions
                    </summary>
                    <p className="mt-2 text-xs text-slate-600">
                      Exact stored rows. Changes here immediately update the derived progression summary; opening or closing this section changes nothing.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Exercise
                      <select
                        aria-label={`Swap ${exercise?.name ?? "exercise"} and keep placement identity`}
                        value={row.exerciseId}
                        onChange={(event) =>
                          updateSession((current) => ({
                            ...current,
                            exercises: replaceAt(current.exercises, exerciseIndex, {
                              ...row,
                              exerciseId: event.target.value,
                              preservedMeasurement:
                                row.preservedMeasurement?.exerciseId === event.target.value
                                  ? row.preservedMeasurement
                                  : undefined,
                              recommendationBaseline: undefined,
                            }),
                          }))
                        }
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                      >
                        {initialData.exercises
                          .filter(
                            (candidate) =>
                              candidate.id === row.exerciseId ||
                              (Boolean(candidate.measurement) &&
                                isExerciseEligibleForIntent({
                                  exercise: candidate,
                                  intent: row.intent,
                                  equipmentProfile: draft.settings.equipmentProfile,
                                  limitationKeys: initialData.limitationKeys,
                                })),
                          )
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                          ))}
                      </select>
                    </label>
                    <IntentFields
                      exercise={exercise}
                      intent={row.intent}
                      onChange={(intent) =>
                        updateSession((current) => ({
                          ...current,
                          exercises: replaceAt(current.exercises, exerciseIndex, {
                            ...row,
                            intent,
                          }),
                        }))
                      }
                    />
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {row.prescriptions.map((prescription, prescriptionIndex) => (
                      <PrescriptionFields
                        key={`${row.placementId}-${prescriptionResetRevision[row.placementId] ?? 0}-${prescription.week}-${draft.weeks[prescriptionIndex]!.phase}`}
                        fieldKey={`${row.placementId}-${prescription.week}-${draft.weeks[prescriptionIndex]!.phase}`}
                        phase={draft.weeks[prescriptionIndex]!.phase}
                        prescription={prescription}
                        isException={Boolean(pattern?.exceptionWeeks.includes(prescription.week))}
                        onValidityChange={setFieldValidity}
                        onChange={(next) =>
                          updateSession((current) => {
                            const currentExercise = current.exercises[exerciseIndex]!;
                            return {
                              ...current,
                              exercises: replaceAt(
                                current.exercises,
                                exerciseIndex,
                                {
                                  ...currentExercise,
                                  prescriptions: replaceAt(
                                    currentExercise.prescriptions,
                                    prescriptionIndex,
                                    next,
                                  ),
                                },
                              ),
                            };
                          })
                        }
                      />
                    ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="touch"
                        disabled={!progressionPatternsSupported}
                        onClick={() => setEditingPlacementId(row.placementId)}
                      >
                        Edit and reapply progression
                      </Button>
                    {hasBaseline ? (
                      <Button
                        variant="secondary"
                        size="touch"
                        disabled={!customized}
                        onClick={() => {
                          if (
                            !row.recommendationBaseline ||
                            !window.confirm(
                              `Reset “${exercise?.name ?? "this exercise"}” to its saved recommendation? Customized intent and weekly values will be replaced.`,
                            )
                          ) {
                            return;
                          }
                          const baseline = row.recommendationBaseline;
                          updateSession((current) => ({
                            ...current,
                            exercises: replaceAt(current.exercises, exerciseIndex, {
                              ...current.exercises[exerciseIndex]!,
                              intent: structuredClone(baseline.intent),
                              prescriptions: structuredClone(baseline.prescriptions),
                            }),
                          }));
                          remountPrescriptionFields(row.placementId);
                        }}
                      >
                        Reset to recommended
                      </Button>
                    ) : exercise ? (
                      <Button
                        variant="secondary"
                        size="touch"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Apply a new recommendation to “${exercise.name}”? Current weekly values will be replaced.`,
                            )
                          ) {
                            return;
                          }
                          const recommendation =
                            materializeHypertrophyExerciseRecommendation({
                              exercise,
                              weeks: draft.weeks,
                              intent: row.intent,
                            });
                          updateSession((current) => ({
                            ...current,
                            exercises: replaceAt(current.exercises, exerciseIndex, {
                              ...current.exercises[exerciseIndex]!,
                              ...recommendation,
                            }),
                          }));
                          remountPrescriptionFields(row.placementId);
                        }}
                      >
                        Apply recommendation
                      </Button>
                    ) : null}

                      <Button
                        variant="ghost"
                        size="touch"
                        className="text-rose-700"
                        onClick={() =>
                          updateSession((current) => ({
                            ...current,
                            exercises: current.exercises.filter(
                              (candidate) => candidate.placementId !== row.placementId,
                            ),
                          }))
                        }
                      >
                        Remove exercise
                      </Button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>

          {showAdd ? (
            <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <h3 className="font-semibold text-slate-900">Add exercise placement</h3>
              <div className="mt-3">
                <label className="text-sm font-medium text-slate-700">
                  Exercise
                  <select
                    value={newExerciseId}
                    onChange={(event) => setNewExerciseId(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                  >
                    <option value="">Choose an exercise</option>
                    {eligibleExercises.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.isFavorite ? "★ " : ""}{candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
                {newRecommendation ? (
                  <p className="mt-3 rounded-lg border border-blue-200 bg-white p-3 text-sm text-slate-700" aria-live="polite">
                    {compactPrescriptionSummary({
                      intent: newRecommendation.intent,
                      prescriptions: newRecommendation.prescriptions,
                      weeks: draft.weeks,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="touch" disabled={!newExerciseId} onClick={addExercise}>Add exercise</Button>
                <Button variant="secondary" size="touch" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </section>
          ) : (
            <Button className="mt-4 w-full" size="touch" onClick={() => setShowAdd(true)}>
              + Add exercise
            </Button>
          )}

          <Button
            variant="secondary"
            size="touch"
            className="mt-3 lg:hidden"
            disabled={draft.sessions.length >= 6}
            onClick={addSession}
          >
            + Session
          </Button>
        </main>

        <aside className="min-w-0 space-y-5">
          <PlanHealthPanel
            health={health}
            stale={healthStale}
            updating={healthUpdating}
          />
          <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="normalized-preview-heading">
          <h2 id="normalized-preview-heading" className="font-semibold text-slate-950">Normalized preview</h2>
          {!previewCurrent ? (
            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Finish the current fields and wait for them to save before previewing.
            </p>
          ) : preview.status === "INELIGIBLE" ? (
            <div className="mt-2">
              <p className="text-sm text-slate-600">Preview is not ready yet:</p>
              <div className="mt-2 space-y-2">
                {preview.reasons.map((reason, index) => (
                  <p key={`${reason.code}-${reason.slotId}-${reason.placementId ?? index}`} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                    {reason.message}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="rounded-lg bg-emerald-50 p-2 text-xs font-medium text-emerald-900">
                Saved draft is preview eligible.
              </p>
              {preview.normalizedPlan.slots.map((slot) => (
                <section key={slot.slotId} className="rounded-lg border border-slate-200 p-3">
                  <h3 className="text-sm font-semibold text-slate-900">{slot.name}</h3>
                  <div className="mt-2 space-y-2">
                    {slot.exercises.map((placement) => (
                      <div key={placement.placementId} className="text-xs text-slate-700">
                        <p className="font-medium text-slate-900">
                          {exerciseById.get(placement.exerciseId)?.name ?? placement.exerciseId}
                        </p>
                        <p className="mt-1">
                          {placement.prescriptions.map(formatPrescription).join(" · ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              <p className="break-all text-[11px] text-slate-500">
                SHA-256 {preview.hash}
              </p>
              <Button
                className="w-full"
                size="touch"
                disabled={!supportedTopology || healthBlocksFinalization || finalizing}
                onClick={() => void finalize()}
              >
                {finalizing ? "Finalizing…" : "Finalize plan"}
              </Button>
              {!supportedTopology ? (
                <p className="text-xs text-amber-800">
                  Finalization currently supports exactly four sessions, four accumulation weeks, and one final deload week.
                </p>
              ) : null}
            </div>
          )}
          </section>
        </aside>
      </div>

      {editingRow && progressionPatternsSupported ? (
        <HypertrophyProgressionEditor
          key={editingRow.placementId}
          exerciseName={exerciseById.get(editingRow.exerciseId)?.name ?? "Unavailable exercise"}
          weeks={draft.weeks}
          prescriptions={editingRow.prescriptions}
          onApply={(prescriptions) =>
            applyPlacementProgression(editingRow.placementId, prescriptions)
          }
          onClose={() => setEditingPlacementId(null)}
        />
      ) : null}

      {bulkEditorOpen && progressionPatternsSupported ? (
        <HypertrophyBulkProgressionEditor
          weeks={draft.weeks}
          candidates={bulkCandidates}
          onApply={applyBulkProgression}
          onClose={() => setBulkEditorOpen(false)}
        />
      ) : null}

      {leaveState === "save_failed" ? (
        <section role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="font-semibold text-rose-900">The latest changes could not be saved.</p>
          <p className="mt-1 text-sm text-rose-800">Retry before leaving, stay here, or explicitly discard the unsaved changes.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void handleBack()}>Retry save and leave</Button>
            <Button variant="secondary" onClick={stayOnEditor}>Stay and keep editing</Button>
            <Button variant="ghost" onClick={discardAndLeave}>Discard changes and leave</Button>
          </div>
        </section>
      ) : leaveState === "incomplete" ? (
        <section role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-950">Correct the incomplete field before leaving.</p>
          <p className="mt-1 text-sm text-amber-900">The malformed text exists only in this editor and has not been saved.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={stayOnEditor}>Stay and correct it</Button>
            <Button variant="ghost" onClick={discardAndLeave}>Discard changes and leave</Button>
          </div>
        </section>
      ) : null}

      <footer className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {leaveState === "saving"
              ? "Saving the latest changes before leaving…"
              : "Autosave keeps only structurally valid weekly drafts."}
          </p>
          <Button
            variant="secondary"
            size="touch"
            disabled={leaveState === "saving"}
            onClick={() => void handleBack()}
          >
            Back to plans
          </Button>
        </div>
      </footer>
    </div>
  );
}

function IntentFields({
  exercise,
  intent,
  onChange,
}: {
  exercise: HypertrophyAuthoringExercise | undefined;
  intent: AcceptedExerciseIntentV2;
  onChange: (intent: AcceptedExerciseIntentV2) => void;
}) {
  if (!exercise) {
    return (
      <div className="text-sm text-slate-600">
        Intent: {ROLE_LABEL[intent.userRole]}
      </div>
    );
  }
  const roles: DisplayRole[] = exercise.isCompound
    ? ["PRIMARY", "SECONDARY", "SUPPORTING"]
    : ["SUPPORTING"];
  return (
    <label className="text-sm font-medium text-slate-700">
      Intent
      <select
        value={displayRole(intent)}
        onChange={(event) =>
          onChange(
            intentForDisplayRole(exercise, event.target.value as DisplayRole),
          )
        }
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {role === "PRIMARY"
              ? "Primary"
              : role === "SECONDARY"
                ? "Secondary"
                : "Supporting"}
          </option>
        ))}
      </select>
    </label>
  );
}

type PrescriptionInput = {
  sets: string;
  repKind: "EXACT" | "RANGE";
  exactReps: string;
  minReps: string;
  maxReps: string;
  rirKind: "TARGET_RANGE" | "NOT_APPLICABLE";
  minRir: string;
  maxRir: string;
};

function inputFromPrescription(
  prescription: WeeklyPrescriptionV4,
): PrescriptionInput {
  const source =
    prescription.status === "PRESCRIBE"
      ? prescription
      : defaultPrescription(prescription.week);
  if (source.status !== "PRESCRIBE") throw new Error("INVALID_PRESCRIPTION");
  return {
    sets: String(source.setCount),
    repKind: source.reps.kind,
    exactReps: source.reps.kind === "EXACT" ? String(source.reps.reps) : "10",
    minReps: source.reps.kind === "RANGE" ? String(source.reps.min) : "8",
    maxReps: source.reps.kind === "RANGE" ? String(source.reps.max) : "12",
    rirKind: source.rir.kind,
    minRir: source.rir.kind === "TARGET_RANGE" ? String(source.rir.min) : "2",
    maxRir: source.rir.kind === "TARGET_RANGE" ? String(source.rir.max) : "3",
  };
}

function parsePrescriptionInput(
  week: number,
  input: PrescriptionInput,
): WeeklyPrescriptionV4 | null {
  const setCount = Number(input.sets);
  const exactReps = Number(input.exactReps);
  const minReps = Number(input.minReps);
  const maxReps = Number(input.maxReps);
  const minRir = Number(input.minRir);
  const maxRir = Number(input.maxRir);
  const validRir = (value: number) =>
    Number.isFinite(value) && value >= 0 && value <= 10 && value * 2 % 1 === 0;
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 10) return null;
  if (
    input.repKind === "EXACT" &&
    (!Number.isInteger(exactReps) || exactReps < 1 || exactReps > 100)
  ) return null;
  if (
    input.repKind === "RANGE" &&
    (!Number.isInteger(minReps) ||
      !Number.isInteger(maxReps) ||
      minReps < 1 ||
      maxReps > 100 ||
      minReps > maxReps)
  ) return null;
  if (
    input.rirKind === "TARGET_RANGE" &&
    (!validRir(minRir) || !validRir(maxRir) || minRir > maxRir)
  ) return null;
  return {
    week,
    status: "PRESCRIBE",
    setCount,
    reps:
      input.repKind === "EXACT"
        ? { kind: "EXACT", reps: exactReps }
        : { kind: "RANGE", min: minReps, max: maxReps },
    rir:
      input.rirKind === "NOT_APPLICABLE"
        ? { kind: "NOT_APPLICABLE" }
        : { kind: "TARGET_RANGE", min: minRir, max: maxRir },
  };
}

function PrescriptionFields({
  fieldKey,
  phase,
  prescription,
  isException,
  onChange,
  onValidityChange,
}: {
  fieldKey: string;
  phase: "ACCUMULATION" | "DELOAD";
  prescription: WeeklyPrescriptionV4;
  isException: boolean;
  onChange: (prescription: WeeklyPrescriptionV4) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [input, setInput] = useState(() => inputFromPrescription(prescription));
  useEffect(
    () => () => onValidityChange(fieldKey, true),
    [fieldKey, onValidityChange],
  );

  const update = (next: PrescriptionInput) => {
    setInput(next);
    const parsed = parsePrescriptionInput(prescription.week, next);
    onValidityChange(fieldKey, Boolean(parsed));
    if (parsed) onChange(parsed);
  };

  if (prescription.status === "OMIT") {
    return (
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Week {prescription.week} · Deload</h4>
          {isException ? (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Pattern exception</span>
          ) : null}
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked
              onChange={() => {
                onValidityChange(fieldKey, true);
                onChange(parsePrescriptionInput(prescription.week, input) ?? defaultPrescription(prescription.week));
              }}
            />
            Omit
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">This placement is omitted only in the final deload.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Week {prescription.week} · {phase === "DELOAD" ? "Deload" : "Accumulation"}
          </h4>
          {isException ? (
            <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Pattern exception</span>
          ) : null}
        </div>
        {phase === "DELOAD" ? (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={false}
              onChange={() => {
                onValidityChange(fieldKey, true);
                onChange({ week: prescription.week, status: "OMIT" });
              }}
            />
            Omit
          </label>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-slate-700">
          Sets
          <input
            aria-label={`Week ${prescription.week} sets`}
            type="number"
            min={1}
            max={10}
            value={input.sets}
            onChange={(event) => update({ ...input, sets: event.target.value })}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Reps
          <select
            aria-label={`Week ${prescription.week} rep format`}
            value={input.repKind}
            onChange={(event) => update({ ...input, repKind: event.target.value as "EXACT" | "RANGE" })}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
          >
            <option value="EXACT">Exact</option>
            <option value="RANGE">Range</option>
          </select>
        </label>
        {input.repKind === "EXACT" ? (
          <label className="text-xs font-medium text-slate-700">
            Exact reps
            <input
              aria-label={`Week ${prescription.week} exact reps`}
              type="number"
              min={1}
              max={100}
              value={input.exactReps}
              onChange={(event) => update({ ...input, exactReps: event.target.value })}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
            />
          </label>
        ) : (
          <>
            <label className="text-xs font-medium text-slate-700">
              Min reps
              <input
                aria-label={`Week ${prescription.week} minimum reps`}
                type="number"
                min={1}
                max={100}
                value={input.minReps}
                onChange={(event) => update({ ...input, minReps: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Max reps
              <input
                aria-label={`Week ${prescription.week} maximum reps`}
                type="number"
                min={1}
                max={100}
                value={input.maxReps}
                onChange={(event) => update({ ...input, maxReps: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
              />
            </label>
          </>
        )}
        <label className="text-xs font-medium text-slate-700">
          RIR
          <select
            aria-label={`Week ${prescription.week} RIR format`}
            value={input.rirKind}
            onChange={(event) => update({ ...input, rirKind: event.target.value as "TARGET_RANGE" | "NOT_APPLICABLE" })}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
          >
            <option value="TARGET_RANGE">Range</option>
            <option value="NOT_APPLICABLE">Not applicable</option>
          </select>
        </label>
        {input.rirKind === "TARGET_RANGE" ? (
          <>
            <label className="text-xs font-medium text-slate-700">
              Min RIR
              <input
                aria-label={`Week ${prescription.week} minimum RIR`}
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={input.minRir}
                onChange={(event) => update({ ...input, minRir: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Max RIR
              <input
                aria-label={`Week ${prescription.week} maximum RIR`}
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={input.maxRir}
                onChange={(event) => update({ ...input, maxRir: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
              />
            </label>
          </>
        ) : null}
      </div>
    </section>
  );
}

function formatPrescription(prescription: WeeklyPrescriptionV4): string {
  if (prescription.status === "OMIT") return `W${prescription.week} omit`;
  const reps =
    prescription.reps.kind === "EXACT"
      ? `${prescription.reps.reps} reps`
      : `${prescription.reps.min}–${prescription.reps.max} reps`;
  const rir =
    prescription.rir.kind === "NOT_APPLICABLE"
      ? "RIR n/a"
      : `RIR ${prescription.rir.min}–${prescription.rir.max}`;
  return `W${prescription.week} ${prescription.setCount}×${reps}, ${rir}`;
}
