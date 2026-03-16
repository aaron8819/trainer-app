import { describe, expect, it } from "vitest";
import { finalizeDeloadSessionResult } from "./finalize-session";

describe("finalizeDeloadSessionResult", () => {
  it("stamps deload traces with final resolved loads from the canonical load engine", () => {
    const result = finalizeDeloadSessionResult({
      mapped: {
        mappedGoals: { primary: "hypertrophy" },
        mappedProfile: { trainingAge: "intermediate", weightKg: 90 },
        exerciseLibrary: [
          {
            id: "row",
            name: "Chest Supported Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
        ],
        history: [
          {
            date: "2026-03-01T00:00:00.000Z",
            status: "COMPLETED",
            selectionMode: "INTENT",
            sessionIntent: "pull",
            mesocycleSnapshot: {
              week: 4,
              phase: "ACCUMULATION",
            },
            exercises: [
              {
                exerciseId: "row",
                sets: [
                  { setIndex: 1, reps: 10, load: 100, rpe: 7 },
                  { setIndex: 2, reps: 10, load: 100, rpe: 7.5 },
                ],
              },
            ],
          },
        ],
        weekInBlock: 5,
        mesocycleLength: 5,
        lifecycleWeek: 5,
        lifecycleRirTarget: { min: 5, max: 6 },
        lifecycleVolumeTargets: { "Upper Back": 8 },
        sorenessSuppressedMuscles: [],
        activeMesocycle: {
          accumulationSessionsCompleted: 12,
        },
        effectivePeriodization: {
          isDeload: true,
          backOffMultiplier: 0.8,
        },
        mappedConstraints: {},
        mappedCheckIn: {},
        mappedPreferences: {},
        rawExercises: [],
        rawWorkouts: [],
        adaptiveDeload: false,
        deloadDecision: {
          mode: "scheduled",
          reason: ["Scheduled deload"],
          reductionPercent: 50,
          appliedTo: "both",
        },
        blockContext: null,
        rotationContext: {},
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 5,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
          source: "computed",
        },
        mesocycleRoleMapByIntent: {
          pull: new Map(),
        },
      } as never,
      workout: {
        id: "workout-deload",
        scheduledDate: "2026-03-08T00:00:00.000Z",
        warmup: [],
        mainLifts: [
          {
            id: "row-entry",
            exercise: {
              id: "row",
              name: "Chest Supported Row",
              movementPatterns: ["horizontal_pull"],
              splitTags: ["pull"],
              jointStress: "medium",
              equipment: ["machine"],
            },
            orderIndex: 0,
            isMainLift: true,
            role: "main",
            sets: [
              { setIndex: 1, targetReps: 10, targetRpe: 4.5, role: "main" },
              { setIndex: 2, targetReps: 10, targetRpe: 4.5, role: "main" },
            ],
          },
        ],
        accessories: [],
        estimatedMinutes: 30,
      },
      selection: {
        selectedExerciseIds: ["row"],
        mainLiftIds: ["row"],
        accessoryIds: [],
        perExerciseSetTargets: { row: 2 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      selectionMode: "INTENT",
      sessionIntent: "pull",
      note: "Scheduled deload week.",
      deloadTrace: {
        version: 1,
        sessionIntent: "pull",
        targetRpe: 4.5,
        setFactor: 0.5,
        minSets: 1,
        exerciseCount: 1,
        exercises: [
          {
            exerciseId: "row",
            exerciseName: "Chest Supported Row",
            isMainLift: true,
            baselineSetCount: 4,
            baselineRepAnchor: 10,
            deloadSetCount: 2,
            anchoredLoad: null,
            anchoredLoadSource: "latest_accumulation",
            peakAccumulationLoadCount: 0,
            latestAccumulationLoadCount: 2,
          },
        ],
      },
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const resolvedTopSetLoad = result.workout.mainLifts[0]?.sets[0]?.targetLoad;
    expect(resolvedTopSetLoad).toBeTypeOf("number");
    expect(result.audit?.deloadTrace?.exercises[0]).toMatchObject({
      anchoredLoadSource: "latest_accumulation",
      canonicalSourceLoadSource: "history",
      resolvedLoadSource: "history",
      resolvedTopSetLoad,
      resolvedSetLoads: [resolvedTopSetLoad, resolvedTopSetLoad],
    });
    expect(result.audit?.deloadTrace?.exercises[0]?.canonicalSourceLoad).toBeGreaterThan(
      resolvedTopSetLoad ?? 0
    );
    expect(result.audit?.deloadTrace?.exercises[0]?.anchoredLoad).toBe(
      result.audit?.deloadTrace?.exercises[0]?.canonicalSourceLoad
    );
  });
});
