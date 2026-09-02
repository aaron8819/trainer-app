import { describe, expect, it } from "vitest";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import { applyLoadsWithAudit } from "./apply-loads";
import { autoregulateWorkout } from "./readiness/autoregulate";
import { toTargetLoad } from "./load-prescription";
import { buildPrescriptionReadouts } from "@/lib/api/prescription-readout";
import type { Exercise, WorkoutHistoryEntry, WorkoutPlan } from "./types";

const machine = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const barbell = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const bodyweight = {
  profile: "REPS_BODYWEIGHT",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const assistance = {
  profile: "REPS_ASSISTED",
  loadConvention: "DISPLAYED_ASSISTANCE",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const bodyweightSemanticZero = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "PER_SIDE",
} as const satisfies MeasurementSemantics;

const exercise: Exercise = {
  id: "leg-press",
  name: "Leg Press",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  jointStress: "medium",
  isMainLiftEligible: false,
  isCompound: true,
  equipment: ["machine"],
  primaryMuscles: ["Quads"],
};
const placementId = "next-leg-press";

function workout(
  measurement: MeasurementSemantics,
  targetLoads: Array<number | undefined> = [undefined, undefined, undefined],
  zeroLoadMeaning?: "BODYWEIGHT_NO_ADDED_LOAD" | "MACHINE_DEFAULT_NO_ADDED_LOAD",
): WorkoutPlan {
  return {
    id: "next-workout",
    scheduledDate: "2026-08-20T00:00:00.000Z",
    warmup: [],
    mainLifts: [],
    accessories: [{
      id: "next-leg-press",
      exercise,
      orderIndex: 0,
      isMainLift: false,
      measurement,
      ...(zeroLoadMeaning ? { zeroLoadMeaning } : {}),
      sets: targetLoads.map((targetLoad, index) => ({
        setIndex: index + 1,
        targetReps: 10,
        targetRepRange: { min: 8, max: 10 },
        targetRpe: 8,
        ...(targetLoad === undefined ? {} : { targetLoad }),
      })),
    }],
    estimatedMinutes: 20,
  };
}

function history(input: {
  workoutId: string;
  date: string;
  measurement?: MeasurementSemantics;
  load: number;
  reps: number;
  rpe?: number;
  confidence?: number;
}): WorkoutHistoryEntry {
  return {
    workoutId: input.workoutId,
    date: input.date,
    completed: true,
    status: "COMPLETED",
    progressionEligible: true,
    performanceEligible: true,
    selectionMode: "INTENT",
    sessionIntent: "lower",
    confidence: input.confidence ?? 1,
    exercises: [{
      exerciseId: exercise.id,
      ...(input.measurement ? { measurement: input.measurement } : {}),
      plannedWorkingSetCount: 3,
      sets: [1, 2, 3].map((setIndex) => ({
        exerciseId: exercise.id,
        setIndex,
        load: input.load,
        reps: input.reps,
        ...(input.rpe == null ? {} : { rpe: input.rpe }),
        targetLoad: input.load,
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 10,
        targetRpe: 8,
      })),
    }],
  };
}

function generate(input: {
  plan?: WorkoutPlan;
  history?: WorkoutHistoryEntry[];
}) {
  const plan = input.plan ?? workout(machine);
  const exerciseById = Object.fromEntries(
    [...plan.mainLifts, ...plan.accessories].map((entry) => [
      entry.exercise.id,
      entry.exercise,
    ]),
  );
  return applyLoadsWithAudit(plan, {
    history: input.history ?? [],
    baselines: [],
    exerciseById,
    primaryGoal: "hypertrophy",
    profile: { trainingAge: "intermediate" },
    sessionIntent: "lower",
    acceptedV4Calibration: true,
    accumulationSessionsCompleted: 1,
    isFirstSessionInMesocycle: false,
    loadIncrementByExerciseId: { [exercise.id]: 5 },
  });
}

function emittedTargets(result: ReturnType<typeof generate>): Array<number | null> {
  return result.workout.accessories[0].sets.map((set) => set.targetLoad ?? null);
}

describe("PrescriptionResult production authority", () => {
  it.each([
    { name: "increase", rpe: 6, expected: 105 },
    { name: "hold", rpe: 8, expected: 100 },
    { name: "decrease", rpe: 10, expected: 95 },
  ])("allows clean exact displayed-machine evidence to $name at reduced confidence", ({ rpe, expected }) => {
    const result = generate({
      history: [history({
        workoutId: `machine-${rpe}`,
        date: "2026-08-15T00:00:00.000Z",
        measurement: machine,
        load: 100,
        reps: rpe === 10 ? 7 : 10,
        rpe,
      })],
    });

    expect(result.audit.prescriptions[placementId]).toMatchObject({
      kind: "numeric",
      value: expected,
      confidence: "reduced",
      evidence: [expect.objectContaining({ confidence: 0.7 })],
    });
    expect(emittedTargets(result)).toEqual([expected, expected, expected]);
  });

  it("holds when displayed-machine effort is missing and never raises weaker confidence to the cap", () => {
    const missingEffort = generate({
      history: [history({
        workoutId: "missing-effort",
        date: "2026-08-15T00:00:00.000Z",
        measurement: machine,
        load: 100,
        reps: 10,
      })],
    });
    expect(emittedTargets(missingEffort)).toEqual([100, 100, 100]);
    expect(missingEffort.audit.prescriptions[placementId].reasonCodes).toContain("missing_effort");

    const weak = generate({
      history: [history({
        workoutId: "weak-machine",
        date: "2026-08-15T00:00:00.000Z",
        measurement: machine,
        load: 100,
        reps: 10,
        rpe: 6,
        confidence: 0.4,
      })],
    });
    expect(emittedTargets(weak)).toEqual([100, 100, 100]);
    expect(weak.audit.prescriptions[placementId]).toMatchObject({
      kind: "numeric",
      evidence: [expect.objectContaining({ confidence: 0.4 })],
    });
  });

  it("binds load, progression, and provenance to the newest valid comparable exposure", () => {
    const result = generate({
      history: [
        history({
          workoutId: "new-invalid",
          date: "2026-08-15T00:00:00.000Z",
          measurement: machine,
          load: 140,
          reps: 0,
        }),
        history({
          workoutId: "older-valid",
          date: "2026-08-10T00:00:00.000Z",
          measurement: machine,
          load: 120,
          reps: 10,
          rpe: 8,
        }),
      ],
    });

    expect(result.audit.prescriptions[placementId]).toMatchObject({
      kind: "numeric",
      value: 120,
      evidence: [expect.objectContaining({
        evidenceId: "older-valid:leg-press",
        representativeLoad: 120,
      })],
    });
    expect(result.audit.resolvedLoads[placementId].historyEvidence).toMatchObject({
      load: 120,
      date: "2026-08-10T00:00:00.000Z",
    });
    expect(emittedTargets(result)).toEqual([120, 120, 120]);
  });

  it("classifies measurement semantics before preserving stale targets", () => {
    const bodyweightResult = generate({ plan: workout(bodyweight, [75, 75, 75]) });
    expect(bodyweightResult.audit.prescriptions[placementId].kind).toBe("not_applicable");
    expect(emittedTargets(bodyweightResult)).toEqual([null, null, null]);

    const assistanceResult = generate({ plan: workout(assistance, [75, 75, 75]) });
    expect(assistanceResult.audit.prescriptions[placementId]).toMatchObject({
      kind: "unavailable",
      reasonCodes: ["displayed_assistance_unsupported"],
    });
    expect(emittedTargets(assistanceResult)).toEqual([null, null, null]);

    const zeroResult = generate({
      plan: workout(machine, [0, 75, 75], "MACHINE_DEFAULT_NO_ADDED_LOAD"),
    });
    expect(zeroResult.audit.prescriptions[placementId].kind).toBe("semantic_zero");
    expect(emittedTargets(zeroResult)).toEqual([0, 0, 0]);

    const externalResult = generate({ plan: workout(barbell, [75, 80, 80]) });
    expect(externalResult.audit.prescriptions[placementId]).toMatchObject({
      kind: "numeric",
      source: "existing_target",
      value: 75,
    });
    expect(emittedTargets(externalResult)).toEqual([75, 75, 75]);
  });

  it.each([
    {
      name: "bodyweight/no-added-load",
      measurement: bodyweightSemanticZero,
      zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD" as const,
    },
    {
      name: "machine-default/no-added-load",
      measurement: machine,
      zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
    },
  ])("keeps $name semantic zero consistent from final workout through projection", ({
    measurement,
    zeroLoadMeaning,
  }) => {
    const result = generate({
      plan: workout(measurement, [0, 0, 0], zeroLoadMeaning),
    });
    const finalExercise = result.workout.accessories[0];
    const prescription = result.audit.prescriptions[placementId];
    const [readout] = buildPrescriptionReadouts({
      workout: result.workout,
      prescriptionResultsByPlacement: result.audit.prescriptions,
      resolvedLoadsByPlacement: result.audit.resolvedLoads,
    });

    expect(finalExercise.zeroLoadMeaning).toBe(zeroLoadMeaning);
    expect(prescription).toMatchObject({
      kind: "semantic_zero",
      value: 0,
      zeroLoadMeaning,
    });
    expect(readout).toMatchObject({
      placementId,
      prescriptionKind: "semantic_zero",
      targetLoad: 0,
      zeroLoadMeaning,
    });
    expect(readout.targetLoad).toBe(0);
    expect(readout.targetLoad).not.toBeNull();
  });

  it("does not infer semantic zero from legacy bodyweight equipment", () => {
    const legacyWorkout = workout(machine, [0, 0, 0]);
    legacyWorkout.accessories[0] = {
      ...legacyWorkout.accessories[0],
      exercise: {
        ...legacyWorkout.accessories[0].exercise,
        id: "legacy-dip",
        name: "Legacy Dip",
        equipment: ["bodyweight", "machine"],
      },
      measurement: undefined,
      zeroLoadMeaning: undefined,
    };

    const result = generate({ plan: legacyWorkout });
    const prescription = result.audit.prescriptions[placementId];
    const [readout] = buildPrescriptionReadouts({
      workout: result.workout,
      prescriptionResultsByPlacement: result.audit.prescriptions,
      resolvedLoadsByPlacement: result.audit.resolvedLoads,
    });

    expect(prescription).toMatchObject({
      canonicalExerciseId: "legacy-dip",
      kind: "unavailable",
    });
    expect(result.workout.accessories[0].zeroLoadMeaning ?? null).toBeNull();
    expect(readout).toMatchObject({
      targetLoad: null,
      prescriptionKind: "unavailable",
      zeroLoadMeaning: null,
    });
  });

  it("projects every emitted set target through the exercise PrescriptionResult", () => {
    const cases = [
      generate({ history: [history({ workoutId: "numeric", date: "2026-08-15", measurement: machine, load: 100, reps: 10, rpe: 8 })] }),
      generate({ plan: workout(machine, [0, 0, 0], "MACHINE_DEFAULT_NO_ADDED_LOAD") }),
      generate({ history: [history({ workoutId: "calibration", date: "2026-08-15", load: 100, reps: 10, rpe: 8 })] }),
      generate({ plan: workout(bodyweight, [75, 75, 75]) }),
      generate({ history: [history({ workoutId: "unavailable", date: "2026-08-15", measurement: machine, load: 100, reps: 0 })] }),
    ];
    expect(cases.map((result) => result.audit.prescriptions[placementId].kind)).toEqual([
      "numeric",
      "semantic_zero",
      "calibration_required",
      "not_applicable",
      "unavailable",
    ]);
    expect(cases[4].audit.prescriptions[placementId]).toMatchObject({
      kind: "unavailable",
      reasonCodes: expect.arrayContaining(["missing_reps"]),
      blockingFields: expect.arrayContaining(["performedReps"]),
    });
    for (const result of cases) {
      const prescription = result.audit.prescriptions[placementId];
      const projected = toTargetLoad(prescription);
      expect(emittedTargets(result)).toEqual([projected, projected, projected]);
    }
  });

  it("keeps duplicate canonical exercises distinct through base authority and readiness projection", () => {
    const duplicateWorkout: WorkoutPlan = {
      id: "duplicate-bench-workout",
      scheduledDate: "2026-08-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "bench-placement-a",
          exercise: { ...exercise, id: "bench", name: "Bench Press", equipment: ["barbell"] },
          orderIndex: 0,
          isMainLift: true,
          measurement: barbell,
          sets: [{ setIndex: 1, targetReps: 6, targetRpe: 8, targetLoad: 105 }],
        },
        {
          id: "bench-placement-b",
          exercise: { ...exercise, id: "bench", name: "Bench Press", equipment: ["barbell"] },
          orderIndex: 1,
          isMainLift: true,
          measurement: barbell,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8, targetLoad: 95 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };
    const base = applyLoadsWithAudit(duplicateWorkout, {
      history: [],
      baselines: [],
      exerciseById: { bench: duplicateWorkout.mainLifts[0].exercise },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
      acceptedV4Calibration: true,
    });

    expect(Object.keys(base.audit.prescriptions)).toEqual([
      "bench-placement-a",
      "bench-placement-b",
    ]);
    expect(base.audit.prescriptions["bench-placement-a"]).toMatchObject({
      canonicalExerciseId: "bench",
      kind: "numeric",
      value: 105,
    });
    expect(base.audit.prescriptions["bench-placement-b"]).toMatchObject({
      canonicalExerciseId: "bench",
      kind: "numeric",
      value: 95,
    });
    expect(base.audit.resolvedLoads["bench-placement-a"]).toMatchObject({
      placementId: "bench-placement-a",
      canonicalExerciseId: "bench",
      resolvedTopSetLoad: 105,
    });
    expect(base.audit.resolvedLoads["bench-placement-b"]).toMatchObject({
      placementId: "bench-placement-b",
      canonicalExerciseId: "bench",
      resolvedTopSetLoad: 95,
    });
    expect(buildPrescriptionReadouts({
      workout: base.workout,
      prescriptionResultsByPlacement: base.audit.prescriptions,
      resolvedLoadsByPlacement: base.audit.resolvedLoads,
    }))
      .toMatchObject([
        { placementId: "bench-placement-a", exerciseId: "bench", targetLoad: 105 },
        { placementId: "bench-placement-b", exerciseId: "bench", targetLoad: 95 },
      ]);

    const readiness = autoregulateWorkout(
      base.workout,
      base.audit,
      {
        overall: 0.4,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.2,
          performanceContribution: 0.2,
        },
      },
    );
    expect(readiness.adjustedWorkout.mainLifts.map((entry) => entry.sets[0].targetLoad)).toEqual([
      94.5,
      85.5,
    ]);
    expect(readiness.loadAudit.prescriptions["bench-placement-a"]).toMatchObject({ value: 94.5 });
    expect(readiness.loadAudit.prescriptions["bench-placement-b"]).toMatchObject({ value: 85.5 });
    expect(readiness.loadAudit.resolvedLoads["bench-placement-a"].resolvedTopSetLoad).toBe(94.5);
    expect(readiness.loadAudit.resolvedLoads["bench-placement-b"].resolvedTopSetLoad).toBe(85.5);
    expect(buildPrescriptionReadouts({
      workout: readiness.adjustedWorkout,
      prescriptionResultsByPlacement: readiness.loadAudit.prescriptions,
      resolvedLoadsByPlacement: readiness.loadAudit.resolvedLoads,
    })).toMatchObject([
      { placementId: "bench-placement-a", exerciseId: "bench", targetLoad: 94.5 },
      { placementId: "bench-placement-b", exerciseId: "bench", targetLoad: 85.5 },
    ]);
  });
});
