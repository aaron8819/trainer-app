/**
 * Protects: Schema invariants: Workout.revision (if implemented), WorkoutExercise orderIndex uniqueness, SetLog upsert idempotency.
 * Why it matters: These DB guarantees prevent race-condition corruption that unit-level logic cannot safely recover from.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("prisma schema invariants", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  it("declares Workout.revision", () => {
    expect(schema).toMatch(/model\s+Workout[\s\S]*?revision\s+Int\s+@default\(1\)/);
  });

  it("enforces WorkoutExercise orderIndex uniqueness per workout", () => {
    expect(schema).toMatch(/model\s+WorkoutExercise[\s\S]*?@@unique\(\[workoutId,\s*orderIndex\]\)/);
  });

  it("enforces single SetLog per workoutSetId for upsert idempotency", () => {
    expect(schema).toMatch(/model\s+SetLog[\s\S]*?workoutSetId\s+String\s+@unique/);
  });
});
