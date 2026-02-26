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
        wasAutoregulated: false,
        autoregulationLog: null,
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
        wasAutoregulated: false,
        autoregulationLog: null,
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
    });
  });
});
