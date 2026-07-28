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

  it("keeps the GET owner projection pure and routes synchronization through the gated POST", () => {
    const service = readFileSync("src/lib/api/finisher-service.ts", "utf8");
    const route = readFileSync(
      "src/app/api/workouts/[id]/finisher/route.ts",
      "utf8",
    );
    const gateInventory = readFileSync(
      "scripts/check-production-write-gate.ts",
      "utf8",
    );
    const getOfferBody = service.slice(
      service.indexOf("export async function getFinisherOffer"),
      service.indexOf("async function createSelectedExecution"),
    );

    expect(getOfferBody).not.toMatch(
      /persistElapsedProjectionInTransaction|\.create\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(/,
    );
    expect(route).toContain('resolveContext(params, "read")');
    expect(route).toContain('case "sync"');
    expect(route.indexOf("productionWritePauseResponse")).toBeLessThan(
      route.indexOf("finisherActionSchema.safeParse"),
    );
    expect(gateInventory).toContain(
      '["workouts/[id]/finisher/route.ts#POST", "finisher_execution"]',
    );
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

  it("ships the reviewed bilateral side-plank cues for Core Stability 10", () => {
    const core = FINISHER_ROUTINE_SEEDS.find(
      (routine) => routine.code === "core-stability-10",
    );
    const sidePlanks = core?.steps.filter((step) =>
      step.movementName.startsWith("Side Plank"),
    );
    expect(sidePlanks?.map((step) => step.movementName)).toEqual([
      "Side Plank — Left",
      "Side Plank — Right",
    ]);
    for (const step of sidePlanks ?? []) {
      const cues = step.techniqueCues.join(" ").toLowerCase();
      expect(cues).toContain("stack the shoulders and hips");
      expect(cues).toContain("brace the core");
      expect(cues).toContain("hips lifted");
      expect(cues).toContain("straight line without rotating");
    }
  });
});
