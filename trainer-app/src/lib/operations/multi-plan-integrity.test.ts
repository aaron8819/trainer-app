import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMultiPlanIntegrityReport,
  type MultiPlanIntegrityRows,
} from "./multi-plan-integrity";

function emptyRows(): MultiPlanIntegrityRows {
  return {
    legacyCandidates: [],
    macrocycleActiveCounts: [],
    contradictoryActiveMesocycleIds: [],
    workoutOwnerMismatchIds: [],
    workoutSeedMismatchIds: [],
    currentSeedMismatchIds: [],
    readinessMismatchIds: [],
    checkInMismatchIds: [],
    weekCloseMismatchIds: [],
    historicalArtifacts: [],
  };
}

describe("multi-plan integrity preflight", () => {
  it("keeps the ambiguity guard and all schema changes in one transaction", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260726120000_add_active_macrocycle_foundation/migration.sql"
      ),
      "utf8"
    );

    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("DO $$"));
    expect(sql.indexOf("DO $$")).toBeLessThan(
      sql.indexOf('ADD COLUMN "activeMacroCycleId"')
    );
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("classifies no legacy candidate as valid absence", () => {
    const report = buildMultiPlanIntegrityReport({
      ...emptyRows(),
      legacyCandidates: [
        {
          userId: "user-1",
          activeMesocycleCount: 0,
          candidatePlanCount: 0,
          activeMesocycleIds: [],
          candidateMacroCycleIds: [],
        },
      ],
    });

    expect(report.safeToMigrate).toBe(true);
    expect(report.counts).toEqual({
      blocking: 0,
      legacyValidAbsence: 1,
      total: 1,
    });
  });

  it("blocks ambiguous legacy active state without repairing it", () => {
    const report = buildMultiPlanIntegrityReport({
      ...emptyRows(),
      legacyCandidates: [
        {
          userId: "user-1",
          activeMesocycleCount: 2,
          candidatePlanCount: 2,
          activeMesocycleIds: ["meso-a", "meso-b"],
          candidateMacroCycleIds: ["plan-a", "plan-b"],
        },
      ],
    });

    expect(report.safeToMigrate).toBe(false);
    expect(report.findings.map((entry) => entry.code)).toEqual([
      "LEGACY_MULTIPLE_SELECTED_PLAN_CANDIDATES",
      "USER_MULTIPLE_ACTIVE_MESOCYCLES",
    ]);
  });

  it("rejects historical artifacts with missing or mixed mesocycle identity", () => {
    const report = buildMultiPlanIntegrityReport({
      ...emptyRows(),
      historicalArtifacts: [
        {
          artifactId: "legacy.json",
          targetMesocycleId: null,
          sessionMesocycleIds: ["meso-a", "meso-b"],
        },
      ],
    });

    expect(report.safeToMigrate).toBe(false);
    expect(report.findings.map((entry) => entry.code)).toEqual([
      "HISTORICAL_ARTIFACT_MULTIPLE_MESOCYCLES",
      "HISTORICAL_ARTIFACT_MISSING_MESOCYCLE",
    ]);
  });
});
