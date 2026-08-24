import { describe, expect, it } from "vitest";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import { applyLoadsWithAudit } from "./apply-loads";
import type { Exercise, WorkoutHistoryEntry, WorkoutPlan } from "./types";

const barbell = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;
const machine = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;

const definitions = [
  ["barbell-back-squat", "Barbell Back Squat", "barbell", barbell, true, 185],
  ["barbell-rdl", "Barbell Romanian Deadlift", "barbell", barbell, true, 155],
  ["leg-press", "Leg Press", "machine", machine, false, 240],
  ["hip-abduction", "Hip Abduction Machine", "machine", machine, false, 90],
  ["lying-leg-curl", "Lying Leg Curl", "machine", machine, false, 80],
  ["cable-crunch", "Cable Crunch", "cable", machine, false, 70],
] as const;

const exercises = Object.fromEntries(
  definitions.map(([id, name, equipment, , main]) => [
    id,
    {
      id,
      name,
      movementPatterns: name.includes("Squat") ? ["squat"] : ["isolation"],
      splitTags: ["legs"],
      jointStress: "medium",
      isMainLiftEligible: main,
      isCompound: main,
      equipment: [equipment],
      primaryMuscles: ["Legs"],
    } satisfies Exercise,
  ]),
);

function lowerAWorkout(id: string, date: string): WorkoutPlan {
  const entries = definitions.map(([exerciseId, , , measurement, main], orderIndex) => ({
    id: `${id}:${exerciseId}`,
    exercise: exercises[exerciseId],
    orderIndex,
    isMainLift: main,
    measurement,
    sets: [1, 2, 3].map((setIndex) => ({
      setIndex,
      targetReps: main ? 8 : 12,
      targetRepRange: main ? { min: 6, max: 8 } : { min: 10, max: 12 },
      targetRpe: 8,
    })),
  }));
  return {
    id,
    scheduledDate: date,
    warmup: [],
    mainLifts: entries.filter((entry) => entry.isMainLift),
    accessories: entries.filter((entry) => !entry.isMainLift),
    estimatedMinutes: 60,
  };
}

function lowerAHistory(input: {
  workoutId: string;
  date: string;
  frozen: boolean;
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
    confidence: 1,
    exercises: definitions.map(([exerciseId, , , measurement, , load]) => ({
      exerciseId,
      ...(input.frozen ? { measurement } : {}),
      plannedWorkingSetCount: 3,
      sets: [1, 2, 3].map((setIndex) => ({
        exerciseId,
        setIndex,
        load,
        reps: 12,
        rpe: 8,
        targetLoad: load,
        targetReps: 12,
        targetRepMin: 10,
        targetRepMax: 12,
        targetRpe: 8,
      })),
    })),
  };
}

function generate(workout: WorkoutPlan, history: WorkoutHistoryEntry[]) {
  return applyLoadsWithAudit(workout, {
    history,
    baselines: [],
    exerciseById: exercises,
    primaryGoal: "hypertrophy",
    profile: { trainingAge: "intermediate" },
    sessionIntent: "lower",
    acceptedV4Calibration: true,
    accumulationSessionsCompleted: 1,
    isFirstSessionInMesocycle: false,
    loadIncrementByExerciseId: Object.fromEntries(definitions.map(([id]) => [id, 5])),
  });
}

describe("Lower A Week 1 to Week 3 prescription regression", () => {
  it("calibrates legacy machine evidence in Week 2, then progresses exact Week 2 evidence in Week 3", () => {
    const week1 = lowerAHistory({
      workoutId: "week-1-lower-a",
      date: "2026-08-01T00:00:00.000Z",
      frozen: false,
    });
    const week2 = generate(
      lowerAWorkout("week-2-generation", "2026-08-08T00:00:00.000Z"),
      [week1],
    );

    expect(week2.audit.prescriptions["barbell-back-squat"]).toMatchObject({
      kind: "numeric",
      source: "legacy_barbell_history",
      confidence: "reduced",
    });
    expect(week2.audit.prescriptions["barbell-rdl"]).toMatchObject({
      kind: "numeric",
      source: "legacy_barbell_history",
      confidence: "reduced",
    });
    for (const id of ["leg-press", "hip-abduction", "lying-leg-curl", "cable-crunch"]) {
      expect(week2.audit.prescriptions[id], id).toMatchObject({
        kind: "calibration_required",
        confidence: "low",
        reasonCodes: expect.arrayContaining(["legacy_machine_calibration_only"]),
        priorObservedHint: {
          progressionEligible: false,
          anchor: "representative_working_set",
        },
      });
    }

    const exactWeek2 = lowerAHistory({
      workoutId: "week-2-lower-a",
      date: "2026-08-08T00:00:00.000Z",
      frozen: true,
    });
    const week3 = generate(
      lowerAWorkout("week-3-generation", "2026-08-15T00:00:00.000Z"),
      [exactWeek2, week1],
    );

    for (const [id, , , measurement] of definitions) {
      expect(week3.audit.prescriptions[id], id).toMatchObject({
        kind: "numeric",
        source: "exact_history",
        evidence: [
          expect.objectContaining({
            evidenceId: `week-2-lower-a:${id}`,
            measurement,
            progressionEligible: true,
          }),
        ],
      });
    }
    for (const id of ["leg-press", "hip-abduction", "lying-leg-curl", "cable-crunch"]) {
      expect(week3.audit.prescriptions[id], id).toMatchObject({
        confidence: "reduced",
        reasonCodes: expect.arrayContaining(["same_exercise_displayed_load"]),
      });
      expect(week3.audit.prescriptions[id]?.evidence).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ measurementProvenance: "legacy_null" }),
        ]),
      );
    }
  });
});
