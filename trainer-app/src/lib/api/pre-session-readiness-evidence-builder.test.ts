import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCurrentWeekAuditEvaluation } from "@/lib/audit/workout-audit/current-week-audit";
import { buildPreSessionReadinessCurrentWeekEvidence } from "./pre-session-readiness-evidence-builder";
import type { PreSessionReadinessProjectedWeekEvidence } from "./pre-session-readiness-evidence";

function buildPayload(
  overrides: Partial<PreSessionReadinessProjectedWeekEvidence> = {}
): PreSessionReadinessProjectedWeekEvidence {
  return {
    version: 1,
    currentWeek: {
      mesocycleId: "meso-1",
      week: 4,
      phase: "accumulation",
      blockType: "accumulation",
    },
    projectionNotes: [],
    completedVolumeByMuscle: {},
    projectedSessions: [],
    fullWeekByMuscle: [],
    ...overrides,
  };
}

describe("pre-session readiness evidence builder", () => {
  it("keeps app evidence builders free of CLI, artifact, formatter, and audit producer imports", () => {
    const source = readFileSync(
      "src/lib/api/pre-session-readiness-evidence-builder.ts",
      "utf8"
    );

    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toContain("artifact-serialization");
    expect(source).not.toContain("serializer");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("readFile");
    expect(source).not.toContain("writeFile");
  });

  it("leaves workout-audit as a consumer of the app-owned current-week evidence builder", () => {
    const source = readFileSync(
      "src/lib/audit/workout-audit/current-week-audit.ts",
      "utf8"
    );

    expect(source).toContain("@/lib/api/pre-session-readiness-evidence-builder");
  });

  it("matches the legacy audit current-week facade output", () => {
    const payload = buildPayload({
      projectedSessions: [
        {
          slotId: "upper_b",
          intent: "upper",
          isNext: true,
          exerciseCount: 6,
          totalSets: 20,
          estimatedMinutes: 65,
          movementPatternCounts: {
            horizontal_pull: 3,
            vertical_pull: 1,
            horizontal_push: 1,
          },
          projectedContributionByMuscle: {
            Chest: 3,
            Lats: 4,
          },
        },
      ],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 0,
          projectedNextSessionEffectiveSets: 3,
          projectedRemainingWeekEffectiveSets: 3,
          projectedFullWeekEffectiveSets: 6,
          weeklyTarget: 12,
          mev: 8,
          mav: 16,
          deltaToTarget: -6,
          deltaToMev: -2,
          deltaToMav: -10,
        },
      ],
    });

    expect(buildCurrentWeekAuditEvaluation(payload)).toEqual(
      buildPreSessionReadinessCurrentWeekEvidence(payload)
    );
  });
});
