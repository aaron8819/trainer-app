"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FinisherLibraryItemDto } from "@/lib/api/finisher-library-service";
import { FinisherRoutinePreview } from "./FinisherRoutinePreview";
import { Button, buttonClassName } from "@/components/ui/Button";
import { buildFinisherEditorPreview } from "@/lib/ui/finisher-routine-editor";
import {
  FINISHER_BODY_REGION_VALUES,
  finisherRoutineDefinitionSchema,
  type FinisherRoutineDefinition,
} from "@/lib/validation";
import { CANONICAL_LIMITATION_TAGS } from "@/lib/engine/limitation-policy";

type EditorStep = FinisherRoutineDefinition["steps"][number];

const EMPTY_DEFINITION: FinisherRoutineDefinition = {
  name: "",
  description: "",
  category: "CORE",
  difficulty: "MODERATE",
  fatigueCost: "MODERATE",
  impactLevel: "LOW",
  bodyRegions: ["core"],
  limitationTags: [],
  preparationSeconds: 10,
  includesFinalRecovery: false,
  steps: [
    {
      movementName: "",
      workSeconds: 40,
      recoverySeconds: 20,
      techniqueCues: [],
      alternatives: [],
    },
  ],
};

function definitionFromItem(
  item: FinisherLibraryItemDto | undefined,
): FinisherRoutineDefinition {
  if (!item) return EMPTY_DEFINITION;
  const routine = item.routine;
  return {
    name: routine.name,
    description: routine.description,
    category: routine.category,
    difficulty: routine.difficulty,
    fatigueCost: routine.fatigueCost,
    impactLevel: routine.impactLevel,
    bodyRegions:
      routine.bodyRegions as FinisherRoutineDefinition["bodyRegions"],
    limitationTags:
      routine.limitationTags as FinisherRoutineDefinition["limitationTags"],
    preparationSeconds: routine.preparationSeconds,
    includesFinalRecovery: routine.includesFinalRecovery,
    steps: routine.steps.map((step) => ({
      movementName: step.movementName,
      workSeconds: step.workSeconds,
      recoverySeconds: step.recoverySeconds,
      techniqueCues: step.techniqueCues,
      alternatives: step.alternatives.map(
        (alternative) => alternative.movementName,
      ),
    })),
  };
}

function compactDefinition(
  definition: FinisherRoutineDefinition,
): FinisherRoutineDefinition {
  return {
    ...definition,
    name: definition.name.trim(),
    description: definition.description.trim(),
    steps: definition.steps.map((step) => ({
      ...step,
      movementName: step.movementName.trim(),
      techniqueCues: step.techniqueCues
        .map((value) => value.trim())
        .filter(Boolean),
      alternatives: step.alternatives
        .map((value) => value.trim())
        .filter(Boolean),
    })),
  };
}

function listInputValue(values: string[], index: number): string {
  return values[index] ?? "";
}

function setListInputValue(
  values: string[],
  index: number,
  value: string,
): string[] {
  const next = Array.from(
    { length: Math.max(values.length, index + 1) },
    (_, currentIndex) => values[currentIndex] ?? "",
  );
  next[index] = value;
  return next;
}

const BODY_REGION_LABELS: Record<
  (typeof FINISHER_BODY_REGION_VALUES)[number],
  string
> = {
  core: "Core",
  shoulders: "Shoulders",
  hips: "Hips",
  full_body: "Full body",
  legs: "Legs",
};

export function FinisherRoutineEditor({
  mode,
  item,
  activeLimitations,
}: {
  mode: "create" | "edit";
  item?: FinisherLibraryItemDto;
  activeLimitations: string[];
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState(() => definitionFromItem(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compact = useMemo(() => compactDefinition(definition), [definition]);
  const preview = useMemo(
    () =>
      buildFinisherEditorPreview({
        definition: compact,
        activeLimitations,
        existing: item?.routine,
      }),
    [activeLimitations, compact, item?.routine],
  );
  const validation = finisherRoutineDefinitionSchema.safeParse(compact);

  const updateStep = (index: number, update: Partial<EditorStep>) => {
    setDefinition((current) => ({
      ...current,
      steps: current.steps.map((step, currentIndex) =>
        currentIndex === index ? { ...step, ...update } : step,
      ),
    }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= definition.steps.length) return;
    setDefinition((current) => {
      const steps = [...current.steps];
      [steps[index], steps[destination]] = [
        steps[destination]!,
        steps[index]!,
      ];
      return { ...current, steps };
    });
  };

  const save = async () => {
    setError(null);
    const parsed = finisherRoutineDefinitionSchema.safeParse(compact);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the routine fields.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        mode === "create" ? "/api/finishers" : `/api/finishers/${item!.routineId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            definition: parsed.data,
            ...(mode === "edit"
              ? { expectedRevision: item!.revision }
              : {}),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (!response.ok) {
        setError(
          body.code === "FINISHER_LIBRARY_STALE"
            ? "This finisher changed in another tab. Reload before saving."
            : "Could not save this finisher.",
        );
        return;
      }
      router.push("/settings/finishers");
      router.refresh();
    } catch {
      setError("Could not save this finisher.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-slate-950">Routine details</h2>
          <p className="mt-1 text-sm text-slate-600">
            Placement, phase kind, and protocol stay fixed as post-workout timed intervals.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-800 sm:col-span-2">
              Name
              <input
                value={definition.name}
                maxLength={80}
                onChange={(event) =>
                  setDefinition((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
              />
            </label>
            <label className="text-sm font-medium text-slate-800 sm:col-span-2">
              Description
              <textarea
                value={definition.description}
                maxLength={500}
                rows={3}
                onChange={(event) =>
                  setDefinition((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-base"
              />
            </label>
            {(
              [
                ["category", "Category", ["CORE", "CONDITIONING"]],
                ["difficulty", "Difficulty", ["EASY", "MODERATE", "CHALLENGING"]],
                ["fatigueCost", "Fatigue cost", ["LOW", "MODERATE", "HIGH"]],
                ["impactLevel", "Impact level", ["LOW", "MODERATE", "HIGH"]],
              ] as const
            ).map(([field, label, values]) => (
              <label className="text-sm font-medium text-slate-800" key={field}>
                {label}
                <select
                  value={definition[field]}
                  onChange={(event) =>
                    setDefinition((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                >
                  {values.map((value) => (
                    <option key={value} value={value}>
                      {value.toLowerCase().replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="text-sm font-medium text-slate-800">
              Preparation seconds
              <input
                type="number"
                min={0}
                max={60}
                value={definition.preparationSeconds}
                onChange={(event) =>
                  setDefinition((current) => ({
                    ...current,
                    preparationSeconds: Number(event.target.value),
                  }))
                }
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={definition.includesFinalRecovery}
                onChange={(event) =>
                  setDefinition((current) => ({
                    ...current,
                    includesFinalRecovery: event.target.checked,
                  }))
                }
              />
              Include final recovery
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-slate-950">Safety context</h2>
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold text-slate-800">Body regions</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {FINISHER_BODY_REGION_VALUES.map((value) => (
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={value}>
                  <input
                    type="checkbox"
                    checked={definition.bodyRegions.includes(value)}
                    onChange={(event) =>
                      setDefinition((current) => ({
                        ...current,
                        bodyRegions: event.target.checked
                          ? [...current.bodyRegions, value]
                          : current.bodyRegions.filter((item) => item !== value),
                      }))
                    }
                  />
                  {BODY_REGION_LABELS[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold text-slate-800">Limitation tags</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CANONICAL_LIMITATION_TAGS.map((value) => (
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={value}>
                  <input
                    type="checkbox"
                    checked={definition.limitationTags.includes(value)}
                    onChange={(event) =>
                      setDefinition((current) => ({
                        ...current,
                        limitationTags: event.target.checked
                          ? [...current.limitationTags, value]
                          : current.limitationTags.filter((item) => item !== value),
                      }))
                    }
                  />
                  {value.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Timed steps</h2>
              <p className="mt-1 text-sm text-slate-600">Add 1–20 steps in performance order.</p>
            </div>
            <Button
              variant="secondary"
              size="touch"
              disabled={definition.steps.length >= 20}
              onClick={() =>
                setDefinition((current) => ({
                  ...current,
                  steps: [
                    ...current.steps,
                    {
                      movementName: "",
                      workSeconds: 40,
                      recoverySeconds: 20,
                      techniqueCues: [],
                      alternatives: [],
                    },
                  ],
                }))
              }
            >
              Add step
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {definition.steps.map((step, index) => (
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4" key={index}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">Step {index + 1}</h3>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={`Move step ${index + 1} up`}>↑</Button>
                    <Button variant="ghost" size="sm" disabled={index === definition.steps.length - 1} onClick={() => moveStep(index, 1)} aria-label={`Move step ${index + 1} down`}>↓</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={definition.steps.length === 1}
                      onClick={() =>
                        setDefinition((current) => ({
                          ...current,
                          steps: current.steps.filter((_, currentIndex) => currentIndex !== index),
                        }))
                      }
                      className="text-rose-700"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-800 sm:col-span-2">
                    Movement
                    <input
                      value={step.movementName}
                      maxLength={120}
                      onChange={(event) => updateStep(index, { movementName: event.target.value })}
                      className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Work seconds
                    <input type="number" min={1} max={600} value={step.workSeconds} onChange={(event) => updateStep(index, { workSeconds: Number(event.target.value) })} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Recovery seconds
                    <input type="number" min={0} max={600} value={step.recoverySeconds} onChange={(event) => updateStep(index, { recoverySeconds: Number(event.target.value) })} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Technique cues (up to 3)</p>
                    {[0, 1, 2].map((cueIndex) => (
                      <input
                        key={cueIndex}
                        value={listInputValue(step.techniqueCues, cueIndex)}
                        maxLength={160}
                        aria-label={`Step ${index + 1} cue ${cueIndex + 1}`}
                        onChange={(event) => updateStep(index, { techniqueCues: setListInputValue(step.techniqueCues, cueIndex, event.target.value) })}
                        className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                      />
                    ))}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">Predefined alternatives (up to 3)</p>
                    {[0, 1, 2].map((alternativeIndex) => (
                      <input
                        key={alternativeIndex}
                        value={listInputValue(step.alternatives, alternativeIndex)}
                        maxLength={160}
                        aria-label={`Step ${index + 1} alternative ${alternativeIndex + 1}`}
                        onChange={(event) => updateStep(index, { alternatives: setListInputValue(step.alternatives, alternativeIndex, event.target.value) })}
                        className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
                      />
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="touch" disabled={saving || !validation.success} onClick={save}>
            {saving ? "Saving…" : mode === "create" ? "Create finisher" : "Save new version"}
          </Button>
          <Link href="/settings/finishers" className={buttonClassName({ variant: "secondary", size: "touch" })}>
            Cancel
          </Link>
        </div>
      </div>

      <aside className="self-start rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-24">
        <FinisherRoutinePreview routine={preview} />
        {preview.warnings.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        <p className={`mt-4 text-sm font-medium ${preview.durationSeconds > 1800 ? "text-rose-700" : "text-slate-600"}`}>
          {preview.durationSeconds > 1800
            ? "Reduce step timing to stay within 30 minutes."
            : "Duration is computed from ordered work and included recovery intervals."}
        </p>
      </aside>
    </div>
  );
}
