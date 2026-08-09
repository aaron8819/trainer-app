"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  isExerciseEligibleForIntent,
  type AcceptedExerciseIntentV2,
  type HypertrophyPlanDraftV2,
  type HypertrophySessionFocus,
  type HypertrophyUserRole,
  type WeeklyPrescriptionV4,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  CANONICAL_MUSCLE_IDS,
  MUSCLE_POLICY_BY_ID,
  type CanonicalMuscleId,
} from "@/lib/engine/muscle-policy";
import { CANONICAL_MOVEMENT_PATTERN_VALUES } from "@/lib/engine/types";
import type {
  HypertrophyPlanEditorDataV2,
  HypertrophyPlanV4Preview,
} from "@/lib/api/hypertrophy-plan-drafts";

type WeeklyEditorData = HypertrophyPlanEditorDataV2;
type SaveState = "saved" | "saving" | "failed" | "incomplete";

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

function defaultIntent(role: HypertrophyUserRole): AcceptedExerciseIntentV2 {
  return role === "PRIMARY_LIFT" || role === "SECONDARY_LIFT"
    ? {
        userRole: role,
        target: {
          kind: "movement_pattern",
          movementPattern: "horizontal_push",
        },
      }
    : {
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

function reconfigureWeeks(
  draft: HypertrophyPlanDraftV2,
  accumulationWeekCount: number,
  includeDeload: boolean,
): HypertrophyPlanDraftV2 {
  const oldAccumulationCount = draft.weeks.filter(
    (week) => week.phase === "ACCUMULATION",
  ).length;
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
        const lastAccumulation =
          exercise.prescriptions[Math.max(0, oldAccumulationCount - 1)];
        const oldDeload =
          oldDeloadIndex >= 0
            ? exercise.prescriptions[oldDeloadIndex]
            : undefined;
        return {
          ...exercise,
          prescriptions: weeks.map((week) =>
            week.phase === "DELOAD"
              ? oldDeload
                ? { ...oldDeload, week: week.week }
                : prescriptionForWeek(lastAccumulation, week.week)
              : prescriptionForWeek(
                  exercise.prescriptions[week.week - 1] ?? lastAccumulation,
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
  }>;
}

export function WeeklyHypertrophyPlanEditor({
  initialData,
}: {
  initialData: WeeklyEditorData;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialData.name);
  const [draft, setDraft] = useState(initialData.draft);
  const [revision, setRevision] = useState(initialData.revision);
  const [preview, setPreview] = useState(initialData.preview);
  const [selectedSlotId, setSelectedSlotId] = useState(
    initialData.draft.sessions[0]!.slotId,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [weekCountInput, setWeekCountInput] = useState(
    String(
      initialData.draft.weeks.filter(
        (week) => week.phase === "ACCUMULATION",
      ).length,
    ),
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newIntent, setNewIntent] = useState<AcceptedExerciseIntentV2>(
    defaultIntent("PRIMARY_LIFT"),
  );
  const [newExerciseId, setNewExerciseId] = useState("");

  const lastSavedSignature = useRef(
    JSON.stringify({ name: initialData.name, draft: initialData.draft }),
  );
  const currentSignature = JSON.stringify({ name, draft });
  const unsaved = currentSignature !== lastSavedSignature.current;
  const inFlight = useRef(false);
  const queued = useRef(false);
  const invalidFieldCount = invalidFields.size;
  const invalidFieldCountRef = useRef(invalidFieldCount);
  invalidFieldCountRef.current = invalidFieldCount;
  const latest = useRef({ name, draft, revision });
  latest.current = { name, draft, revision };

  const selectedIndex = Math.max(
    0,
    draft.sessions.findIndex((session) => session.slotId === selectedSlotId),
  );
  const session = draft.sessions[selectedIndex]!;
  const includeDeload = draft.weeks.at(-1)?.phase === "DELOAD";
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

  const save = useCallback(async () => {
    if (invalidFieldCountRef.current > 0) {
      setSaveState("incomplete");
      return false;
    }
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
      setPreview(body.preview);
      setSaveState("saved");
      return true;
    } catch {
      setError("Could not save the weekly draft.");
      setSaveState("failed");
      return false;
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        window.setTimeout(() => void save(), 0);
      }
    }
  }, [initialData.planId]);

  useEffect(() => {
    if (invalidFieldCount > 0) {
      setSaveState("incomplete");
      return;
    }
    if (!unsaved || saveState === "failed") return;
    setSaveState("saving");
    const timer = window.setTimeout(() => void save(), 750);
    return () => window.clearTimeout(timer);
  }, [currentSignature, invalidFieldCount, save, saveState, unsaved]);

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
        .filter((exercise) =>
          isExerciseEligibleForIntent({
            exercise,
            intent: newIntent,
            equipmentProfile: draft.settings.equipmentProfile,
            limitationKeys: initialData.limitationKeys,
          }),
        )
        .sort(
          (left, right) =>
            Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite)) ||
            left.name.localeCompare(right.name),
        ),
    [
      draft.settings.equipmentProfile,
      initialData.exercises,
      initialData.limitationKeys,
      newIntent,
    ],
  );

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
      !window.confirm(`Remove “${session.name}” and all of its prescriptions?`)
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
        {
          placementId: crypto.randomUUID(),
          exerciseId: newExerciseId,
          intent: newIntent,
          prescriptions: draft.weeks.map((week) =>
            defaultPrescription(week.week),
          ),
        },
      ],
    }));
    setNewExerciseId("");
    setShowAdd(false);
  };

  const previewCurrent =
    !unsaved && invalidFieldCount === 0 && saveState === "saved";

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
                saveState === "failed" || saveState === "incomplete"
                  ? "text-rose-700"
                  : "text-slate-600"
              }
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "failed"
                  ? "Save failed"
                  : saveState === "incomplete"
                    ? "Incomplete — not saved"
                    : "Saved"}
            </span>
            {saveState === "failed" ? (
              <Button size="touch" variant="secondary" onClick={() => void save()}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Draft and preview only. Weekly plans cannot be finalized, activated, or used for workouts.
        </p>
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

          <div className="mt-5 space-y-4">
            {session.exercises.map((row, exerciseIndex) => {
              const exercise = exerciseById.get(row.exerciseId);
              return (
                <article key={row.placementId} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-950">
                        {exercise?.name ?? "Unavailable exercise"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Stable placement · {ROLE_LABEL[row.intent.userRole]}
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
                            }),
                          }))
                        }
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
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
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                          ))}
                      </select>
                    </label>
                    <IntentFields
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
                        key={`${row.placementId}-${prescription.week}`}
                        fieldKey={`${row.placementId}-${prescription.week}`}
                        phase={draft.weeks[prescriptionIndex]!.phase}
                        prescription={prescription}
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

                  <Button
                    variant="ghost"
                    size="touch"
                    className="mt-3 text-rose-700"
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
                </article>
              );
            })}
          </div>

          {showAdd ? (
            <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <h3 className="font-semibold text-slate-900">Add exercise placement</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <IntentFields intent={newIntent} onChange={(intent) => {
                  setNewIntent(intent);
                  setNewExerciseId("");
                }} />
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

        <aside className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-950">Normalized preview</h2>
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
            </div>
          )}
        </aside>
      </div>

      <footer className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Autosave keeps only structurally valid weekly drafts.</p>
          <Button variant="secondary" size="touch" onClick={() => router.push("/plans")}>Back to plans</Button>
        </div>
      </footer>
    </div>
  );
}

function IntentFields({
  intent,
  onChange,
}: {
  intent: AcceptedExerciseIntentV2;
  onChange: (intent: AcceptedExerciseIntentV2) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">
        Role
        <select
          value={intent.userRole}
          onChange={(event) =>
            onChange(defaultIntent(event.target.value as HypertrophyUserRole))
          }
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
        >
          {Object.entries(ROLE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {intent.target.kind === "movement_pattern" ? (
        <label className="text-sm font-medium text-slate-700">
          Target
          <select
            value={intent.target.movementPattern}
            onChange={(event) =>
              onChange({
                ...intent,
                target: {
                  kind: "movement_pattern",
                  movementPattern: event.target.value as (typeof CANONICAL_MOVEMENT_PATTERN_VALUES)[number],
                },
              })
            }
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
          >
            {CANONICAL_MOVEMENT_PATTERN_VALUES.map((value) => (
              <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
      ) : (
        <label className="text-sm font-medium text-slate-700">
          Target
          <select
            value={intent.target.muscleId}
            onChange={(event) =>
              onChange({
                ...intent,
                target: {
                  kind: "muscle",
                  muscleId: event.target.value as CanonicalMuscleId,
                },
              })
            }
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
          >
            {CANONICAL_MUSCLE_IDS.map((value) => (
              <option key={value} value={value}>{MUSCLE_POLICY_BY_ID[value].displayName}</option>
            ))}
          </select>
        </label>
      )}
    </div>
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
  onChange,
  onValidityChange,
}: {
  fieldKey: string;
  phase: "ACCUMULATION" | "DELOAD";
  prescription: WeeklyPrescriptionV4;
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
        <h4 className="text-sm font-semibold text-slate-900">
          Week {prescription.week} · {phase === "DELOAD" ? "Deload" : "Accumulation"}
        </h4>
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
            className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Reps
          <select
            aria-label={`Week ${prescription.week} rep format`}
            value={input.repKind}
            onChange={(event) => update({ ...input, repKind: event.target.value as "EXACT" | "RANGE" })}
            className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
              className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
            className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-2"
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
