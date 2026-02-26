import { describe, expect, it } from "vitest";
import { WorkoutStatus } from "@prisma/client";
import { mapHistory } from "./workout-context";

function makeWorkout(input: {
  id: string;
  date: string;
  selectionMode: "INTENT" | "MANUAL" | "AUTO";
  exerciseId?: string;
  loads: number[];
  rpes: number[];
}) {
  const exerciseId = input.exerciseId ?? "bench";
  return {
    id: input.id,
    userId: "u1",
    templateId: null,
    scheduledDate: new Date(input.date),
    completedAt: new Date(input.date),
    status: WorkoutStatus.COMPLETED,
    estimatedMinutes: 45,
    notes: null,
    selectionMode: input.selectionMode,
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
        id: `we-${input.id}`,
        workoutId: input.id,
        exerciseId,
        orderIndex: 0,
        section: "MAIN",
        isMainLift: true,
        movementPatterns: [],
        notes: null,
        exercise: {
          id: exerciseId,
          name: exerciseId,
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
        sets: input.loads.map((load, idx) => ({
          id: `set-${input.id}-${idx + 1}`,
          workoutExerciseId: `we-${input.id}`,
          setIndex: idx + 1,
          targetReps: 8,
          targetRepMin: null,
          targetRepMax: null,
          targetRpe: 8,
          targetLoad: load,
          restSeconds: 120,
          logs: [
            {
              id: `log-${input.id}-${idx + 1}`,
              workoutSetId: `set-${input.id}-${idx + 1}`,
              actualReps: 8,
              actualRpe: input.rpes[idx],
              actualLoad: load,
              completedAt: new Date(input.date),
              notes: null,
              wasSkipped: false,
            },
          ],
        })),
      },
    ],
  } as never;
}

describe("mapHistory manual confidence and anomaly handling", () => {
  it("assigns MANUAL confidence at 0.7 vs INTENT at 1.0", () => {
    const history = mapHistory([
      makeWorkout({
        id: "w1",
        date: "2026-02-18T00:00:00.000Z",
        selectionMode: "INTENT",
        loads: [200, 200],
        rpes: [8, 8],
      }),
      makeWorkout({
        id: "w2",
        date: "2026-02-19T00:00:00.000Z",
        selectionMode: "MANUAL",
        loads: [190, 190],
        rpes: [8, 8.5],
      }),
    ]);

    const intentEntry = history.find((entry) => entry.selectionMode === "INTENT");
    const manualEntry = history.find((entry) => entry.selectionMode === "MANUAL");
    expect(intentEntry?.confidence).toBe(1);
    expect(manualEntry?.confidence).toBe(0.7);
  });

  it("flags uniform-RPE MANUAL sessions and applies anomaly confidence 0.3", () => {
    const history = mapHistory([
      makeWorkout({
        id: "w3",
        date: "2026-02-20T00:00:00.000Z",
        selectionMode: "MANUAL",
        loads: [180, 180, 180],
        rpes: [8, 8, 8],
      }),
    ]);

    expect(history[0].confidence).toBe(0.3);
    expect(history[0].anomalyFlags).toContain("uniform_rpe_synthetic");
  });

  it("flags load regression anomalies against recent INTENT history", () => {
    const history = mapHistory([
      makeWorkout({
        id: "w4",
        date: "2026-02-18T00:00:00.000Z",
        selectionMode: "INTENT",
        loads: [200, 200],
        rpes: [8, 8],
      }),
      makeWorkout({
        id: "w5",
        date: "2026-02-20T00:00:00.000Z",
        selectionMode: "MANUAL",
        loads: [90, 90],
        rpes: [8, 8.5],
      }),
    ]);

    const manual = history.find((entry) => entry.selectionMode === "MANUAL");
    expect(manual?.confidence).toBe(0.3);
    expect(manual?.anomalyFlags?.some((flag) => flag.startsWith("load_regression_"))).toBe(true);
  });

  it("flags MANUAL sessions with RPE 10 on more than half of sets", () => {
    const history = mapHistory([
      makeWorkout({
        id: "w6",
        date: "2026-02-21T00:00:00.000Z",
        selectionMode: "MANUAL",
        loads: [180, 180, 180],
        rpes: [10, 10, 8],
      }),
    ]);

    expect(history[0].confidence).toBe(0.3);
    expect(history[0].anomalyFlags).toContain("rpe10_majority");
  });

  it("keeps anomalous MANUAL entries in history with reduced confidence", () => {
    const history = mapHistory([
      makeWorkout({
        id: "w7",
        date: "2026-02-22T00:00:00.000Z",
        selectionMode: "MANUAL",
        loads: [100, 100],
        rpes: [10, 10],
      }),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].selectionMode).toBe("MANUAL");
    expect(history[0].confidence).toBe(0.3);
  });
});
