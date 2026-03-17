/**
 * Protects: Performed-work-only adaptation: no planned fallback in history/progression/explainability/readiness.
 * Why it matters: Mapping planned targets as completed work would poison adaptation decisions.
 */
import { describe, expect, it } from "vitest";
import { WorkoutStatus } from "@prisma/client";
import { mapHistory } from "./workout-context";

describe("mapHistory", () => {
  it("uses only performed non-skipped logs and never falls back to planned targets", () => {
    const history = mapHistory([
      {
        id: "w1",
        userId: "u1",
        templateId: null,
        scheduledDate: new Date("2026-02-20T00:00:00.000Z"),
        completedAt: new Date("2026-02-20T01:00:00.000Z"),
        status: WorkoutStatus.COMPLETED,
        estimatedMinutes: 60,
        notes: null,
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        selectionMetadata: null,
        revision: 1,
        forcedSplit: null,
        advancesSplit: true,
        trainingBlockId: null,
        weekInBlock: null,
        mesocycleWeekSnapshot: 4,
        mesoSessionSnapshot: 2,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          {
            id: "we1",
            workoutId: "w1",
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            movementPatterns: [],
            notes: null,
            exercise: {
              id: "bench",
              name: "Bench Press",
              movementPatterns: [],
              splitTags: [],
              jointStress: "MEDIUM",
              isMainLiftEligible: true,
              isCompound: true,
              fatigueCost: 3,
              stimulusBias: [],
              contraindications: null,
              timePerSetSec: 120,
              sfrScore: 3,
              lengthPositionScore: 3,
              difficulty: "INTERMEDIATE",
              isUnilateral: false,
              repRangeMin: 5,
              repRangeMax: 12,
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest", sraHours: 48 } }],
            },
            sets: [
              {
                id: "s1",
                workoutExerciseId: "we1",
                setIndex: 1,
                targetReps: 8,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 185,
                restSeconds: 180,
                logs: [
                  {
                    id: "l1",
                    workoutSetId: "s1",
                    actualReps: 8,
                    actualRpe: 8,
                    actualLoad: 185,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: false,
                  },
                ],
              },
              {
                id: "s2",
                workoutExerciseId: "we1",
                setIndex: 2,
                targetReps: 8,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 185,
                restSeconds: 180,
                logs: [
                  {
                    id: "l2",
                    workoutSetId: "s2",
                    actualReps: null,
                    actualRpe: null,
                    actualLoad: null,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: true,
                  },
                ],
              },
              {
                id: "s3",
                workoutExerciseId: "we1",
                setIndex: 3,
                targetReps: 8,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 185,
                restSeconds: 180,
                logs: [],
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].exercises[0].sets).toHaveLength(1);
    expect(history[0].exercises[0].sets[0]).toMatchObject({
      setIndex: 1,
      reps: 8,
      load: 185,
      targetLoad: 185,
    });
    expect(history[0].mesocycleSnapshot).toEqual({
      mesocycleId: undefined,
      week: 4,
      session: 2,
      phase: "ACCUMULATION",
      slotId: null,
    });
  });

  it("excludes low-effort warmup/feeler sets (RPE < 6) from progression history signals", () => {
    const history = mapHistory([
      {
        id: "w2",
        userId: "u1",
        templateId: null,
        scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
        completedAt: new Date("2026-02-21T01:00:00.000Z"),
        status: WorkoutStatus.COMPLETED,
        estimatedMinutes: 45,
        notes: null,
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: null,
        revision: 1,
        forcedSplit: null,
        advancesSplit: true,
        trainingBlockId: null,
        weekInBlock: null,
        exercises: [
          {
            id: "we2",
            workoutId: "w2",
            exerciseId: "rear-delt-fly",
            orderIndex: 0,
            section: "ACCESSORY",
            isMainLift: false,
            movementPatterns: [],
            notes: null,
            exercise: {
              id: "rear-delt-fly",
              name: "Rear Delt Fly",
              movementPatterns: [],
              splitTags: [],
              jointStress: "LOW",
              isMainLiftEligible: false,
              isCompound: false,
              fatigueCost: 2,
              stimulusBias: [],
              contraindications: null,
              timePerSetSec: 120,
              sfrScore: 3,
              lengthPositionScore: 3,
              difficulty: "INTERMEDIATE",
              isUnilateral: false,
              repRangeMin: 10,
              repRangeMax: 20,
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts", sraHours: 48 } }],
            },
            sets: [
              {
                id: "s21",
                workoutExerciseId: "we2",
                setIndex: 1,
                targetReps: 12,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 20,
                restSeconds: 90,
                logs: [
                  {
                    id: "l21",
                    workoutSetId: "s21",
                    actualReps: 15,
                    actualRpe: 5,
                    actualLoad: 15,
                    completedAt: new Date(),
                    notes: "warmup feel set",
                    wasSkipped: false,
                  },
                ],
              },
              {
                id: "s22",
                workoutExerciseId: "we2",
                setIndex: 2,
                targetReps: 12,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 20,
                restSeconds: 90,
                logs: [
                  {
                    id: "l22",
                    workoutSetId: "s22",
                    actualReps: 12,
                    actualRpe: 8,
                    actualLoad: 20,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: false,
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(history[0].exercises[0].sets).toHaveLength(1);
    expect(history[0].exercises[0].sets[0]).toMatchObject({
      setIndex: 2,
      reps: 12,
      rpe: 8,
      load: 20,
      targetLoad: 20,
    });
  });

  it("excludes resolved load-only rows from progression history signals", () => {
    const history = mapHistory([
      {
        id: "w-load-only",
        userId: "u1",
        templateId: null,
        scheduledDate: new Date("2026-02-23T00:00:00.000Z"),
        completedAt: new Date("2026-02-23T01:00:00.000Z"),
        status: WorkoutStatus.COMPLETED,
        estimatedMinutes: 45,
        notes: null,
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: null,
        revision: 1,
        forcedSplit: null,
        advancesSplit: true,
        trainingBlockId: null,
        weekInBlock: null,
        exercises: [
          {
            id: "we-load-only",
            workoutId: "w-load-only",
            exerciseId: "lat-pull",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: false,
            movementPatterns: [],
            notes: null,
            exercise: {
              id: "lat-pull",
              name: "Lat Pulldown",
              movementPatterns: [],
              splitTags: [],
              jointStress: "LOW",
              isMainLiftEligible: false,
              isCompound: false,
              fatigueCost: 2,
              stimulusBias: [],
              contraindications: null,
              timePerSetSec: 120,
              sfrScore: 3,
              lengthPositionScore: 3,
              difficulty: "INTERMEDIATE",
              isUnilateral: false,
              repRangeMin: 8,
              repRangeMax: 12,
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats", sraHours: 48 } }],
            },
            sets: [
              {
                id: "s-load-only",
                workoutExerciseId: "we-load-only",
                setIndex: 1,
                targetReps: 10,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 120,
                restSeconds: 90,
                logs: [
                  {
                    id: "l-load-only",
                    workoutSetId: "s-load-only",
                    actualReps: null,
                    actualRpe: null,
                    actualLoad: 120,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: false,
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(history[0].exercises[0].sets).toHaveLength(0);
  });

  it("marks strict supplemental deficit sessions as progression-ineligible while keeping them performed", () => {
    const history = mapHistory([
      {
        id: "w3",
        userId: "u1",
        templateId: null,
        scheduledDate: new Date("2026-02-22T00:00:00.000Z"),
        completedAt: new Date("2026-02-22T01:00:00.000Z"),
        status: WorkoutStatus.COMPLETED,
        estimatedMinutes: 45,
        notes: null,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            lifecycleVolume: {
              source: "unknown",
            },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [
              {
                code: "supplemental_deficit_session",
                message: "Marked as supplemental deficit session.",
              },
            ],
          },
        },
        revision: 1,
        forcedSplit: null,
        advancesSplit: false,
        trainingBlockId: null,
        weekInBlock: null,
        exercises: [
          {
            id: "we3",
            workoutId: "w3",
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            movementPatterns: [],
            notes: null,
            exercise: {
              id: "bench",
              name: "Bench Press",
              movementPatterns: [],
              splitTags: [],
              jointStress: "MEDIUM",
              isMainLiftEligible: true,
              isCompound: true,
              fatigueCost: 3,
              stimulusBias: [],
              contraindications: null,
              timePerSetSec: 120,
              sfrScore: 3,
              lengthPositionScore: 3,
              difficulty: "INTERMEDIATE",
              isUnilateral: false,
              repRangeMin: 5,
              repRangeMax: 12,
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest", sraHours: 48 } }],
            },
            sets: [
              {
                id: "s31",
                workoutExerciseId: "we3",
                setIndex: 1,
                targetReps: 10,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 8,
                targetLoad: 155,
                restSeconds: 120,
                logs: [
                  {
                    id: "l31",
                    workoutSetId: "s31",
                    actualReps: 10,
                    actualRpe: 8,
                    actualLoad: 155,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: false,
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("COMPLETED");
    expect(history[0].progressionEligible).toBe(false);
    expect(history[0].exercises[0].sets).toHaveLength(1);
  });

  it("marks scheduled deload sessions as performed but excludes them from progression and performance history", () => {
    const history = mapHistory([
      {
        id: "w-deload",
        userId: "u1",
        templateId: null,
        scheduledDate: new Date("2026-02-28T00:00:00.000Z"),
        completedAt: new Date("2026-02-28T01:00:00.000Z"),
        status: WorkoutStatus.COMPLETED,
        estimatedMinutes: 35,
        notes: null,
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
            lifecycleVolume: {
              source: "unknown",
            },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "scheduled",
              reason: ["Scheduled deload week."],
              reductionPercent: 50,
              appliedTo: "volume",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [],
          },
        },
        revision: 1,
        forcedSplit: null,
        advancesSplit: true,
        trainingBlockId: null,
        weekInBlock: null,
        mesocycleWeekSnapshot: 5,
        mesoSessionSnapshot: 1,
        mesocyclePhaseSnapshot: "DELOAD",
        exercises: [
          {
            id: "we-deload",
            workoutId: "w-deload",
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            movementPatterns: [],
            notes: null,
            exercise: {
              id: "bench",
              name: "Bench Press",
              movementPatterns: [],
              splitTags: [],
              jointStress: "MEDIUM",
              isMainLiftEligible: true,
              isCompound: true,
              fatigueCost: 3,
              stimulusBias: [],
              contraindications: null,
              timePerSetSec: 120,
              sfrScore: 3,
              lengthPositionScore: 3,
              difficulty: "INTERMEDIATE",
              isUnilateral: false,
              repRangeMin: 5,
              repRangeMax: 12,
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest", sraHours: 48 } }],
            },
            sets: [
              {
                id: "s-deload",
                workoutExerciseId: "we-deload",
                setIndex: 1,
                targetReps: 8,
                targetRepMin: null,
                targetRepMax: null,
                targetRpe: 5,
                targetLoad: 155,
                restSeconds: 120,
                logs: [
                  {
                    id: "l-deload",
                    workoutSetId: "s-deload",
                    actualReps: 8,
                    actualRpe: 5,
                    actualLoad: 155,
                    completedAt: new Date(),
                    notes: null,
                    wasSkipped: false,
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].isDeload).toBe(true);
    expect(history[0].progressionEligible).toBe(false);
    expect(history[0].performanceEligible).toBe(false);
    expect(history[0].advancesSplit).toBe(true);
  });
});
