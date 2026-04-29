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
  "mesocycleDemand",
  "targetSkeleton",
  "weeklyProgressionModel",
  "weeklyDemandCurve",
  "slotDemandAllocationByWeek",
  "exerciseClassDistributionBySlot",
  "deloadTransform",
  "v2SetDistributionIntent",
  "v2SupportLanePolicy",
  "selectionCapacityPlan",
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

  it("does not import audit, planning-reality, repair, seed, runtime, or selection modules", () => {
    const forbiddenImportPattern =
      /from\s+["'][^"']*(audit|planning-reality|repair|seed|runtime|selection-v2)[^"']*["']/;
    const violations = readPolicyFiles().flatMap(({ file, text }) =>
      text
        .split(/\r?\n/)
        .filter((line) => forbiddenImportPattern.test(line))
        .map(
          (line) =>
            `${path.relative(process.cwd(), file)} has forbidden import ${line.trim()}`,
        ),
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

  it("keeps upstream pure V2 policy objects first-class", () => {
    const exportedText = readPolicyFiles()
      .map(({ text }) => text)
      .join("\n");

    expect(exportedText).toContain("V2MesocycleDemand");
    expect(exportedText).toContain("V2WeeklyDemandCurve");
    expect(exportedText).toContain("V2SlotDemandAllocationByWeek");
    expect(exportedText).toContain("V2ExerciseClassDistributionBySlot");
    expect(exportedText).toContain("V2SupportLanePolicy");
    expect(exportedText).toContain("V2SelectionCapacityPlan");
  });

  it("does not introduce acceptedPlannerIntent persistence in pure policy modules", () => {
    const violations = readPolicyFiles().flatMap(({ file, text }) =>
      text.includes("acceptedPlannerIntent")
        ? [`${path.relative(process.cwd(), file)} references acceptedPlannerIntent`]
        : []
    );

    expect(violations).toEqual([]);
  });

  it("does not add SelectionCapacityPlan to audit artifact or sidecar schemas", () => {
    const artifactFiles = [
      path.join(process.cwd(), "src", "lib", "audit", "workout-audit", "types.ts"),
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "serializer.ts",
      ),
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "artifact-serialization.ts",
      ),
    ];
    const violations = artifactFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /\bselectionCapacityPlan\b/.test(text) ||
        /\bV2SelectionCapacityPlan\b(?!Diagnostic)/.test(text)
        ? [`${path.relative(process.cwd(), file)} exposes selectionCapacityPlan`]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
