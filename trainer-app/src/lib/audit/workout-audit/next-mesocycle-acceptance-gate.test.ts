import { describe, expect, it } from "vitest";
import type {
  MesocycleExplainAuditPayload,
  V2AcceptedSeedPrepareCompareAuditPayload,
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

function build(input: {
  state?: string;
  found?: boolean;
  preview?: MesocycleExplainAuditPayload;
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

  it("does not fail volume gate when a candidate is above MEV but below target", () => {
    const payload = build({
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
