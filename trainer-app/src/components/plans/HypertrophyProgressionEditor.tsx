"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import type {
  HypertrophyPlanWeekV4,
  RepTargetV4,
  RirTargetV4,
  WeeklyPrescriptionV4,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  materializeBulkHypertrophyPrescriptionPattern,
  materializeHypertrophyPrescriptionPattern,
  recognizeHypertrophyPrescriptionPattern,
  type AccumulationEffortPattern,
  type DeloadPrescriptionPattern,
  type HypertrophyPrescriptionPattern,
} from "@/lib/engine/hypertrophy-prescription-patterns";

type RirInput = {
  kind: "TARGET_RANGE" | "NOT_APPLICABLE";
  min: string;
  max: string;
};

type PatternForm = {
  sets: string;
  repKind: "EXACT" | "RANGE";
  exactReps: string;
  minReps: string;
  maxReps: string;
  effortKind: "STANDARD" | "STABLE" | "CUSTOM";
  stableRir: RirInput;
  customRir: RirInput[];
  deloadKind: "REDUCED_SETS" | "MAINTAIN" | "OMIT" | "CUSTOM";
  deloadSets: string;
};

function rirInput(rir: RirTargetV4): RirInput {
  return rir.kind === "NOT_APPLICABLE"
    ? { kind: "NOT_APPLICABLE", min: "2", max: "3" }
    : { kind: "TARGET_RANGE", min: String(rir.min), max: String(rir.max) };
}

function prescribed(
  prescription: WeeklyPrescriptionV4 | undefined,
): Extract<WeeklyPrescriptionV4, { status: "PRESCRIBE" }> | undefined {
  return prescription?.status === "PRESCRIBE" ? prescription : undefined;
}

function initialForm(
  weeks: readonly HypertrophyPlanWeekV4[],
  prescriptions: readonly WeeklyPrescriptionV4[],
): PatternForm {
  const first = prescribed(prescriptions[0]);
  if (!first) throw new Error("PRESCRIPTION_PATTERN_ACCUMULATION_OMIT");
  const recognition = recognizeHypertrophyPrescriptionPattern({
    weeks,
    prescriptions,
  });
  const deload = prescribed(prescriptions[4]);
  return {
    sets: String(first.setCount),
    repKind: first.reps.kind,
    exactReps: first.reps.kind === "EXACT" ? String(first.reps.reps) : "8",
    minReps: first.reps.kind === "RANGE" ? String(first.reps.min) : "8",
    maxReps: first.reps.kind === "RANGE" ? String(first.reps.max) : "12",
    effortKind:
      recognition.accumulation.kind === "STANDARD"
        ? "STANDARD"
        : recognition.accumulation.kind === "STABLE"
          ? "STABLE"
          : "CUSTOM",
    stableRir: rirInput(first.rir),
    customRir: prescriptions.slice(0, 4).map((entry) =>
      rirInput(prescribed(entry)?.rir ?? { kind: "TARGET_RANGE", min: 2, max: 3 }),
    ),
    deloadKind: recognition.deload.kind,
    deloadSets: String(
      recognition.deload.kind === "REDUCED_SETS"
        ? recognition.deload.setCount
        : deload?.setCount ?? Math.max(1, first.setCount - 1),
    ),
  };
}

function parseRir(input: RirInput, label: string, errors: string[]): RirTargetV4 {
  if (input.kind === "NOT_APPLICABLE") return { kind: "NOT_APPLICABLE" };
  const min = Number(input.min);
  const max = Number(input.max);
  const valid = (value: number) =>
    Number.isFinite(value) && value >= 0 && value <= 10 && Number.isInteger(value * 2);
  if (!valid(min) || !valid(max) || min > max) {
    errors.push(`${label} RIR must use 0–10 in half-step increments, with minimum no greater than maximum.`);
  }
  return { kind: "TARGET_RANGE", min, max };
}

function parsePattern(
  form: PatternForm,
  currentDeload: WeeklyPrescriptionV4,
): { pattern?: HypertrophyPrescriptionPattern; errors: string[] } {
  const errors: string[] = [];
  const setCount = Number(form.sets);
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 10) {
    errors.push("Base sets must be a whole number from 1 to 10.");
  }
  let reps: RepTargetV4;
  if (form.repKind === "EXACT") {
    const exact = Number(form.exactReps);
    if (!Number.isInteger(exact) || exact < 1 || exact > 100) {
      errors.push("Exact reps must be a whole number from 1 to 100.");
    }
    reps = { kind: "EXACT", reps: exact };
  } else {
    const min = Number(form.minReps);
    const max = Number(form.maxReps);
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < 1 ||
      max > 100 ||
      min > max
    ) {
      errors.push("Rep range must use whole numbers from 1 to 100, with minimum no greater than maximum.");
    }
    reps = { kind: "RANGE", min, max };
  }

  let effort: AccumulationEffortPattern;
  if (form.effortKind === "STANDARD") {
    effort = { kind: "STANDARD" };
  } else if (form.effortKind === "STABLE") {
    effort = { kind: "STABLE", rir: parseRir(form.stableRir, "Stable effort", errors) };
  } else {
    effort = {
      kind: "CUSTOM",
      rirByWeek: form.customRir.map((entry, index) =>
        parseRir(entry, `Week ${index + 1}`, errors),
      ),
    };
  }

  let deload: DeloadPrescriptionPattern;
  if (form.deloadKind === "REDUCED_SETS") {
    const reduced = Number(form.deloadSets);
    if (
      !Number.isInteger(reduced) ||
      reduced < 1 ||
      reduced > 10 ||
      (Number.isInteger(setCount) && reduced >= setCount)
    ) {
      errors.push("Reduced deload sets must be a whole number below the base set count.");
    }
    deload = { kind: "REDUCED_SETS", setCount: reduced };
  } else if (form.deloadKind === "MAINTAIN") {
    deload = { kind: "MAINTAIN" };
  } else if (form.deloadKind === "OMIT") {
    deload = { kind: "OMIT" };
  } else {
    deload = { kind: "CUSTOM", prescription: structuredClone(currentDeload) };
  }
  return errors.length > 0
    ? { errors }
    : { pattern: { base: { setCount, reps }, effort, deload }, errors };
}

function formatReps(reps: RepTargetV4): string {
  return reps.kind === "EXACT" ? `${reps.reps}` : `${reps.min}–${reps.max}`;
}

function formatRir(rir: RirTargetV4): string {
  if (rir.kind === "NOT_APPLICABLE") return "n/a";
  return rir.min === rir.max ? `${rir.min}` : `${rir.min}–${rir.max}`;
}

export function formatProgressionResult(prescription: WeeklyPrescriptionV4): string {
  if (prescription.status === "OMIT") return "Omitted";
  return `${prescription.setCount} × ${formatReps(prescription.reps)} · RIR ${formatRir(prescription.rir)}`;
}

function RirFields({
  label,
  value,
  errorId,
  invalid = false,
  onChange,
}: {
  label: string;
  value: RirInput;
  errorId?: string;
  invalid?: boolean;
  onChange: (next: RirInput) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      <label className="text-xs font-medium text-slate-700">
        RIR format
        <select
          aria-label={`${label} RIR format`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={value.kind}
          onChange={(event) =>
            onChange({ ...value, kind: event.target.value as RirInput["kind"] })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
        >
          <option value="TARGET_RANGE">Target or range</option>
          <option value="NOT_APPLICABLE">Not applicable</option>
        </select>
      </label>
      {value.kind === "TARGET_RANGE" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs font-medium text-slate-700">
            Minimum RIR
            <input
              aria-label={`${label} minimum RIR`}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={value.min}
              onChange={(event) => onChange({ ...value, min: event.target.value })}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Maximum RIR
            <input
              aria-label={`${label} maximum RIR`}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={value.max}
              onChange={(event) => onChange({ ...value, max: event.target.value })}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2"
            />
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

export function HypertrophyProgressionEditor({
  exerciseName,
  weeks,
  prescriptions,
  onApply,
  onClose,
}: {
  exerciseName: string;
  weeks: readonly HypertrophyPlanWeekV4[];
  prescriptions: readonly WeeklyPrescriptionV4[];
  onApply: (prescriptions: WeeklyPrescriptionV4[]) => void;
  onClose: () => void;
}) {
  const recognition = useMemo(
    () => recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions }),
    [prescriptions, weeks],
  );
  const [form, setForm] = useState(() => initialForm(weeks, prescriptions));
  const [submitted, setSubmitted] = useState(false);
  const errorId = useId();
  const parsed = useMemo(
    () => parsePattern(form, prescriptions[4]!),
    [form, prescriptions],
  );
  const result = useMemo(() => {
    if (!parsed.pattern) return null;
    try {
      return materializeHypertrophyPrescriptionPattern({ weeks, pattern: parsed.pattern });
    } catch {
      return null;
    }
  }, [parsed.pattern, weeks]);
  const errors = result ? parsed.errors : parsed.errors.length > 0 ? parsed.errors : ["The selected pattern is not valid."];
  const baseSetsError = errors.find((entry) => entry.startsWith("Base sets"));
  const baseRepsError = errors.find((entry) => entry.startsWith("Exact reps") || entry.startsWith("Rep range"));
  const effortError = errors.find((entry) => entry.includes(" RIR "));
  const deloadError = errors.find((entry) => entry.startsWith("Reduced deload"));

  const apply = () => {
    setSubmitted(true);
    if (!result) return;
    if (
      recognition.isCustom &&
      !window.confirm(
        `Apply this progression to “${exerciseName}” and overwrite its custom weekly rows?`,
      )
    ) {
      return;
    }
    onApply(result);
    onClose();
  };

  return (
    <SlideUpSheet isOpen onClose={onClose} title={`Edit progression · ${exerciseName}`}>
      <div className="space-y-5">
        {recognition.isCustom ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This exercise has custom weekly values. They remain unchanged until you explicitly apply and confirm a progression.
          </p>
        ) : null}
        {submitted && errors.length > 0 ? (
          <section role="alert" aria-labelledby={`${errorId}-summary`} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <h3 id={`${errorId}-summary`} className="font-semibold">Correct these fields</h3>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          </section>
        ) : null}

        <fieldset>
          <legend className="font-semibold text-slate-950">Base prescription</legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              Base sets
              <input
                aria-label="Base sets"
                aria-invalid={submitted && Boolean(baseSetsError)}
                aria-describedby={submitted && baseSetsError ? `${errorId}-base-sets` : undefined}
                type="number"
                min={1}
                max={10}
                value={form.sets}
                onChange={(event) => setForm({ ...form, sets: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
              />
              {submitted && baseSetsError ? <span id={`${errorId}-base-sets`} className="mt-1 block text-xs text-rose-700">{baseSetsError}</span> : null}
            </label>
            <label className="text-sm font-medium text-slate-700">
              Rep format
              <select
                aria-label="Base rep format"
                value={form.repKind}
                onChange={(event) => setForm({ ...form, repKind: event.target.value as PatternForm["repKind"] })}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
              >
                <option value="EXACT">Exact</option>
                <option value="RANGE">Range</option>
              </select>
            </label>
            {form.repKind === "EXACT" ? (
              <label className="col-span-2 text-sm font-medium text-slate-700">
                Exact reps
                <input
                  aria-label="Base exact reps"
                  aria-invalid={submitted && Boolean(baseRepsError)}
                  aria-describedby={submitted && baseRepsError ? `${errorId}-base-reps` : undefined}
                  type="number"
                  min={1}
                  max={100}
                  value={form.exactReps}
                  onChange={(event) => setForm({ ...form, exactReps: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
                />
                {submitted && baseRepsError ? <span id={`${errorId}-base-reps`} className="mt-1 block text-xs text-rose-700">{baseRepsError}</span> : null}
              </label>
            ) : (
              <>
                <label className="text-sm font-medium text-slate-700">
                  Minimum reps
                  <input aria-label="Base minimum reps" aria-invalid={submitted && Boolean(baseRepsError)} aria-describedby={submitted && baseRepsError ? `${errorId}-base-reps` : undefined} type="number" min={1} max={100} value={form.minReps} onChange={(event) => setForm({ ...form, minReps: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Maximum reps
                  <input aria-label="Base maximum reps" aria-invalid={submitted && Boolean(baseRepsError)} aria-describedby={submitted && baseRepsError ? `${errorId}-base-reps` : undefined} type="number" min={1} max={100} value={form.maxReps} onChange={(event) => setForm({ ...form, maxReps: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
                </label>
                {submitted && baseRepsError ? <p id={`${errorId}-base-reps`} className="col-span-2 text-xs text-rose-700">{baseRepsError}</p> : null}
              </>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-semibold text-slate-950">Accumulation effort</legend>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Effort progression
            <select
              aria-label="Accumulation effort progression"
              value={form.effortKind}
              onChange={(event) => setForm({ ...form, effortKind: event.target.value as PatternForm["effortKind"] })}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
            >
              <option value="STANDARD">Standard accumulation (RIR 3–4 → 1–2)</option>
              <option value="STABLE">Stable effort</option>
              <option value="CUSTOM">Custom effort curve</option>
            </select>
          </label>
          {form.effortKind === "STABLE" ? (
            <div className="mt-3">
              <RirFields label="Stable accumulation" value={form.stableRir} errorId={`${errorId}-effort`} invalid={submitted && Boolean(effortError)} onChange={(stableRir) => setForm({ ...form, stableRir })} />
            </div>
          ) : form.effortKind === "CUSTOM" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {form.customRir.map((value, index) => (
                <RirFields
                  key={index}
                  label={`Week ${index + 1}`}
                  value={value}
                  errorId={`${errorId}-effort`}
                  invalid={submitted && Boolean(effortError)}
                  onChange={(next) => setForm({
                    ...form,
                    customRir: form.customRir.map((entry, entryIndex) => entryIndex === index ? next : entry),
                  })}
                />
              ))}
            </div>
          ) : null}
          {submitted && effortError ? <p id={`${errorId}-effort`} className="mt-2 text-xs text-rose-700">{effortError}</p> : null}
        </fieldset>

        <fieldset>
          <legend className="font-semibold text-slate-950">Deload behavior</legend>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Week 5 behavior
            <select
              aria-label="Deload behavior"
              value={form.deloadKind}
              onChange={(event) => setForm({ ...form, deloadKind: event.target.value as PatternForm["deloadKind"] })}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
            >
              <option value="REDUCED_SETS">Reduced sets · RIR 4–5</option>
              <option value="MAINTAIN">Maintain sets · RIR 4–5</option>
              <option value="OMIT">Omit in Week 5</option>
              <option value="CUSTOM">Keep current custom Week 5</option>
            </select>
          </label>
          {form.deloadKind === "REDUCED_SETS" ? (
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Week 5 sets
              <input
                aria-label="Reduced deload sets"
                aria-invalid={submitted && Boolean(deloadError)}
                aria-describedby={submitted && deloadError ? `${errorId}-deload-sets` : undefined}
                type="number"
                min={1}
                max={10}
                value={form.deloadSets}
                onChange={(event) => setForm({ ...form, deloadSets: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
              />
              {submitted && deloadError ? <span id={`${errorId}-deload-sets`} className="mt-1 block text-xs text-rose-700">{deloadError}</span> : null}
            </label>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">Applying is a one-time rewrite of the exact rows. No pattern metadata is saved.</p>
        </fieldset>

        <section aria-labelledby="five-week-result-title">
          <h3 id="five-week-result-title" className="font-semibold text-slate-950">Five-week result</h3>
          {result ? (
            <ol className="mt-3 grid gap-2 sm:grid-cols-5">
              {result.map((entry, index) => (
                <li key={entry.week} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">W{entry.week} · {index === 4 ? "Deload" : "Accumulation"}</span>
                  <span className="mt-1 block">{formatProgressionResult(entry)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-rose-700">Correct the fields to preview the exact rows.</p>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" size="touch" onClick={onClose}>Cancel</Button>
          <Button size="touch" onClick={apply}>
            {recognition.isCustom ? "Apply and overwrite custom weeks" : "Apply progression"}
          </Button>
        </div>
      </div>
    </SlideUpSheet>
  );
}

export type BulkProgressionCandidate = {
  placementId: string;
  exerciseName: string;
  prescriptions: WeeklyPrescriptionV4[];
};

type BulkEffort = "STANDARD" | "STABLE";
type BulkDeload = "KEEP" | "REDUCE_BY_ONE" | "MAINTAIN" | "OMIT";

export function HypertrophyBulkProgressionEditor({
  weeks,
  candidates,
  onApply,
  onClose,
}: {
  weeks: readonly HypertrophyPlanWeekV4[];
  candidates: BulkProgressionCandidate[];
  onApply: (changes: Map<string, WeeklyPrescriptionV4[]>) => void;
  onClose: () => void;
}) {
  const [effort, setEffort] = useState<BulkEffort>("STANDARD");
  const [stableRir, setStableRir] = useState<RirInput>({ kind: "TARGET_RANGE", min: "2", max: "3" });
  const [deload, setDeload] = useState<BulkDeload>("KEEP");
  const effortErrorId = useId();
  const preview = useMemo(() => {
    const errors: string[] = [];
    const rir = effort === "STABLE" ? parseRir(stableRir, "Stable effort", errors) : undefined;
    return candidates.map((candidate) => {
      const before = recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions: candidate.prescriptions });
      try {
        const afterRows = materializeBulkHypertrophyPrescriptionPattern({
          weeks,
          prescriptions: candidate.prescriptions,
          effort: effort === "STANDARD" ? { kind: "STANDARD" } : { kind: "STABLE", rir: rir! },
          deload: { kind: deload },
        });
        const after = recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions: afterRows });
        return { candidate, before, after, afterRows, error: errors[0] };
      } catch (error) {
        return {
          candidate,
          before,
          after: null,
          afterRows: null,
          error: error instanceof Error ? error.message : "Pattern is not valid.",
        };
      }
    });
  }, [candidates, deload, effort, stableRir, weeks]);
  const custom = preview.filter((entry) => entry.before.isCustom);
  const eligible = preview.filter((entry) => !entry.before.isCustom && entry.afterRows && !entry.error);
  const hasErrors = preview.some((entry) => Boolean(entry.error));

  const apply = (overwriteCustom: boolean) => {
    if (hasErrors) return;
    const applicable = preview.filter(
      (entry) => entry.afterRows && !entry.error && (overwriteCustom || !entry.before.isCustom),
    );
    if (applicable.length === 0) return;
    const message = overwriteCustom
      ? `Overwrite custom weekly rows and apply this bulk progression to ${applicable.length} selected exercises?`
      : `Apply this bulk progression to ${applicable.length} selected exercises? Custom rows will remain unchanged.`;
    if (!window.confirm(message)) return;
    onApply(new Map(applicable.map((entry) => [entry.candidate.placementId, entry.afterRows!] as const)));
    onClose();
  };

  return (
    <SlideUpSheet isOpen onClose={onClose} title="Preview session progression">
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          This command changes only effort and deload rows for selected placements in the current session. Each exercise keeps its own base sets and reps.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Effort progression
            <select aria-label="Bulk effort progression" value={effort} onChange={(event) => setEffort(event.target.value as BulkEffort)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3">
              <option value="STANDARD">Standard accumulation</option>
              <option value="STABLE">Stable effort</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Deload policy
            <select aria-label="Bulk deload policy" value={deload} onChange={(event) => setDeload(event.target.value as BulkDeload)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3">
              <option value="KEEP">Keep each Week 5 row</option>
              <option value="REDUCE_BY_ONE">Reduce each base by one set</option>
              <option value="MAINTAIN">Maintain each base set count</option>
              <option value="OMIT">Omit each in Week 5</option>
            </select>
          </label>
        </div>
        {effort === "STABLE" ? (
          <RirFields label="Bulk stable effort" value={stableRir} errorId={effortErrorId} invalid={hasErrors} onChange={setStableRir} />
        ) : null}
        {preview.some((entry) => entry.error) ? (
          <p id={effortErrorId} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Correct the bulk effort values or choose a deload policy valid for every exercise marked Cannot apply.
          </p>
        ) : null}

        <section aria-labelledby="bulk-preview-title">
          <h3 id="bulk-preview-title" className="font-semibold text-slate-950">Before and after preview</h3>
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            {eligible.length} will apply · {custom.length} custom {custom.length === 1 ? "row skips" : "rows skip"} by default
          </p>
          <ul className="mt-3 space-y-3" aria-label="Bulk progression before and after preview">
            {preview.map((entry) => {
              const skipped = entry.before.isCustom;
              return (
                <li key={entry.candidate.placementId} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="font-semibold text-slate-950">{entry.candidate.exerciseName}</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${skipped ? "bg-amber-100 text-amber-900" : entry.error ? "bg-rose-100 text-rose-900" : "bg-emerald-100 text-emerald-900"}`}>
                      {entry.error ? "Cannot apply" : skipped ? "Custom · skipped" : "Will apply"}
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div><dt className="text-xs font-semibold text-slate-500">Before</dt><dd className="mt-1 text-slate-700">{entry.before.summary}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">After</dt><dd className="mt-1 text-slate-700">{entry.after?.summary ?? entry.error}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" size="touch" onClick={onClose}>Cancel</Button>
          <Button size="touch" disabled={eligible.length === 0 || hasErrors} onClick={() => apply(false)}>Apply eligible</Button>
          {custom.length > 0 ? (
            <Button variant="secondary" size="touch" disabled={hasErrors} onClick={() => apply(true)}>Overwrite custom and apply all</Button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Bulk apply is confirmed before one coherent local draft update. Undo is deferred because autosave can commit within the existing 750 ms CAS cycle and the editor has no durable revision-aware undo stack.
        </p>
      </div>
    </SlideUpSheet>
  );
}
