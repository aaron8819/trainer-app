import { describe, expect, it } from "vitest";
import { resolveRoleFixtureAnchor } from "./role-anchor-policy";

describe("resolveRoleFixtureAnchor", () => {
  it("prefers the highest relevant stimulus muscle for the current role fixture", () => {
    const anchor = resolveRoleFixtureAnchor({
      role: "CORE_COMPOUND",
      sessionIntent: "push",
      weeklyTarget: new Map([
        ["Chest", 12],
        ["Triceps", 10],
      ]),
      exercise: {
        id: "chest-priority-press",
        name: "Chest Priority Press",
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["Chest", "Triceps"],
        secondaryMuscles: ["Front Delts"],
        stimulusProfile: {
          chest: 1,
          triceps: 0.35,
          front_delts: 0.2,
        },
      },
    });

    expect(anchor).toEqual({ kind: "muscle", muscle: "chest" });
  });

  it("breaks ties deterministically by primary muscle order when weights and targets match", () => {
    const anchor = resolveRoleFixtureAnchor({
      role: "CORE_COMPOUND",
      sessionIntent: "legs",
      weeklyTarget: new Map([
        ["Quads", 12],
        ["Glutes", 12],
      ]),
      exercise: {
        id: "tie-breaker-squat",
        name: "Tie Breaker Squat",
        movementPatterns: ["squat"],
        primaryMuscles: ["Glutes", "Quads"],
        secondaryMuscles: [],
        stimulusProfile: {
          glutes: 1,
          quads: 1,
        },
      },
    });

    expect(anchor).toEqual({ kind: "muscle", muscle: "glutes" });
  });
});
