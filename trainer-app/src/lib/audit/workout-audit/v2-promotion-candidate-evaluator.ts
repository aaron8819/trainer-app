import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2PlanQualityBenchmark,
  V2PromotionCandidateEvaluator,
  V2PromotionCandidateStopReason,
} from "./types";

type Candidate = V2PromotionCandidateEvaluator["candidates"][number];
type CandidateInput = Omit<Candidate, "rank" | "score" | "status"> & {
  score: Omit<Candidate["score"], "total">;
};
type RepairScoreboard = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"]
>;
type GapInventoryRow =
  RepairScoreboard["interpretation"]["gapInventory"][number];
type BenchmarkGate = V2PlanQualityBenchmark["gates"][number];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function countStopReasons(
  candidates: Candidate[],
): V2PromotionCandidateEvaluator["stopReasonCounts"] {
  return candidates.reduce<V2PromotionCandidateEvaluator["stopReasonCounts"]>(
    (counts, candidate) => {
      candidate.stopReasons.forEach((reason) => {
        counts[reason] = (counts[reason] ?? 0) + 1;
      });
      return counts;
    },
    {},
  );
}

function statusForCandidate(input: {
  priorProbe: Candidate["priorProbe"];
  stopReasons: V2PromotionCandidateStopReason[];
  score: Candidate["score"];
}): Candidate["status"] {
  if (input.stopReasons.length === 0) {
    return input.score.measuredOwnerSpecificPositiveImpact > 0
      ? "ready"
      : "blocked";
  }
  if (input.priorProbe === "bounded_watch") {
    return "watch";
  }
  if (
    input.stopReasons.includes("measured_no_impact") ||
    input.stopReasons.includes("stale_noise") ||
    input.stopReasons.includes("diagnostic_artifact") ||
    input.stopReasons.includes("already_promoted_baseline") ||
    input.stopReasons.includes("materializer_regression")
  ) {
    return "stopped";
  }
  if (
    input.stopReasons.includes("missing_acceptance_or_watch_clearance") ||
    input.stopReasons.includes("missing_seed_runtime_receipt_db_non_consumption")
  ) {
    return "blocked";
  }
  return "stopped";
}

function candidate(input: CandidateInput): Candidate {
  const score = {
    ...input.score,
    total: Object.values(input.score).reduce((sum, value) => sum + value, 0),
  };
  return {
    ...input,
    status: statusForCandidate({
      priorProbe: input.priorProbe,
      stopReasons: input.stopReasons,
      score,
    }),
    rank: null,
    score,
    evidence: uniqueSorted(input.evidence),
    missingProof: uniqueSorted(input.missingProof),
  };
}

function scoreInput(input: {
  measuredOwnerSpecificPositiveImpact?: number;
  materializerNonRegression?: number;
  protectedCoverage?: number;
  acceptanceWatchStatus?: number;
  seedRuntimeReceiptDbNonConsumption?: number;
  sourceAttributionQuality?: number;
  priorProbeAdjustment?: number;
  implementationScope?: number;
}): CandidateInput["score"] {
  return {
    measuredOwnerSpecificPositiveImpact:
      input.measuredOwnerSpecificPositiveImpact ?? 0,
    materializerNonRegression: input.materializerNonRegression ?? 0,
    protectedCoverage: input.protectedCoverage ?? 0,
    acceptanceWatchStatus: input.acceptanceWatchStatus ?? 0,
    seedRuntimeReceiptDbNonConsumption:
      input.seedRuntimeReceiptDbNonConsumption ?? 20,
    sourceAttributionQuality: input.sourceAttributionQuality ?? 10,
    priorProbeAdjustment: input.priorProbeAdjustment ?? 0,
    implementationScope: input.implementationScope ?? 0,
  };
}

function noConsumptionStopReasons(input: {
  consumedByProduction?: boolean;
  consumedByDemandOrMaterializer?: boolean;
}): V2PromotionCandidateStopReason[] {
  return input.consumedByProduction || input.consumedByDemandOrMaterializer
    ? ["missing_seed_runtime_receipt_db_non_consumption"]
    : [];
}

function candidateFromGapRow(row: GapInventoryRow): Candidate {
  const stopReasons: V2PromotionCandidateStopReason[] = [];
  if (row.status === "measured_promoted_baseline_idempotent") {
    stopReasons.push("already_promoted_baseline");
  } else if (row.status === "measured_no_candidate_impact") {
    stopReasons.push("measured_no_impact");
  } else if (
    row.status === "measured_no_drift" ||
    row.status === "stale_or_ambiguous"
  ) {
    stopReasons.push("stale_noise");
  } else if (row.status === "diagnostic_only") {
    stopReasons.push("diagnostic_artifact");
  } else if (row.status === "blocked_by_missing_evidence") {
    stopReasons.push("missing_bounded_delta");
  }

  return candidate({
    candidateId: row.gapId,
    label: row.description,
    ownerSeam: row.likelyOwnerSeam,
    sourceSurface: "repair_promotion_scoreboard",
    priorProbe:
      row.status === "measured_promoted_baseline_idempotent"
        ? "promoted"
        : row.status === "measured_no_candidate_impact"
          ? "measured_no_impact"
          : row.status === "measured_no_drift" ||
              row.status === "stale_or_ambiguous"
            ? "stale_noise"
            : row.status === "selected_for_measured_proof"
              ? "measured_positive"
              : row.status === "blocked_by_missing_evidence"
                ? "blocked"
                : "unmeasured",
    stopReasons,
    score: scoreInput({
      measuredOwnerSpecificPositiveImpact:
        row.status === "selected_for_measured_proof" ? 30 : 0,
      materializerNonRegression:
        row.evidenceQuality === "measured_materializer_projection" ? 20 : 0,
      protectedCoverage:
        row.currentEvidence.some((value) =>
          value.includes("protectedCoverage=preserved"),
        )
          ? 15
          : 0,
      sourceAttributionQuality:
        row.evidenceQuality === "measured_materializer_projection" ? 15 : 8,
      priorProbeAdjustment:
        row.status === "measured_promoted_baseline_idempotent"
          ? -60
          : row.status === "measured_no_candidate_impact" ||
              row.status === "measured_no_drift"
            ? -35
            : 0,
      implementationScope:
        row.trainingImportance === "high"
          ? 10
          : row.trainingImportance === "medium"
            ? 6
            : 2,
    }),
    evidence: row.currentEvidence,
    missingProof: row.missingProof,
    nextSafeAction: row.measurableNextStep,
  });
}

function gateCandidate(input: {
  gate: BenchmarkGate;
  candidateId: string;
  label: string;
  priorProbe: Candidate["priorProbe"];
  stopReasons: V2PromotionCandidateStopReason[];
}): Candidate {
  return candidate({
    candidateId: input.candidateId,
    label: input.label,
    ownerSeam: input.gate.ownerSeam,
    sourceSurface: "v2_plan_quality_benchmark",
    priorProbe: input.priorProbe,
    stopReasons: input.stopReasons,
    score: scoreInput({
      materializerNonRegression: input.gate.status === "warning" ? 15 : 0,
      acceptanceWatchStatus: input.gate.status === "warning" ? 10 : 0,
      sourceAttributionQuality: input.gate.evidenceSource ? 12 : 4,
      priorProbeAdjustment: input.priorProbe === "bounded_watch" ? -15 : -30,
      implementationScope: 6,
    }),
    evidence: input.gate.evidence,
    missingProof: input.gate.missingEvidence,
    nextSafeAction:
      input.gate.status === "warning"
        ? "keep_as_watch_until_bounded_delta_is_measured"
        : "resolve_benchmark_gate_before_candidate_selection",
  });
}

function buildBenchmarkCandidates(
  benchmark: V2PlanQualityBenchmark | undefined,
): Candidate[] {
  if (!benchmark) {
    return [];
  }
  const candidates: Candidate[] = [];
  const duplicateGate = benchmark.gates.find(
    (gate) => gate.gate === "duplicate_concentration_risk",
  );
  if (duplicateGate?.status === "warning") {
    candidates.push(
      gateCandidate({
        gate: duplicateGate,
        candidateId: "duplicate_class_family_distinctness",
        label:
          "Duplicate/class-family distinctness watch needs bounded owner proof before behavior.",
        priorProbe: "bounded_watch",
        stopReasons: ["missing_bounded_delta"],
      }),
    );
  }
  const laneGate = benchmark.gates.find(
    (gate) => gate.gate === "lane_preservation",
  );
  if (laneGate?.status === "warning") {
    candidates.push(
      gateCandidate({
        gate: laneGate,
        candidateId: "lane_preservation_shadow_readout",
        label:
          "Lane-preservation warning is shadow diagnostic noise until measured against candidate truth.",
        priorProbe: "stale_noise",
        stopReasons: ["stale_noise", "diagnostic_artifact"],
      }),
    );
  }
  return candidates;
}

function buildStrategyRowCandidate(
  projection: MesocycleExplainPlannerOnlyNoRepair["v2StrategyRowMaterializerProjection"],
): Candidate[] {
  if (!projection) {
    return [];
  }
  const deltas = projection.materializerDeltas;
  const hasPositiveImpact =
    deltas.selectedIdentityDelta > 0 ||
    deltas.totalSetDelta > 0 ||
    deltas.targetLaneSetDelta > 0 ||
    projection.protectedCoverageImpact.status === "improved";
  const noImpact =
    deltas.selectedIdentityDelta === 0 &&
    deltas.totalSetDelta === 0 &&
    deltas.targetLaneSetDelta === 0 &&
    deltas.targetLaneExerciseDelta === 0 &&
    deltas.materializerBlockerDelta === 0 &&
    deltas.regressionCount === 0;
  const regressed =
    deltas.regressionCount > 0 ||
    projection.protectedCoverageImpact.status === "regressed" ||
    deltas.materializerBlockerDelta > 0;
  const stopReasons: V2PromotionCandidateStopReason[] = [
    ...noConsumptionStopReasons({
      consumedByProduction: projection.consumedByProduction,
      consumedByDemandOrMaterializer: projection.consumedByDemandOrMaterializer,
    }),
  ];
  if (regressed) {
    stopReasons.push("materializer_regression");
  } else if (noImpact) {
    stopReasons.push("measured_no_impact");
  }
  if (projection.readiness !== "candidate_for_bounded_review") {
    stopReasons.push("missing_acceptance_or_watch_clearance");
  }

  return [
    candidate({
      candidateId: "side_delts_protect_floor",
      label: "Side Delts protect-floor strategy row",
      ownerSeam: projection.row.ownerSeam,
      sourceSurface: "strategy_row_materializer_projection",
      priorProbe: hasPositiveImpact ? "measured_positive" : "measured_no_impact",
      stopReasons,
      score: scoreInput({
        measuredOwnerSpecificPositiveImpact: hasPositiveImpact ? 40 : 0,
        materializerNonRegression: regressed ? -100 : 20,
        protectedCoverage:
          projection.protectedCoverageImpact.status === "improved"
            ? 20
            : projection.protectedCoverageImpact.status === "preserved"
              ? 15
              : 0,
        acceptanceWatchStatus:
          projection.readiness === "candidate_for_bounded_review" ? 15 : 0,
        sourceAttributionQuality: 15,
        priorProbeAdjustment: noImpact ? -35 : 0,
        implementationScope: 8,
      }),
      evidence: uniqueSorted([
        `rowKey=${projection.row.rowKey}`,
        `readiness=${projection.readiness}`,
        `identityDelta=${deltas.selectedIdentityDelta}`,
        `totalSetDelta=${deltas.totalSetDelta}`,
        `targetLaneSetDelta=${deltas.targetLaneSetDelta}`,
        `blockerDelta=${deltas.materializerBlockerDelta}`,
        `protectedCoverage=${projection.protectedCoverageImpact.status}`,
        `setBudgetBasis=${projection.setBudgetBasisCheck.status}`,
        `consumedByProduction=${projection.consumedByProduction}`,
        `consumedByDemandOrMaterializer=${projection.consumedByDemandOrMaterializer}`,
        ...projection.sourcePerformedEvidence,
      ]),
      missingProof: projection.remainingProofBeforeBehavior,
      nextSafeAction: projection.nextSafeSlice,
    }),
  ];
}

function rankCandidates(candidates: Candidate[]): Candidate[] {
  const ready = candidates.filter((row) => row.status === "ready");
  const readyIds = new Map(
    ready
      .sort(
        (left, right) =>
          right.score.total - left.score.total ||
          left.candidateId.localeCompare(right.candidateId),
      )
      .map((row, index) => [row.candidateId, index + 1]),
  );
  return candidates
    .sort(
      (left, right) =>
        (readyIds.get(left.candidateId) ? 0 : 1) -
          (readyIds.get(right.candidateId) ? 0 : 1) ||
        right.score.total - left.score.total ||
        left.candidateId.localeCompare(right.candidateId),
    )
    .map((row) => ({
      ...row,
      rank: readyIds.get(row.candidateId) ?? null,
    }));
}

export function buildV2PromotionCandidateEvaluator(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): V2PromotionCandidateEvaluator {
  const gapCandidates =
    noRepair.repairPromotionScoreboard?.interpretation.gapInventory.map(
      candidateFromGapRow,
    ) ?? [];
  const candidates = rankCandidates([
    ...gapCandidates,
    ...buildBenchmarkCandidates(noRepair.v2PlanQualityBenchmark),
    ...buildStrategyRowCandidate(noRepair.v2StrategyRowMaterializerProjection),
  ]);
  const readyCandidates = candidates.filter((row) => row.status === "ready");
  const stoppedCandidates = candidates.filter((row) => row.status === "stopped");
  const watchCandidates = candidates.filter((row) => row.status === "watch");
  const blockedCandidates = candidates.filter((row) => row.status === "blocked");
  const topCandidate = readyCandidates[0] ?? null;
  const decision = topCandidate
    ? "recommend_next_safe_slice"
    : blockedCandidates.length > 0
      ? "collect_more_evidence"
      : "none_ready";
  const reason = topCandidate
    ? "candidate has measured owner-specific positive impact, non-regression, source attribution, and non-consumption proof"
    : candidates.length === 0
      ? "no promotion candidates were available in the current read-only diagnostics"
      : "no candidate has measured owner-specific positive impact with bounded delta, non-regression, acceptance/watch clearance, and seed/runtime/receipt/DB non-consumption";

  return {
    version: 1,
    source: "v2_promotion_candidate_evaluator",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status: topCandidate
      ? "candidate_ready"
      : blockedCandidates.length > 0
        ? "blocked_by_missing_evidence"
        : "none_ready",
    summary: {
      evaluatedCandidateCount: candidates.length,
      readyCandidateCount: readyCandidates.length,
      stoppedCandidateCount: stoppedCandidates.length,
      watchCandidateCount: watchCandidates.length,
      topCandidateId: topCandidate?.candidateId ?? null,
      topRecommendation: decision,
      nextSafeAction:
        topCandidate?.nextSafeAction ??
        (decision === "collect_more_evidence"
          ? "collect_missing_bounded_delta_or_acceptance_evidence"
          : "pivot_to_new_owner_specific_candidate_inventory"),
    },
    recommendation: {
      decision,
      candidateId: topCandidate?.candidateId ?? null,
      label: topCandidate?.label ?? "none ready",
      ownerSeam: topCandidate?.ownerSeam ?? null,
      reason,
      nextSafeAction:
        topCandidate?.nextSafeAction ??
        (decision === "collect_more_evidence"
          ? "collect_missing_bounded_delta_or_acceptance_evidence"
          : "pivot_to_new_owner_specific_candidate_inventory"),
      score: topCandidate?.score.total ?? null,
    },
    candidates,
    stopReasonCounts: countStopReasons(candidates),
    guardrails: {
      seedRuntimeChanged: false,
      receiptChanged: false,
      persistenceChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
    },
  };
}
