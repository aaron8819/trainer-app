import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildV2AcceptedPlannerIntentDto,
  buildV2PlannerMesocyclePolicy,
} from "./index";

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  return Object.values(value).flatMap(collectStrings);
}

function lane(week: number, slotId: string, laneId: string) {
  const found = buildV2AcceptedPlannerIntentDto()
    .weekPolicies.find((row) => row.week === week)
    ?.slots.find((slot) => slot.slotId === slotId)
    ?.lanes.find((row) => row.laneId === laneId);
  if (!found) {
    throw new Error(`Missing DTO lane ${week}:${slotId}:${laneId}`);
  }
  return found;
}

describe("buildV2AcceptedPlannerIntentDto", () => {
  it("returns deterministic compact policy intent", () => {
    const first = buildV2AcceptedPlannerIntentDto();
    const second = buildV2AcceptedPlannerIntentDto();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      targetSkeletonId: "upper_lower_4x_v2",
      split: "upper_lower_4x",
      weekCount: 5,
      slotSequence: [
        { slotIndex: 0, slotId: "upper_a" },
        { slotIndex: 1, slotId: "lower_a" },
        { slotIndex: 2, slotId: "upper_b" },
        { slotIndex: 3, slotId: "lower_b" },
      ],
    });
    expect(first.phases.map((row) => row.phase)).toEqual([
      "entry_calibration",
      "accumulation",
      "hard_accumulation",
      "peak_overreach_lite",
      "deload",
    ]);
  });

  it("contains no selected identities, exercise ids, or exercise names", () => {
    const dto = buildV2AcceptedPlannerIntentDto();
    const keys = collectKeys(dto);
    const serialized = JSON.stringify(dto);

    expect(keys).not.toEqual(
      expect.arrayContaining([
        "selectedIdentity",
        "selectedExercise",
        "selectedExercises",
        "exerciseId",
        "exerciseName",
        "name",
        "candidateInventory",
        "inventoryCandidates",
      ]),
    );
    expect(serialized).not.toMatch(
      /selectedIdentity|selectedExercise|exerciseId|exerciseName|candidateInventory|inventoryCandidates/,
    );
  });

  it("contains no diagnostic, readout, audit, repair, runtime, receipt, or artifact fields", () => {
    const dto = buildV2AcceptedPlannerIntentDto();
    const keys = collectKeys(dto);
    const strings = collectStrings(dto).join(" ");

    expect(keys).not.toEqual(
      expect.arrayContaining([
        "readOnly",
        "affectsScoringOrGeneration",
        "guardrails",
        "diagnosticOnly",
        "status",
        "warnings",
        "blockers",
        "limitations",
        "evidence",
        "evidenceBasis",
        "designBasis",
        "summary",
        "sidecar",
        "debugArtifact",
        "artifact",
        "planningReality",
        "mesocycleStrategyDiagnostic",
        "v2TargetVsNoRepairDiff",
        "crossWeekProjectionGate",
        "v2ExerciseSelectionPlanDiagnostic",
        "v2DeloadProjectionDiagnostic",
        "v2SupportLaneProjectionDiagnostic",
        "v2SelectionCapacityPlanDiagnostic",
        "repairPromotionScoreboard",
        "repairMateriality",
        "noRepair",
        "repairedProjection",
        "slotPlans",
        "weeklyMuscleTotals",
        "selectionMetadata",
        "sessionDecisionReceipt",
        "provenance",
      ]),
    );
    expect(strings).not.toMatch(
      /audit|planningReality|mesocycleStrategyDiagnostic|noRepair|no-repair|repaired|runtime|receipt|artifact|sidecar|repairMateriality|guardrail/i,
    );
  });

  it("keeps top-level policy source as the only source key", () => {
    const dto = buildV2AcceptedPlannerIntentDto();
    const sourceKeys = collectKeys(dto).filter((key) => key === "source");

    expect(sourceKeys).toEqual(["source"]);
    expect(dto.source).toBe("v2_planner_policy");
  });

  it("does not expose raw pure policy guardrails", () => {
    const dto = buildV2AcceptedPlannerIntentDto();

    expect(collectKeys(dto)).not.toContain("guardrails");
    expect(JSON.stringify(dto)).not.toMatch(/doesNotUse|doesNotAffect/);
  });

  it("includes compact lane, class, set, support, capacity, duplicate, and continuity intent", () => {
    expect(lane(1, "upper_a", "triceps")).toMatchObject({
      laneId: "triceps",
      role: "accessory",
      requirement: "required",
      primaryMuscles: ["Triceps"],
      acceptableExerciseClasses: ["triceps_isolation", "pressdown"],
      preferredExerciseClasses: ["triceps_isolation", "pressdown"],
      setBudget: {
        min: 2,
        preferred: 3,
        max: 3,
        basis: "support_direct_floor",
      },
      supportDirectFloor: {
        muscle: "Triceps",
        minDirectSets: 2,
        requiredExerciseClasses: ["triceps_isolation", "pressdown"],
        collateralCanSatisfy: false,
      },
      collateralCreditLimit: {
        maxWeeklyEffectiveSetsCreditable: 2,
        collateralExerciseClasses: ["horizontal_press", "vertical_press"],
        creditAppliesToWeeklyTotalOnly: true,
      },
      perExerciseCap: {
        maxSetsWithoutJustification: 4,
        maxDirectExercises: 1,
        allowAboveFiveSetsOnlyWithJustification: true,
      },
      duplicatePolicy: {
        scope: "same_slot",
        sameExerciseAllowedOnlyWithJustification: true,
      },
      cleanAlternativePolicy: {
        evaluationTiming: "future_inventory_selection",
      },
      continuityPolicy: {
        exactIdentityPolicy: "not_planned_until_inventory_selection",
      },
    });
    expect(lane(1, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      requirement: "conditional_optional",
      optionalActivationPolicy: {
        type: "activate_only_if_weekly_target_below_range",
        weeklyFloorSets: 4,
        requiresSlotExerciseHeadroom: true,
        requiresCleanAlternative: true,
        requiresRecoverability: true,
      },
      concentrationPolicy: {
        appliesTo: "optional_lane",
      },
    });
  });

  it("includes muscle target tiers, phase multipliers, and compact deload transform summary", () => {
    const dto = buildV2AcceptedPlannerIntentDto();

    expect(dto.muscleTargets.find((row) => row.muscle === "Chest")).toMatchObject({
      targetTier: "A_PRIMARY",
      role: "primary",
      setRange: { min: 8, preferred: 9, max: 11 },
      exposureCount: 2,
    });
    expect(dto.weekPolicies[3]).toMatchObject({
      week: 4,
      phase: "peak_overreach_lite",
      volumeMultiplier: 1.125,
      rirTarget: "0-1 isolations; 1-2 compounds",
    });
    expect(dto.deloadTransform).toEqual({
      preservePlannedMovements: true,
      targetVolumeReductionPercent: { min: 40, max: 60 },
      targetRir: "4-5",
      removeRedundantAccessories: true,
      introduceNewMovements: false,
    });
  });

  it("does not mutate raw pure planner output", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const before = JSON.parse(JSON.stringify(policy)) as typeof policy;

    buildV2AcceptedPlannerIntentDto(policy);

    expect(policy).toEqual(before);
  });

  it("is not serialized into audit artifact or sidecar schema files", () => {
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
      return /acceptedPlannerIntent|V2AcceptedPlannerIntentDto|buildV2AcceptedPlannerIntentDto/.test(
        text,
      )
        ? [path.relative(process.cwd(), file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
