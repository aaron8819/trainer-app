import type {
  HypertrophyPlanWeekV4,
  RepTargetV4,
  RirTargetV4,
  WeeklyPrescriptionV4,
} from "./hypertrophy-plan-authoring";

export const STANDARD_ACCUMULATION_RIR = [
  { kind: "TARGET_RANGE", min: 3, max: 4 },
  { kind: "TARGET_RANGE", min: 3, max: 3 },
  { kind: "TARGET_RANGE", min: 2, max: 3 },
  { kind: "TARGET_RANGE", min: 1, max: 2 },
] as const satisfies readonly RirTargetV4[];

export const STANDARD_DELOAD_RIR = {
  kind: "TARGET_RANGE",
  min: 4,
  max: 5,
} as const satisfies RirTargetV4;

export type AccumulationEffortPattern =
  | { kind: "STANDARD" }
  | { kind: "STABLE"; rir: RirTargetV4 }
  | { kind: "CUSTOM"; rirByWeek: RirTargetV4[] };

export type DeloadPrescriptionPattern =
  | { kind: "REDUCED_SETS"; setCount: number }
  | { kind: "MAINTAIN" }
  | { kind: "OMIT" }
  | { kind: "CUSTOM"; prescription: WeeklyPrescriptionV4 };

export type HypertrophyPrescriptionPattern = {
  base: { setCount: number; reps: RepTargetV4 };
  effort: AccumulationEffortPattern;
  deload: DeloadPrescriptionPattern;
};

export type RecognizedPrescriptionPattern = {
  classification:
    | "STANDARD_ACCUMULATION"
    | "STABLE_WEEKLY_PRESCRIPTION"
    | "REDUCED_DELOAD"
    | "OMITTED_DELOAD"
    | "WEEK_EXCEPTION"
    | "CUSTOM_WEEKLY_PATTERN";
  classificationLabel: string;
  accumulation:
    | { kind: "STANDARD" }
    | { kind: "STABLE"; rir: RirTargetV4 }
    | { kind: "CUSTOM" };
  deload:
    | { kind: "REDUCED_SETS"; setCount: number }
    | { kind: "MAINTAIN" }
    | { kind: "OMIT" }
    | { kind: "CUSTOM" };
  base: { setCount: number; reps: RepTargetV4 };
  exceptionWeeks: number[];
  summary: string;
  deloadSummary: string;
  isCustom: boolean;
};

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertFiveWeekTopology(weeks: readonly HypertrophyPlanWeekV4[]): void {
  if (
    weeks.length !== 5 ||
    weeks.some(
      (week, index) =>
        week.week !== index + 1 ||
        week.phase !== (index === 4 ? "DELOAD" : "ACCUMULATION"),
    )
  ) {
    throw new Error("PRESCRIPTION_PATTERN_REQUIRES_FIVE_WEEK_TOPOLOGY");
  }
}

function assertRepTarget(reps: RepTargetV4): void {
  if (reps.kind === "EXACT") {
    if (!Number.isInteger(reps.reps) || reps.reps < 1 || reps.reps > 100) {
      throw new Error("PRESCRIPTION_PATTERN_INVALID_EXACT_REPS");
    }
    return;
  }
  if (
    !Number.isInteger(reps.min) ||
    !Number.isInteger(reps.max) ||
    reps.min < 1 ||
    reps.max > 100 ||
    reps.min > reps.max
  ) {
    throw new Error("PRESCRIPTION_PATTERN_INVALID_REP_RANGE");
  }
}

function assertRirTarget(rir: RirTargetV4): void {
  if (rir.kind === "NOT_APPLICABLE") return;
  const valid = (value: number) =>
    Number.isFinite(value) && value >= 0 && value <= 10 && Number.isInteger(value * 2);
  if (!valid(rir.min) || !valid(rir.max) || rir.min > rir.max) {
    throw new Error("PRESCRIPTION_PATTERN_INVALID_RIR");
  }
}

function assertSetCount(setCount: number): void {
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 10) {
    throw new Error("PRESCRIPTION_PATTERN_INVALID_SET_COUNT");
  }
}

function assertPrescription(
  prescription: WeeklyPrescriptionV4,
  expectedWeek: number,
  allowOmit: boolean,
): void {
  if (prescription.week !== expectedWeek) {
    throw new Error("PRESCRIPTION_PATTERN_WEEK_ORDER_MISMATCH");
  }
  if (prescription.status === "OMIT") {
    if (!allowOmit) throw new Error("PRESCRIPTION_PATTERN_ACCUMULATION_OMIT");
    return;
  }
  assertSetCount(prescription.setCount);
  assertRepTarget(prescription.reps);
  assertRirTarget(prescription.rir);
}

function cloneRir(rir: RirTargetV4): RirTargetV4 {
  return structuredClone(rir);
}

export function materializeHypertrophyPrescriptionPattern(input: {
  weeks: readonly HypertrophyPlanWeekV4[];
  pattern: HypertrophyPrescriptionPattern;
}): WeeklyPrescriptionV4[] {
  assertFiveWeekTopology(input.weeks);
  assertSetCount(input.pattern.base.setCount);
  assertRepTarget(input.pattern.base.reps);

  const effort = input.pattern.effort;
  if (effort.kind === "STABLE") assertRirTarget(effort.rir);
  if (effort.kind === "CUSTOM") {
    if (effort.rirByWeek.length !== 4) {
      throw new Error("PRESCRIPTION_PATTERN_CUSTOM_EFFORT_REQUIRES_FOUR_WEEKS");
    }
    effort.rirByWeek.forEach(assertRirTarget);
  }

  const accumulation = input.weeks.slice(0, 4).map((week, index) => ({
    week: week.week,
    status: "PRESCRIBE" as const,
    setCount: input.pattern.base.setCount,
    reps: structuredClone(input.pattern.base.reps),
    rir: cloneRir(
      effort.kind === "STANDARD"
        ? STANDARD_ACCUMULATION_RIR[index]!
        : effort.kind === "STABLE"
          ? effort.rir
          : effort.rirByWeek[index]!,
    ),
  }));

  const deloadWeek = input.weeks[4]!.week;
  let deload: WeeklyPrescriptionV4;
  switch (input.pattern.deload.kind) {
    case "OMIT":
      deload = { week: deloadWeek, status: "OMIT" };
      break;
    case "REDUCED_SETS":
      assertSetCount(input.pattern.deload.setCount);
      if (input.pattern.deload.setCount >= input.pattern.base.setCount) {
        throw new Error("PRESCRIPTION_PATTERN_DELOAD_NOT_REDUCED");
      }
      deload = {
        week: deloadWeek,
        status: "PRESCRIBE",
        setCount: input.pattern.deload.setCount,
        reps: structuredClone(input.pattern.base.reps),
        rir: structuredClone(STANDARD_DELOAD_RIR),
      };
      break;
    case "MAINTAIN":
      deload = {
        week: deloadWeek,
        status: "PRESCRIBE",
        setCount: input.pattern.base.setCount,
        reps: structuredClone(input.pattern.base.reps),
        rir: structuredClone(STANDARD_DELOAD_RIR),
      };
      break;
    case "CUSTOM":
      assertPrescription(input.pattern.deload.prescription, deloadWeek, true);
      deload = structuredClone(input.pattern.deload.prescription);
      break;
  }

  return [...accumulation, deload];
}

function formatReps(reps: RepTargetV4): string {
  return reps.kind === "EXACT" ? String(reps.reps) : `${reps.min}–${reps.max}`;
}

function formatRir(rir: RirTargetV4): string {
  if (rir.kind === "NOT_APPLICABLE") return "n/a";
  return rir.min === rir.max ? String(rir.min) : `${rir.min}–${rir.max}`;
}

function inferDeload(
  base: { setCount: number; reps: RepTargetV4 },
  prescription: WeeklyPrescriptionV4,
): RecognizedPrescriptionPattern["deload"] {
  if (prescription.status === "OMIT") return { kind: "OMIT" };
  if (!equal(prescription.reps, base.reps) || !equal(prescription.rir, STANDARD_DELOAD_RIR)) {
    return { kind: "CUSTOM" };
  }
  if (prescription.setCount < base.setCount) {
    return { kind: "REDUCED_SETS", setCount: prescription.setCount };
  }
  return prescription.setCount === base.setCount
    ? { kind: "MAINTAIN" }
    : { kind: "CUSTOM" };
}

function patternDeload(
  base: { setCount: number; reps: RepTargetV4 },
  prescription: WeeklyPrescriptionV4,
): DeloadPrescriptionPattern {
  const recognized = inferDeload(base, prescription);
  switch (recognized.kind) {
    case "OMIT":
      return { kind: "OMIT" };
    case "MAINTAIN":
      return { kind: "MAINTAIN" };
    case "REDUCED_SETS":
      return recognized;
    case "CUSTOM":
      return { kind: "CUSTOM", prescription: structuredClone(prescription) };
  }
}

function findExceptionWeeks(input: {
  weeks: readonly HypertrophyPlanWeekV4[];
  prescriptions: readonly WeeklyPrescriptionV4[];
}): number[] {
  const prescribedAccumulation = input.prescriptions
    .slice(0, 4)
    .filter((entry): entry is Extract<WeeklyPrescriptionV4, { status: "PRESCRIBE" }> =>
      entry.status === "PRESCRIBE",
    );
  const deload = input.prescriptions[4]!;
  let best: number[] = input.weeks.map((week) => week.week);
  for (const source of prescribedAccumulation) {
    const base = { setCount: source.setCount, reps: source.reps };
    const efforts: AccumulationEffortPattern[] = [
      { kind: "STANDARD" },
      { kind: "STABLE", rir: source.rir },
    ];
    for (const effort of efforts) {
      const candidate = materializeHypertrophyPrescriptionPattern({
        weeks: input.weeks,
        pattern: {
          base,
          effort,
          deload: patternDeload(base, deload),
        },
      });
      const differing = candidate.flatMap((entry, index) =>
        equal(entry, input.prescriptions[index]) ? [] : [entry.week],
      );
      if (differing.length < best.length) best = differing;
    }
  }
  return best;
}

export function recognizeHypertrophyPrescriptionPattern(input: {
  weeks: readonly HypertrophyPlanWeekV4[];
  prescriptions: readonly WeeklyPrescriptionV4[];
}): RecognizedPrescriptionPattern {
  assertFiveWeekTopology(input.weeks);
  if (input.prescriptions.length !== 5) {
    throw new Error("PRESCRIPTION_PATTERN_REQUIRES_FIVE_ROWS");
  }
  input.prescriptions.forEach((entry, index) =>
    assertPrescription(entry, index + 1, index === 4),
  );
  const first = input.prescriptions[0]!;
  if (first.status !== "PRESCRIBE") {
    throw new Error("PRESCRIPTION_PATTERN_ACCUMULATION_OMIT");
  }
  const base = {
    setCount: first.setCount,
    reps: structuredClone(first.reps),
  };
  const accumulationRows = input.prescriptions.slice(0, 4);
  const sameBase = accumulationRows.every(
    (entry) =>
      entry.status === "PRESCRIBE" &&
      entry.setCount === base.setCount &&
      equal(entry.reps, base.reps),
  );
  const standard =
    sameBase &&
    accumulationRows.every(
      (entry, index) =>
        entry.status === "PRESCRIBE" &&
        equal(entry.rir, STANDARD_ACCUMULATION_RIR[index]),
    );
  const stable =
    sameBase &&
    accumulationRows.every(
      (entry) => entry.status === "PRESCRIBE" && equal(entry.rir, first.rir),
    );
  const accumulation: RecognizedPrescriptionPattern["accumulation"] = standard
    ? { kind: "STANDARD" }
    : stable
      ? { kind: "STABLE", rir: structuredClone(first.rir) }
      : { kind: "CUSTOM" };
  const deload = inferDeload(base, input.prescriptions[4]!);
  const exactPattern = accumulation.kind !== "CUSTOM" && deload.kind !== "CUSTOM";
  const exceptionWeeks = exactPattern ? [] : findExceptionWeeks(input);
  const isCustom = !exactPattern;

  let classification: RecognizedPrescriptionPattern["classification"];
  let classificationLabel: string;
  if (exceptionWeeks.length === 1) {
    classification = "WEEK_EXCEPTION";
    classificationLabel = `Week ${exceptionWeeks[0]} exception`;
  } else if (isCustom) {
    classification = "CUSTOM_WEEKLY_PATTERN";
    classificationLabel = "Custom weekly pattern";
  } else if (accumulation.kind === "STABLE") {
    classification = "STABLE_WEEKLY_PRESCRIPTION";
    classificationLabel = "Stable weekly prescription";
  } else if (deload.kind === "OMIT") {
    classification = "OMITTED_DELOAD";
    classificationLabel = "Omitted in deload";
  } else if (deload.kind === "REDUCED_SETS") {
    classification = "REDUCED_DELOAD";
    classificationLabel = "Reduced deload";
  } else {
    classification = "STANDARD_ACCUMULATION";
    classificationLabel = "Standard accumulation";
  }

  const deloadSummary =
    deload.kind === "OMIT"
      ? "Omitted in Week 5"
      : deload.kind === "REDUCED_SETS"
        ? `${deload.setCount}-set deload`
        : deload.kind === "MAINTAIN"
          ? "Maintained sets in Week 5"
          : "Custom Week 5";
  const effortSummary =
    accumulation.kind === "STANDARD"
      ? `RIR ${formatRir(STANDARD_ACCUMULATION_RIR[0])} → ${formatRir(STANDARD_ACCUMULATION_RIR[3])}`
      : accumulation.kind === "STABLE"
        ? "stable effort"
        : "custom effort";
  const summary = exceptionWeeks.length === 1
    ? `Custom · Week ${exceptionWeeks[0]} differs`
    : isCustom && exceptionWeeks.length > 1
      ? `Custom · Weeks ${exceptionWeeks.join(", ")} differ`
      : isCustom
        ? "Custom weekly pattern"
      : `${base.setCount} × ${formatReps(base.reps)} · ${effortSummary} · ${deloadSummary.toLowerCase()}`;

  return {
    classification,
    classificationLabel,
    accumulation,
    deload,
    base,
    exceptionWeeks,
    summary,
    deloadSummary,
    isCustom,
  };
}

export function materializeBulkHypertrophyPrescriptionPattern(input: {
  weeks: readonly HypertrophyPlanWeekV4[];
  prescriptions: readonly WeeklyPrescriptionV4[];
  effort: Exclude<AccumulationEffortPattern, { kind: "CUSTOM" }>;
  deload:
    | { kind: "KEEP" }
    | { kind: "REDUCE_BY_ONE" }
    | { kind: "MAINTAIN" }
    | { kind: "OMIT" };
}): WeeklyPrescriptionV4[] {
  assertFiveWeekTopology(input.weeks);
  if (input.prescriptions.length !== 5) {
    throw new Error("PRESCRIPTION_PATTERN_REQUIRES_FIVE_ROWS");
  }
  input.prescriptions.forEach((entry, index) =>
    assertPrescription(entry, index + 1, index === 4),
  );
  if (input.effort.kind === "STABLE") assertRirTarget(input.effort.rir);

  const accumulation = input.prescriptions.slice(0, 4).map((entry, index) => {
    if (entry.status !== "PRESCRIBE") {
      throw new Error("PRESCRIPTION_PATTERN_ACCUMULATION_OMIT");
    }
    return {
      ...structuredClone(entry),
      rir: cloneRir(
        input.effort.kind === "STANDARD"
          ? STANDARD_ACCUMULATION_RIR[index]!
          : input.effort.rir,
      ),
    };
  });

  const base = input.prescriptions[0]!;
  if (base.status !== "PRESCRIBE") {
    throw new Error("PRESCRIPTION_PATTERN_ACCUMULATION_OMIT");
  }
  const currentDeload = input.prescriptions[4]!;
  let deload: WeeklyPrescriptionV4;
  switch (input.deload.kind) {
    case "KEEP":
      deload = structuredClone(currentDeload);
      break;
    case "OMIT":
      deload = { week: currentDeload.week, status: "OMIT" };
      break;
    case "REDUCE_BY_ONE": {
      const setCount = base.setCount - 1;
      if (setCount < 1) {
        throw new Error("PRESCRIPTION_PATTERN_DELOAD_NOT_REDUCED");
      }
      deload = currentDeload.status === "PRESCRIBE"
        ? { ...structuredClone(currentDeload), setCount }
        : {
            week: currentDeload.week,
            status: "PRESCRIBE",
            setCount,
            reps: structuredClone(base.reps),
            rir: structuredClone(STANDARD_DELOAD_RIR),
          };
      break;
    }
    case "MAINTAIN":
      deload = currentDeload.status === "PRESCRIBE"
        ? { ...structuredClone(currentDeload), setCount: base.setCount }
        : {
            week: currentDeload.week,
            status: "PRESCRIBE",
            setCount: base.setCount,
            reps: structuredClone(base.reps),
            rir: structuredClone(STANDARD_DELOAD_RIR),
          };
      break;
  }

  return [...accumulation, deload];
}
