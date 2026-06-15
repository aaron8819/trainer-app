import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2PlanQualityBenchmark,
  V2PromotionCandidateEvaluator,
  V2PromotionCandidateStopReason,
} from "./types";
import type { SlotPlanPlanningRealityDiagnostic } from "@/lib/api/planning-reality";

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
type StrategyInventoryRow =
  MesocycleExplainPlannerOnlyNoRepair["strategyToDemandProjection"]["candidateInventory"]["rows"][number];
type CleanPreselectionRow =
  SlotPlanPlanningRealityDiagnostic["preselectionFeasibility"][number];
type BuildV2PromotionCandidateEvaluatorOptions = {
  planningReality?: SlotPlanPlanningRealityDiagnostic;
};

const EXHAUSTED_CANDIDATE_IDS = new Set([
  "side_delts_protect_floor",
  "set_distribution_budget",
  "support_direct_floor",
  "class_taxonomy_mismatch",
  "concentration_quality",
  "selection_capacity_pressure",
]);

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function slug(value: string | undefined): string {
  return (value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
    input.stopReasons.includes("too_broad_or_low_roi") ||
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
      candidateId: `fresh_strategy_${slug(projection.row.ownerSeam)}_${slug(
        projection.row.muscle,
      )}_${slug(projection.row.action)}`,
      label: `${projection.row.muscle} ${projection.row.action} strategy row`,
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

function strategyInventoryCandidateId(row: StrategyInventoryRow): string {
  return `fresh_strategy_${slug(row.proposedOwnerSeam)}_${slug(
    row.affected.muscle,
  )}_${slug(row.suggestedFutureActionType)}`;
}

function strategyInventoryPriority(row: StrategyInventoryRow): number {
  const actionPriority =
    row.suggestedFutureActionType === "protect_floor"
      ? 40
      : row.suggestedFutureActionType === "redistribute_or_cap"
        ? 35
        : row.suggestedFutureActionType === "monitor_productive"
          ? 20
          : 5;
  const ownerPriority =
    row.proposedOwnerSeam === "SlotDemandAllocationByWeek"
      ? 20
      : row.proposedOwnerSeam === "SetDistributionIntent"
        ? 18
        : row.proposedOwnerSeam === "WeeklyDemandCurve"
          ? 14
          : row.proposedOwnerSeam === "MesocycleDemand"
            ? 12
            : 0;
  const readinessPriority =
    row.readiness === "candidate_for_read_only_projection" ? 20 : 0;
  return actionPriority + ownerPriority + readinessPriority;
}

function buildStrategyInventoryCandidates(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
  excludedCandidateIds: ReadonlySet<string> = new Set(),
): Candidate[] {
  return (noRepair.strategyToDemandProjection?.candidateInventory?.rows ?? [])
    .filter((row) => row.evidenceSource === "performed_reality")
    .filter((row) => row.readiness !== "diagnostic_only")
    .filter((row) => {
      const muscle = row.affected.muscle;
      return !(
        row.proposedOwnerSeam === "SlotDemandAllocationByWeek" &&
        row.suggestedFutureActionType === "protect_floor" &&
        muscle === "Side Delts"
      );
    })
    .sort(
      (left, right) =>
        strategyInventoryPriority(right) - strategyInventoryPriority(left) ||
        strategyInventoryCandidateId(left).localeCompare(
          strategyInventoryCandidateId(right),
        ),
    )
    .slice(0, 5)
    .filter((row) => !excludedCandidateIds.has(strategyInventoryCandidateId(row)))
    .map((row) => {
      const candidateId = strategyInventoryCandidateId(row);
      const actionableMissingProof =
        row.readiness === "candidate_for_read_only_projection";
      const stopReasons: V2PromotionCandidateStopReason[] = [
        ...(actionableMissingProof
          ? ([
              "missing_bounded_delta",
              "missing_acceptance_or_watch_clearance",
            ] as const)
          : (["too_broad_or_low_roi"] as const)),
        ...noConsumptionStopReasons({
          consumedByProduction: false,
          consumedByDemandOrMaterializer:
            row.nonConsumption.demandOrMaterializer,
        }),
      ];
      return candidate({
        candidateId,
        label: `${row.affected.muscle ?? "Block"} ${row.suggestedFutureActionType} inventory row`,
        ownerSeam: row.proposedOwnerSeam,
        sourceSurface: "fresh_owner_specific_inventory",
        priorProbe:
          actionableMissingProof ? "blocked" : "unmeasured",
        stopReasons,
        score: scoreInput({
          sourceAttributionQuality: 14,
          implementationScope:
            row.suggestedFutureActionType === "protect_floor" ? 10 : 8,
          priorProbeAdjustment: actionableMissingProof ? -10 : -30,
        }),
        evidence: uniqueSorted([
          `source=${row.evidenceSource}`,
          `readiness=${row.readiness}`,
          `futureAction=${row.suggestedFutureActionType}`,
          `ownerSeam=${row.proposedOwnerSeam}`,
          ...(row.affected.muscle ? [`muscle=${row.affected.muscle}`] : []),
          ...(row.affected.slotIds.length > 0
            ? [`slotIds=${row.affected.slotIds.join("|")}`]
            : []),
          ...row.sourceAttribution.slice(0, 8),
          `demandOrMaterializerConsumed=${row.nonConsumption.demandOrMaterializer}`,
          `seedRuntimeReceiptDbConsumed=${row.nonConsumption.seedRuntimeReceiptDb}`,
        ]),
        missingProof: uniqueSorted([
          ...row.requiredProofBeforeBehavior,
          ...(actionableMissingProof
            ? [
                "owner_specific_bounded_delta_projection",
                "acceptance_watch_clearance",
              ]
            : []),
        ]),
        nextSafeAction: actionableMissingProof
          ? "one_bounded_owner_specific_projection_or_pivot"
          : "no_next_projection_recommended_roi_cutoff",
      });
    });
}

function buildCleanPreselectionCandidate(row: CleanPreselectionRow): Candidate {
  const cleanCandidateCount = row.candidateInventory.filter((candidateRow) =>
    [
      "clean_available",
      "available_but_capacity_blocked",
      "available_but_duplicate_blocked",
      "available_but_already_used_elsewhere",
    ].includes(candidateRow.availability),
  ).length;
  return candidate({
    candidateId: `fresh_preselection_${slug(row.slotId)}_${slug(row.muscle)}`,
    label: `${row.slotId} ${row.muscle} clean preselection feasibility`,
    ownerSeam: "ExerciseClassDistributionBySlot -> ExerciseSelectionPlan",
    sourceSurface: "fresh_owner_specific_inventory",
    priorProbe: "unmeasured",
    stopReasons: [
      "missing_bounded_delta",
      "missing_acceptance_or_watch_clearance",
    ],
    score: scoreInput({
      sourceAttributionQuality: 16,
      implementationScope: row.role === "primary" ? 12 : 8,
      priorProbeAdjustment: -5,
    }),
    evidence: uniqueSorted([
      "source=clean_preselection_feasibility",
      `slotId=${row.slotId}`,
      `muscle=${row.muscle}`,
      `role=${row.role}`,
      `targetStatus=${row.targetStatus}`,
      `recommendation=${row.recommendation}`,
      `candidateStatus=${row.candidateStatus}`,
      `targetEffectiveSets=${row.targetEffectiveSets ?? "unknown"}`,
      `initialEffectiveSets=${row.currentInitialEffectiveSets ?? "unknown"}`,
      `finalEffectiveSets=${row.currentFinalEffectiveSets ?? "unknown"}`,
      `shortfallBeforeRepair=${row.shortfallBeforeRepair ?? "unknown"}`,
      `cleanCandidateCount=${cleanCandidateCount}`,
      `dirtyClosureSignalCount=${row.dirtyClosureSignals.length}`,
      `glutesCollateralDelta=${row.collateralEstimate.glutesDelta ?? "unknown"}`,
      `lowerBackCollateralDelta=${row.collateralEstimate.lowerBackDelta ?? "unknown"}`,
      ...row.preferredCleanPath.map(
        (path) => `cleanPath=${path.exerciseClass}:${path.available}`,
      ),
      ...row.reasons.slice(0, 6),
    ]),
    missingProof: [
      "owner_specific_preselection_materializer_projection",
      "cross_week_non_regression",
      "acceptance_watch_clearance",
      "seed_runtime_receipt_db_non_consumption_must_remain_proven",
      "production_materializer_non_consumption_must_remain_proven",
    ],
    nextSafeAction: "run_one_read_only_preselection_materializer_projection",
  });
}

function buildMeasuredPreselectionCandidate(
  projection: MesocycleExplainPlannerOnlyNoRepair["v2PreselectionMaterializerProjection"],
): Candidate[] {
  if (!projection) {
    return [];
  }
  const deltas = projection.deltas;
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
    projection.duplicateConcentrationImpact.status === "regressed" ||
    deltas.materializerBlockerDelta > 0 ||
    projection.status === "blocked";
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
      candidateId: projection.candidateId,
      label: "lower_b Hamstrings clean preselection feasibility",
      ownerSeam: projection.ownerSeam,
      sourceSurface: "preselection_materializer_projection",
      priorProbe: hasPositiveImpact ? "measured_positive" : "measured_no_impact",
      stopReasons,
      score: scoreInput({
        measuredOwnerSpecificPositiveImpact: hasPositiveImpact ? 35 : 0,
        materializerNonRegression: regressed ? -100 : 20,
        protectedCoverage:
          projection.protectedCoverageImpact.status === "improved"
            ? 20
            : projection.protectedCoverageImpact.status === "preserved"
              ? 15
              : 0,
        acceptanceWatchStatus:
          projection.readiness === "candidate_for_bounded_review" ? 15 : 0,
        sourceAttributionQuality: 16,
        priorProbeAdjustment: noImpact ? -35 : 0,
        implementationScope: 8,
      }),
      evidence: uniqueSorted([
        `source=${projection.sourceSurface}`,
        `trialId=${projection.trialId}`,
        `status=${projection.status}`,
        `readiness=${projection.readiness}`,
        `baselineHamstrings=${projection.materializedHamstrings.baselineIdentities
          .map((row) => `${row.exerciseName}:${row.setCount}`)
          .join("|")}`,
        `trialHamstrings=${projection.materializedHamstrings.trialIdentities
          .map((row) => `${row.exerciseName}:${row.setCount}`)
          .join("|")}`,
        `identityDelta=${deltas.selectedIdentityDelta}`,
        `totalSetDelta=${deltas.totalSetDelta}`,
        `targetLaneSetDelta=${deltas.targetLaneSetDelta}`,
        `blockerDelta=${deltas.materializerBlockerDelta}`,
        `protectedCoverage=${projection.protectedCoverageImpact.status}`,
        `duplicateConcentration=${projection.duplicateConcentrationImpact.status}`,
        `consumedByProduction=${projection.consumedByProduction}`,
        `consumedByDemandOrMaterializer=${projection.consumedByDemandOrMaterializer}`,
      ]),
      missingProof: projection.remainingProofBeforeBehavior,
      nextSafeAction: projection.nextSafeSlice,
    }),
  ];
}

function buildCleanPreselectionCandidates(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
  planningReality: SlotPlanPlanningRealityDiagnostic | undefined,
): Candidate[] {
  const measuredCandidates = buildMeasuredPreselectionCandidate(
    noRepair.v2PreselectionMaterializerProjection,
  );
  const measuredCandidateIds = new Set(
    measuredCandidates.map((row) => row.candidateId),
  );
  return (
    planningReality?.preselectionFeasibility
      .filter((row) => row.recommendation === "safe_to_trial_preselection")
      .filter((row) => row.candidateStatus === "clean_candidate")
      .filter(
        (row) =>
          !measuredCandidateIds.has(
            `fresh_preselection_${slug(row.slotId)}_${slug(row.muscle)}`,
          ),
      )
      .map(buildCleanPreselectionCandidate) ?? []
  ).concat(measuredCandidates);
}

function buildFreshOwnerSpecificCandidates(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
  options: BuildV2PromotionCandidateEvaluatorOptions,
  excludedCandidateIds: ReadonlySet<string> = new Set(),
): Candidate[] {
  const candidates = [
    ...buildCleanPreselectionCandidates(noRepair, options.planningReality),
    ...buildStrategyInventoryCandidates(noRepair, excludedCandidateIds),
  ];
  return candidates.filter(
    (row) => !EXHAUSTED_CANDIDATE_IDS.has(row.candidateId),
  );
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
  options: BuildV2PromotionCandidateEvaluatorOptions = {},
): V2PromotionCandidateEvaluator {
  const gapCandidates =
    noRepair.repairPromotionScoreboard?.interpretation.gapInventory.map(
      candidateFromGapRow,
    ) ?? [];
  const measuredStrategyCandidates = buildStrategyRowCandidate(
    noRepair.v2StrategyRowMaterializerProjection,
  );
  const measuredStrategyCandidateIds = new Set(
    measuredStrategyCandidates.map((row) => row.candidateId),
  );
  const candidates = rankCandidates([
    ...gapCandidates,
    ...buildBenchmarkCandidates(noRepair.v2PlanQualityBenchmark),
    ...measuredStrategyCandidates,
    ...buildFreshOwnerSpecificCandidates(
      noRepair,
      options,
      measuredStrategyCandidateIds,
    ),
  ]);
  const readyCandidates = candidates.filter((row) => row.status === "ready");
  const stoppedCandidates = candidates.filter((row) => row.status === "stopped");
  const watchCandidates = candidates.filter((row) => row.status === "watch");
  const blockedCandidates = candidates.filter((row) => row.status === "blocked");
  const topCandidate = readyCandidates[0] ?? null;
  const noActionCandidates = stoppedCandidates;
  const hasActionableMissingProof = blockedCandidates.length > 0;
  const hasWatchOnlyBenchmarkItems = watchCandidates.length > 0;
  const decision = topCandidate
    ? "recommend_next_safe_slice"
    : hasActionableMissingProof
      ? "collect_actionable_missing_proof"
      : hasWatchOnlyBenchmarkItems && noActionCandidates.length === 0
        ? "keep_watch_only_benchmark_items"
        : "no_next_projection_recommended";
  const status = topCandidate
    ? "candidate_ready"
    : hasActionableMissingProof
      ? "blocked_actionable_missing_proof"
      : hasWatchOnlyBenchmarkItems && noActionCandidates.length === 0
        ? "watch_only_benchmark_item"
        : "no_action_roi_cutoff";
  const nextSafeAction =
    topCandidate?.nextSafeAction ??
    (decision === "collect_actionable_missing_proof"
      ? "collect_actionable_missing_proof"
      : decision === "keep_watch_only_benchmark_items"
        ? "keep_watch_only_no_projection_recommended"
        : "no_next_projection_recommended");
  const nextProjectionRecommendation = topCandidate
    ? "run_next_safe_slice"
    : decision === "collect_actionable_missing_proof"
      ? "collect_actionable_missing_proof"
      : decision === "keep_watch_only_benchmark_items"
        ? "watch_only_no_projection_recommended"
        : "no_next_projection_recommended";
  const reason = topCandidate
    ? "candidate has measured owner-specific positive impact, non-regression, source attribution, and non-consumption proof"
    : candidates.length === 0
      ? "no promotion candidates were available in the current read-only diagnostics; no next projection is recommended"
      : decision === "collect_actionable_missing_proof"
        ? "at least one bounded owner-specific row has plausible positive impact but still lacks projection, acceptance/watch, or non-consumption proof"
        : decision === "keep_watch_only_benchmark_items"
          ? "remaining benchmark items are watch-only and do not justify a new projection"
          : "remaining rows are measured no-impact, stale/readout, safety-net repair, diagnostic-only, or too broad/low ROI; no next projection is recommended";

  return {
    version: 1,
    source: "v2_promotion_candidate_evaluator",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status,
    summary: {
      evaluatedCandidateCount: candidates.length,
      readyCandidateCount: readyCandidates.length,
      stoppedCandidateCount: stoppedCandidates.length,
      watchCandidateCount: watchCandidates.length,
      actionableMissingProofCandidateCount: blockedCandidates.length,
      noActionCandidateCount: noActionCandidates.length,
      watchOnlyBenchmarkCandidateCount: watchCandidates.length,
      topCandidateId: topCandidate?.candidateId ?? null,
      topRecommendation: decision,
      nextSafeAction,
      nextProjectionRecommendation,
    },
    recommendation: {
      decision,
      candidateId: topCandidate?.candidateId ?? null,
      label: topCandidate?.label ?? "none ready",
      ownerSeam: topCandidate?.ownerSeam ?? null,
      reason,
      nextSafeAction,
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
