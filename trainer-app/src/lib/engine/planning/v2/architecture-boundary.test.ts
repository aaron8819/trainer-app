import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const v2PolicyDir = path.join(process.cwd(), "src", "lib", "engine", "planning", "v2");

const forbiddenImportFragments = [
  "@/lib/audit/",
  "@/lib/api/planning-reality",
  "src/lib/audit/",
  "src/lib/api/planning-reality",
  "workout-audit",
  "mesocycle-explain",
  "artifact-serialization",
  "serializer",
  "repaired-projection",
  "repairedProjection",
  "readout",
];

const diagnosticReadoutKeys = [
  "v2TargetVsNoRepairDiff",
  "crossWeekProjectionGate",
  "v2ExerciseSelectionPlanDiagnostic",
  "v2DeloadProjectionDiagnostic",
  "repairMateriality",
  "comparisonToRepaired",
  "warnings",
  "blockers",
  "sidecar catalogs",
  "sidecarCatalogs",
  "sidecar manifests",
  "sidecarManifests",
  "nextBestMigrationSlice",
  "debugArtifact",
  "diagnosticCatalogs",
  "laneEvidence",
];

const acceptedPlannerIntentCandidateWhitelist: string[] = [
  "targetSkeleton",
  "weeklyProgressionModel",
  "deloadTransform",
  "v2SetDistributionIntent",
];

function listTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [entryPath]
      : [];
  });
}

function readPolicyFiles(): Array<{ file: string; text: string }> {
  return listTypeScriptFiles(v2PolicyDir).map((file) => ({
    file,
    text: fs.readFileSync(file, "utf8"),
  }));
}

describe("V2 planner policy module boundary", () => {
  it("does not import audit, planning-reality, repaired-projection, or readout modules", () => {
    const violations = readPolicyFiles().flatMap(({ file, text }) =>
      forbiddenImportFragments.flatMap((fragment) =>
        text.includes(fragment)
          ? [`${path.relative(process.cwd(), file)} imports or references ${fragment}`]
          : []
      )
    );

    expect(violations).toEqual([]);
  });

  it("keeps acceptedPlannerIntent candidates limited to pure planner policy keys", () => {
    for (const key of diagnosticReadoutKeys) {
      expect(acceptedPlannerIntentCandidateWhitelist).not.toContain(key);
    }
  });

  it("does not define diagnostic/readout objects inside pure policy modules", () => {
    const violations = readPolicyFiles().flatMap(({ file, text }) =>
      diagnosticReadoutKeys.flatMap((key) =>
        text.includes(key)
          ? [`${path.relative(process.cwd(), file)} contains diagnostic key ${key}`]
          : []
      )
    );

    expect(violations).toEqual([]);
  });
});
