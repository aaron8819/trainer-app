import { describe, expect, it } from "vitest";
import { loadRolloutEnvironment } from "./rollout-environment";
import {
  formatReadinessIntegritySummary,
  sanitizeReadinessIntegrityError,
} from "./readiness-integrity-cli";
import type { ReadinessIntegrityReport } from "./readiness-integrity";

describe("readiness integrity CLI", () => {
  it("requires an explicit environment before any database operation", () => {
    expect(() =>
      loadRolloutEnvironment({ argv: [], allowWrite: false, environment: {} }),
    ).toThrow("Missing required --env-file");
  });

  it("redacts unexpected connection failures", () => {
    const output = sanitizeReadinessIntegrityError(
      new Error("connect ECONNREFUSED postgresql://trainer:secret@example.test/trainer"),
    );
    expect(output).not.toContain("secret");
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("example.test");
  });

  it("formats deterministic operator output with zero writes", () => {
    const report = {
      schemaStage: "pre_architecture_migration",
      snapshots: { total: 10, active: 8 },
      legacy: { invalid: 0, unknown: 0 },
      exact: {
        identityHashFailures: [],
        targetHashFailures: [],
        payloadHashFailures: [],
        identityContractFailures: [],
        contractFailures: [],
      },
      migrationSafety: { readinessMigrationSafe: true },
      writes: 0,
      readinessIntegrityReady: true,
    } as unknown as ReadinessIntegrityReport;
    expect(formatReadinessIntegritySummary(report)).toBe(
      "Readiness integrity: stage=pre_architecture_migration, total=10, active=8, " +
        "legacyInvalid=0, legacyUnknown=0, exactFailures=0, migrationSafe=true, " +
        "writes=0, readinessIntegrityReady=true.",
    );
  });
});
