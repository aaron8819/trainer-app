import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareMesocycleExplainArtifacts,
  formatMesocycleExplainCompareTable,
  stringifyMesocycleExplainCompareJson,
} from "./mesocycle-explain-compare";
import { runMesocycleExplainCompareCli } from "../../../../scripts/audit-mesocycle-explain-compare";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mesocycle-compare-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<string> {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}

function metric(summary: Awaited<ReturnType<typeof compareMesocycleExplainArtifacts>>, key: string) {
  const found = summary.metrics.find((entry) => entry.key === key);
  if (!found) {
    throw new Error(`Missing metric ${key}`);
  }
  return found;
}

function makeArtifact(input?: {
  materialRepairCount?: number;
  majorRepairCount?: number;
  likelyAvoidableMaterialRepairCount?: number;
  remainingMaterialRepairCount?: number;
  suspiciousCount?: number;
  noRepair?: Record<string, unknown>;
  sidecar?: { relativePath: string; sha256?: string };
}) {
  return {
    mode: "mesocycle-explain",
    warningSummary: {
      counts: {
        blockingErrors: 0,
        semanticWarnings: 1,
        backgroundWarnings: 0,
      },
    },
    mesocycleExplain: {
      preview: {
        projectionDiagnostics: {
          planningReality: {
            summary: {
              planningShape: "mostly_repair_shaped",
              materialRepairCount: input?.materialRepairCount ?? 5,
              majorRepairCount: input?.majorRepairCount ?? 2,
            },
            shadowRepairSummary: {
              materialRepairCount: input?.materialRepairCount ?? 5,
              majorRepairCount: input?.majorRepairCount ?? 2,
              likelyAvoidableMaterialRepairCount:
                input?.likelyAvoidableMaterialRepairCount ?? 3,
              remainingMaterialRepairCount:
                input?.remainingMaterialRepairCount ?? 2,
            },
            suspiciousRepairsNotEligibleForPromotion: Array.from(
              { length: input?.suspiciousCount ?? 1 },
              (_, index) => ({ id: index })
            ),
            exerciseConcentration: [
              {
                slotId: "upper_a",
                exerciseName: "Bench Press",
                flags: ["EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"],
              },
            ],
          },
        },
      },
      ...(input?.noRepair || input?.sidecar
        ? {
            plannerOnlyNoRepair: {
              ...(input?.noRepair ?? {}),
              ...(input?.sidecar
                ? {
                    debugArtifact: {
                      kind: "v2_planner_no_repair_debug",
                      created: true,
                      relativePath: input.sidecar.relativePath,
                      sha256: input.sidecar.sha256,
                      contains: [],
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

function makeCompactNoRepair(input?: {
  basicMesocycleShapeStatus?: string;
  canReplaceRepairedProjection?: boolean;
  nextBestMigrationSlice?: string;
  migrationCandidateCount?: number;
  blockedLaneCount?: number;
  repairDependentLaneCount?: number;
}) {
  return {
    summary: {
      basicMesocycleShapeStatus:
        input?.basicMesocycleShapeStatus ?? "partial",
      nextBestMigrationSlice:
        input?.nextBestMigrationSlice ?? "upper_a:chest_anchor",
      hardBlockerCount: 1,
      warningCount: 2,
    },
    replacementReadiness: {
      canReplaceRepairedProjection:
        input?.canReplaceRepairedProjection ?? false,
    },
    v2Summary: {
      targetVsNoRepairSummary: {
        migrationCandidateCount: input?.migrationCandidateCount ?? 4,
        blockedLaneCount: input?.blockedLaneCount ?? 1,
        repairDependentLaneCount: input?.repairDependentLaneCount ?? 2,
      },
      laneCounts: {
        migrationCandidates: input?.migrationCandidateCount ?? 4,
        blocked: input?.blockedLaneCount ?? 1,
        repairDependent: input?.repairDependentLaneCount ?? 2,
      },
      migrationScoreboard: {
        materialRepairCount: 5,
        majorRepairCount: 2,
        suspiciousRepairs: 1,
        canReplaceRepairedProjection: false,
        reason: "not_ready",
      },
    },
  };
}

function makeSidecar(input?: {
  week1Status?: string;
  accumulationWeeksStatus?: string;
  deloadStatus?: string;
  replacementReadinessStatus?: string;
  exerciseStatus?: string;
  deloadDiagnosticStatus?: string;
}) {
  return {
    kind: "v2_planner_no_repair_debug",
    plannerOnlyNoRepair: {
      acceptanceClassification: {
        basicMesocycleShapeStatus: "pass_with_warnings",
        migrationScoreboard: {
          materialRepairCount: 1,
          majorRepairCount: 0,
          suspiciousRepairs: 0,
          canReplaceRepairedProjection: false,
          reason: "limited",
        },
      },
      canReplaceRepairedProjection: false,
      crossWeekProjectionGate: {
        week1Status: { status: input?.week1Status ?? "pass_with_warnings" },
        accumulationWeeksStatus: {
          status: input?.accumulationWeeksStatus ?? "projected_with_limitations",
        },
        deloadStatus: {
          status: input?.deloadStatus ?? "diagnostic_projection_only",
        },
        replacementReadinessStatus:
          input?.replacementReadinessStatus ?? "limited",
        safeToPromoteBehavior: false,
      },
      v2ExerciseSelectionPlanDiagnostic: {
        status: input?.exerciseStatus ?? "projected_with_limitations",
      },
      v2DeloadProjectionDiagnostic: {
        status: input?.deloadDiagnosticStatus ?? "projected_with_limitations",
      },
      v2TargetVsNoRepairDiff: {
        summary: {
          migrationCandidateCount: 7,
          blockedLaneCount: 2,
          repairDependentLaneCount: 3,
        },
        replacementReadinessImpact: {
          nextBestMigrationSlice: "lower_a:squat_anchor",
        },
      },
    },
  };
}

describe("mesocycle-explain artifact compare", () => {
  it("compares core repair counts", async () => {
    const dir = await makeTempDir();
    const before = await writeJson(
      path.join(dir, "before.json"),
      makeArtifact({ materialRepairCount: 5, majorRepairCount: 2 })
    );
    const after = await writeJson(
      path.join(dir, "after.json"),
      makeArtifact({ materialRepairCount: 3, majorRepairCount: 1 })
    );

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });

    expect(metric(summary, "materialRepairCount")).toMatchObject({
      before: { status: "value", value: 5 },
      after: { status: "value", value: 3 },
      delta: "-2",
    });
    expect(metric(summary, "majorRepairCount").delta).toBe("-1");
    expect(formatMesocycleExplainCompareTable(summary)).toContain(
      "materialRepairCount"
    );
  });

  it("compares V2 summary fields", async () => {
    const dir = await makeTempDir();
    const before = await writeJson(
      path.join(dir, "before.json"),
      makeArtifact({
        noRepair: makeCompactNoRepair({
          basicMesocycleShapeStatus: "partial",
          migrationCandidateCount: 2,
        }),
      })
    );
    const after = await writeJson(
      path.join(dir, "after.json"),
      makeArtifact({
        noRepair: makeCompactNoRepair({
          basicMesocycleShapeStatus: "pass_with_warnings",
          migrationCandidateCount: 5,
        }),
      })
    );

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });

    expect(metric(summary, "basicMesocycleShapeStatus").delta).toBe(
      "partial -> pass_with_warnings"
    );
    expect(metric(summary, "migrationCandidateCount")).toMatchObject({
      before: { status: "value", value: 2 },
      after: { status: "value", value: 5 },
      delta: "+3",
    });
    expect(metric(summary, "targetVsNoRepairSummary").before.status).toBe(
      "value"
    );
    expect(metric(summary, "migrationScoreboard").before.status).toBe("value");
  });

  it("auto-detects sidecar from relativePath", async () => {
    const dir = await makeTempDir();
    await writeJson(path.join(dir, "before-sidecar.json"), makeSidecar());
    await writeJson(
      path.join(dir, "after-sidecar.json"),
      makeSidecar({ exerciseStatus: "ready" })
    );
    const before = await writeJson(
      path.join(dir, "before.json"),
      makeArtifact({
        noRepair: makeCompactNoRepair({ canReplaceRepairedProjection: false }),
        sidecar: { relativePath: "before-sidecar.json", sha256: "abc123" },
      })
    );
    const after = await writeJson(
      path.join(dir, "after.json"),
      makeArtifact({
        noRepair: makeCompactNoRepair({ canReplaceRepairedProjection: true }),
        sidecar: { relativePath: "after-sidecar.json", sha256: "def456" },
      })
    );

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });

    expect(summary.before.sidecar).toMatchObject({
      status: "loaded",
      sha256: "abc123",
    });
    expect(metric(summary, "crossWeekWeek1Status").before).toEqual({
      status: "value",
      value: "pass_with_warnings",
    });
    expect(metric(summary, "canReplaceRepairedProjection").delta).toBe(
      "false -> true"
    );
    expect(metric(summary, "v2ExerciseSelectionPlanDiagnosticStatus").delta).toBe(
      "projected_with_limitations -> ready"
    );
  });

  it("handles missing sidecar gracefully", async () => {
    const dir = await makeTempDir();
    const before = await writeJson(
      path.join(dir, "before.json"),
      makeArtifact({ sidecar: { relativePath: "missing-sidecar.json" } })
    );
    const after = await writeJson(path.join(dir, "after.json"), makeArtifact());

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });

    expect(summary.warnings[0]).toContain("Missing linked V2 sidecar");
    expect(summary.before.sidecar?.status).toBe("missing");
    expect(metric(summary, "sidecarBytes").before.status).toBe("missing");
    expect(metric(summary, "sidecarBytes").after.status).toBe("n/a");
  });

  it("handles standard artifact with no plannerOnlyNoRepair", async () => {
    const dir = await makeTempDir();
    const before = await writeJson(path.join(dir, "before.json"), makeArtifact());
    const after = await writeJson(path.join(dir, "after.json"), makeArtifact());

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });

    expect(metric(summary, "basicMesocycleShapeStatus").before.status).toBe(
      "missing"
    );
    expect(metric(summary, "crossWeekWeek1Status").before.status).toBe("n/a");
  });

  it("outputs JSON mode", async () => {
    const dir = await makeTempDir();
    const before = await writeJson(path.join(dir, "before.json"), makeArtifact());
    const after = await writeJson(
      path.join(dir, "after.json"),
      makeArtifact({ materialRepairCount: 6 })
    );

    const summary = await compareMesocycleExplainArtifacts({
      beforePath: before,
      afterPath: after,
    });
    const parsed = JSON.parse(stringifyMesocycleExplainCompareJson(summary));

    expect(parsed.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "materialRepairCount",
          before: 5,
          after: 6,
          delta: "+1",
        }),
      ])
    );
  });

  it("invalid path and invalid JSON return clear CLI errors", async () => {
    const dir = await makeTempDir();
    const invalidJson = path.join(dir, "invalid.json");
    await writeFile(invalidJson, "{", "utf8");
    const stderr: string[] = [];

    await expect(
      runMesocycleExplainCompareCli({
        argv: ["--before", path.join(dir, "missing.json"), "--after", invalidJson],
        stdout: () => undefined,
        stderr: (line) => stderr.push(line),
      })
    ).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("Invalid artifact path");

    stderr.length = 0;
    await expect(
      runMesocycleExplainCompareCli({
        argv: ["--before", invalidJson, "--after", invalidJson],
        stdout: () => undefined,
        stderr: (line) => stderr.push(line),
      })
    ).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("Invalid JSON in artifact");
  });

  it("does not import DB or Prisma", async () => {
    const files = [
      path.join(process.cwd(), "src/lib/audit/workout-audit/mesocycle-explain-compare.ts"),
      path.join(process.cwd(), "scripts/audit-mesocycle-explain-compare.ts"),
    ];

    for (const file of files) {
      const imports = (await readFile(file, "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("import "));
      expect(imports.join("\n")).not.toMatch(
        /@\/lib\/db|@prisma|PrismaClient|prisma/i
      );
    }
  });
});
