import { describe, expect, it } from "vitest";
import { resolveNextWorkoutContext } from "./next-session";

describe("resolveNextWorkoutContext", () => {
  const baseMeso = {
    durationWeeks: 5,
    accumulationSessionsCompleted: 7,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: 3,
    state: "ACTIVE_ACCUMULATION" as const,
  };

  it("prefers the highest-priority incomplete workout over rotation intent", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [
        {
          id: "planned-early",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-01T00:00:00.000Z"),
          sessionIntent: "legs",
        },
        {
          id: "in-progress-later",
          status: "IN_PROGRESS",
          scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
          sessionIntent: "push",
        },
      ],
    });

    expect(context.source).toBe("existing_incomplete");
    expect(context.isExisting).toBe(true);
    expect(context.existingWorkoutId).toBe("in-progress-later");
    expect(context.intent).toBe("push");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(2);
  });

  it("falls back to rotation when no incomplete workout exists", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [],
    });

    expect(context.source).toBe("rotation");
    expect(context.isExisting).toBe(false);
    expect(context.existingWorkoutId).toBeNull();
    expect(context.intent).toBe("pull");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(2);
  });

  it("falls back to first schedule entry when mesocycle is unavailable", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: null,
      weeklySchedule: ["UPPER", "LOWER"],
      incompleteWorkouts: [],
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("upper");
    expect(context.weekInMeso).toBeNull();
    expect(context.sessionInWeek).toBeNull();
  });
});
