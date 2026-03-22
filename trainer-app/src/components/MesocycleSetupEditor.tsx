"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SplitType, WorkoutSessionIntent } from "@prisma/client";
import {
  buildOrderedFlexibleSlots,
  findIncompatibleCarryForwardKeeps,
  getAllowedIntentsForSplit,
  type NextCycleCarryForwardConflict,
  type NextCycleSeedDraft,
} from "@/lib/api/mesocycle-handoff-contract";
import type { FrozenRecommendationPresentation } from "@/lib/api/mesocycle-handoff-presentation";
import type { MesocycleSetupPreview } from "@/lib/api/mesocycle-setup";

type MesocycleSetupEditorProps = {
  mesocycleId: string;
  recommendation: FrozenRecommendationPresentation;
  frozenRecommendationDraft: NextCycleSeedDraft;
  initialDraft: NextCycleSeedDraft;
  initialPreview: MesocycleSetupPreview;
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
    return `${conflicts[0]!.exerciseName} can no longer be kept because this draft does not include the ${INTENT_LABELS[conflicts[0]!.sessionIntent]} session type.`;
  }

  return `${conflicts.length} kept exercises no longer match this draft. Set them to Rotate or Drop to continue.`;
}

function buildCarryForwardConflictRowMessage(conflict: NextCycleCarryForwardConflict): string {
  return `This draft does not include the ${INTENT_LABELS[conflict.sessionIntent]} session type for this keep. Change it to Rotate or Drop to continue.`;
}

function formatRoleLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
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
  recommendation,
  frozenRecommendationDraft,
  initialDraft,
  initialPreview,
}: MesocycleSetupEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [lastSavedDraft, setLastSavedDraft] = useState(initialDraft);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [showSuccessorPreview, setShowSuccessorPreview] = useState(false);
  const [preview, setPreview] = useState(initialPreview);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const drift = useMemo(
    () => buildDraftDrift({ recommendedDraft: frozenRecommendationDraft, currentDraft: draft }),
    [draft, frozenRecommendationDraft]
  );
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
  const initialDraftSnapshot = buildComparableDraftSnapshot(initialDraft);

  useEffect(() => {
    const draftSnapshot = buildComparableDraftSnapshot(draft);

    if (hasCarryForwardConflicts) {
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    if (draftSnapshot === initialDraftSnapshot) {
      setPreview(initialPreview);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const response = await fetch(`/api/mesocycles/${mesocycleId}/setup-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceMesocycleId: draft.sourceMesocycleId,
            structure: draft.structure,
            carryForwardSelections: draft.carryForwardSelections,
          }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (!controller.signal.aborted) {
            setPreviewError(body.error ?? "Failed to refresh preview.");
          }
          return;
        }

        if (!controller.signal.aborted && body.preview) {
          setPreview(body.preview as MesocycleSetupPreview);
          setPreviewError(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPreviewError("Failed to refresh preview.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      }
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [draft, hasCarryForwardConflicts, initialDraftSnapshot, initialPreview, mesocycleId]);

  const updateDraft = (
    recipe: NextCycleSeedDraft | ((current: NextCycleSeedDraft) => NextCycleSeedDraft)
  ) => {
    setStatus(null);
    setError(null);
    setDraft(recipe);
  };

  const fixAllCarryForwardConflicts = () => {
    if (!hasCarryForwardConflicts) {
      return;
    }

    const conflictKeys = new Set(
      carryForwardConflicts.map((conflict) => buildCarryForwardConflictKey(conflict))
    );
    updateDraft((current) => ({
      ...current,
      carryForwardSelections: current.carryForwardSelections.map((selection) =>
        conflictKeys.has(buildCarryForwardConflictKey(selection))
          ? {
              ...selection,
              action: "rotate",
            }
          : selection
      ),
    }));
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
          <h2 className="mt-2 text-xl font-semibold">Evidence-based design baseline</h2>
          <p className="mt-2 text-sm text-slate-700">
            {recommendation.summary}
          </p>
          {recommendation.structureReasons.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Why the system recommended this design
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {recommendation.structureReasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {frozenRecommendationDraft.structure.slots.map((slot, index) => (
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
            {recommendation.carryForwardSummary}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {recommendation.startingPointSummary}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Editable override draft
          </p>
          <h2 className="mt-2 text-xl font-semibold">Draft override inputs</h2>
          <p className="mt-2 text-sm text-slate-600">
            Edit the pending setup draft here. This draft is your override of the frozen system
            recommendation. Preview and Accept both continue from the current draft against the
            same handoff baseline.
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {drift.matchesRecommendation ? (
              <p>Current draft still matches the system recommendation.</p>
            ) : (
              <p>
                Current draft overrides the system recommendation for: {drift.changedFields.join(", ")}.
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
        <h2 className="mt-2 text-xl font-semibold">Editable slot order</h2>
        <p className="mt-2 text-sm text-slate-600">
          {recommendation.slotOrderSummary} Change the intent in each slot only if you want a
          different next-cycle sequence than the system recommendation.
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
          These are the evidence-based carry-forward decisions saved at handoff. Your draft can
          override what happens before the next cycle is accepted.
        </p>
        {hasCarryForwardConflicts ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">Carry-forward conflicts need to be resolved before save or accept.</p>
            <p className="mt-1">{buildCarryForwardConflictSummary(carryForwardConflicts)}</p>
            <p className="mt-2 text-rose-800">
              Set the conflicting keeps to Rotate or Drop to continue. You can fine-tune them after that.
            </p>
            <button
              type="button"
              className="mt-3 inline-flex h-10 items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-900"
              onClick={fixAllCarryForwardConflicts}
            >
              Fix all conflicts
            </button>
          </div>
        ) : null}
        <div className="mt-5 space-y-3">
          {draft.carryForwardSelections.map((selection) => {
            const recommended = frozenRecommendationDraft.carryForwardSelections.find(
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
                      {INTENT_LABELS[selection.sessionIntent]} / {selection.role.toLowerCase().replace("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      System decision: {recommended?.action ?? "rotate"} from handoff evidence
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
          Setup preview
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Projected next-cycle setup</h2>
            <p className="mt-2 text-sm text-slate-600">
              This is the server-owned projection of what Accept would create from the current
              draft. No mesocycle has been created yet.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-900"
            aria-expanded={showSuccessorPreview}
            onClick={() => setShowSuccessorPreview((current) => !current)}
          >
            {showSuccessorPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {hasCarryForwardConflicts
            ? "Resolve carry-forward conflicts to refresh the server projection for this draft."
            : `${preview.summary.title} is currently projected from this draft as ${preview.summary.sessionsPerWeek}x/week ${formatSplitType(preview.summary.splitType)}.`}
        </p>
        <div className="mt-4 rounded-2xl bg-slate-50 p-5">
          {hasCarryForwardConflicts ? (
            <p className="text-sm text-rose-800">
              Preview refresh is paused until the current draft is valid.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-900">
                {preview.summary.keepCount} keep / {preview.summary.rotateCount} rotate /{" "}
                {preview.summary.dropCount} drop
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Session plans in this preview are projected server-side from the same handoff
                baseline used by Accept.
              </p>
              {previewLoading ? (
                <p className="mt-2 text-sm text-slate-500">Refreshing preview from server...</p>
              ) : null}
              {previewError ? (
                <p className="mt-2 text-sm text-rose-700">{previewError}</p>
              ) : null}
            </>
          )}
        </div>

        {showSuccessorPreview ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Mesocycle
              </h3>
              <p className="mt-4 text-lg font-semibold text-slate-900">{preview.summary.title}</p>
              <p className="mt-2 text-sm text-slate-700">Focus: {preview.summary.focus}</p>
              <p className="mt-2 text-sm text-slate-700">
                Split: {formatSplitType(preview.summary.splitType)}
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Frequency: {preview.summary.sessionsPerWeek} sessions per week
              </p>
              <p className="mt-2 text-sm text-slate-700">
                {recommendation.startingPointSummary}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Session slots
              </h3>
              {hasCarryForwardConflicts ? (
                <p className="mt-4 text-sm text-rose-800">
                  Resolve carry-forward conflicts to view the projected server slot-plan preview.
                </p>
              ) : previewError ? (
                <p className="mt-4 text-sm text-rose-800">{previewError}</p>
              ) : preview.slotPlanError ? (
                <p className="mt-4 text-sm text-rose-800">{preview.slotPlanError}</p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {preview.display.projectedSlotPlans.map((slot) => (
                    <div key={slot.slotId} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {slot.slotId.replace("_", " ")}
                          </p>
                          <p className="mt-1 font-medium text-slate-900">{slot.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{INTENT_LABELS[slot.intent]}</p>
                        </div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {slot.exercises.length} projected exercise
                          {slot.exercises.length === 1 ? "" : "s"}
                        </p>
                      </div>

                      {slot.exercises.length > 0 ? (
                        <div className="mt-4 space-y-2">
                          {slot.exercises.map((exercise) => (
                            <div
                              key={`${slot.slotId}:${exercise.exerciseId}:${exercise.role}`}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                            >
                              <p className="text-sm font-medium text-slate-900">
                                {exercise.exerciseName}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatRoleLabel(exercise.role)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-slate-600">
                          This projected session is currently empty for the active draft.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

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
          {isDirty ? (
            <span className="text-sm text-amber-700">
              Accept will save the current setup draft before creating the next cycle.
            </span>
          ) : null}
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
