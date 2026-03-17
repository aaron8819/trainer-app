"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SplitType, WorkoutSessionIntent } from "@prisma/client";
import {
  buildOrderedFlexibleSlots,
  findIncompatibleCarryForwardKeeps,
  getAllowedIntentsForSplit,
  type NextCycleCarryForwardConflict,
  type NextCycleSeedDraft,
} from "@/lib/api/mesocycle-handoff-contract";

type MesocycleSetupEditorProps = {
  mesocycleId: string;
  recommendedDraft: NextCycleSeedDraft;
  initialDraft: NextCycleSeedDraft;
};

const SPLIT_OPTIONS: Array<{ value: SplitType; label: string }> = [
  { value: "UPPER_LOWER", label: "Upper / Lower" },
  { value: "PPL", label: "Push / Pull / Legs" },
  { value: "FULL_BODY", label: "Full Body" },
  { value: "CUSTOM", label: "Custom" },
];

const INTENT_LABELS: Record<WorkoutSessionIntent, string> = {
  PUSH: "Push",
  PULL: "Pull",
  LEGS: "Legs",
  UPPER: "Upper",
  LOWER: "Lower",
  FULL_BODY: "Full Body",
  BODY_PART: "Body Part",
};

function formatSplitType(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function buildComparableDraftSnapshot(draft: NextCycleSeedDraft): string {
  return JSON.stringify({
    structure: draft.structure,
    carryForwardSelections: draft.carryForwardSelections,
  });
}

function buildDraftDrift(input: {
  recommendedDraft: NextCycleSeedDraft;
  currentDraft: NextCycleSeedDraft;
}) {
  const changedFields: string[] = [];

  if (input.recommendedDraft.structure.splitType !== input.currentDraft.structure.splitType) {
    changedFields.push("split type");
  }
  if (
    input.recommendedDraft.structure.sessionsPerWeek !==
    input.currentDraft.structure.sessionsPerWeek
  ) {
    changedFields.push("sessions per week");
  }

  const recommendedSlots = input.recommendedDraft.structure.slots
    .map((slot) => `${slot.slotId}:${slot.intent}`)
    .join("|");
  const currentSlots = input.currentDraft.structure.slots
    .map((slot) => `${slot.slotId}:${slot.intent}`)
    .join("|");
  if (recommendedSlots !== currentSlots) {
    changedFields.push("slot sequence");
  }

  const carryForwardChangedCount = input.currentDraft.carryForwardSelections.filter((selection) => {
    const recommended = input.recommendedDraft.carryForwardSelections.find(
      (item) =>
        item.exerciseId === selection.exerciseId &&
        item.sessionIntent === selection.sessionIntent &&
        item.role === selection.role
    );
    return recommended?.action !== selection.action;
  }).length;
  if (carryForwardChangedCount > 0) {
    changedFields.push("carry-forward selections");
  }

  return {
    matchesRecommendation: changedFields.length === 0,
    changedFields,
    carryForwardChangedCount,
  };
}

function buildPreview(draft: NextCycleSeedDraft) {
  return {
    keepCount: draft.carryForwardSelections.filter((selection) => selection.action === "keep").length,
    rotateCount: draft.carryForwardSelections.filter((selection) => selection.action === "rotate").length,
    dropCount: draft.carryForwardSelections.filter((selection) => selection.action === "drop").length,
  };
}

function buildCarryForwardConflictKey(conflict: {
  exerciseId: string;
  sessionIntent: WorkoutSessionIntent;
  role: string;
}): string {
  return `${conflict.exerciseId}:${conflict.sessionIntent}:${conflict.role}`;
}

function buildCarryForwardConflictSummary(
  conflicts: NextCycleCarryForwardConflict[]
): string {
  if (conflicts.length === 1) {
    return `${conflicts[0]!.exerciseName} can no longer be kept because this draft no longer includes the ${INTENT_LABELS[conflicts[0]!.sessionIntent]} session type.`;
  }

  return `${conflicts.length} kept exercises no longer match the edited split. Each one needs its original session type to stay in the draft.`;
}

function buildCarryForwardConflictRowMessage(conflict: NextCycleCarryForwardConflict): string {
  return `This draft no longer includes the ${INTENT_LABELS[conflict.sessionIntent]} session type, so this exercise cannot stay on Keep. Change it to Rotate or Drop, or add ${INTENT_LABELS[conflict.sessionIntent]} back to the split.`;
}

function nextDraftForSessions(
  currentDraft: NextCycleSeedDraft,
  sessionsPerWeek: number
): NextCycleSeedDraft {
  const nextCount = Math.max(1, Math.min(7, sessionsPerWeek));
  const allowed = new Set(getAllowedIntentsForSplit(currentDraft.structure.splitType));
  const defaults = buildOrderedFlexibleSlots({
    splitType: currentDraft.structure.splitType,
    sessionsPerWeek: nextCount,
  });
  const currentIntents = currentDraft.structure.slots
    .map((slot) => slot.intent)
    .filter((intent) => allowed.has(intent));
  const nextIntents = Array.from({ length: nextCount }, (_, index) => currentIntents[index] ?? defaults[index]!.intent);

  return {
    ...currentDraft,
    structure: {
      ...currentDraft.structure,
      sessionsPerWeek: nextCount,
      daysPerWeek: nextCount,
      slots: buildOrderedFlexibleSlots({
        splitType: currentDraft.structure.splitType,
        sessionsPerWeek: nextCount,
        intents: nextIntents,
      }),
    },
  };
}

function nextDraftForSplit(
  currentDraft: NextCycleSeedDraft,
  splitType: SplitType
): NextCycleSeedDraft {
  const allowed = new Set(getAllowedIntentsForSplit(splitType));
  const defaults = buildOrderedFlexibleSlots({
    splitType,
    sessionsPerWeek: currentDraft.structure.sessionsPerWeek,
  });
  const preserved = currentDraft.structure.slots
    .map((slot) => slot.intent)
    .filter((intent) => allowed.has(intent));
  const nextIntents = Array.from(
    { length: currentDraft.structure.sessionsPerWeek },
    (_, index) => preserved[index] ?? defaults[index]!.intent
  );

  return {
    ...currentDraft,
    structure: {
      ...currentDraft.structure,
      splitType,
      slots: buildOrderedFlexibleSlots({
        splitType,
        sessionsPerWeek: currentDraft.structure.sessionsPerWeek,
        intents: nextIntents,
      }),
    },
  };
}

export function MesocycleSetupEditor({
  mesocycleId,
  recommendedDraft,
  initialDraft,
}: MesocycleSetupEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [lastSavedDraft, setLastSavedDraft] = useState(initialDraft);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const drift = useMemo(
    () => buildDraftDrift({ recommendedDraft, currentDraft: draft }),
    [draft, recommendedDraft]
  );
  const preview = useMemo(() => buildPreview(draft), [draft]);
  const carryForwardConflicts = useMemo(
    () =>
      findIncompatibleCarryForwardKeeps({
        slots: draft.structure.slots,
        carryForwardSelections: draft.carryForwardSelections,
      }),
    [draft]
  );
  const carryForwardConflictMap = useMemo(
    () =>
      new Map(
        carryForwardConflicts.map((conflict) => [
          buildCarryForwardConflictKey(conflict),
          conflict,
        ])
      ),
    [carryForwardConflicts]
  );
  const hasCarryForwardConflicts = carryForwardConflicts.length > 0;
  const isDirty = buildComparableDraftSnapshot(draft) !== buildComparableDraftSnapshot(lastSavedDraft);
  const allowedIntents = getAllowedIntentsForSplit(draft.structure.splitType);

  const updateDraft = (
    recipe: NextCycleSeedDraft | ((current: NextCycleSeedDraft) => NextCycleSeedDraft)
  ) => {
    setStatus(null);
    setError(null);
    setDraft(recipe);
  };

  const saveDraft = async (): Promise<boolean> => {
    if (hasCarryForwardConflicts) {
      setStatus(null);
      setError("Resolve carry-forward conflicts before saving this draft.");
      return false;
    }
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const response = await fetch(`/api/mesocycles/${mesocycleId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMesocycleId: draft.sourceMesocycleId,
          structure: draft.structure,
          carryForwardSelections: draft.carryForwardSelections,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to save draft.");
        return false;
      }

      const body = await response.json().catch(() => ({}));
      const savedDraft = body.handoff?.draft as NextCycleSeedDraft | undefined;
      if (savedDraft) {
        setDraft(savedDraft);
        setLastSavedDraft(savedDraft);
      }
      setStatus("Draft saved.");
      return true;
    } catch {
      setError("Failed to save draft.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const acceptDraft = async () => {
    if (hasCarryForwardConflicts) {
      setStatus(null);
      setError("Resolve carry-forward conflicts before accepting the next cycle.");
      return;
    }
    setAccepting(true);
    setStatus(null);
    setError(null);
    try {
      if (isDirty) {
        const saved = await saveDraft();
        if (!saved) {
          return;
        }
      }

      const response = await fetch(`/api/mesocycles/${mesocycleId}/accept-next-cycle`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to start next cycle.");
        return;
      }

      router.push("/program");
      router.refresh();
    } catch {
      setError("Failed to start next cycle.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Frozen system recommendation
          </p>
          <h2 className="mt-2 text-xl font-semibold">Conservative default</h2>
          <p className="mt-2 text-sm text-slate-700">
            {recommendedDraft.structure.sessionsPerWeek}x/week {formatSplitType(recommendedDraft.structure.splitType)}.
            This is the system recommendation saved at handoff close.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {recommendedDraft.structure.slots.map((slot, index) => (
              <div key={slot.slotId} className="rounded-xl border border-amber-200 bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Slot {index + 1}
                </p>
                <p className="mt-1 font-medium text-slate-900">{INTENT_LABELS[slot.intent]}</p>
                <p className="mt-1 text-xs text-slate-500">{slot.slotId.replace("_", " ")}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Carry forward:{" "}
            {recommendedDraft.carryForwardSelections.filter((selection) => selection.action === "keep").length} keep,{" "}
            {recommendedDraft.carryForwardSelections.filter((selection) => selection.action === "rotate").length} rotate.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Mutable draft
          </p>
          <h2 className="mt-2 text-xl font-semibold">Current editable setup</h2>
          <p className="mt-2 text-sm text-slate-600">
            Save changes into <code>nextSeedDraftJson</code> before you accept the next cycle.
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {drift.matchesRecommendation ? (
              <p>Current draft still matches the system recommendation.</p>
            ) : (
              <p>
                Draft differs from recommendation: {drift.changedFields.join(", ")}.
                {drift.carryForwardChangedCount > 0
                  ? ` ${drift.carryForwardChangedCount} carry-forward actions changed.`
                  : ""}
              </p>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Split type
              <select
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                value={draft.structure.splitType}
                onChange={(event) =>
                  updateDraft((current) => nextDraftForSplit(current, event.target.value as SplitType))
                }
              >
                {SPLIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Sessions per week
              <input
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                type="number"
                min={1}
                max={7}
                value={draft.structure.sessionsPerWeek}
                onChange={(event) =>
                  updateDraft((current) =>
                    nextDraftForSessions(current, Number.parseInt(event.target.value, 10) || 1)
                  )
                }
              />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Training structure
        </p>
        <h2 className="mt-2 text-xl font-semibold">Ordered flexible slot sequence</h2>
        <p className="mt-2 text-sm text-slate-600">
          The order stays fixed, but the week can stay flexible. Change the intent in each slot if
          you want a different sequence.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {draft.structure.slots.map((slot, index) => (
            <div key={`${slot.slotId}:${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Slot {index + 1}
              </p>
              <p className="mt-1 text-xs text-slate-500">{slot.slotId.replace("_", " ")}</p>
              <select
                className="mt-3 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                value={slot.intent}
                onChange={(event) =>
                  updateDraft((current) => {
                    const nextIntents = current.structure.slots.map((entry) => entry.intent);
                    nextIntents[index] = event.target.value as WorkoutSessionIntent;
                    return {
                      ...current,
                      structure: {
                        ...current.structure,
                        slots: buildOrderedFlexibleSlots({
                          splitType: current.structure.splitType,
                          sessionsPerWeek: current.structure.sessionsPerWeek,
                          intents: nextIntents,
                        }),
                      },
                    };
                  })
                }
              >
                {allowedIntents.map((intent) => (
                  <option key={intent} value={intent}>
                    {INTENT_LABELS[intent]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Exercise carry-forward
        </p>
        <h2 className="mt-2 text-xl font-semibold">Keep, rotate, or drop</h2>
        <p className="mt-2 text-sm text-slate-600">
          The recommendation stays visible. Your draft only changes the action taken for the next cycle.
        </p>
        {hasCarryForwardConflicts ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">Carry-forward conflicts need to be resolved before save or accept.</p>
            <p className="mt-1">{buildCarryForwardConflictSummary(carryForwardConflicts)}</p>
            <p className="mt-2 text-rose-800">
              Change the affected exercises to Rotate or Drop, or restore the missing session type in the split.
            </p>
          </div>
        ) : null}
        <div className="mt-5 space-y-3">
          {draft.carryForwardSelections.map((selection) => {
            const recommended = recommendedDraft.carryForwardSelections.find(
              (item) =>
                item.exerciseId === selection.exerciseId &&
                item.sessionIntent === selection.sessionIntent &&
                item.role === selection.role
            );
            const conflict = carryForwardConflictMap.get(
              buildCarryForwardConflictKey(selection)
            );

            return (
              <div
                key={`${selection.exerciseId}:${selection.sessionIntent}:${selection.role}`}
                className={`rounded-xl border p-4 ${
                  conflict ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{selection.exerciseName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {INTENT_LABELS[selection.sessionIntent]} • {selection.role.toLowerCase().replace("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      System recommendation: {recommended?.action ?? "rotate"}
                    </p>
                    {conflict ? (
                      <p className="mt-2 text-sm text-rose-800">
                        {buildCarryForwardConflictRowMessage(conflict)}
                      </p>
                    ) : null}
                  </div>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    Draft action
                    <select
                      className="h-11 w-full min-w-40 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      value={selection.action}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          carryForwardSelections: current.carryForwardSelections.map((item) =>
                            item.exerciseId === selection.exerciseId &&
                            item.sessionIntent === selection.sessionIntent &&
                            item.role === selection.role
                              ? {
                                  ...item,
                                  action: event.target.value as "keep" | "rotate" | "drop",
                                }
                              : item
                          ),
                        }))
                      }
                    >
                      <option value="keep">Keep</option>
                      <option value="rotate">Rotate</option>
                      <option value="drop">Drop</option>
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Summary preview
        </p>
        <h2 className="mt-2 text-xl font-semibold">If you accept now</h2>
        <p className="mt-2 text-sm text-slate-600">
          The next mesocycle will start as {draft.structure.sessionsPerWeek}x/week{" "}
          {formatSplitType(draft.structure.splitType)} with this ordered slot sequence.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl bg-slate-50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sequence</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {draft.structure.slots.map((slot, index) => (
                <div key={slot.slotId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Slot {index + 1}
                  </p>
                  <p className="mt-1 font-medium text-slate-900">{INTENT_LABELS[slot.intent]}</p>
                  <p className="mt-1 text-xs text-slate-500">{slot.slotId.replace("_", " ")}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Carry-forward mix
            </h3>
            <p className="mt-4 text-sm text-slate-700">
              {preview.keepCount} keep • {preview.rotateCount} rotate • {preview.dropCount} drop
            </p>
            <p className="mt-2 text-sm text-slate-700">
              Default starting point stays conservative productive, excluding deload from baseline.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <button
            type="button"
            className="h-11 rounded-full border border-slate-300 px-6 text-sm font-semibold text-slate-900 disabled:opacity-60"
            onClick={() => void saveDraft()}
            disabled={saving || accepting || hasCarryForwardConflicts}
          >
            {saving ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            className="h-11 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => void acceptDraft()}
            disabled={saving || accepting || hasCarryForwardConflicts}
          >
            {accepting ? "Starting..." : "Accept and create next cycle"}
          </button>
          {isDirty ? <span className="text-sm text-amber-700">Unsaved changes</span> : null}
          {hasCarryForwardConflicts ? (
            <span className="text-sm text-rose-700">
              Resolve {carryForwardConflicts.length} carry-forward conflict
              {carryForwardConflicts.length === 1 ? "" : "s"} to save or accept.
            </span>
          ) : null}
          {status ? <span className="text-sm text-emerald-600">{status}</span> : null}
          {error ? <span className="text-sm text-rose-600">{error}</span> : null}
        </div>
      </section>
    </div>
  );
}
