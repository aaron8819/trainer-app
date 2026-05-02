import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildV2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";
import { evaluateAcceptedMesocycleSeedProvenance } from "./accepted-mesocycle-seed-provenance";

function setAwareSeed(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
          { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        ],
      },
    ],
    ...overrides,
  };
}

function warningCodes(
  result: ReturnType<typeof evaluateAcceptedMesocycleSeedProvenance>,
) {
  return result.warnings.map((warning) => warning.code);
}

function listSourceTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceTypeScriptFiles(entryPath);
    }
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [entryPath]
      : [];
  });
}

describe("evaluateAcceptedMesocycleSeedProvenance", () => {
  it("classifies legacy set-aware seeds as valid while caveating runtime replay authorship", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed(),
      receiptCompositionSource: "persisted_slot_plan_seed",
    });

    expect(result).toMatchObject({
      version: 1,
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      status: "valid",
      seed: {
        available: true,
        source: "handoff_slot_plan_projection",
        executableShape: "set_aware",
      },
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
        severity: "info",
      }),
    ]);
  });

  it("flags V2 planner metadata stored under the legacy hard-coded seed source", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed({
        acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
      }),
    });

    expect(result.status).toBe("suspicious");
    expect(result.seed).toMatchObject({
      source: "handoff_slot_plan_projection",
      plannerMetadataSource: "v2_planner_policy",
      targetSkeletonId: "upper_lower_4x_v2",
      executableShape: "set_aware",
    });
    expect(warningCodes(result)).toContain(
      "SEED_SOURCE_LEGACY_WITH_V2_PLANNER_METADATA",
    );
  });

  it("caveats Program/read-model seed rows as display provenance, not authorship", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed(),
      readModelExerciseSource: "persisted_slot_plan_seed",
    });

    expect(result.status).toBe("valid");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "UI_SEED_SOURCE_NOT_AUTHORSHIP",
        severity: "info",
      }),
    ]);
  });

  it("marks V2 diagnostics alongside a legacy-labeled accepted seed as suspicious", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed(),
      v2DiagnosticSignals: {
        materializedSeedSource: "v2_materialized_seed",
        dbWriteOccurred: false,
      },
    });

    expect(result.status).toBe("suspicious");
    expect(warningCodes(result)).toContain(
      "V2_DIAGNOSTICS_WITH_LEGACY_ACCEPTED_SEED",
    );
  });

  it("accepts read-only V2 diagnostics with no write when not presented as persistence success", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: null,
      v2DiagnosticSignals: {
        materializedSeedSource: "v2_materialized_seed",
        dbWriteOccurred: false,
        generationPath: "v2-accepted-seed-prepare-compare",
      },
    });

    expect(result.status).toBe("valid");
    expect(result.seed).toMatchObject({
      available: false,
      executableShape: "missing",
    });
    expect(result.warnings).toEqual([]);
  });

  it("rejects a V2 seed source without V2 planner metadata and target skeleton", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed({ source: "v2_materialized_seed" }),
    });

    expect(result.status).toBe("invalid");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "V2_SOURCE_WITHOUT_V2_PLANNER_METADATA",
        severity: "error",
      }),
    ]);
  });

  it("rejects V2 persistence provenance when dbWriteOccurred is false", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed({
        source: "v2_materialized_seed",
        acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
      }),
      v2DiagnosticSignals: {
        persistenceSource: "v2_materialized_seed",
        dbWriteOccurred: false,
      },
    });

    expect(result.status).toBe("invalid");
    expect(warningCodes(result)).toContain(
      "V2_PROVENANCE_REPORTED_WITHOUT_DB_WRITE",
    );
  });

  it("rejects runtime composition provenance that reports planner authorship", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed(),
      receiptCompositionSource: "v2_planner_policy",
    });

    expect(result.status).toBe("invalid");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
        severity: "error",
      }),
    ]);
  });

  it("rejects missing executable set counts", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed({
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
        ],
      }),
    });

    expect(result.status).toBe("invalid");
    expect(result.seed.executableShape).toBe("identity_only");
    expect(warningCodes(result)).toContain("MISSING_EXECUTABLE_SET_COUNTS");
  });

  it("accepts future V2 seed sources with V2 planner metadata and set-aware rows", () => {
    const result = evaluateAcceptedMesocycleSeedProvenance({
      mesocycleId: "meso-1",
      slotPlanSeedJson: setAwareSeed({
        source: "v2_materialized_seed",
        acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
      }),
    });

    expect(result.status).toBe("valid");
    expect(result.warnings).toEqual([]);
  });

  it("stays read-only and outside generation, materialization, and runtime consumption paths", () => {
    const helperPath = path.join(
      process.cwd(),
      "src",
      "lib",
      "api",
      "accepted-mesocycle-seed-provenance.ts",
    );
    const helperText = fs.readFileSync(helperPath, "utf8");
    expect(helperText).not.toMatch(
      /prisma|\.create\s*\(|\.createMany\s*\(|\.update\s*\(|\.updateMany\s*\(|\.upsert\s*\(|\.delete\s*\(|\.deleteMany\s*\(/,
    );

    const forbiddenConsumers = [
      path.join(process.cwd(), "src", "lib", "api", "template-session.ts"),
      path.join(process.cwd(), "src", "lib", "api", "template-session"),
      path.join(process.cwd(), "src", "lib", "api", "mesocycle-slot-runtime.ts"),
      path.join(
        process.cwd(),
        "src",
        "lib",
        "engine",
        "planning",
        "v2",
        "materialization",
      ),
    ].flatMap((entryPath) =>
      fs.statSync(entryPath).isDirectory()
        ? listSourceTypeScriptFiles(entryPath)
        : [entryPath],
    );

    const violations = forbiddenConsumers.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return text.includes("evaluateAcceptedMesocycleSeedProvenance") ||
        text.includes("accepted-mesocycle-seed-provenance")
        ? [path.relative(process.cwd(), file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
