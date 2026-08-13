/**
 * Protects: Schema invariants: Workout.revision (if implemented), WorkoutExercise orderIndex uniqueness, SetLog upsert idempotency.
 * Why it matters: These DB guarantees prevent race-condition corruption that unit-level logic cannot safely recover from.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_MOVEMENT_PATTERN_VALUES } from "./engine/types";

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

  it("persists mesocycle slot-plan seeds separately from slot sequencing", () => {
    expect(schema).toMatch(/model\s+Mesocycle[\s\S]*?slotSequenceJson\s+Json\?/);
    expect(schema).toMatch(/model\s+Mesocycle[\s\S]*?slotPlanSeedJson\s+Json\?/);
  });

  it("keeps the Prisma and engine movement-pattern vocabularies aligned", () => {
    const body = schema.match(/enum\s+MovementPatternV2\s*\{([\s\S]*?)\}/)?.[1];
    expect(body).toBeDefined();
    const prismaValues = body!
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean);

    expect(prismaValues).toEqual(
      CANONICAL_MOVEMENT_PATTERN_VALUES.map((value) => value.toUpperCase()),
    );
    expect(prismaValues).toContain("ANTI_EXTENSION");
    expect(CANONICAL_MOVEMENT_PATTERN_VALUES).toContain("anti_extension");
  });

  it("adds anti-extension through an enum-only additive migration", () => {
    const migration = readFileSync(
      "prisma/migrations/20260813120000_add_anti_extension_movement_pattern/migration.sql",
      "utf8",
    );

    expect(migration.trim()).toBe(
      `ALTER TYPE "MovementPatternV2" ADD VALUE 'ANTI_EXTENSION';`,
    );
  });
});
