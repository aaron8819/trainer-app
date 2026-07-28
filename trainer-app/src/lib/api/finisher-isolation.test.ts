import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FINISHER_ROUTINE_SEEDS,
  deriveFinisherDurationSeconds,
} from "../../../prisma/finisher-routine-seed-data";

describe("Phase 1 Finisher isolation", () => {
  it("ships multiple descriptive routines in both categories with exact derived durations", () => {
    expect(
      FINISHER_ROUTINE_SEEDS.filter((routine) => routine.category === "CORE")
    ).toHaveLength(2);
    expect(
      FINISHER_ROUTINE_SEEDS.filter(
        (routine) => routine.category === "CONDITIONING"
      )
    ).toHaveLength(2);
    expect(
      FINISHER_ROUTINE_SEEDS.some((routine) =>
        /finisher\s+\d/i.test(routine.name)
      )
    ).toBe(false);
    expect(
      FINISHER_ROUTINE_SEEDS.map((routine) => [
        routine.name,
        deriveFinisherDurationSeconds(routine),
      ])
    ).toEqual([
      ["Core Stability 10", 600],
      ["Core Control 8", 480],
      ["Low-Impact Conditioning 8", 480],
      ["Bodyweight Conditioning 6", 360],
    ]);
  });

  it("keeps Finisher writes outside workout and progression mutation owners", () => {
    const source = readFileSync("src/lib/api/finisher-service.ts", "utf8");
    expect(source).not.toContain("tx.workout.update");
    expect(source).not.toContain("tx.workout.delete");
    expect(source).not.toContain("@/lib/engine/progression");
    expect(source).not.toContain("@/lib/api/pr-tracker");
    expect(source).not.toContain("effective-set");
    expect(source).not.toContain("exercise-exposure");
    expect(source).not.toContain("load-recommendation");
    expect(source).toContain('status !== "COMPLETED"');
    expect(source).toContain("workout: { userId: input.userId }");
  });

  it("protects one execution and immutable version truth in the database", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql",
      "utf8"
    );
    expect(schema).toMatch(/workoutId\s+String\s+@unique/);
    expect(schema).toContain("performedAlternativeId String?");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "FinisherExecution_workoutId_key"'
    );
    expect(migration).toContain('"FinisherRoutineVersion_immutable"');
    expect(migration).toContain("ON DELETE RESTRICT");
  });

  it("counts only started terminal executions as recent performed history", () => {
    const source = readFileSync("src/lib/api/finisher-service.ts", "utf8");
    expect(source).toContain("startedAt: { not: null }");
    expect(source).toContain('state: { in: ["COMPLETED", "PARTIAL"] }');
  });
});
