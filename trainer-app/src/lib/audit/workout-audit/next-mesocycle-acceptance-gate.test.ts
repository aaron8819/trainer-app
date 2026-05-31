import { describe, expect, it } from "vitest";
import type {
  MesocycleExplainAuditPayload,
  V2AcceptedSeedPrepareCompareAuditPayload,
  WeeklyRetroAuditPayload,
} from "./types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import type { MesocycleSlotPlanSeed } from "@/lib/api/mesocycle-handoff-slot-plan-projection.seed-serialization";
import {
  buildCandidateVolumeRowsFromSlotPlanSeed,
  buildNextMesocycleAcceptanceGateFromEvidence,
} from "./next-mesocycle-acceptance-gate";

const draftJson = {
  version: 1,
  sourceMesocycleId: "meso-source",
  createdAt: "2026-05-01T00:00:00.000Z",
  structure: {
    splitType: "UPPER_LOWER",
    sessionsPerWeek: 4,
    daysPerWeek: 4,
    sequenceMode: "ordered_flexible",
    slots: [
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "lower_a", intent: "LOWER" },
      { slotId: "upper_b", intent: "UPPER" },
      { slotId: "lower_b", intent: "LOWER" },
    ],
  },
  startingPoint: {
    volumeEntry: "conservative",
    baselineSource: "accumulation_preferred",
    allowNonDeloadFallback: true,
  },
  carryForwardSelections: [],
};

function source(state = "AWAITING_HANDOFF") {
  return {
    id: "meso-source",
    state,
    macroCycleId: "macro-1",
    mesoNumber: 2,
    sessionsPerWeek: 4,
    deloadSessionsCompleted: state === "ACTIVE_DELOAD" ? 2 : 4,
    nextSeedDraftJson: state === "AWAITING_HANDOFF" ? draftJson : null,
  };
}

function v2Compare(
  found = true,
  seedSource = "handoff_slot_plan_projection",
  options?: {
    baseValidationStatus?: string;
    seedShapeCompatible?: boolean;
    executableFieldShapeClassification?: string;
    seedSerializerIdentityClassification?: string;
  },
): V2AcceptedSeedPrepareCompareAuditPayload {
  const seedShapeCompatible = options?.seedShapeCompatible ?? true;
  return {
    compareStatus: found ? "available" : "no_handoff_candidate",
    handoffCandidate: found
      ? {
          found: true,
          resolvedBy: "explicit_source_mesocycle_id",
          mesocycleId: "meso-source",
          state: "AWAITING_HANDOFF",
        }
      : {
          found: false,
          resolvedBy: "not_found",
          missingReason: "no_pending_handoff_candidate",
        },
    boundaryFacts: {
      readOnly: true,
      noWrite: true,
      consumedByProduction: false,
      v2PreviewAvailable: found,
      v2ProductionWriteEligible: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      legacyProjectionCalledByV2Path: false,
      repairCalledByV2Path: false,
      transactionStatus: "no_write",
    },
    seedShapeComparison: {
      executableFieldShape: {
        classification:
          options?.executableFieldShapeClassification ?? "v2_preserves",
      },
      seedSerializerIdentity: {
        classification:
          options?.seedSerializerIdentityClassification ?? "v2_preserves",
      },
    },
    identityCoverageComparison: {
      coverageRows: [
        {
          item: "side_delt_direct",
          v2: true,
          classification: "v2_improves",
        },
      ],
    },
    provenance: {
      legacySourceLabel: seedSource,
      baseValidationStatus: options?.baseValidationStatus ?? "pass",
      materializerStatus: "materialized",
      seedShapeCompatibility: { compatible: seedShapeCompatible },
      productionGates: { missing: [] },
      promotionReadinessStatus: "blocked",
    },
  } as unknown as V2AcceptedSeedPrepareCompareAuditPayload;
}

function diagnosticPreview(input?: {
  planningShape?: string;
  weeklyMuscleTotals?: Array<{
    muscle: string;
    projectedEffectiveSets: number;
    targetMin: number | null;
    targetPreferred: number | null;
    status: "below" | "within" | "above" | "diagnostic";
  }>;
  supportLaneBoundaryRows?: Array<{
    muscle: "Triceps" | "Rear Delts";
    projectedEffectiveSets: number | null;
    mevFloor: number | null;
    severity: "warning" | "high_risk";
    mustFixBeforeWeek1: boolean;
  }>;
  shadowConsumptionTrial?: unknown;
}): MesocycleExplainAuditPayload {
  return {
    preview: {
      projectionDiagnostics: {
        planningReality: {
          summary: {
            planningShape: input?.planningShape ?? "mostly_upstream_planned",
          },
        },
      },
    },
    plannerOnlyNoRepair: {
      weeklyMuscleTotals: input?.weeklyMuscleTotals ?? [],
      ...(input?.shadowConsumptionTrial
        ? { v2BasePlanShadowConsumptionTrial: input.shadowConsumptionTrial }
        : {}),
      v2SupportLaneProjectionDiagnostic: {
        laneBoundaryRows: (input?.supportLaneBoundaryRows ?? []).map((row) => ({
          muscle: row.muscle,
          slotId: "upper_b",
          laneId: "optional_triceps_if_under_target",
          laneKind: "optional_top_up",
          supportPolicyAuthored: true,
          setDistributionBudgeted: true,
          setBudget: { min: 2, preferred: 2, max: 2 },
          exerciseSelectionPreserved: false,
          exerciseSelectionStatus: "missing_candidate",
          weeklyTargetStatus:
            row.projectedEffectiveSets != null &&
            row.mevFloor != null &&
            row.projectedEffectiveSets < row.mevFloor
              ? "below"
              : "within",
          projectedEffectiveSets: row.projectedEffectiveSets,
          mevFloor: row.mevFloor,
          likelyOwnerSeam: "materializer_exercise_selection_capacity",
          status: "authored_support_lane_dropped",
          severity: row.severity,
          mustFixBeforeWeek1: row.mustFixBeforeWeek1,
          evidence: [
            "supportPolicyAuthored:yes",
            "setDistributionBudgeted:yes",
            "exerciseSelectionPreserved:no",
          ],
          limitations: [
            "authored_budget_not_preserved_after_exercise_selection",
          ],
        })),
      },
    },
  } as unknown as MesocycleExplainAuditPayload;
}

function weeklyRetro(input: {
  week: number;
  muscles?: Array<{
    muscle: string;
    actualEffectiveSets: number;
    mev: number;
    weeklyTarget?: number;
    mav?: number;
    status?: "below_mev" | "under_target_only" | "within_target_band";
  }>;
  addedSets?: number;
  topUpMuscles?: string[];
  calibrationRows?: Array<{
    exerciseName: string;
    classification: "target_too_low" | "target_too_high" | "recalibrated_hold";
  }>;
  underTargetOnly?: string[];
  belowMev?: string[];
}): WeeklyRetroAuditPayload {
  const muscles = input.muscles ?? [];
  return {
    week: input.week,
    volumeTargeting: {
      belowMev:
        input.belowMev ??
        muscles
          .filter((row) => row.status === "below_mev")
          .map((row) => row.muscle),
      underTargetOnly:
        input.underTargetOnly ??
        muscles
          .filter((row) => row.status === "under_target_only")
          .map((row) => row.muscle),
      overMav: [],
      overTargetOnly: [],
      muscles: muscles.map((row) => {
        const weeklyTarget = row.weeklyTarget ?? row.mev + 2;
        const mav = row.mav ?? weeklyTarget + 4;
        return {
          muscle: row.muscle,
          actualEffectiveSets: row.actualEffectiveSets,
          weeklyTarget,
          mev: row.mev,
          mav,
          deltaToTarget: row.actualEffectiveSets - weeklyTarget,
          deltaToMev: row.actualEffectiveSets - row.mev,
          deltaToMav: row.actualEffectiveSets - mav,
          status: row.status ?? "within_target_band",
          topContributors: [],
        };
      }),
    },
    planAdherence: {
      explainedAdditions: {
        totalSets: input.addedSets ?? 0,
        byIntent:
          input.topUpMuscles && input.topUpMuscles.length > 0
            ? { final_weekly_opportunity_mev_closure: input.addedSets ?? 1 }
            : {},
      },
      interpretations: (input.topUpMuscles ?? []).map((muscle) => ({
        opKind: "add_set",
        intent: "final_weekly_opportunity_mev_closure",
        confidence: "high",
        source: "audit_inferred",
        setDelta: 1,
        muscles: [muscle],
        evidence: ["fixture top-up"],
      })),
    },
    exerciseLoadCalibrationRows: input.calibrationRows?.map((row, index) => ({
      week: input.week,
      workoutId: `workout-${input.week}`,
      sessionLabel: "upper_a",
      exerciseId: `exercise-${input.week}-${index}`,
      exerciseName: row.exerciseName,
      plannedSetCount: 3,
      savedSetCount: 3,
      performedSetCount: 3,
      skippedSetCount: 0,
      addedSetCount: 0,
      performedLoadSummary: {},
      classification: row.classification,
      reasonCodes: [],
      notes: [],
    })),
  } as unknown as WeeklyRetroAuditPayload;
}

const completedBlockRetros = [
  weeklyRetro({
    week: 3,
    addedSets: 8,
    topUpMuscles: ["Chest", "Calves"],
    calibrationRows: [
      { exerciseName: "Incline Machine Press", classification: "target_too_low" },
      { exerciseName: "Belt Squat", classification: "recalibrated_hold" },
    ],
    muscles: [
      { muscle: "Chest", actualEffectiveSets: 10, mev: 10 },
      { muscle: "Calves", actualEffectiveSets: 8, mev: 8 },
      { muscle: "Side Delts", actualEffectiveSets: 6, mev: 6 },
      { muscle: "Rear Delts", actualEffectiveSets: 3, mev: 4, status: "below_mev" },
    ],
  }),
  weeklyRetro({
    week: 4,
    addedSets: 2,
    topUpMuscles: ["Chest"],
    calibrationRows: [
      { exerciseName: "Close-Grip Seated Cable Row", classification: "target_too_low" },
      { exerciseName: "SLDL", classification: "recalibrated_hold" },
    ],
    muscles: [
      { muscle: "Chest", actualEffectiveSets: 9, mev: 10, status: "below_mev" },
      { muscle: "Calves", actualEffectiveSets: 7, mev: 8, status: "below_mev" },
      { muscle: "Side Delts", actualEffectiveSets: 6, mev: 6 },
      { muscle: "Rear Delts", actualEffectiveSets: 4, mev: 4 },
      {
        muscle: "Lats",
        actualEffectiveSets: 9,
        mev: 8,
        weeklyTarget: 12,
        status: "under_target_only",
      },
    ],
  }),
];

function build(input: {
  state?: string;
  found?: boolean;
  seedSource?: string;
  baseValidationStatus?: string;
  seedShapeCompatible?: boolean;
  executableFieldShapeClassification?: string;
  seedSerializerIdentityClassification?: string;
  preview?: MesocycleExplainAuditPayload;
  retros?: WeeklyRetroAuditPayload[];
  volumes?: Array<{
    muscle: string;
    projectedSets: number;
    mev?: number | null;
    productiveTarget?: number | null;
    mav?: number | null;
  }>;
}) {
  return buildNextMesocycleAcceptanceGateFromEvidence({
    userId: "user-1",
    ownerEmail: "owner@test.local",
    sourceMesocycleId: "meso-source",
    sourceMesocycle: source(input.state),
    incompleteWorkouts: [],
    v2PrepareCompare: v2Compare(input.found ?? true, input.seedSource, {
      baseValidationStatus: input.baseValidationStatus,
      seedShapeCompatible: input.seedShapeCompatible,
      executableFieldShapeClassification: input.executableFieldShapeClassification,
      seedSerializerIdentityClassification:
        input.seedSerializerIdentityClassification,
    }),
    diagnosticPreview: input.preview,
    completedBlockRetros: input.retros,
    candidateVolumeRows: input.volumes,
  });
}

const refreshedV2SupportFloorSeed: MesocycleSlotPlanSeed = {
  version: 1,
  source: "v2_materialized_seed",
  slots: [
    {
      slotId: "upper_a",
      exercises: [
        { exerciseId: "barbell-bench", role: "CORE_COMPOUND", setCount: 4 },
        { exerciseId: "close-row", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "close-lat", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "rear", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "lateral-a", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "triceps-a", role: "ACCESSORY", setCount: 3 },
      ],
    },
    {
      slotId: "lower_a",
      exercises: [
        { exerciseId: "barbell-back-squat", role: "CORE_COMPOUND", setCount: 4 },
        { exerciseId: "leg-extension", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "lying-curl", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "calf-a", role: "ACCESSORY", setCount: 4 },
      ],
    },
    {
      slotId: "upper_b",
      exercises: [
        { exerciseId: "machine-chest", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "lat", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "fly", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "lateral-b", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "triceps-b", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "curl", role: "ACCESSORY", setCount: 3 },
      ],
    },
    {
      slotId: "lower_b",
      exercises: [
        { exerciseId: "sldl", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "seated-curl", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "calf-b", role: "ACCESSORY", setCount: 4 },
      ],
    },
  ],
};

const refreshedV2SupportFloorExercises = [
  exerciseRow(
    "barbell-bench",
    "Barbell Bench Press",
    ["Chest", "Triceps"],
    ["Front Delts"],
  ),
  exerciseRow(
    "close-row",
    "Close-Grip Seated Cable Row",
    ["Lats", "Upper Back"],
    ["Biceps", "Forearms"],
  ),
  exerciseRow("close-lat", "Close-Grip Lat Pulldown", ["Lats"], ["Biceps", "Upper Back"]),
  exerciseRow("lat", "Lat Pulldown", ["Lats"], ["Biceps", "Upper Back"]),
  exerciseRow("fly", "Cable Fly", ["Chest"]),
  exerciseRow("row", "Seated Cable Row", ["Lats", "Upper Back"], ["Biceps", "Forearms"]),
  exerciseRow("rear", "Cable Rear Delt Fly", ["Rear Delts"], ["Upper Back"]),
  exerciseRow("lateral-a", "Machine Lateral Raise", ["Side Delts"]),
  exerciseRow("triceps-a", "Cable Triceps Pushdown", ["Triceps"]),
  exerciseRow("machine-chest", "Machine Chest Press", ["Chest"], ["Front Delts", "Triceps"]),
  exerciseRow("lateral-b", "Machine Lateral Raise", ["Side Delts"]),
  exerciseRow("triceps-b", "Cable Triceps Pushdown", ["Triceps"]),
  exerciseRow("curl", "Barbell Curl", ["Biceps"], ["Forearms"]),
  exerciseRow(
    "barbell-back-squat",
    "Barbell Back Squat",
    ["Quads", "Glutes"],
    ["Hamstrings", "Core", "Lower Back", "Adductors"],
  ),
  exerciseRow("leg-extension", "Leg Extension", ["Quads"]),
  exerciseRow("lying-curl", "Lying Leg Curl", ["Hamstrings"]),
  exerciseRow("calf-a", "Seated Calf Raise", ["Calves"]),
  exerciseRow("sldl", "Stiff-Legged Deadlift", ["Hamstrings"], ["Glutes", "Lower Back"]),
  exerciseRow("seated-curl", "Seated Leg Curl", ["Hamstrings"]),
  exerciseRow("split-squat", "Bulgarian Split Squat", ["Quads", "Glutes"]),
  exerciseRow("calf-b", "Seated Calf Raise", ["Calves"]),
];

function exerciseRow(
  id: string,
  name: string,
  primaryMuscles: string[],
  secondaryMuscles: string[] = [],
) {
  return {
    id,
    name,
    aliases: [],
    exerciseMuscles: [
      ...primaryMuscles.map((muscle) => ({
        role: "PRIMARY",
        muscle: { name: muscle },
      })),
      ...secondaryMuscles.map((muscle) => ({
        role: "SECONDARY",
        muscle: { name: muscle },
      })),
    ],
  };
}

function candidateVolumeRowsFromRefreshedV2Seed() {
  return buildCandidateVolumeRowsFromSlotPlanSeed({
    seed: refreshedV2SupportFloorSeed,
    exercises: refreshedV2SupportFloorExercises,
    muscles: Object.keys(VOLUME_LANDMARKS),
  });
}

function volumeRow<T extends { muscle: string }>(rows: T[], muscle: string): T {
  const found = rows.find((row) => row.muscle === muscle);
  if (!found) {
    throw new Error(`Missing candidate volume row for ${muscle}`);
  }
  return found;
}

describe("next mesocycle acceptance gate", () => {
  it("reports no handoff candidate as not runnable", () => {
    const payload = build({ found: false });

    expect(payload.candidateFound).toBe(false);
    expect(payload.gateResult).toBe("not_runnable");
    expect(payload.why).toContain("no persisted handoff candidate");
    expect(payload.recommendation).toBe("rerun after handoff exists");
    expect(payload.gates.find((row) => row.gate === "Candidate identity")).toMatchObject({
      severity: "blocker",
      ownerSeam: "candidate identity",
      mustFixBeforeWeek1: true,
    });
  });

  it("prints completed-block evidence even when no candidate exists", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(payload.candidateFound).toBe(false);
    expect(payload.gateResult).toBe("not_runnable");
    expect(payload.completedBlockEvidence.map((row) => row.risk)).toEqual(
      expect.arrayContaining([
        "Chest MEV fragility",
        "Calf MEV fragility",
        "Repeated runtime add-ons",
      ]),
    );
    expect(
      payload.gates.find((row) => row.gate === "Prior-block recurring risks"),
    ).toMatchObject({
      status: "unknown",
      notes: "evidence will be applied when a persisted handoff candidate exists",
    });
  });

  it("keeps ACTIVE_DELOAD sources without handoff candidates blocked until handoff", () => {
    const payload = build({ state: "ACTIVE_DELOAD", found: false });

    expect(payload.candidateFound).toBe(false);
    expect(payload.gateResult).toBe("not_runnable");
    expect(payload.blockers).toEqual(
      expect.arrayContaining([
        "source state not AWAITING_HANDOFF (ACTIVE_DELOAD)",
        "no persisted handoff candidate",
        "current deload incomplete (2/4)",
      ]),
    );
  });

  it("labels diagnostic preview as non-candidate when no persisted candidate exists", () => {
    const payload = build({
      found: false,
      preview: diagnosticPreview(),
    });

    expect(payload.candidateIdentity.candidateKind).toBe(
      "diagnostic_preview_only",
    );
    expect(payload.diagnosticPreview.label).toBe(
      "diagnostic_preview_not_candidate",
    );
    expect(payload.gates.find((row) => row.gate === "Candidate identity")).toMatchObject({
      status: "fail",
      severity: "blocker",
      notes: "diagnostic previews are evidence only and cannot be accepted",
    });
    expect(payload.gateResult).toBe("not_runnable");
  });

  it("rejects a candidate with a below-MEV priority muscle", () => {
    const payload = build({
      volumes: [
        { muscle: "Chest", projectedSets: 8, mev: 10, productiveTarget: 14, mav: 16 },
      ],
    });

    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      muscle: "Chest",
      status: "below_mev_fail",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "fail",
      severity: "high_risk",
      ownerSeam: "volume floors",
      mustFixBeforeWeek1: true,
    });
    expect(payload.gateResult).toBe("rejected");
    expect(payload.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "Volume floors/zones",
          ownerSeam: "volume floors",
          smallestSafeFix: expect.stringContaining("canonical volume-floor"),
          mustFixBeforeWeek1: true,
        }),
      ]),
    );
  });

  it("rejects a real candidate with rear-delt volume below the floor", () => {
    const payload = build({
      volumes: [
        {
          muscle: "Rear Delts",
          projectedSets: 3.1,
          mev: 4,
          productiveTarget: 6,
          mav: 12,
        },
      ],
    });

    expect(payload.candidateIdentity.candidateKind).toBe("draft");
    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      muscle: "Rear Delts",
      projectedSets: 3.1,
      mev: 4,
      status: "below_mev_fail",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "fail",
      severity: "high_risk",
      ownerSeam: "volume floors",
      mustFixBeforeWeek1: true,
    });
    expect(payload.gateResult).toBe("rejected");
  });

  it("identifies a refreshed V2 materialized seed as the evaluated candidate source", () => {
    const payload = build({
      seedSource: "v2_materialized_seed",
      volumes: [
        {
          muscle: "Rear Delts",
          projectedSets: 7,
          mev: 4,
          productiveTarget: 6,
          mav: 12,
        },
      ],
    });

    expect(payload.candidateIdentity).toMatchObject({
      candidateKind: "draft",
      candidateSeedSource: "v2_materialized_seed",
    });
  });

  it("does not reject solely because base validation passed with non-blocking warnings", () => {
    const payload = build({
      seedSource: "v2_materialized_seed",
      baseValidationStatus: "pass_with_warnings",
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 12, mav: 16 },
        { muscle: "Calves", projectedSets: 10, mev: 8, productiveTarget: 10, mav: 14 },
      ],
    });

    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "pass",
    });
    expect(payload.gates.find((row) => row.gate === "Week 1 trainability")).toMatchObject({
      status: "warning",
      severity: "warning",
      evidence: "base=pass_with_warnings seed_shape=yes post_accept_verification=required",
      mustFixBeforeWeek1: false,
    });
    expect(payload.decisionSummary.trainability).toBe("warning");
    expect(payload.gateResult).toBe("accepted_with_watch_items");
  });

  it("turns non-blocking base validation warnings into Week 1 watch items", () => {
    const payload = build({
      baseValidationStatus: "pass_with_warnings",
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 12, mav: 16 },
      ],
    });

    expect(payload.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "Week 1 trainability",
          severity: "warning",
          mustFixBeforeWeek1: false,
        }),
      ]),
    );
    expect(payload.watchItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          risk: "Post-accept Week 1 verification",
          monitoringPlan: expect.stringContaining(
            "next-mesocycle-post-accept-verification",
          ),
        }),
      ]),
    );
  });

  it("rejects a candidate when base validation fails even if floors pass", () => {
    const payload = build({
      baseValidationStatus: "fail",
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 12, mav: 16 },
        { muscle: "Calves", projectedSets: 10, mev: 8, productiveTarget: 10, mav: 14 },
      ],
    });

    expect(payload.gates.find((row) => row.gate === "Week 1 trainability")).toMatchObject({
      status: "fail",
      severity: "high_risk",
      evidence: "base=fail seed_shape=yes",
      mustFixBeforeWeek1: true,
    });
    expect(payload.gateResult).toBe("rejected");
  });

  it("rejects a candidate when seed shape compatibility fails", () => {
    const payload = build({
      seedShapeCompatible: false,
      executableFieldShapeClassification: "v2_regresses",
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 12, mav: 16 },
      ],
    });

    expect(
      payload.gates.find((row) => row.gate === "Seed truth/runtime contract"),
    ).toMatchObject({
      status: "unknown",
      severity: "blocker",
      mustFixBeforeWeek1: true,
    });
    expect(payload.gates.find((row) => row.gate === "Week 1 trainability")).toMatchObject({
      status: "fail",
      severity: "high_risk",
      evidence: "base=pass seed_shape=no",
      mustFixBeforeWeek1: true,
    });
    expect(payload.gateResult).toBe("rejected");
  });

  it("keeps rear-delt diagnostic preview evidence separate from candidate truth", () => {
    const payload = build({
      found: false,
      preview: diagnosticPreview({
        weeklyMuscleTotals: [
          {
            muscle: "Rear Delts",
            projectedEffectiveSets: 3.1,
            targetMin: 4,
            targetPreferred: 6,
            status: "below",
          },
        ],
        supportLaneBoundaryRows: [
          {
            muscle: "Rear Delts",
            projectedEffectiveSets: 3.1,
            mevFloor: 4,
            severity: "high_risk",
            mustFixBeforeWeek1: true,
          },
        ],
      }),
    });

    expect(payload.candidateFound).toBe(false);
    expect(payload.candidateIdentity.candidateKind).toBe(
      "diagnostic_preview_only",
    );
    expect(payload.diagnosticPreview.label).toBe(
      "diagnostic_preview_not_candidate",
    );
    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      muscle: "Rear Delts",
      status: "below_mev_fail",
    });
    expect(payload.gates.find((row) => row.gate === "Candidate identity")).toMatchObject({
      status: "fail",
      severity: "blocker",
      notes: "diagnostic previews are evidence only and cannot be accepted",
    });
    expect(payload.gateResult).toBe("not_runnable");
  });

  it("keeps completed-block evidence separate from hypothesis and required fix", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Chest MEV fragility"),
    ).toMatchObject({
      severity: "info",
      evidence: expect.stringContaining("W4 finished 9/10 MEV"),
      hypothesis: expect.stringContaining("planned floor margin"),
      acceptanceImplication: expect.stringContaining("candidate evidence pending"),
      requiredFix: expect.stringContaining("none unless"),
      mustFixBeforeWeek1: false,
    });
  });

  it("does not make prior-block evidence an automatic required fix", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Calf MEV fragility"),
    ).toMatchObject({
      severity: "info",
      evidence: expect.stringContaining("W4 finished 7/8 MEV"),
      requiredFix: expect.stringContaining("none unless"),
      mustFixBeforeWeek1: false,
    });
  });

  it("does not fail volume gate when a candidate is above MEV but below target", () => {
    const payload = build({
      retros: completedBlockRetros,
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 14, mav: 16 },
      ],
    });

    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      status: "above_mev_below_target_not_failure",
      severity: "info",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "pass",
    });
    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Target semantics noise"),
    ).toMatchObject({
      severity: "info",
      acceptanceImplication:
        "do not fail candidate solely for below-target rows when projected volume is at or above MEV",
      requiredFix: expect.stringContaining("none for below-target/above-MEV"),
    });
    expect(payload.doNotFixNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: "below target but above MEV" }),
      ]),
    );
  });

  it("surfaces repeated runtime add-ons from completed weekly retros", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Repeated runtime add-ons"),
    ).toMatchObject({
      severity: "warning",
      evidence: expect.stringContaining("W3 added_sets=8"),
      mustFixBeforeWeek1: false,
    });
  });

  it("surfaces load calibration drift from completed weekly retros", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Load calibration drift"),
    ).toMatchObject({
      severity: "warning",
      evidence: expect.stringContaining("Incline Machine Press target_too_low"),
      ownerSeam: "prescription/readout",
    });
  });

  it("fails the recurring-risk gate when a candidate repeats below-MEV chest and calf floors", () => {
    const payload = build({
      retros: completedBlockRetros,
      volumes: [
        { muscle: "Chest", projectedSets: 9, mev: 10, productiveTarget: 14, mav: 16 },
        { muscle: "Calves", projectedSets: 7, mev: 8, productiveTarget: 10, mav: 14 },
        { muscle: "Side Delts", projectedSets: 8, mev: 6, productiveTarget: 8, mav: 14 },
        { muscle: "Rear Delts", projectedSets: 7, mev: 4, productiveTarget: 6, mav: 12 },
      ],
    });

    expect(payload.gateResult).toBe("rejected");
    expect(
      payload.gates.find((row) => row.gate === "Prior-block recurring risks"),
    ).toMatchObject({
      status: "fail",
      severity: "high_risk",
      evidence: expect.stringContaining("Chest MEV fragility"),
    });
  });

  it("marks completed-block floor risks addressed when candidate clears MEV floors", () => {
    const payload = build({
      retros: completedBlockRetros,
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 14, mav: 16 },
        { muscle: "Calves", projectedSets: 10, mev: 8, productiveTarget: 10, mav: 14 },
        { muscle: "Side Delts", projectedSets: 8, mev: 6, productiveTarget: 8, mav: 14 },
        { muscle: "Rear Delts", projectedSets: 7, mev: 4, productiveTarget: 6, mav: 12 },
      ],
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Chest MEV fragility"),
    ).toMatchObject({
      acceptanceImplication: expect.stringContaining("candidate addresses Chest floor"),
    });
    expect(
      payload.completedBlockEvidence.find(
        (row) => row.risk === "Optional gap-fill dependency risk",
      ),
    ).toMatchObject({
      acceptanceImplication: expect.stringContaining("planned floors clear"),
    });
    expect(
      payload.gates.find((row) => row.gate === "Prior-block recurring risks"),
    ).toMatchObject({
      status: "pass",
    });
  });

  it("turns exact-MEV recurring fragile muscles into watch items", () => {
    const payload = build({
      retros: completedBlockRetros,
      volumes: [
        { muscle: "Chest", projectedSets: 10, mev: 10, productiveTarget: 14, mav: 16 },
        { muscle: "Calves", projectedSets: 8, mev: 8, productiveTarget: 10, mav: 14 },
        { muscle: "Side Delts", projectedSets: 8, mev: 6, productiveTarget: 8, mav: 14 },
        { muscle: "Rear Delts", projectedSets: 7, mev: 4, productiveTarget: 6, mav: 12 },
      ],
    });

    expect(payload.gateResult).toBe("accepted_with_watch_items");
    expect(payload.watchItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ risk: "Chest floor margin" }),
        expect.objectContaining({ risk: "Calves floor margin" }),
      ]),
    );
    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Chest MEV fragility"),
    ).toMatchObject({
      severity: "warning",
      mustFixBeforeWeek1: false,
    });
  });

  it("computes refreshed V2 support-floor volumes from executable seed truth", () => {
    const rows = candidateVolumeRowsFromRefreshedV2Seed();
    const seedRows = refreshedV2SupportFloorSeed.slots.flatMap(
      (slot) => slot.exercises,
    );

    expect(seedRows).toHaveLength(21);
    expect(Math.max(...seedRows.map((row) => row.setCount))).toBeLessThanOrEqual(4);
    expect(volumeRow(rows, "Rear Delts")).toMatchObject({
      projectedSets: 5.5,
      mev: 4,
    });
    expect(volumeRow(rows, "Chest")).toMatchObject({
      projectedSets: 10,
      mev: 10,
    });
    expect(volumeRow(rows, "Calves")).toMatchObject({
      projectedSets: 8,
      mev: 8,
    });
    expect(volumeRow(rows, "Side Delts")).toMatchObject({
      projectedSets: 8,
      mev: 8,
    });
    expect(volumeRow(rows, "Triceps")).toMatchObject({
      projectedSets: 8.2,
      mev: 6,
    });
    for (const seedExercise of seedRows) {
      expect(Object.keys(seedExercise).sort()).toEqual([
        "exerciseId",
        "role",
        "setCount",
      ]);
    }
    expect(rows.filter((row) => row.mev != null && row.projectedSets < row.mev)).toEqual([]);
    expect(rows.filter((row) => row.mav != null && row.projectedSets > row.mav)).toEqual([]);
  });

  it("judges refreshed V2 support floors from seed truth instead of diagnostic preview volume", () => {
    const payload = build({
      seedSource: "v2_materialized_seed",
      preview: diagnosticPreview({
        weeklyMuscleTotals: [
          {
            muscle: "Rear Delts",
            projectedEffectiveSets: 3.1,
            targetMin: 4,
            targetPreferred: 6,
            status: "below",
          },
          {
            muscle: "Side Delts",
            projectedEffectiveSets: 6,
            targetMin: 8,
            targetPreferred: 10,
            status: "below",
          },
          {
            muscle: "Triceps",
            projectedEffectiveSets: 4.4,
            targetMin: 6,
            targetPreferred: 8,
            status: "below",
          },
        ],
        supportLaneBoundaryRows: [
          {
            muscle: "Triceps",
            projectedEffectiveSets: 4.4,
            mevFloor: 6,
            severity: "high_risk",
            mustFixBeforeWeek1: true,
          },
        ],
      }),
      volumes: candidateVolumeRowsFromRefreshedV2Seed(),
    });

    expect(volumeRow(payload.weeklyMuscleTable, "Rear Delts")).toMatchObject({
      projectedSets: 5.5,
      status: "productive_zone",
    });
    expect(volumeRow(payload.weeklyMuscleTable, "Chest")).toMatchObject({
      projectedSets: 10,
      status: "productive_zone",
    });
    expect(volumeRow(payload.weeklyMuscleTable, "Calves")).toMatchObject({
      projectedSets: 8,
      status: "productive_zone",
    });
    expect(volumeRow(payload.weeklyMuscleTable, "Side Delts")).toMatchObject({
      projectedSets: 8,
      status: "productive_zone",
    });
    expect(volumeRow(payload.weeklyMuscleTable, "Triceps")).toMatchObject({
      projectedSets: 8.2,
      status: "productive_zone",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "pass",
    });
    expect(
      payload.gates.find((row) => row.gate === "Exercise/materialization quality"),
    ).toMatchObject({
      status: "warning",
      severity: "warning",
      notes:
        "authored support lane was budgeted but dropped; current candidate floor is not below MEV",
      mustFixBeforeWeek1: false,
    });
    expect(payload.gateResult).toBe("accepted_with_watch_items");
    expect(payload.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "Volume floors/zones",
          severity: "high_risk",
        }),
      ]),
    );
  });

  it("preserves diagnostic-preview volume fallback when no seed-derived rows are supplied", () => {
    const payload = build({
      preview: diagnosticPreview({
        weeklyMuscleTotals: [
          {
            muscle: "Rear Delts",
            projectedEffectiveSets: 3.1,
            targetMin: 4,
            targetPreferred: 6,
            status: "below",
          },
        ],
      }),
    });

    expect(payload.weeklyMuscleTable).toEqual([
      expect.objectContaining({
        muscle: "Rear Delts",
        projectedSets: 3.1,
        status: "below_mev_fail",
      }),
    ]);
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "fail",
    });
    expect(payload.gateResult).toBe("rejected");
  });

  it("fails volume gate for over-MAV candidate rows", () => {
    const payload = build({
      volumes: [
        { muscle: "Chest", projectedSets: 17, mev: 10, productiveTarget: 15, mav: 16 },
      ],
    });

    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      status: "over_mav_fail_or_warning",
      severity: "high_risk",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "fail",
      severity: "high_risk",
    });
    expect(payload.gateResult).toBe("rejected");
  });

  it("separates trainability pass from planner quality warning for repair-heavy candidates", () => {
    const payload = build({
      preview: diagnosticPreview({ planningShape: "mostly_repair_shaped" }),
    });

    expect(
      payload.gates.find((row) => row.gate === "Exercise/materialization quality"),
    ).toMatchObject({
      status: "warning",
      severity: "warning",
      notes: "repair-heavy candidate can be trainable but carries planner/materializer quality debt",
    });
    expect(payload.decisionSummary).toMatchObject({
      trainability: "pass",
      plannerMaterializerQuality: "warning",
      repairBurden: "high",
      repairBurdenSource: "planning_reality_summary",
      repairBurdenClassification: "architecture_debt",
    });
    expect(payload.decisionSummary.repairBurdenEvidence).toContain(
      "classification=architecture_debt",
    );
    expect(payload.gateResult).toBe("accepted_with_watch_items");
    expect(payload.watchItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ risk: "Repair burden" })]),
    );
  });

  it("labels repair burden as candidate truth only when candidate floors fail", () => {
    const payload = build({
      preview: diagnosticPreview({ planningShape: "mostly_repair_shaped" }),
      volumes: [
        {
          muscle: "Rear Delts",
          projectedSets: 3,
          mev: 4,
          productiveTarget: 6,
          mav: 12,
        },
      ],
    });

    expect(payload.gateResult).toBe("rejected");
    expect(payload.decisionSummary).toMatchObject({
      repairBurden: "high",
      repairBurdenClassification: "candidate_truth",
    });
    expect(payload.decisionSummary.repairBurdenEvidence).toContain(
      "classification=candidate_truth",
    );
  });

  it("surfaces shadow consumption as diagnostic candidate-quality evidence only", () => {
    const payload = build({
      preview: diagnosticPreview({
        shadowConsumptionTrial: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          status: "available",
          guardrails: {
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
          },
          summary: {
            repairDependencyDelta: -8,
            currentRepairDependencyCount: 9,
            shadowRemainingRepairDependencyCount: 1,
            regressionCount: 0,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
      }),
    });

    expect(payload.gateResult).toBe("accepted_with_watch_items");
    expect(payload.decisionSummary).toMatchObject({
      shadowConsumptionClassification:
        "diagnostic_positive_needs_inspection",
      shadowConsumptionNextSafeAction: "inspect_shadow_consumption",
    });
    expect(payload.decisionSummary.shadowConsumptionEvidence).toContain(
      "consumedByProduction=false",
    );
  });

  it("blocks a candidate when an authored support lane is dropped and the floor remains below MEV", () => {
    const payload = build({
      preview: diagnosticPreview({
        weeklyMuscleTotals: [
          {
            muscle: "Triceps",
            projectedEffectiveSets: 5,
            targetMin: 6,
            targetPreferred: 8,
            status: "below",
          },
        ],
        supportLaneBoundaryRows: [
          {
            muscle: "Triceps",
            projectedEffectiveSets: 5,
            mevFloor: 6,
            severity: "high_risk",
            mustFixBeforeWeek1: true,
          },
        ],
      }),
      volumes: [
        {
          muscle: "Triceps",
          projectedSets: 5,
          mev: 6,
          productiveTarget: 8,
          mav: 12,
        },
      ],
    });

    expect(
      payload.gates.find((row) => row.gate === "Exercise/materialization quality"),
    ).toMatchObject({
      status: "fail",
      severity: "high_risk",
      ownerSeam: "materializer/exercise-selection capacity",
      notes:
        "authored support lane was budgeted but dropped before selection while the candidate remains below MEV",
      mustFixBeforeWeek1: true,
    });
    expect(payload.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "Exercise/materialization quality",
          smallestSafeFix: expect.stringContaining("preserve the authored support lane"),
          mustFixBeforeWeek1: true,
        }),
      ]),
    );
    expect(payload.gateResult).toBe("rejected");
  });

  it("warns when an authored support lane is dropped but no floor issue remains", () => {
    const payload = build({
      preview: diagnosticPreview({
        weeklyMuscleTotals: [
          {
            muscle: "Triceps",
            projectedEffectiveSets: 7,
            targetMin: 6,
            targetPreferred: 8,
            status: "within",
          },
        ],
        supportLaneBoundaryRows: [
          {
            muscle: "Triceps",
            projectedEffectiveSets: 7,
            mevFloor: 6,
            severity: "warning",
            mustFixBeforeWeek1: false,
          },
        ],
      }),
      volumes: [
        {
          muscle: "Triceps",
          projectedSets: 7,
          mev: 6,
          productiveTarget: 8,
          mav: 12,
        },
      ],
    });

    expect(
      payload.gates.find((row) => row.gate === "Exercise/materialization quality"),
    ).toMatchObject({
      status: "warning",
      severity: "warning",
      ownerSeam: "materializer/exercise-selection capacity",
      notes:
        "authored support lane was budgeted but dropped; current candidate floor is not below MEV",
      mustFixBeforeWeek1: false,
    });
    expect(payload.gateResult).toBe("accepted_with_watch_items");
  });

  it("accepts a clean candidate with no material concerns", () => {
    const payload = build({
      volumes: [
        { muscle: "Chest", projectedSets: 12, mev: 10, productiveTarget: 12, mav: 16 },
        { muscle: "Calves", projectedSets: 10, mev: 8, productiveTarget: 10, mav: 14 },
      ],
    });

    expect(payload.gateResult).toBe("accepted");
    expect(payload.decisionSummary).toMatchObject({
      trainability: "pass",
      plannerMaterializerQuality: "pass",
    });
    expect(payload.findings).toEqual([]);
  });
});
