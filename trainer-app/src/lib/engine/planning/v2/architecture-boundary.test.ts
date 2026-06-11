import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const v2PolicyDir = path.join(process.cwd(), "src", "lib", "engine", "planning", "v2");
const liveContextDryRunHarness = path.join(
  process.cwd(),
  "src",
  "lib",
  "audit",
  "workout-audit",
  "v2-materialization-live-context-dry-run.ts",
);
const acceptanceMaterializedSeedHelper = path.join(
  process.cwd(),
  "src",
  "lib",
  "api",
  "mesocycle-handoff-v2-materialized-seed.ts",
);
const seedRuntimeFiles = [
  path.join(process.cwd(), "src", "lib", "api", "slot-plan-seed-parser.ts"),
  path.join(
    process.cwd(),
    "src",
    "lib",
    "api",
    "template-session",
    "slot-plan-seed.ts",
  ),
  path.join(process.cwd(), "src", "lib", "api", "mesocycle-slot-runtime.ts"),
  path.join(
    process.cwd(),
    "src",
    "lib",
    "api",
    "mesocycle-handoff-slot-plan-projection.ts",
  ),
];
const generationSeedRuntimeReceiptPersistenceFiles = [
  ...seedRuntimeFiles,
  path.join(process.cwd(), "src", "lib", "api", "template-session.ts"),
  path.join(
    process.cwd(),
    "src",
    "lib",
    "api",
    "template-session",
    "deload-session.ts",
  ),
  path.join(process.cwd(), "src", "lib", "evidence", "session-decision-receipt.ts"),
  path.join(process.cwd(), "prisma", "schema.prisma"),
];
const repairQuarantineDiagnosticKeys = [
  "repairPromotionScoreboard",
  "legacyRepairQuarantine",
  "quarantineGroups",
  "gapInventory",
  "taxonomyMismatchInventory",
  "selectedMismatchId",
  "selectedGapProof",
  "missingProofBeforeBehaviorPromotion",
  "behaviorPromotionCandidateCount",
];
const nextMesocycleCandidateEvaluator = path.join(
  process.cwd(),
  "src",
  "lib",
  "audit",
  "workout-audit",
  "next-mesocycle-candidate-evaluator.ts",
);
const promotionReadinessContract = path.join(
  process.cwd(),
  "src",
  "lib",
  "engine",
  "planning",
  "v2",
  "materialization",
  "promotion-readiness.ts",
);
const mesocycleStrategyFiles = [
  path.join(process.cwd(), "src", "lib", "engine", "planning", "v2", "types.ts"),
  path.join(
    process.cwd(),
    "src",
    "lib",
    "engine",
    "planning",
    "v2",
    "mesocycle-strategy.ts",
  ),
];

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
  "exerciseSelectionPlan",
  "acceptedPlannerIntentDto",
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

function readPolicyFilesExceptMaterialization(): Array<{
  file: string;
  text: string;
}> {
  const materializationSegment = `${path.sep}materialization${path.sep}`;
  return readPolicyFiles().filter(
    ({ file }) => !file.includes(materializationSegment),
  );
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
    const violations = readPolicyFilesExceptMaterialization().flatMap(({ file, text }) =>
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
    expect(exportedText).toContain("V2MesocycleStrategyInput");
    expect(exportedText).toContain("V2MesocycleStrategyDiagnostic");
    expect(exportedText).toContain("V2MesocycleStrategyRecommendation");
    expect(exportedText).toContain("V2StrategyHypothesisPromotionReadiness");
    expect(exportedText).toContain("V2StrategyHypothesisPromotionDiff");
    expect(exportedText).toContain("V2StrategyHypothesisProjectionDiff");
    expect(exportedText).toContain("V2DonorSurplusEvidence");
    expect(exportedText).toContain("V2SlotOwnedDemandAdjustmentPlan");
    expect(exportedText).toContain("V2StrategyToDemandProjection");
    expect(exportedText).toContain("V2WeeklyDemandCurve");
    expect(exportedText).toContain("V2SlotDemandAllocationByWeek");
    expect(exportedText).toContain("V2ExerciseClassDistributionBySlot");
    expect(exportedText).toContain("V2SupportLanePolicy");
    expect(exportedText).toContain("V2SelectionCapacityPlan");
    expect(exportedText).toContain("V2ExerciseSelectionPlan");
    expect(exportedText).toContain("V2ExerciseMaterializationPlan");
    expect(exportedText).toContain("V2MaterializationDryRunReport");
    expect(exportedText).toContain("V2MaterializationPromotionReadiness");
    expect(exportedText).toContain("V2BasePlanValidation");
    expect(exportedText).toContain("V2BasePlanShadowConsumptionTrial");
    expect(exportedText).toContain("V2AcceptedPlannerIntentDto");
  });

  it("keeps V2 mesocycle strategy input and diagnostic free of DB/API/runtime/receipt/UI/repair/audit imports", () => {
    const forbiddenImportPattern =
      /from\s+["'][^"']*(db|prisma|@prisma\/client|app\/api|\/api\/|runtime|receipt|ui|repair|audit|workout-audit|serializer|artifact-serialization)[^"']*["']/;
    const violations = mesocycleStrategyFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return text
        .split(/\r?\n/)
        .filter((line) => forbiddenImportPattern.test(line))
        .map(
          (line) =>
            `${path.relative(process.cwd(), file)} has forbidden import ${line.trim()}`,
        );
    });

    expect(violations).toEqual([]);
  });

  it("keeps promotion-readiness contract free of production write, receipt, UI, runtime, repair, and audit imports", () => {
    const text = fs.readFileSync(promotionReadinessContract, "utf8");
    const forbiddenImportPattern =
      /from\s+["'][^"']*(db|prisma|app\/api|api\/template-session|slot-plan-seed|runtime|receipt|ui|repair|audit|workout-audit|serializer|artifact-serialization)[^"']*["']/;
    const violations = text
      .split(/\r?\n/)
      .filter((line) => forbiddenImportPattern.test(line))
      .map((line) => `promotion-readiness has forbidden import ${line.trim()}`);

    expect(violations).toEqual([]);
  });

  it("does not introduce acceptedPlannerIntent persistence in pure policy modules", () => {
    const violations = readPolicyFiles().flatMap(({ file, text }) =>
      text.includes("acceptedPlannerIntent")
        ? [`${path.relative(process.cwd(), file)} references acceptedPlannerIntent`]
        : []
    );

    expect(violations).toEqual([]);
  });

  it("does not add acceptedPlannerIntent DTO to audit artifact or sidecar schemas", () => {
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
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "v2-debug-artifacts.ts",
      ),
    ];
    const violations = artifactFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /acceptedPlannerIntent|V2AcceptedPlannerIntentDto|buildV2AcceptedPlannerIntentDto/.test(
        text,
      )
        ? [`${path.relative(process.cwd(), file)} exposes acceptedPlannerIntent`]
        : [];
    });

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
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "v2-debug-artifacts.ts",
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

  it("does not add ExerciseSelectionPlan to audit artifact or sidecar schemas", () => {
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
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "v2-debug-artifacts.ts",
      ),
    ];
    const violations = artifactFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /\bexerciseSelectionPlan\b/.test(text) ||
        /\bV2ExerciseSelectionPlan\b(?!Diagnostic)/.test(text)
        ? [`${path.relative(process.cwd(), file)} exposes exerciseSelectionPlan`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("does not add ExerciseMaterializationPlan to audit artifact or sidecar schemas", () => {
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
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "v2-debug-artifacts.ts",
      ),
    ];
    const violations = artifactFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /exerciseMaterialization|V2ExerciseMaterialization|v2_exercise_materialization/.test(
        text,
      )
        ? [`${path.relative(process.cwd(), file)} exposes exercise materialization`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps laneSelectionIntent out of executable seed and runtime replay seams", () => {
    const violations = seedRuntimeFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /\blaneSelectionIntent\b/.test(text)
        ? [`${path.relative(process.cwd(), file)} references laneSelectionIntent`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps repair quarantine diagnostics out of generation, seed, runtime, receipts, persistence, and acceptance thresholds", () => {
    const boundaryViolations = generationSeedRuntimeReceiptPersistenceFiles.flatMap(
      (file) => {
        const text = fs.readFileSync(file, "utf8");
        return repairQuarantineDiagnosticKeys.flatMap((key) =>
          text.includes(key)
            ? [`${path.relative(process.cwd(), file)} references ${key}`]
            : []
        );
      },
    );
    const evaluatorText = fs.readFileSync(nextMesocycleCandidateEvaluator, "utf8");
    const acceptanceThresholdViolations = [
      "legacyRepairQuarantine",
      "quarantineGroups",
      "gapInventory",
      "taxonomyMismatchInventory",
      "selectedMismatchId",
      "selectedGapProof",
      "missingProofBeforeBehaviorPromotion",
      "behaviorPromotionCandidateCount",
      "promotionCandidates",
      "doNotPromoteRows",
    ].flatMap((key) =>
      evaluatorText.includes(key)
        ? [
            `${path.relative(
              process.cwd(),
              nextMesocycleCandidateEvaluator,
            )} consumes ${key}`,
          ]
        : []
    );

    expect([...boundaryViolations, ...acceptanceThresholdViolations]).toEqual([]);
  });

  it("does not add BasePlanValidation to audit artifact or sidecar schemas", () => {
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
      path.join(
        process.cwd(),
        "src",
        "lib",
        "audit",
        "workout-audit",
        "v2-debug-artifacts.ts",
      ),
    ];
    const violations = artifactFiles.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /basePlanValidation|V2BasePlanValidation|v2_base_plan_validation|buildV2BasePlanValidation/.test(
        text,
      )
        ? [`${path.relative(process.cwd(), file)} exposes base plan validation`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("does not call the dry-run materializer from production modules", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const materializationSegment = `${path.sep}engine${path.sep}planning${path.sep}v2${path.sep}materialization${path.sep}`;
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      if (file.includes(materializationSegment)) {
        return [];
      }
      if (file === liveContextDryRunHarness) {
        return [];
      }
      const text = fs.readFileSync(file, "utf8");
      return /buildV2ExerciseMaterializationPlan\s*\(/.test(text)
        ? [`${path.relative(process.cwd(), file)} calls dry-run materializer`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("does not call the dry-run materialization report from production modules", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const materializationSegment = `${path.sep}engine${path.sep}planning${path.sep}v2${path.sep}materialization${path.sep}`;
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      if (file.includes(materializationSegment)) {
        return [];
      }
      if (file === liveContextDryRunHarness) {
        return [];
      }
      if (file === acceptanceMaterializedSeedHelper) {
        return [];
      }
      const text = fs.readFileSync(file, "utf8");
      return /buildV2MaterializationDryRunReport\s*\(/.test(text)
        ? [`${path.relative(process.cwd(), file)} calls dry-run materialization report`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("does not call the base-plan validation diagnostic from production modules", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      if (file.startsWith(v2PolicyDir)) {
        return [];
      }
      if (file === liveContextDryRunHarness) {
        return [];
      }
      const text = fs.readFileSync(file, "utf8");
      return /buildV2BasePlanValidation\s*\(/.test(text)
        ? [`${path.relative(process.cwd(), file)} calls base plan validation`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps the live-context dry-run harness read-only and outside seed/runtime/receipt paths", () => {
    const text = fs.readFileSync(liveContextDryRunHarness, "utf8");
    const forbiddenPatterns = [
      /buildMesocycleSlotPlanSeed/,
      /parseSlotPlanSeedJson/,
      /resolveSeededSlotPlan/,
      /slotPlanSeedJson/,
      /sessionDecisionReceipt/,
      /workouts\/save/,
      /save-workout/,
      /runtimeReplay/,
      /template-session\/slot-plan-seed/,
      /\.create\s*\(/,
      /\.createMany\s*\(/,
      /\.update\s*\(/,
      /\.updateMany\s*\(/,
      /\.upsert\s*\(/,
      /\.delete\s*\(/,
      /\.deleteMany\s*\(/,
    ];
    const violations = forbiddenPatterns.flatMap((pattern) =>
      pattern.test(text)
        ? [`live-context dry-run harness matches ${String(pattern)}`]
        : [],
    );

    expect(violations).toEqual([]);
  });

  it("does not call the shadow consumption diagnostic from production modules", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      if (file.startsWith(v2PolicyDir)) {
        return [];
      }
      if (file === liveContextDryRunHarness) {
        return [];
      }
      const text = fs.readFileSync(file, "utf8");
      return /buildV2BasePlanShadowConsumptionTrial\s*\(/.test(text)
        ? [`${path.relative(process.cwd(), file)} calls shadow consumption trial`]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
