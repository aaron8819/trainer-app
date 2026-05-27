import { describe, expect, it } from "vitest";
import type {
  MesocycleExplainAuditPayload,
  V2AcceptedSeedPrepareCompareAuditPayload,
  WeeklyRetroAuditPayload,
} from "./types";
import { buildNextMesocycleAcceptanceGateFromEvidence } from "./next-mesocycle-acceptance-gate";

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

function v2Compare(found = true): V2AcceptedSeedPrepareCompareAuditPayload {
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
      executableFieldShape: { classification: "v2_preserves" },
      seedSerializerIdentity: { classification: "v2_preserves" },
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
      baseValidationStatus: "pass",
      materializerStatus: "materialized",
      seedShapeCompatibility: { compatible: true },
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
    v2PrepareCompare: v2Compare(input.found ?? true),
    diagnosticPreview: input.preview,
    completedBlockRetros: input.retros,
    candidateVolumeRows: input.volumes,
  });
}

describe("next mesocycle acceptance gate", () => {
  it("reports no handoff candidate as not runnable", () => {
    const payload = build({ found: false });

    expect(payload.candidateFound).toBe(false);
    expect(payload.gateResult).toBe("not_runnable_yet");
    expect(payload.why).toContain("no persisted handoff candidate");
    expect(payload.recommendation).toBe("rerun after handoff exists");
  });

  it("prints completed-block evidence even when no candidate exists", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(payload.candidateFound).toBe(false);
    expect(payload.gateResult).toBe("not_runnable_yet");
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
    expect(payload.gateResult).toBe("not_runnable_yet");
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
      notes: "diagnostic previews are evidence only and cannot be accepted",
    });
  });

  it("fails volume gate for a candidate with a below-MEV priority muscle", () => {
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
    });
  });

  it("classifies chest Week 4 below-MEV evidence as high severity", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Chest MEV fragility"),
    ).toMatchObject({
      severity: "high",
      evidence: expect.stringContaining("W4 finished 9/10 MEV"),
    });
  });

  it("classifies calf Week 4 below-MEV evidence as high severity", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Calf MEV fragility"),
    ).toMatchObject({
      severity: "high",
      evidence: expect.stringContaining("W4 finished 7/8 MEV"),
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
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "pass",
    });
    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Target semantics noise"),
    ).toMatchObject({
      severity: "medium",
      acceptanceImplication:
        "do not fail candidate solely for below-target rows when projected volume is at or above MEV",
    });
  });

  it("surfaces repeated runtime add-ons from completed weekly retros", () => {
    const payload = build({
      found: false,
      retros: completedBlockRetros,
    });

    expect(
      payload.completedBlockEvidence.find((row) => row.risk === "Repeated runtime add-ons"),
    ).toMatchObject({
      severity: "medium",
      evidence: expect.stringContaining("W3 added_sets=8"),
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
      severity: "medium",
      evidence: expect.stringContaining("Incline Machine Press target_too_low"),
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

    expect(payload.gateResult).toBe("fail");
    expect(
      payload.gates.find((row) => row.gate === "Prior-block recurring risks"),
    ).toMatchObject({
      status: "fail",
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

  it("fails volume gate for over-MAV candidate rows", () => {
    const payload = build({
      volumes: [
        { muscle: "Chest", projectedSets: 17, mev: 10, productiveTarget: 15, mav: 16 },
      ],
    });

    expect(payload.weeklyMuscleTable[0]).toMatchObject({
      status: "over_mav_fail_or_warning",
    });
    expect(payload.gates.find((row) => row.gate === "Volume floors/zones")).toMatchObject({
      status: "fail",
    });
  });

  it("fails materialization quality for mostly repair-shaped candidate evidence", () => {
    const payload = build({
      preview: diagnosticPreview({ planningShape: "mostly_repair_shaped" }),
    });

    expect(
      payload.gates.find((row) => row.gate === "Exercise/materialization quality"),
    ).toMatchObject({
      status: "fail",
      notes: "mostly repair-shaped candidate evidence blocks acceptance",
    });
  });
});
