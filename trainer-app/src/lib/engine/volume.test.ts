import { describe, expect, it } from "vitest";
import { buildVolumeContext, buildVolumePlanByMuscle } from "./volume";
import type { Exercise, WorkoutHistoryEntry } from "./types";

const exerciseLibrary: Exercise[] = [
  {
    id: "press",
    name: "Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    equipment: ["dumbbell"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
  },
  {
    id: "pushdown",
    name: "Pushdown",
    movementPatterns: ["isolation"],
    splitTags: ["push"],
    jointStress: "low",
    equipment: ["cable"],
    primaryMuscles: ["Triceps"],
    secondaryMuscles: [],
  },
];

function makeSets(exerciseId: string, sets: number) {
  return Array.from({ length: sets }, (_, index) => ({
    exerciseId,
    setIndex: index + 1,
    reps: 10,
    rpe: 8,
    load: 100,
  }));
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe("volume context", () => {
  it("scopes actual weekly volume to the current mesocycle week and mesocycle id", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: hoursAgo(24),
        completed: true,
        status: "COMPLETED",
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 2, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 3) }],
      },
      {
        date: hoursAgo(48),
        completed: true,
        status: "COMPLETED",
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 1, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 4) }],
      },
      {
        date: hoursAgo(20),
        completed: true,
        status: "PARTIAL",
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 2, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "pushdown", sets: makeSets("pushdown", 2) }],
      },
      {
        date: hoursAgo(30),
        completed: true,
        status: "COMPLETED",
        mesocycleSnapshot: { mesocycleId: "old-meso", week: 2, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 5) }],
      },
    ];

    const context = buildVolumeContext(history, exerciseLibrary, {
      week: 2,
      length: 4,
      mesocycleId: "active-meso",
    });

    expect("muscleVolume" in context).toBe(true);
    if (!("muscleVolume" in context)) return;

    expect(context.muscleVolume.Chest.weeklyDirectSets).toBe(3);
    expect(context.muscleVolume.Triceps.weeklyDirectSets).toBe(2);
    expect(context.muscleVolume.Triceps.weeklyIndirectSets).toBe(3);
    expect(context.muscleVolume.Triceps.weeklyEffectiveSets).toBeCloseTo(2.9, 6);
    expect(context.recent.Chest).toBe(12);
  });

  it("builds weekly volume plans from mesocycle-week actuals instead of rolling recent volume", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: hoursAgo(24),
        completed: true,
        status: "COMPLETED",
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 2, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 3) }],
      },
      {
        date: hoursAgo(48),
        completed: true,
        status: "COMPLETED",
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 1, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 4) }],
      },
    ];

    const context = buildVolumeContext(history, exerciseLibrary, {
      week: 2,
      length: 4,
      mesocycleId: "active-meso",
      weeklyTargets: { Chest: 12, Triceps: 8 },
    });
    const plan = buildVolumePlanByMuscle([], [], context, {
      mesocycleWeek: 2,
      mesocycleLength: 4,
    });

    expect(plan.Chest.planned).toBe(3);
  });

  it("still counts progression-ineligible supplemental sessions toward weekly volume", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: hoursAgo(12),
        completed: true,
        status: "COMPLETED",
        progressionEligible: false,
        mesocycleSnapshot: { mesocycleId: "active-meso", week: 2, phase: "ACCUMULATION" },
        exercises: [{ exerciseId: "press", sets: makeSets("press", 3) }],
      },
    ];

    const context = buildVolumeContext(history, exerciseLibrary, {
      week: 2,
      length: 4,
      mesocycleId: "active-meso",
    });

    expect("muscleVolume" in context).toBe(true);
    if (!("muscleVolume" in context)) return;

    expect(context.muscleVolume.Chest.weeklyDirectSets).toBe(3);
    expect(context.muscleVolume.Chest.weeklyEffectiveSets).toBe(3);
  });
});
