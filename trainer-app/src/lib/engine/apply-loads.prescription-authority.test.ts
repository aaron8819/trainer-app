import { describe, expect, it } from "vitest";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import { applyLoadsWithAudit } from "./apply-loads";
import { toTargetLoad } from "./load-prescription";
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
  return applyLoadsWithAudit(input.plan ?? workout(machine), {
    history: input.history ?? [],
    baselines: [],
    exerciseById: { [exercise.id]: exercise },
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

    expect(result.audit.prescriptions[exercise.id]).toMatchObject({
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
    expect(missingEffort.audit.prescriptions[exercise.id].reasonCodes).toContain("missing_effort");

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
    expect(weak.audit.prescriptions[exercise.id]).toMatchObject({
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

    expect(result.audit.prescriptions[exercise.id]).toMatchObject({
      kind: "numeric",
      value: 120,
      evidence: [expect.objectContaining({
        evidenceId: "older-valid:leg-press",
        representativeLoad: 120,
      })],
    });
    expect(result.audit.resolvedLoads[exercise.id].historyEvidence).toMatchObject({
      load: 120,
      date: "2026-08-10T00:00:00.000Z",
    });
    expect(emittedTargets(result)).toEqual([120, 120, 120]);
  });

  it("classifies measurement semantics before preserving stale targets", () => {
    const bodyweightResult = generate({ plan: workout(bodyweight, [75, 75, 75]) });
    expect(bodyweightResult.audit.prescriptions[exercise.id].kind).toBe("not_applicable");
    expect(emittedTargets(bodyweightResult)).toEqual([null, null, null]);

    const assistanceResult = generate({ plan: workout(assistance, [75, 75, 75]) });
    expect(assistanceResult.audit.prescriptions[exercise.id]).toMatchObject({
      kind: "unavailable",
      reasonCodes: ["displayed_assistance_unsupported"],
    });
    expect(emittedTargets(assistanceResult)).toEqual([null, null, null]);

    const zeroResult = generate({
      plan: workout(machine, [0, 75, 75], "MACHINE_DEFAULT_NO_ADDED_LOAD"),
    });
    expect(zeroResult.audit.prescriptions[exercise.id].kind).toBe("semantic_zero");
    expect(emittedTargets(zeroResult)).toEqual([0, 0, 0]);

    const externalResult = generate({ plan: workout(barbell, [75, 80, 80]) });
    expect(externalResult.audit.prescriptions[exercise.id]).toMatchObject({
      kind: "numeric",
      source: "existing_target",
      value: 75,
    });
    expect(emittedTargets(externalResult)).toEqual([75, 75, 75]);
  });

  it("projects every emitted set target through the exercise PrescriptionResult", () => {
    const cases = [
      generate({ history: [history({ workoutId: "numeric", date: "2026-08-15", measurement: machine, load: 100, reps: 10, rpe: 8 })] }),
      generate({ plan: workout(machine, [0, 0, 0], "MACHINE_DEFAULT_NO_ADDED_LOAD") }),
      generate({ history: [history({ workoutId: "calibration", date: "2026-08-15", load: 100, reps: 10, rpe: 8 })] }),
      generate({ plan: workout(bodyweight, [75, 75, 75]) }),
      generate({ history: [history({ workoutId: "unavailable", date: "2026-08-15", measurement: machine, load: 100, reps: 0 })] }),
    ];
    expect(cases.map((result) => result.audit.prescriptions[exercise.id].kind)).toEqual([
      "numeric",
      "semantic_zero",
      "calibration_required",
      "not_applicable",
      "unavailable",
    ]);
    expect(cases[4].audit.prescriptions[exercise.id]).toMatchObject({
      kind: "unavailable",
      reasonCodes: expect.arrayContaining(["missing_reps"]),
      blockingFields: expect.arrayContaining(["performedReps"]),
    });
    for (const result of cases) {
      const prescription = result.audit.prescriptions[exercise.id];
      const projected = toTargetLoad(prescription);
      expect(emittedTargets(result)).toEqual([projected, projected, projected]);
    }
  });
});
