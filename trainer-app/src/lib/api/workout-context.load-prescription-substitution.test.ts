import { describe, expect, it, vi } from "vitest";
import { WorkoutStatus } from "@prisma/client";
import { applyLoadsWithAudit } from "@/lib/engine/apply-loads";
import { autoregulateWorkout } from "@/lib/engine/readiness/autoregulate";
import type { Exercise, WorkoutPlan } from "@/lib/engine/types";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import { mapHistory } from "./workout-context";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

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

const barbellExercise: Exercise = {
  ...exercise,
  id: "barbell-bench-press",
  name: "Barbell Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  isMainLiftEligible: true,
  equipment: ["barbell"],
  primaryMuscles: ["Chest"],
};

function persistedHistoryRow(
  substituted: boolean,
  selectedExercise: Exercise = exercise,
  measurement: MeasurementSemantics = machine,
) {
  const workoutExerciseId = `we-${selectedExercise.id}`;
  return {
    id: substituted ? "substituted-machine" : "clean-machine",
    userId: "u1",
    templateId: null,
    scheduledDate: new Date("2026-08-15T00:00:00.000Z"),
    completedAt: new Date("2026-08-15T01:00:00.000Z"),
    status: WorkoutStatus.COMPLETED,
    estimatedMinutes: 45,
    notes: null,
    selectionMode: "INTENT",
    sessionIntent: "LOWER",
    selectionMetadata: substituted
      ? {
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-08-15T01:00:00.000Z",
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
            ops: [{
              kind: "replace_exercise",
              source: "api_workouts_swap_exercise",
              appliedAt: "2026-08-15T00:20:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId,
                fromExerciseId: "hack-squat",
                fromExerciseName: "Hack Squat",
                toExerciseId: selectedExercise.id,
                toExerciseName: selectedExercise.name,
                reason: "equipment_availability_equivalent_pull_swap",
                setCount: 3,
              },
            }],
          },
        }
      : null,
    revision: 1,
    forcedSplit: null,
    advancesSplit: true,
    trainingBlockId: null,
    weekInBlock: null,
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 2,
    mesoSessionSnapshot: 1,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    exercises: [{
      id: workoutExerciseId,
      workoutId: substituted ? "substituted-machine" : "clean-machine",
      exerciseId: selectedExercise.id,
      orderIndex: 0,
      section: "ACCESSORY",
      isMainLift: false,
      movementPatterns: ["SQUAT"],
      measurementProfile: measurement.profile,
      loadConvention: "loadConvention" in measurement ? measurement.loadConvention : null,
      repBasis: measurement.repBasis,
      zeroLoadMeaning: null,
      stimulusAccountingSnapshot: null,
      notes: null,
      exercise: {
        id: selectedExercise.id,
        name: selectedExercise.name,
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: selectedExercise.primaryMuscles?.[0] ?? "Quads" } }],
      },
      sets: [1, 2, 3].map((setIndex) => ({
        id: `set-${setIndex}`,
        workoutExerciseId,
        setIndex,
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 10,
        targetRpe: 8,
        targetLoad: 100,
        restSeconds: 120,
        logs: [{
          id: `log-${setIndex}`,
          workoutSetId: `set-${setIndex}`,
          actualReps: 10,
          actualRpe: 6,
          actualLoad: 100,
          completedAt: new Date("2026-08-15T00:30:00.000Z"),
          notes: null,
          wasSkipped: false,
        }],
      })),
    }],
  } as never;
}

function nextWorkout(
  selectedExercise: Exercise = exercise,
  measurement: MeasurementSemantics = machine,
): WorkoutPlan {
  return {
    id: "next-workout",
    scheduledDate: "2026-08-22T00:00:00.000Z",
    warmup: [],
    mainLifts: [],
    accessories: [{
      id: `next-${selectedExercise.id}`,
      exercise: selectedExercise,
      orderIndex: 0,
      isMainLift: false,
      measurement,
      sets: [1, 2, 3].map((setIndex) => ({
        setIndex,
        targetReps: 10,
        targetRepRange: { min: 8, max: 10 },
        targetRpe: 8,
      })),
    }],
    estimatedMinutes: 20,
  };
}

function prescribeFromPersistedHistory(
  substituted: boolean,
  selectedExercise: Exercise = exercise,
  measurement: MeasurementSemantics = machine,
) {
  const history = mapHistory([persistedHistoryRow(substituted, selectedExercise, measurement)]);
  const result = applyLoadsWithAudit(nextWorkout(selectedExercise, measurement), {
    history,
    baselines: [],
    exerciseById: { [selectedExercise.id]: selectedExercise },
    primaryGoal: "hypertrophy",
    profile: { trainingAge: "intermediate" },
    sessionIntent: "lower",
    acceptedV4Calibration: true,
    accumulationSessionsCompleted: 1,
    isFirstSessionInMesocycle: false,
    loadIncrementByExerciseId: { [selectedExercise.id]: 5 },
  });
  return {
    history,
    result,
    prescription: result.audit.prescriptions[`next-${selectedExercise.id}`],
  };
}

describe("runtime replacement provenance into load prescription", () => {
  it("holds a substituted exact-machine exposure mapped from persisted replacement metadata", () => {
    const { history, prescription } = prescribeFromPersistedHistory(true);

    expect(history[0].exercises[0]).toMatchObject({
      exerciseId: exercise.id,
      substituted: true,
    });
    expect(prescription).toMatchObject({
      kind: "numeric",
      value: 100,
      confidence: "reduced",
      reasonCodes: expect.arrayContaining([
        "same_exercise_displayed_load",
        "substituted_exposure",
        "hold",
      ]),
      evidence: [expect.objectContaining({ substituted: true, confidence: 0.7 })],
    });
    expect(prescription.reasonCodes).not.toContain("double_progression_increase");
    expect(prescription.reasonCodes).not.toContain("decrease");
  });

  it("still increases from clean exact-machine evidence mapped through the same production seam", () => {
    const { history, prescription } = prescribeFromPersistedHistory(false);

    expect(history[0].exercises[0]).not.toHaveProperty("substituted");
    expect(prescription).toMatchObject({
      kind: "numeric",
      value: 105,
      confidence: "reduced",
      reasonCodes: expect.arrayContaining([
        "same_exercise_displayed_load",
        "double_progression_increase",
      ]),
      evidence: [expect.objectContaining({ substituted: false, confidence: 0.7 })],
    });
  });

  it("blocks a high-confidence substituted barbell increase before readiness projection", () => {
    const { history, result, prescription } = prescribeFromPersistedHistory(
      true,
      barbellExercise,
      barbell,
    );

    expect(history[0].exercises[0]).toMatchObject({
      exerciseId: barbellExercise.id,
      substituted: true,
      measurement: barbell,
    });
    expect(history[0].confidence).toBe(1);
    expect(prescription).toMatchObject({
      kind: "numeric",
      value: 100,
      confidence: "reduced",
      reasonCodes: expect.arrayContaining([
        "same_exercise_same_measurement",
        "substituted_exposure",
        "hold",
      ]),
      evidence: [expect.objectContaining({ substituted: true, confidence: 1 })],
    });
    expect(prescription.reasonCodes).not.toContain("double_progression_increase");

    const readiness = autoregulateWorkout(
      result.workout,
      result.audit,
      {
        overall: 1,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.6,
          performanceContribution: 0.4,
        },
      },
      { aggressiveness: "aggressive", allowUpRegulation: true, allowDownRegulation: true },
    );
    expect(readiness.adjustedWorkout.accessories[0].sets[0].targetLoad).toBe(100);
    expect(readiness.loadAudit.prescriptions[`next-${barbellExercise.id}`]).toMatchObject({
      kind: "numeric",
      value: 100,
      reasonCodes: expect.arrayContaining(["substituted_exposure", "readiness_hold"]),
    });
  });
});
