import { describe, expect, it } from "vitest";
import type { ExerciseSection, FlatSetItem } from "@/components/log-workout/types";
import { resolveRestSeconds } from "@/components/log-workout/useWorkoutLogState";

function makeFlatSetItem(input: {
  section: ExerciseSection;
  isMainLift: boolean;
  restSeconds?: number | null;
  isRuntimeAddedExercise?: boolean;
  isRuntimeAddedSet?: boolean;
}): FlatSetItem {
  return {
    section: input.section,
    sectionLabel: input.section,
    exerciseIndex: 0,
    setIndex: 0,
    exercise: {
      workoutExerciseId: "exercise-1",
      name: "Exercise",
      isMainLift: input.isMainLift,
      isRuntimeAdded: input.isRuntimeAddedExercise,
      sets: [],
    },
    set: {
      setId: "set-1",
      setIndex: 1,
      targetReps: 10,
      restSeconds: input.restSeconds,
      isRuntimeAdded: input.isRuntimeAddedSet,
    },
  };
}

describe("resolveRestSeconds", () => {
  it("uses explicit set rest before execution defaults", () => {
    expect(
      resolveRestSeconds(
        makeFlatSetItem({ section: "accessory", isMainLift: false, restSeconds: 75 })
      )
    ).toBe(75);
  });

  it("defaults warmup sets to 60 seconds", () => {
    expect(resolveRestSeconds(makeFlatSetItem({ section: "warmup", isMainLift: false }))).toBe(
      60
    );
  });

  it("defaults planned main-lift working sets to 180 seconds", () => {
    expect(resolveRestSeconds(makeFlatSetItem({ section: "main", isMainLift: true }))).toBe(
      180
    );
  });

  it("defaults planned accessory working sets to 120 seconds", () => {
    expect(
      resolveRestSeconds(makeFlatSetItem({ section: "accessory", isMainLift: false }))
    ).toBe(120);
  });

  it("defaults runtime-added non-main exercises to 120 seconds", () => {
    expect(
      resolveRestSeconds(
        makeFlatSetItem({
          section: "accessory",
          isMainLift: false,
          isRuntimeAddedExercise: true,
          isRuntimeAddedSet: true,
        })
      )
    ).toBe(120);
  });

  it("defaults runtime-added sets on accessory exercises to 120 seconds", () => {
    expect(
      resolveRestSeconds(
        makeFlatSetItem({
          section: "accessory",
          isMainLift: false,
          isRuntimeAddedSet: true,
        })
      )
    ).toBe(120);
  });

  it("defaults runtime-added sets on main lifts to 180 seconds", () => {
    expect(
      resolveRestSeconds(
        makeFlatSetItem({
          section: "main",
          isMainLift: true,
          isRuntimeAddedSet: true,
        })
      )
    ).toBe(180);
  });
});
