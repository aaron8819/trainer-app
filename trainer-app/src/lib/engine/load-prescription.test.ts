import { describe, expect, it } from "vitest";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import { normalizePerformedExerciseEvidence } from "@/lib/session-semantics/performed-exercise-semantics";
import {
  classifyPrescriptionComparability,
  createNumericPrescription,
  createSemanticZeroPrescription,
  resolvePrescriptionResult,
  selectBestPrescriptionComparability,
  toTargetLoad,
} from "./load-prescription";

const barbell = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const dumbbell = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const machine = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;

function evidence(input: {
  exerciseId?: string;
  measurement?: MeasurementSemantics | null;
  load?: number | null;
  reps?: number | null;
  rpe?: number | null;
  status?: "PARTIAL" | "COMPLETED" | "SKIPPED";
  planned?: number;
  setCount?: number;
  isDeload?: boolean;
  runtimeAdded?: boolean;
  substituted?: boolean;
} = {}) {
  const setCount = input.setCount ?? 3;
  return normalizePerformedExerciseEvidence({
    workoutId: `workout-${input.exerciseId ?? "leg-press"}`,
    canonicalExerciseId: input.exerciseId ?? "leg-press",
    performedAt: "2026-08-01T00:00:00.000Z",
    status: input.status ?? "COMPLETED",
    measurement: input.measurement === undefined ? machine : input.measurement,
    plannedWorkingSetCount: input.planned ?? setCount,
    isDeload: input.isDeload,
    runtimeAdded: input.runtimeAdded,
    substituted: input.substituted,
    sets: Array.from({ length: setCount }, (_, index) => ({
      setIndex: index + 1,
      load: input.load === undefined ? 200 : input.load,
      reps: input.reps === undefined ? 10 : input.reps,
      rpe: input.rpe === undefined ? 8 : input.rpe,
    })),
  });
}

describe("prescription comparability", () => {
  it("admits exact barbell/dumbbell at high confidence and displayed load at reduced confidence", () => {
    for (const measurement of [barbell, dumbbell]) {
      expect(
        classifyPrescriptionComparability({
          canonicalExerciseId: "leg-press",
          measurement,
          evidence: evidence({ measurement }),
        }),
      ).toMatchObject({
        kind: "comparable",
        confidence: "high",
        reasonCodes: ["same_exercise_same_measurement", "complete_performed_evidence"],
      });
    }
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: machine,
        evidence: evidence(),
      }),
    ).toMatchObject({
      kind: "comparable_reduced_confidence",
      confidence: "reduced",
      reasonCodes: ["same_exercise_displayed_load", "complete_performed_evidence"],
    });
  });

  it("rejects changed exercise identity and changed measurement", () => {
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: machine,
        evidence: evidence({ exerciseId: "hack-squat" }),
      }),
    ).toMatchObject({ kind: "not_comparable", reasonCodes: ["exercise_identity_changed"] });
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: machine,
        evidence: evidence({ measurement: barbell }),
      }),
    ).toMatchObject({ kind: "not_comparable", reasonCodes: ["measurement_changed"] });
  });

  it("keeps the legacy bridge narrow and makes legacy machine evidence calibration-only", () => {
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: barbell,
        evidence: evidence({ measurement: null }),
      }),
    ).toMatchObject({
      kind: "comparable_reduced_confidence",
      reasonCodes: expect.arrayContaining(["legacy_barbell_bridge"]),
    });
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: dumbbell,
        evidence: evidence({ measurement: null }),
      }),
    ).toMatchObject({ kind: "not_comparable", reasonCodes: ["measurement_changed"] });
    expect(
      classifyPrescriptionComparability({
        canonicalExerciseId: "leg-press",
        measurement: machine,
        evidence: evidence({ measurement: null }),
      }),
    ).toMatchObject({
      kind: "calibration_required",
      confidence: "low",
      priorObservedHint: {
        value: 200,
        anchor: "representative_working_set",
        progressionEligible: false,
      },
    });
  });

  it("prefers exact displayed-load evidence over a newer legacy calibration hint", () => {
    const selected = selectBestPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: [
        evidence({ measurement: null, load: 240 }),
        evidence({ measurement: machine, load: 200 }),
      ],
    });
    expect(selected).toMatchObject({
      kind: "comparable_reduced_confidence",
      evidence: { representativeLoad: 200, progressionEligible: true },
    });
  });

  it("handles evidence quality, partials, skipped exposure, and deload exclusion explicitly", () => {
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ load: null }),
    })).toMatchObject({ kind: "not_comparable", blockingFields: ["performedLoad"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ reps: null }),
    })).toMatchObject({ kind: "not_comparable", blockingFields: expect.arrayContaining(["performedReps"]) });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ rpe: null }),
    })).toMatchObject({
      kind: "comparable_reduced_confidence",
      directionalActionEligible: false,
      reasonCodes: expect.arrayContaining(["missing_effort"]),
    });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ status: "PARTIAL", planned: 3, setCount: 2 }),
    })).toMatchObject({
      kind: "comparable_reduced_confidence",
      directionalActionEligible: false,
    });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ status: "PARTIAL", planned: 4, setCount: 2 }),
    })).toMatchObject({ kind: "not_comparable", blockingFields: ["performedSetCoverage"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ status: "PARTIAL", planned: 4, setCount: 1 }),
    })).toMatchObject({ kind: "not_comparable", blockingFields: ["performedSetCoverage"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ status: "SKIPPED" }),
    })).toMatchObject({ kind: "not_comparable", reasonCodes: ["skipped_exposure"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ isDeload: true }),
    })).toMatchObject({ kind: "not_comparable", reasonCodes: ["deload_excluded"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "leg-press",
      measurement: machine,
      evidence: evidence({ runtimeAdded: true, substituted: true }),
    })).toMatchObject({
      kind: "comparable_reduced_confidence",
      reasonCodes: expect.arrayContaining(["runtime_added_evidence", "substituted_exposure"]),
    });
  });

  it("keeps reps-only bodyweight not applicable and displayed assistance unsupported", () => {
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "pull-up",
      measurement: { profile: "REPS_BODYWEIGHT", repBasis: "TOTAL" },
      evidence: evidence({ exerciseId: "pull-up", measurement: null }),
    })).toMatchObject({ kind: "not_applicable", reasonCodes: ["bodyweight_no_load_not_applicable"] });
    expect(classifyPrescriptionComparability({
      canonicalExerciseId: "assisted-pull-up",
      measurement: {
        profile: "REPS_ASSISTED",
        loadConvention: "DISPLAYED_ASSISTANCE",
        repBasis: "TOTAL",
      },
      evidence: evidence({ exerciseId: "assisted-pull-up", measurement: null }),
    })).toMatchObject({ kind: "not_comparable", reasonCodes: ["displayed_assistance_unsupported"] });
  });
});

describe("PrescriptionResult compatibility projection", () => {
  it("preserves positive numeric and both existing semantic-zero meanings", () => {
    const numeric = createNumericPrescription({
      canonicalExerciseId: "bench",
      measurement: barbell,
      value: 140,
      source: "exact_history",
      confidence: "high",
      reasonCodes: ["hold"],
      evidence: [],
    });
    const bodyweightZero = createSemanticZeroPrescription({
      canonicalExerciseId: "dip",
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "PER_SIDE",
      },
      zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
    });
    const machineZero = createSemanticZeroPrescription({
      canonicalExerciseId: "machine-calf",
      measurement: machine,
      zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD",
    });
    expect(toTargetLoad(numeric)).toBe(140);
    expect(toTargetLoad(bodyweightZero)).toBe(0);
    expect(toTargetLoad(machineZero)).toBe(0);
    expect(() => createNumericPrescription({ ...numeric, value: 0 })).toThrow(
      "NUMERIC_PRESCRIPTION_REQUIRES_POSITIVE_VALUE",
    );
  });

  it("projects calibration, not-applicable, and unavailable results to null", () => {
    const bodyweight = resolvePrescriptionResult({
      canonicalExerciseId: "pull-up",
      measurement: { profile: "REPS_BODYWEIGHT", repBasis: "TOTAL" },
      zeroLoadMeaning: null,
      candidate: null,
      comparability: null,
      isDeload: false,
    });
    const assistance = resolvePrescriptionResult({
      canonicalExerciseId: "assisted-pull-up",
      measurement: {
        profile: "REPS_ASSISTED",
        loadConvention: "DISPLAYED_ASSISTANCE",
        repBasis: "TOTAL",
      },
      zeroLoadMeaning: null,
      candidate: null,
      comparability: null,
      isDeload: false,
    });
    const unavailable = resolvePrescriptionResult({
      canonicalExerciseId: "bench",
      measurement: barbell,
      zeroLoadMeaning: null,
      candidate: null,
      comparability: null,
      isDeload: false,
    });
    expect(bodyweight).toMatchObject({ kind: "not_applicable" });
    expect(assistance).toMatchObject({
      kind: "unavailable",
      reasonCodes: ["displayed_assistance_unsupported"],
    });
    expect(unavailable).toMatchObject({ kind: "unavailable" });
    expect([bodyweight, assistance, unavailable].map(toTargetLoad)).toEqual([null, null, null]);
  });
});
