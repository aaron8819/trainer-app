import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2PlanQualityBenchmark,
} from "./types";
import { buildV2LaneSelectionIntentBenchmark } from "@/lib/engine/planning/v2/lane-selection-intent-benchmark";

type BenchmarkGate = V2PlanQualityBenchmark["gates"][number];
type BenchmarkStatus = BenchmarkGate["status"];
type SlotWeekAllocationAcceptanceProjection =
  V2PlanQualityBenchmark["slotWeekAllocationAcceptanceProjection"];
type AcceptanceItemClassification =
  SlotWeekAllocationAcceptanceProjection["acceptance"]["itemClassifications"][number];
type AcceptanceClassificationCounts =
  SlotWeekAllocationAcceptanceProjection["acceptance"]["classificationCounts"];
type BasePlanCompare = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
>;
type ShadowConsumptionTrial = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"]
>;

const V2_BASE_SESSION_SIZE_WATCH_SET_CAP = 21;

function countByStatus(
  gates: BenchmarkGate[],
  status: BenchmarkStatus,
): number {
  return gates.filter((gate) => gate.status === status).length;
}

function benchmarkStatus(gates: BenchmarkGate[]): V2PlanQualityBenchmark["status"] {
  if (countByStatus(gates, "fail") > 0) {
    return "fail";
  }
  if (countByStatus(gates, "missing_evidence") > 0) {
    return "blocked_by_missing_evidence";
  }
  if (countByStatus(gates, "warning") > 0) {
    return "warning";
  }
  return "pass";
}

function gate(input: {
  gate: BenchmarkGate["gate"];
  status: BenchmarkStatus;
  ownerSeam: string;
  evidenceSource: BenchmarkGate["evidenceSource"];
  evidence: string[];
  missingEvidence?: string[];
  mustFixBeforeWeek1?: boolean;
}): BenchmarkGate {
  return {
    gate: input.gate,
    status: input.status,
    ownerSeam: input.ownerSeam,
    evidenceSource: input.evidenceSource,
    evidence: input.evidence,
    missingEvidence: input.missingEvidence ?? [],
    candidateImpact:
      input.status === "pass"
        ? "supports_deprecation_review"
        : input.status === "fail"
          ? "blocks_deprecation"
          : "needs_more_evidence",
    mustFixBeforeWeek1:
      input.mustFixBeforeWeek1 === true || input.status === "fail",
  };
}

function numberEvidence(label: string, value: number | null | undefined): string {
  return `${label}=${typeof value === "number" ? value : "unknown"}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function emptyClassificationCounts(): AcceptanceClassificationCounts {
  return {
    acceptedWatch: 0,
    boundedOwnerWatch: 0,
    blocker: 0,
    staleOrDiagnosticNoise: 0,
    ownerSpecificNextFix: 0,
  };
}

function countClassifications(
  rows: AcceptanceItemClassification[],
): AcceptanceClassificationCounts {
  return rows.reduce((counts, row) => {
    if (row.classification === "accepted_watch") {
      counts.acceptedWatch += 1;
    } else if (row.classification === "blocker") {
      counts.blocker += 1;
    } else if (row.classification === "bounded_owner_watch") {
      counts.boundedOwnerWatch += 1;
    } else if (row.classification === "stale_or_diagnostic_noise") {
      counts.staleOrDiagnosticNoise += 1;
    } else {
      counts.ownerSpecificNextFix += 1;
    }
    return counts;
  }, emptyClassificationCounts());
}

function affectedFromEvidence(input: {
  evidence: string[];
  fallbackWeeks?: number[];
  fallbackMuscles?: string[];
}): AcceptanceItemClassification["affected"] {
  const joined = input.evidence.join(" ");
  const weeks = uniqueSorted(
    [
      ...(input.fallbackWeeks ?? []).map((week) => String(week)),
      ...Array.from(joined.matchAll(/week[_:-](\d+)/gi)).map((match) => match[1]),
    ],
  ).map((week) => Number(week));
  const slots = uniqueSorted(
    Array.from(
      joined.matchAll(/\b(upper_a|upper_b|lower_a|lower_b|full_body|push|pull|legs)\b/gi),
    ).map((match) => match[1].toLowerCase()),
  );
  const lanes = uniqueSorted(
    Array.from(
      joined.matchAll(
        /\b(chest_anchor|row_anchor|vertical_pull|horizontal_pull|squat_anchor|hinge_anchor|quad_support|hamstrings|calves|side_delt_isolation|rear_delt_direct|biceps|triceps)\b/gi,
      ),
    ).map((match) => match[1].toLowerCase()),
  );
  const muscles = uniqueSorted([
    ...(input.fallbackMuscles ?? []),
    ...Array.from(
      joined.matchAll(
        /\b(Chest|Lats|Quads|Hamstrings|Calves|Side Delts|Rear Delts|Biceps|Triceps|Glutes|Upper Back|Front Delts)\b/g,
      ),
    ).map((match) => match[1]),
  ]);
  return { weeks, slots, lanes, muscles };
}

function warningClassificationForGate(
  gateRow: BenchmarkGate,
): Pick<
  AcceptanceItemClassification,
  "classification" | "materiality" | "smallestSafeNextAction"
> {
  if (
    gateRow.gate === "lane_preservation" &&
    gateRow.evidenceSource === "shadow_diagnostic"
  ) {
    return {
      classification: "stale_or_diagnostic_noise",
      materiality:
        "diagnostic-only shadow ambiguity with no measured regression or production consumption",
      smallestSafeNextAction:
        "keep in debug evidence and review shadow differences before any behavior-promotion review",
    };
  }
  if (gateRow.gate === "duplicate_concentration_risk") {
    const noExactDuplicateReuse = gateRow.evidence.some(
      (row) => row === "v2DuplicateExactExercises=0",
    );
    const baseNonRegression = gateRow.evidence.some(
      (row) => row === "baseRegressions=0",
    );
    const noRegressionClassification = !gateRow.evidence.some(
      (row) => row === "exerciseIdentityClassification=v2_regresses",
    );
    if (
      noExactDuplicateReuse &&
      baseNonRegression &&
      noRegressionClassification
    ) {
      return {
        classification: "bounded_owner_watch",
        materiality:
          "bounded distinctness watch; pure V2 has no exact duplicate reuse and no base-plan regression, while class-family reuse remains review evidence",
        smallestSafeNextAction:
          "carry class-family reuse as a bounded promotion-review watch; require no exact duplicate reuse, no base regression, and debug-shard row review before any behavior slice",
      };
    }
    return {
      classification: "owner_specific_next_fix",
      materiality:
        "bounded distinctness watch; behavior promotion waits on duplicate/class-family owner proof",
      smallestSafeNextAction:
        "resolve exact duplicate or class-family distinctness in V2 base-plan validation before promotion review",
    };
  }
  if (gateRow.gate === "fatigue_distribution") {
    const promotedBaselineIdempotent = gateRow.evidence.some(
      (row) => row === "promotedBoundedCalvesBaselineIdempotent=true",
    );
    const slotWeekCandidate = gateRow.evidence.some(
      (row) => row === "slotWeekAllocationReadiness=candidate_for_acceptance_projection",
    );
    const slotWeekUnblocked = gateRow.evidence.some(
      (row) => row === "slotWeekAllocationBlockedRows=0",
    );
    const materializerNonRegression = gateRow.evidence.some(
      (row) => row === "donorOffsetMaterializerRegressions=0",
    );
    const concentrationNonRegression = gateRow.evidence.some(
      (row) => row === "donorOffsetConcentrationRegressions=0",
    );
    const warningDelta = gateRow.evidence.find((row) =>
      row.startsWith("donorOffsetWarningDelta="),
    );
    const warningImproved =
      warningDelta != null && Number(warningDelta.split("=")[1]) < 0;
    if (
      slotWeekCandidate &&
      slotWeekUnblocked &&
      materializerNonRegression &&
      concentrationNonRegression &&
      (warningImproved || promotedBaselineIdempotent)
    ) {
      return {
        classification: "bounded_owner_watch",
        materiality:
          promotedBaselineIdempotent
            ? "bounded fatigue/concentration watch; promoted Calves slot allocation is idempotent baseline with no weekly-volume, protected-coverage, materializer, or concentration regression"
            : "bounded fatigue/concentration watch; slot-owned donor absorption improves concentration without weekly-volume, protected-coverage, or materializer regression",
        smallestSafeNextAction:
          "carry as a bounded promotion-review watch; require Weeks 2-4 donor absorption, net-zero weekly sets, preserved protected coverage, and materializer non-regression",
      };
    }
    return {
      classification: "owner_specific_next_fix",
      materiality:
        "bounded fatigue/concentration watch; non-regression passes but distribution quality still needs owner review",
      smallestSafeNextAction:
      "resolve concentration/fatigue projection warnings in the V2 materializer or slot-allocation diagnostic before promotion review",
    };
  }
  if (gateRow.gate === "lane_intent_explicitness") {
    return {
      classification: "bounded_owner_watch",
      materiality:
        "read-only lane-intent benchmark watch; high-risk lane jobs are explicit enough to audit, while remaining warning rows are contract-design evidence only",
      smallestSafeNextAction:
        "use the lane-intent benchmark as ontology cleanup or lane-intent contract design input before any materializer ranking trial",
    };
  }
  if (gateRow.gate === "week_1_trainability") {
    return {
      classification: "accepted_watch",
      materiality:
        "Week 1 is trainable with warnings and no hard blockers",
      smallestSafeNextAction:
        "carry as a Week 1/post-accept verification watch; do not promote behavior while warnings remain unbounded",
    };
  }
  return {
    classification: "accepted_watch",
    materiality: "non-blocking warning gate with no must-fix Week 1 signal",
    smallestSafeNextAction:
      "keep as a bounded watch and resolve before behavior-promotion review",
  };
}

function acceptanceProjectionBlockerClassification(
  blocker: string,
): AcceptanceItemClassification {
  const isWeek1 = blocker.startsWith("week_1_trainability:");
  const isNonConsumption = blocker === "read_only_non_consumption_boundary_not_proven";
  const isMaterializer = blocker === "materializer_identity_set_or_blocker_regression";
  const isProtectedCoverage =
    blocker === "protected_volume_or_coverage_regressed" ||
    blocker === "protected_volume_or_coverage_not_projected";
  return {
    item: blocker,
    gate: "acceptance_projection",
    status: "blocker",
    classification: "blocker",
    evidenceSource: "acceptance_projection",
    affected: affectedFromEvidence({
      evidence: [blocker],
      fallbackWeeks: isWeek1 ? [1] : undefined,
    }),
    evidence: [blocker],
    ownerSeam: isWeek1
      ? "plannerOnlyNoRepair.acceptanceClassification"
      : isNonConsumption
        ? "seed_runtime_receipt_persistence_boundary"
        : isMaterializer
          ? "v2_materialization_dry_run"
          : isProtectedCoverage
            ? "SlotDemandAllocationByWeek"
            : "slot_week_acceptance_projection",
    materiality: isWeek1
      ? "real Week 1 trainability blocker"
      : "blocks behavior-promotion readiness for this projection",
    mustFixBeforeWeek1: isWeek1,
    smallestSafeNextAction: isWeek1
      ? "fix acceptance/trainability before Week 1"
      : "resolve the named acceptance/non-regression blocker before any behavior-promotion review",
  };
}

function buildAcceptanceItemClassifications(input: {
  gates: BenchmarkGate[];
  acceptance: MesocycleExplainPlannerOnlyNoRepair["acceptanceClassification"];
  blockerCandidates: string[];
  watchItems: string[];
  representativeAccumulationWeeks: number[];
}): AcceptanceItemClassification[] {
  const rows: AcceptanceItemClassification[] = [];
  const seen = new Set<string>();
  const push = (row: AcceptanceItemClassification) => {
    if (seen.has(row.item)) {
      return;
    }
    seen.add(row.item);
    rows.push(row);
  };

  for (const gateRow of input.gates) {
    if (gateRow.status === "warning") {
      const classification = warningClassificationForGate(gateRow);
      push({
        item: `${gateRow.gate}:${gateRow.ownerSeam}`,
        gate: gateRow.gate,
        status: "watch",
        evidenceSource: gateRow.evidenceSource,
        affected: affectedFromEvidence({
          evidence: gateRow.evidence,
          fallbackWeeks:
            gateRow.gate === "fatigue_distribution"
              ? input.representativeAccumulationWeeks
              : undefined,
        }),
        evidence: gateRow.evidence.slice(0, 8),
        ownerSeam: gateRow.ownerSeam,
        mustFixBeforeWeek1: gateRow.mustFixBeforeWeek1,
        ...classification,
      });
    } else if (gateRow.status === "fail" || gateRow.status === "missing_evidence") {
      push({
        item: `${gateRow.gate}:${gateRow.status}:${gateRow.ownerSeam}`,
        gate: gateRow.gate,
        status: "blocker",
        classification: "blocker",
        evidenceSource: gateRow.evidenceSource,
        affected: affectedFromEvidence({ evidence: gateRow.evidence }),
        evidence: [
          ...gateRow.evidence.slice(0, 6),
          ...gateRow.missingEvidence.slice(0, 4).map((row) => `missing:${row}`),
        ],
        ownerSeam: gateRow.ownerSeam,
        materiality:
          gateRow.status === "fail"
            ? "real benchmark blocker"
            : "missing required benchmark evidence",
        mustFixBeforeWeek1: gateRow.mustFixBeforeWeek1,
        smallestSafeNextAction:
          gateRow.status === "fail"
            ? "fix the failed owner gate before Week 1 or behavior review as indicated"
            : "collect the missing source-attributed evidence before promotion review",
      });
    }
  }

  for (const warning of input.acceptance.qualityWarnings) {
    push({
      item: `week_1_quality:${warning.code}`,
      gate: "week_1_trainability",
      status: "watch",
      classification: "accepted_watch",
      evidenceSource: "acceptance_classification_no_repair",
      affected: affectedFromEvidence({
        evidence: warning.evidence,
        fallbackWeeks: [1],
      }),
      evidence: warning.evidence.slice(0, 8),
      ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
      materiality: "Week 1 quality watch; no hard trainability blocker",
      mustFixBeforeWeek1: false,
      smallestSafeNextAction:
        "carry into post-accept verification or resolve the underlying readout before behavior promotion",
    });
  }

  if (input.acceptance.basicMesocycleShapeStatus === "pass_with_warnings") {
    push({
      item: "week_1_trainability:pass_with_warnings",
      gate: "week_1_trainability",
      status: "watch",
      classification: "accepted_watch",
      evidenceSource: "acceptance_classification_no_repair",
      affected: affectedFromEvidence({
        evidence: ["week_1_trainability:pass_with_warnings"],
        fallbackWeeks: [1],
      }),
      evidence: ["basicMesocycleShapeStatus=pass_with_warnings"],
      ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
      materiality: "Week 1 trainability passes with warnings",
      mustFixBeforeWeek1: false,
      smallestSafeNextAction:
        "bound the Week 1 warning criteria before behavior-promotion review",
    });
  }

  for (const blocker of input.blockerCandidates) {
    if (!seen.has(blocker)) {
      push(acceptanceProjectionBlockerClassification(blocker));
    }
  }

  return rows.filter(
    (row) => row.status === "blocker" || input.watchItems.includes(row.item),
  );
}

function pureV2BaseEvidence(noRepair: MesocycleExplainPlannerOnlyNoRepair): {
  baseCompare?: BasePlanCompare;
  shadowTrial?: ShadowConsumptionTrial;
  baseAvailable: boolean;
  shadowAvailable: boolean;
  baseValidationStatus: string;
  baseRegressionCount: number;
  shadowRegressionCount: number;
  shadowUnclearCount: number;
} {
  const baseCompare = noRepair.v2BasePlanCompare;
  const shadowTrial = noRepair.v2BasePlanShadowConsumptionTrial;
  return {
    ...(baseCompare ? { baseCompare } : {}),
    ...(shadowTrial ? { shadowTrial } : {}),
    baseAvailable:
      baseCompare?.readOnly === true &&
      baseCompare.affectsScoringOrGeneration === false &&
      (baseCompare.status === "available" ||
        baseCompare.status === "available_with_limitations"),
    shadowAvailable:
      shadowTrial?.readOnly === true &&
      shadowTrial.affectsScoringOrGeneration === false &&
      shadowTrial.consumedByProduction === false &&
      (shadowTrial.status === "available" ||
        shadowTrial.status === "available_with_limitations"),
    baseValidationStatus:
      baseCompare?.summary.v2BaseValidationStatus ?? "not_available",
    baseRegressionCount: baseCompare?.summary.v2RegressionCount ?? 0,
    shadowRegressionCount: shadowTrial?.summary.regressionCount ?? 0,
    shadowUnclearCount: shadowTrial?.summary.unclearCount ?? 0,
  };
}

function pureV2BaseIsValid(
  evidence: ReturnType<typeof pureV2BaseEvidence>,
): boolean {
  return (
    evidence.baseAvailable &&
    (evidence.baseValidationStatus === "pass" ||
      evidence.baseValidationStatus === "pass_with_warnings") &&
    evidence.baseRegressionCount === 0
  );
}

function buildSupportFloorsGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const supportResponsibility =
    pureV2.baseCompare?.comparisons?.repairDependency.responsibilities.find(
      (row) => row.item === "support-floor closure as planner author",
    );
  if (
    pureV2BaseIsValid(pureV2) &&
    supportResponsibility &&
    (supportResponsibility.classification === "v2_improves" ||
      supportResponsibility.classification === "v2_preserves")
  ) {
    return gate({
      gate: "support_floors",
      status: "pass",
      ownerSeam: "v2_base_plan_validation.support_direct_floors",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `supportFloorClassification=${supportResponsibility.classification}`,
        ...supportResponsibility.evidence.slice(0, 4),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
    });
  }

  const diagnostic = noRepair.v2SupportLaneProjectionDiagnostic;
  if (!diagnostic) {
    return gate({
      gate: "support_floors",
      status: "missing_evidence",
      ownerSeam: "v2SupportLaneProjectionDiagnostic",
      evidenceSource: "missing_evidence",
      evidence: ["support_lane_projection_diagnostic_missing"],
      missingEvidence: ["support_lane_direct_floor_status"],
    });
  }
  const highRiskRows = diagnostic.laneBoundaryRows.filter(
    (row) => row.mustFixBeforeWeek1 || row.severity === "high_risk",
  );
  const warningRows = diagnostic.laneBoundaryRows.filter(
    (row) => row.severity === "warning",
  );
  return gate({
    gate: "support_floors",
    status:
      highRiskRows.length > 0
        ? "fail"
        : diagnostic.summary.directFloorsBelow > 0 || warningRows.length > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2SupportLaneProjectionDiagnostic",
    evidenceSource: "no_repair_projection",
    evidence: [
      numberEvidence("directFloorsMet", diagnostic.summary.directFloorsMet),
      numberEvidence("directFloorsBelow", diagnostic.summary.directFloorsBelow),
      numberEvidence("authoredDropped", diagnostic.summary.authoredDroppedCount),
      numberEvidence("highRiskDropped", diagnostic.summary.highRiskDroppedCount),
    ],
    missingEvidence: diagnostic.missingInputs,
    mustFixBeforeWeek1: highRiskRows.length > 0,
  });
}

function buildDirectWorkGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const underHitMuscles =
    pureV2.baseCompare?.comparisons?.muscleCoverage.underHitMuscles ?? [];
  if (pureV2BaseIsValid(pureV2) && underHitMuscles.length === 0) {
    return gate({
      gate: "direct_work",
      status: "pass",
      ownerSeam: "v2_base_plan_validation.muscle_coverage",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        numberEvidence(
          "v2TotalSets",
          pureV2.baseCompare?.summary.v2TotalSets,
        ),
        numberEvidence("underHitMuscles", underHitMuscles.length),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
    });
  }

  const belowFloor = noRepair.weeklyMuscleTotals.filter(
    (row) => row.targetMin != null && row.projectedEffectiveSets < row.targetMin,
  );
  if (noRepair.weeklyMuscleTotals.length === 0) {
    return gate({
      gate: "direct_work",
      status: "missing_evidence",
      ownerSeam: "weeklyMuscleTotals",
      evidenceSource: "missing_evidence",
      evidence: ["weekly_muscle_totals_missing"],
      missingEvidence: ["week_1_direct_work_totals"],
    });
  }
  return gate({
    gate: "direct_work",
    status: belowFloor.length > 0 ? "fail" : "pass",
    ownerSeam: "weeklyMuscleTotals",
    evidenceSource: "no_repair_projection",
    evidence:
      belowFloor.length > 0
        ? belowFloor
            .slice(0, 6)
            .map(
              (row) =>
                `${row.muscle}:${row.projectedEffectiveSets}/${row.targetMin}`,
            )
        : [`musclesEvaluated=${noRepair.weeklyMuscleTotals.length}`],
    mustFixBeforeWeek1: belowFloor.length > 0,
  });
}

function buildLanePreservationGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  if (pureV2BaseIsValid(pureV2) && pureV2.shadowAvailable) {
    const status: BenchmarkStatus =
      pureV2.shadowRegressionCount > 0
        ? "fail"
        : pureV2.shadowUnclearCount > 0
          ? "warning"
          : "pass";
    return gate({
      gate: "lane_preservation",
      status,
      ownerSeam: "v2_base_plan_shadow_consumption_trial",
      evidenceSource: "shadow_diagnostic",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        numberEvidence("shadowRegressions", pureV2.shadowRegressionCount),
        numberEvidence("shadowUnclear", pureV2.shadowUnclearCount),
        `shadowStatus=${pureV2.shadowTrial?.status ?? "not_available"}`,
        "shadow_consumption_is_diagnostic_only",
      ],
      mustFixBeforeWeek1: pureV2.shadowRegressionCount > 0,
    });
  }

  const summary = noRepair.v2TargetVsNoRepairDiff.summary;
  return gate({
    gate: "lane_preservation",
    status:
      summary.blockedLaneCount > 0 || summary.missingLaneCount > 0
        ? "fail"
        : summary.partialLaneCount > 0 || summary.repairDependentLaneCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2TargetVsNoRepairDiff",
    evidenceSource: "no_repair_projection",
    evidence: [
      numberEvidence("target", summary.targetLaneCount),
      numberEvidence("satisfied", summary.satisfiedLaneCount),
      numberEvidence("partial", summary.partialLaneCount),
      numberEvidence("missing", summary.missingLaneCount),
      numberEvidence("blocked", summary.blockedLaneCount),
      numberEvidence("repairDependent", summary.repairDependentLaneCount),
    ],
  });
}

function buildLaneIntentExplicitnessGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const benchmark = buildV2LaneSelectionIntentBenchmark(
    noRepair.v2LaneSelectionIntentAudit,
  );
  const failingLanes = benchmark.lanes.filter((lane) => lane.status === "fail");
  const missingLanes = benchmark.lanes.filter(
    (lane) => lane.status === "missing_evidence",
  );
  const warningLanes = benchmark.lanes.filter(
    (lane) => lane.status === "warning",
  );

  return gate({
    gate: "lane_intent_explicitness",
    status: benchmark.status,
    ownerSeam: "V2LaneSelectionIntentAudit",
    evidenceSource: "pure_v2_lane_selection_intent_audit",
    evidence: [
      numberEvidence("laneJobs", benchmark.summary.laneJobCount),
      numberEvidence("pass", benchmark.summary.passCount),
      numberEvidence("warning", benchmark.summary.warningCount),
      numberEvidence("fail", benchmark.summary.failCount),
      numberEvidence("missing", benchmark.summary.missingEvidenceCount),
      numberEvidence(
        "materializerConsumed",
        benchmark.summary.materializerConsumedCount,
      ),
      numberEvidence("diagnosticOnly", benchmark.summary.diagnosticOnlyCount),
      ...benchmark.lanes.map(
        (lane) =>
          `${lane.laneJob}:${lane.status}:${lane.slotId}:${lane.laneId}:consumed=${lane.materializerConsumed}`,
      ),
      ...benchmark.lanes.flatMap((lane) => [
        ...lane.coverageGaps.laneIntentContract.map(
          (gap) => `${lane.laneJob}:laneIntentContractGap:${gap}`,
        ),
        ...lane.coverageGaps.ontologyInventory.map(
          (gap) => `${lane.laneJob}:ontologyInventoryGap:${gap}`,
        ),
      ]),
      "lane_intent_benchmark_is_read_only",
      "lane_intent_evidence_does_not_change_materializer_ranking",
    ],
    missingEvidence: [
      ...missingLanes.flatMap((lane) =>
        lane.missingEvidence.map(
          (missing) => `${lane.laneJob}:${missing}`,
        ),
      ),
      ...failingLanes.flatMap((lane) =>
        lane.missingEvidence.map(
          (missing) => `${lane.laneJob}:${missing}`,
        ),
      ),
      ...warningLanes.flatMap((lane) =>
        lane.required
          ? lane.missingEvidence.map(
              (missing) => `${lane.laneJob}:${missing}`,
            )
          : [],
      ),
    ],
    mustFixBeforeWeek1: failingLanes.some((lane) => lane.required),
  });
}

function buildSessionSizeGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const slotShape = pureV2.baseCompare?.comparisons?.slotShape;
  if (pureV2BaseIsValid(pureV2) && slotShape?.v2Base) {
    const slotShapeRegression =
      slotShape.classification === "v2_regresses" ||
      slotShape.rows.some((row) => row.classification === "v2_regresses");
    const sessionSizeUnclearRows = slotShape.rows.filter(
      (row) =>
        row.classification === "unclear" &&
        (row.item === "standalone_one_set_exercises" ||
          row.item === "five_set_stacking" ||
          (row.item === "max_slot_sets" &&
            slotShape.v2Base.maxSlotSets > V2_BASE_SESSION_SIZE_WATCH_SET_CAP)),
    );
    return gate({
      gate: "session_size",
      status: slotShapeRegression
        ? "fail"
        : sessionSizeUnclearRows.length > 0
          ? "warning"
          : "pass",
      ownerSeam: "v2_base_plan_validation.slot_shape",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `slotShapeClassification=${slotShape.classification}`,
        numberEvidence("sessionSizeWatchSetCap", V2_BASE_SESSION_SIZE_WATCH_SET_CAP),
        `sessionSizeUnclearRows=${
          sessionSizeUnclearRows.map((row) => row.item).join(",") || "none"
        }`,
        numberEvidence("v2MaxSlotSets", slotShape.v2Base.maxSlotSets),
        numberEvidence("v2ExerciseCount", slotShape.v2Base.exerciseCount),
        ...slotShape.v2Base.setsBySlot
          .slice(0, 4)
          .map(
            (slot) =>
              `${slot.slotId}:exercises_${slot.exerciseCount}:sets_${slot.setCount}`,
          ),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
      mustFixBeforeWeek1: slotShapeRegression,
    });
  }

  const materializerProjection = noRepair.v2CapacityMaterializerProjection;
  const materializerSessionGate = materializerProjection?.gates.find(
    (row) => row.gateId === "session_size",
  );
  if (
    materializerProjection?.readOnly === true &&
    materializerProjection.affectsScoringOrGeneration === false &&
    materializerProjection.dryRunOnly === true &&
    materializerProjection.consumedByProduction === false &&
    materializerProjection.consumedByDemandOrMaterializer === false &&
    materializerSessionGate?.measured === true
  ) {
    return gate({
      gate: "session_size",
      status: materializerSessionGate.status === "fail" ? "fail" : "pass",
      ownerSeam: "v2_capacity_materializer_projection.session_size",
      evidenceSource: "pure_v2_materializer_projection",
      evidence: [
        `projectionStatus=${materializerProjection.status}`,
        `trialId=${materializerProjection.trialId ?? "none"}`,
        `gateStatus=${materializerSessionGate.status}`,
        ...materializerSessionGate.evidence.slice(0, 4),
        ...materializerSessionGate.regressions.slice(0, 4),
        "capacity_materializer_projection_is_diagnostic_only",
      ],
      mustFixBeforeWeek1: materializerSessionGate.status === "fail",
    });
  }

  const capacity = noRepair.v2SelectionCapacityPlanDiagnostic;
  if (!capacity) {
    return gate({
      gate: "session_size",
      status: "missing_evidence",
      ownerSeam: "v2SelectionCapacityPlanDiagnostic",
      evidenceSource: "missing_evidence",
      evidence: ["selection_capacity_diagnostic_missing"],
      missingEvidence: ["session_size_capacity_projection"],
    });
  }
  return gate({
    gate: "session_size",
    status:
      capacity.summary.blockerCount > 0
        ? "fail"
        : capacity.summary.capacityPressureCount > 0 ||
            capacity.summary.capAwareExpansionNeededCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2SelectionCapacityPlanDiagnostic",
    evidenceSource: "no_repair_projection",
    evidence: [
      numberEvidence("blockers", capacity.summary.blockerCount),
      numberEvidence("capacityPressure", capacity.summary.capacityPressureCount),
      numberEvidence(
        "capAwareExpansion",
        capacity.summary.capAwareExpansionNeededCount,
      ),
      numberEvidence("optionalSuppressed", capacity.summary.optionalSuppressedCount),
    ],
    missingEvidence: capacity.missingInputs,
  });
}

function buildFatigueDistributionGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const selection = noRepair.v2ExerciseSelectionPlanDiagnostic;
  const concentrationProjection = noRepair.v2ConcentrationMaterializerProjection;
  if (!selection) {
    return gate({
      gate: "fatigue_distribution",
      status: "missing_evidence",
      ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
      evidenceSource: "missing_evidence",
      evidence: ["exercise_selection_plan_diagnostic_missing"],
      missingEvidence: ["fatigue_distribution_projection"],
    });
  }
  const blocked = selection.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes.filter((lane) => lane.fatigueStatus === "blocked"),
    ),
  );
  const warnings = selection.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes
        .filter((lane) => lane.fatigueStatus === "quality_warning")
        .map((lane) => ({ week: week.week, slotId: slot.slotId, lane })),
    ),
  );
  const warningsFromConcentration = warnings.filter(
    ({ lane }) => lane.concentrationStatus === "quality_warning",
  );
  const warningsWithFatigueEvidence = warnings.filter(({ lane }) =>
    lane.evidenceRefs.some((row) => /fatigue|collateral/i.test(row)),
  );
  const concentrationProjectionMeasured =
    concentrationProjection?.readOnly === true &&
    concentrationProjection.affectsScoringOrGeneration === false &&
    concentrationProjection.dryRunOnly === true &&
    concentrationProjection.consumedByProduction === false &&
    concentrationProjection.consumedByDemandOrMaterializer === false &&
    concentrationProjection.status !== "not_available";
  const donorOffsetProjection =
    concentrationProjection?.donorOffsetRedistributionProjection;
  const promotedBoundedCalvesBaselineIdempotent =
    concentrationProjectionMeasured &&
    concentrationProjection
      ? hasPromotedBoundedCalvesBaselineEvidence(concentrationProjection)
      : false;
  const projectionEvidence = concentrationProjectionMeasured
    ? [
        `concentrationProjectionStatus=${concentrationProjection.status}`,
        `crossWeekReadiness=${
          concentrationProjection.crossWeekReadiness.decision
        }`,
        numberEvidence(
          "crossWeekProjectedWeeks",
          concentrationProjection.crossWeekReadiness.projectedWeekCount,
        ),
        numberEvidence(
          "crossWeekImprovedWeeks",
          concentrationProjection.crossWeekReadiness.improvedWeekCount,
        ),
        numberEvidence(
          "readinessBlockers",
          concentrationProjection.crossWeekReadiness.blockerCount,
        ),
        numberEvidence(
          "concentrationWarningDelta",
          concentrationProjection.concentrationDelta.warningDelta,
        ),
        `behaviorReadiness=${
          concentrationProjection.crossWeekReadiness.decision
        }`,
        numberEvidence(
          "behaviorBlockers",
          concentrationProjection.blockersBeforeBehavior.length,
        ),
        ...concentrationProjection.blockersBeforeBehavior
          .slice(0, 6)
          .map((blocker) => `promotionGateMissing:${blocker}`),
        `concentrationTrialId=${concentrationProjection.trialId}`,
        numberEvidence(
          "concentrationMaxShareDelta",
          concentrationProjection.concentrationDelta.maxShareDelta,
        ),
        numberEvidence(
          "highFatigueSetDelta",
          concentrationProjection.concentrationDelta.highFatigueSetDelta,
        ),
        numberEvidence(
          "targetLaneSetDelta",
          concentrationProjection.candidateImpact.targetLaneSetDelta,
        ),
        numberEvidence(
          "materializerBlockerDelta",
          concentrationProjection.candidateImpact.materializerBlockerDelta,
        ),
        `nextSafeAction=${concentrationProjection.nextSafeAction}`,
        `nextSafeSlice=${concentrationProjection.crossWeekReadiness.nextSafeSlice}`,
        `donorOffsetStatus=${
          donorOffsetProjection?.status ?? "not_available"
        }`,
        `donorOffsetReadiness=${
          donorOffsetProjection?.summary.behaviorReadinessDecision ??
          "not_available"
        }`,
        numberEvidence(
          "donorOffsetProjectedWeeks",
          donorOffsetProjection?.summary.projectedWeekCount ?? 0,
        ),
        numberEvidence(
          "donorOffsetWarningDelta",
          donorOffsetProjection?.summary.concentrationWarningDelta ?? 0,
        ),
        numberEvidence(
          "donorOffsetMaterializerRegressions",
          donorOffsetProjection?.summary.materializerRegressionCount ?? 0,
        ),
        numberEvidence(
          "donorOffsetConcentrationRegressions",
          donorOffsetProjection?.summary.concentrationRegressionCount ?? 0,
        ),
        `promotedBoundedCalvesBaselineIdempotent=${promotedBoundedCalvesBaselineIdempotent}`,
        ...(promotedBoundedCalvesBaselineIdempotent
            ? [
              "promotedCalvesMuscle=Calves",
              "promotedCalvesSource=lower_a:calves:4->3",
              "promotedCalvesDonor=lower_b:calves:4->5",
              "promotedCalvesWeeks=2,3,4",
            ]
          : []),
        numberEvidence(
          "donorOffsetAlternateCandidates",
          donorOffsetProjection?.summary.alternateCandidateCount ?? 0,
        ),
        numberEvidence(
          "donorOffsetAlternatePassing",
          donorOffsetProjection?.summary.alternatePassingCandidateCount ?? 0,
        ),
        `slotWeekAllocationReadiness=${
          donorOffsetProjection?.summary.slotWeekAllocationReadiness ??
          "not_available"
        }`,
        numberEvidence(
          "slotWeekAllocationBlockedRows",
          donorOffsetProjection?.summary.slotWeekAllocationBlockedRowCount ?? 0,
        ),
        `slotWeekAllocationNextSafeSlice=${
          donorOffsetProjection?.summary.slotWeekAllocationNextSafeSlice ??
          "not_available"
        }`,
        ...(donorOffsetProjection?.summary.regressionCauseCounts
          ? Object.entries(
              donorOffsetProjection.summary.regressionCauseCounts,
            ).map(([cause, count]) =>
              numberEvidence(`donorOffsetCause:${cause}`, count ?? 0),
            )
          : []),
        `donorOffsetNextSafeSlice=${
          donorOffsetProjection?.summary.nextSafeSlice ?? "not_available"
        }`,
        "concentration_materializer_projection_is_diagnostic_only",
      ]
    : [
        "concentration_quality_gap_requires_measured_projection_delta",
      ];
  return gate({
    gate: "fatigue_distribution",
    status:
      blocked.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "pass",
    ownerSeam: concentrationProjectionMeasured
      ? "v2_concentration_materializer_projection"
      : "v2ExerciseSelectionPlanDiagnostic",
    evidenceSource: concentrationProjectionMeasured
      ? "pure_v2_materializer_projection"
      : "no_repair_projection",
    evidence: [
      numberEvidence("fatigueBlocked", blocked.length),
      numberEvidence("fatigueWarnings", warnings.length),
      numberEvidence(
        "fatigueWarningsFromConcentration",
        warningsFromConcentration.length,
      ),
      numberEvidence(
        "fatigueWarningsWithFatigueOrCollateralEvidence",
        warningsWithFatigueEvidence.length,
      ),
      "no_repair_projection_not_pure_v2_policy",
      ...projectionEvidence,
      ...warnings.slice(0, 4).map(
        ({ week, slotId, lane }) =>
          `fatigueWarning:${[
            `week_${week}`,
            slotId,
            lane.laneId,
            `concentration=${lane.concentrationStatus}`,
            `duplicate=${lane.duplicateStatus}`,
            `identity=${lane.identityStatus}`,
            `capacity=${lane.capacityStatus}`,
          ].join(":")}`,
      ),
    ],
    missingEvidence: concentrationProjectionMeasured
      ? [
          ...selection.missingInputs,
          ...concentrationProjection.crossWeekReadiness.gates.flatMap((gate) =>
            gate.status === "pass" ? [] : gate.requiredNextEvidence,
          ),
        ]
      : [...selection.missingInputs, "concentration_projection_delta"],
  });
}

function hasPromotedBoundedCalvesBaselineEvidence(
  projection: NonNullable<
    MesocycleExplainPlannerOnlyNoRepair["v2ConcentrationMaterializerProjection"]
  >,
): boolean {
  const donorOffset = projection.donorOffsetRedistributionProjection;
  const allocation = donorOffset.slotWeekAllocationProjection;
  const rows = allocation.rows;
  const expectedWeeks = [2, 3, 4];
  return (
    projection.crossWeekReadiness.decision ===
      "candidate_for_bounded_policy_design" &&
    donorOffset.status === "projected_with_limitations" &&
    donorOffset.summary.behaviorReadinessDecision ===
      "candidate_for_acceptance_projection" &&
    donorOffset.summary.totalSetDelta === 0 &&
    donorOffset.summary.materializerRegressionCount === 0 &&
    donorOffset.summary.concentrationRegressionCount === 0 &&
    allocation.status === "available" &&
    allocation.summary.behaviorReadiness ===
      "candidate_for_acceptance_projection" &&
    allocation.summary.blockedRowCount === 0 &&
    allocation.summary.passingRowCount === expectedWeeks.length &&
    allocation.summary.netWeeklySetDelta === 0 &&
    rows.length === expectedWeeks.length &&
    rows.every(
      (row) =>
        expectedWeeks.includes(row.week) &&
        row.muscle === "Calves" &&
        row.sourceLanePressure.slotId === "lower_a" &&
        row.sourceLanePressure.laneId === "calves" &&
        row.sourceLanePressure.baselineSetCount === 4 &&
        row.sourceLanePressure.trialSetCount === 3 &&
        row.sourceLanePressure.allocatedPreferredSets === 3 &&
        row.sourceLanePressure.setDelta === -1 &&
        row.sourceLanePressure.pressureRelieved === true &&
        row.donorCapacity.donorSlotId === "lower_b" &&
        row.donorCapacity.donorLaneId === "calves" &&
        row.donorCapacity.donorBeforeSets === 4 &&
        row.donorCapacity.donorAfterSets === 5 &&
        row.donorCapacity.donorSetDelta === 1 &&
        row.donorCapacity.absorbedRequiredSets === true &&
        row.donorCapacity.status === "absorbed" &&
        row.protectedCoverageImpact.status === "preserved" &&
        row.protectedCoverageImpact.netWeeklySetDelta === 0 &&
        row.materializerNonRegressionStatus === "pass" &&
        row.behaviorReadiness === "candidate_for_acceptance_projection" &&
        row.blockingReasons.length === 0,
    )
  );
}

function buildDuplicateConcentrationGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const exerciseIdentity = pureV2.baseCompare?.comparisons?.exerciseIdentity;
  if (pureV2BaseIsValid(pureV2) && exerciseIdentity) {
    const exactDuplicateCount =
      exerciseIdentity.duplicateExactExercises.v2Base.length;
    const duplicateFamilyCount =
      exerciseIdentity.duplicateClassFamilies.v2Base.length;
    const status: BenchmarkStatus =
      exerciseIdentity.classification === "v2_regresses"
        ? "fail"
        : exerciseIdentity.classification === "unclear" ||
            exactDuplicateCount > 0 ||
            duplicateFamilyCount > 0
          ? "warning"
          : "pass";
    return gate({
      gate: "duplicate_concentration_risk",
      status,
      ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `exerciseIdentityClassification=${exerciseIdentity.classification}`,
        numberEvidence("v2DuplicateExactExercises", exactDuplicateCount),
        numberEvidence("v2DuplicateClassFamilies", duplicateFamilyCount),
        ...(exerciseIdentity.classification === "unclear"
          ? ["watch:identity_differs_from_projection_evidence"]
          : []),
        ...(exactDuplicateCount > 0
          ? ["watch:exact_duplicate_reuse_needs_variant_or_continuity_justification"]
          : []),
        ...(duplicateFamilyCount > 0
          ? ["watch:class_family_reuse_needs_distinctness_policy"]
          : []),
        ...exerciseIdentity.duplicateExactExercises.v2Base
          .slice(0, 4)
          .map((exercise) => `v2DuplicateExact:${exercise}`),
        ...exerciseIdentity.duplicateClassFamilies.v2Base
          .slice(0, 4)
          .map((family) => `v2DuplicateFamily:${family}`),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
      mustFixBeforeWeek1: exerciseIdentity.classification === "v2_regresses",
    });
  }

  const selection = noRepair.v2ExerciseSelectionPlanDiagnostic;
  if (!selection) {
    return gate({
      gate: "duplicate_concentration_risk",
      status: "missing_evidence",
      ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
      evidenceSource: "missing_evidence",
      evidence: ["exercise_selection_plan_diagnostic_missing"],
      missingEvidence: ["duplicate_and_concentration_diagnostics"],
    });
  }
  return gate({
    gate: "duplicate_concentration_risk",
    status:
      selection.summary.blockedLaneCount > 0
        ? "fail"
        : selection.summary.duplicateRequiresJustificationCount > 0 ||
            selection.summary.concentrationWarningCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
    evidenceSource: "no_repair_projection",
    evidence: [
      numberEvidence("blockedLanes", selection.summary.blockedLaneCount),
      numberEvidence(
        "duplicateNeedsJustification",
        selection.summary.duplicateRequiresJustificationCount,
      ),
      numberEvidence(
        "concentrationWarnings",
        selection.summary.concentrationWarningCount,
      ),
    ],
    missingEvidence: selection.missingInputs,
  });
}

function buildMaterializerOmissionsGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const basePlanCompare = noRepair.v2BasePlanCompare;
  const shadowTrial = noRepair.v2BasePlanShadowConsumptionTrial;
  const baseRegressions = basePlanCompare?.summary.v2RegressionCount ?? 0;
  const shadowRegressions = shadowTrial?.summary.regressionCount ?? 0;
  if (!basePlanCompare && !shadowTrial) {
    return gate({
      gate: "materializer_omissions",
      status: "missing_evidence",
      ownerSeam: "v2_materialization_dry_run",
      evidenceSource: "missing_evidence",
      evidence: ["v2_materializer_dry_run_evidence_missing"],
      missingEvidence: ["base_plan_compare_or_shadow_consumption_trial"],
    });
  }
  return gate({
    gate: "materializer_omissions",
    status:
      baseRegressions > 0 || shadowRegressions > 0
        ? "fail"
        : shadowTrial?.status === "blocked"
          ? "warning"
          : "pass",
    ownerSeam: "v2_materialization_dry_run",
    evidenceSource: basePlanCompare
      ? "pure_v2_base_plan"
      : "shadow_diagnostic",
    evidence: [
      `baseStatus=${basePlanCompare?.status ?? "not_available"}`,
      numberEvidence("baseRegressions", baseRegressions),
      `shadowStatus=${shadowTrial?.status ?? "not_available"}`,
      numberEvidence("shadowRegressions", shadowRegressions),
      `consumedByProduction=${Boolean(shadowTrial?.consumedByProduction)}`,
    ],
  });
}

function buildWeekOneTrainabilityGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const classification = noRepair.acceptanceClassification;
  return gate({
    gate: "week_1_trainability",
    status:
      classification.basicMesocycleShapeStatus === "fail"
        ? "fail"
        : classification.basicMesocycleShapeStatus === "partial" ||
            classification.basicMesocycleShapeStatus === "pass_with_warnings"
          ? "warning"
          : "pass",
    ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
    evidenceSource: "acceptance_classification_no_repair",
    evidence: [
      `basicMesocycleShapeStatus=${classification.basicMesocycleShapeStatus}`,
      `replacementReadinessStatus=${classification.replacementReadinessStatus}`,
      numberEvidence("hardBlockers", classification.hardBlockers.length),
      numberEvidence("qualityWarnings", classification.qualityWarnings.length),
    ],
    missingEvidence:
      classification.replacementReadinessStatus === "blocked"
        ? ["replacement_readiness_blocked"]
        : [],
    mustFixBeforeWeek1: classification.hardBlockers.length > 0,
  });
}

function gateStatus(
  gates: BenchmarkGate[],
  gateName: BenchmarkGate["gate"],
): BenchmarkStatus {
  return (
    gates.find((row) => row.gate === gateName)?.status ?? "missing_evidence"
  );
}

function gateWatchItems(gates: BenchmarkGate[]): string[] {
  return gates
    .filter((row) => row.status === "warning")
    .map((row) => `${row.gate}:${row.ownerSeam}`);
}

function gateBlockers(gates: BenchmarkGate[]): string[] {
  return gates
    .filter((row) => row.status === "fail" || row.status === "missing_evidence")
    .flatMap((row) => [
      `${row.gate}:${row.status}:${row.ownerSeam}`,
      ...row.missingEvidence.map((missing) => `${row.gate}:missing:${missing}`),
    ]);
}

function riskStatusFromGate(status: BenchmarkStatus):
  | "pass"
  | "watch"
  | "fail"
  | "unknown" {
  return status === "pass"
    ? "pass"
    : status === "warning"
      ? "watch"
      : status === "fail"
        ? "fail"
        : "unknown";
}

function buildSlotWeekAllocationAcceptanceProjection(input: {
  noRepair: MesocycleExplainPlannerOnlyNoRepair;
  gates: BenchmarkGate[];
}): SlotWeekAllocationAcceptanceProjection {
  const concentrationProjection =
    input.noRepair.v2ConcentrationMaterializerProjection;
  const donorOffset =
    concentrationProjection?.donorOffsetRedistributionProjection;
  const slotWeekAllocation = donorOffset?.slotWeekAllocationProjection;
  const acceptance = input.noRepair.acceptanceClassification;
  const representativeAccumulationWeeks =
    concentrationProjection?.crossWeekReadiness.representativeAccumulationWeeks ??
    [];
  const projectedRows = donorOffset?.rows ?? [];
  const projectedWeekCount = donorOffset?.summary.projectedWeekCount ?? 0;
  const protectedCoveragePassCount =
    donorOffset?.summary.protectedCoveragePassCount ?? 0;
  const blockedRowCount =
    slotWeekAllocation?.summary.blockedRowCount ??
    donorOffset?.summary.slotWeekAllocationBlockedRowCount ??
    0;
  const netWeeklySetDelta =
    slotWeekAllocation?.summary.netWeeklySetDelta ??
    donorOffset?.summary.totalSetDelta ??
    0;
  const protectedVolumeCoverageStatus =
    projectedWeekCount === 0
      ? "unknown"
      : projectedWeekCount === protectedCoveragePassCount &&
          blockedRowCount === 0 &&
          netWeeklySetDelta === 0
        ? "pass"
        : "fail";
  const materializerRegressionCount =
    donorOffset?.summary.materializerRegressionCount ?? 0;
  const materializerBlockerDelta = projectedRows.reduce(
    (sum, row) => sum + row.materializerDelta.materializerBlockerDelta,
    0,
  );
  const selectedIdentityDelta = projectedRows.reduce(
    (sum, row) => sum + row.materializerDelta.selectedIdentityDelta,
    0,
  );
  const totalSetDelta = donorOffset?.summary.totalSetDelta ?? 0;
  const materializerNonRegressionStatus =
    projectedWeekCount === 0
      ? "unknown"
      : materializerRegressionCount === 0 &&
          materializerBlockerDelta === 0 &&
          totalSetDelta === 0
        ? "pass"
        : "fail";
  const sessionSizeGateStatus = gateStatus(input.gates, "session_size");
  const fatigueDistributionGateStatus = gateStatus(
    input.gates,
    "fatigue_distribution",
  );
  const duplicateConcentrationGateStatus = gateStatus(
    input.gates,
    "duplicate_concentration_risk",
  );
  const concentrationWarningDelta =
    donorOffset?.summary.concentrationWarningDelta ??
    concentrationProjection?.concentrationDelta.warningDelta ??
    0;
  const readOnlyProjectionBoundary =
    concentrationProjection?.readOnly === true &&
    concentrationProjection.affectsScoringOrGeneration === false &&
    concentrationProjection.consumedByProduction === false &&
    donorOffset?.readOnly === true &&
    donorOffset.affectsScoringOrGeneration === false &&
    donorOffset.consumedByProduction === false &&
    donorOffset.consumedByDemandOrMaterializer === false;
  const blockerCandidates = uniqueSorted([
    ...gateBlockers(input.gates),
    ...(readOnlyProjectionBoundary
      ? []
      : ["read_only_non_consumption_boundary_not_proven"]),
    ...(protectedVolumeCoverageStatus === "fail"
      ? ["protected_volume_or_coverage_regressed"]
      : protectedVolumeCoverageStatus === "unknown"
        ? ["protected_volume_or_coverage_not_projected"]
        : []),
    ...(materializerNonRegressionStatus === "fail"
      ? ["materializer_identity_set_or_blocker_regression"]
      : materializerNonRegressionStatus === "unknown"
        ? ["materializer_non_regression_not_projected"]
        : []),
    ...(acceptance.hardBlockers.length > 0
      ? acceptance.hardBlockers.map((row) => `week_1_trainability:${row.code}`)
      : []),
    ...(donorOffset?.summary.behaviorReadinessDecision ===
    "candidate_for_acceptance_projection"
      ? []
      : ["slot_week_allocation_not_candidate_for_acceptance_projection"]),
  ]);
  const watchItems = uniqueSorted([
    ...gateWatchItems(input.gates),
    ...acceptance.qualityWarnings.map((row) => `week_1_quality:${row.code}`),
    ...(acceptance.basicMesocycleShapeStatus === "pass_with_warnings"
      ? ["week_1_trainability:pass_with_warnings"]
      : []),
    ...(duplicateConcentrationGateStatus === "warning"
      ? []
      : []),
    ...(fatigueDistributionGateStatus === "warning"
      ? []
      : []),
  ]);
  const itemClassifications = buildAcceptanceItemClassifications({
    gates: input.gates,
    acceptance,
    blockerCandidates,
    watchItems,
    representativeAccumulationWeeks,
  });
  const classificationCounts = countClassifications(itemClassifications);
  const hasEvidence =
    readOnlyProjectionBoundary &&
    representativeAccumulationWeeks.length > 0 &&
    projectedWeekCount === representativeAccumulationWeeks.length;
  const hardPass =
    hasEvidence &&
    blockerCandidates.length === 0 &&
    protectedVolumeCoverageStatus === "pass" &&
    materializerNonRegressionStatus === "pass";
  const decision: SlotWeekAllocationAcceptanceProjection["decision"] =
    !hasEvidence
      ? "diagnostic_only"
      : !hardPass
        ? "blocked_by_acceptance_trainability_or_non_regression"
        : watchItems.length > 0
          ? "accepted_with_watch_items"
          : "behavior_ready_candidate";
  const nextSafeSlice: SlotWeekAllocationAcceptanceProjection["acceptance"]["nextSafeSlice"] =
    decision === "behavior_ready_candidate"
      ? "behavior_promotion_review"
      : decision === "accepted_with_watch_items"
        ? classificationCounts.ownerSpecificNextFix === 0 &&
          classificationCounts.blocker === 0
          ? "bounded_behavior_promotion_review"
          : "resolve_watch_items_before_behavior_promotion"
        : decision === "blocked_by_acceptance_trainability_or_non_regression"
          ? "fix_acceptance_or_non_regression_blockers"
          : "collect_missing_acceptance_projection_evidence";

  return {
    version: 1,
    source: "v2_slot_week_allocation_acceptance_non_regression_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    candidateSource: "SlotDemandAllocationByWeek",
    evidenceSource:
      "v2_plan_quality_benchmark_and_donor_offset_materializer_projection",
    representativeAccumulationWeeks,
    decision,
    week1Trainability: {
      status: acceptance.basicMesocycleShapeStatus,
      replacementReadinessStatus: acceptance.replacementReadinessStatus,
      hardBlockerCount: acceptance.hardBlockers.length,
      qualityWarningCount: acceptance.qualityWarnings.length,
    },
    protectedVolumeCoverage: {
      status: protectedVolumeCoverageStatus,
      projectedWeekCount,
      protectedCoveragePassCount,
      blockedRowCount,
      netWeeklySetDelta,
    },
    materializerNonRegression: {
      status: materializerNonRegressionStatus,
      selectedIdentityDelta,
      totalSetDelta,
      materializerBlockerDelta,
      regressionCount: materializerRegressionCount,
    },
    sessionSizeFatigueConcentrationImpact: {
      status:
        sessionSizeGateStatus === "fail" || fatigueDistributionGateStatus === "fail"
          ? "fail"
          : sessionSizeGateStatus === "missing_evidence" ||
              fatigueDistributionGateStatus === "missing_evidence"
            ? "unknown"
            : sessionSizeGateStatus === "warning" ||
                fatigueDistributionGateStatus === "warning"
              ? "watch"
              : "pass",
      sessionSizeGateStatus,
      fatigueDistributionGateStatus,
      concentrationWarningDelta,
    },
    duplicateConcentrationRisk: {
      status: riskStatusFromGate(duplicateConcentrationGateStatus),
      duplicateConcentrationGateStatus,
      watchItemCount:
        duplicateConcentrationGateStatus === "warning"
          ? watchItems.filter((item) =>
              item.startsWith("duplicate_concentration_risk:"),
            ).length
          : 0,
    },
    acceptance: {
      decision,
      watchItems,
      blockers: blockerCandidates,
      itemClassifications,
      classificationCounts,
      nextSafeSlice,
    },
    nonConsumption: {
      seedRuntimeReceiptDbConsumed: false,
      productionMaterializerConsumed: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    },
  };
}

export function buildV2PlanQualityBenchmark(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): V2PlanQualityBenchmark {
  const gates = [
    buildSupportFloorsGate(noRepair),
    buildDirectWorkGate(noRepair),
    buildLanePreservationGate(noRepair),
    buildLaneIntentExplicitnessGate(noRepair),
    buildSessionSizeGate(noRepair),
    buildFatigueDistributionGate(noRepair),
    buildDuplicateConcentrationGate(noRepair),
    buildMaterializerOmissionsGate(noRepair),
    buildWeekOneTrainabilityGate(noRepair),
  ];
  const failCount = countByStatus(gates, "fail");
  const missingEvidenceCount = countByStatus(gates, "missing_evidence");
  const warningCount = countByStatus(gates, "warning");
  const mustFixBeforeWeek1Count = gates.filter(
    (row) => row.mustFixBeforeWeek1,
  ).length;
  const status = benchmarkStatus(gates);
  const deprecationReady =
    status === "pass" || (status === "warning" && mustFixBeforeWeek1Count === 0);
  const slotWeekAllocationAcceptanceProjection =
    buildSlotWeekAllocationAcceptanceProjection({ noRepair, gates });

  return {
    version: 1,
    source: "v2_candidate_quality_benchmark",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status,
    summary: {
      passCount: countByStatus(gates, "pass"),
      warningCount,
      failCount,
      missingEvidenceCount,
      mustFixBeforeWeek1Count,
      concentrationReadinessDecision:
        noRepair.v2ConcentrationMaterializerProjection?.crossWeekReadiness
          .decision ?? "not_available",
      concentrationNextSafeSlice:
        noRepair.v2ConcentrationMaterializerProjection?.crossWeekReadiness
          .nextSafeSlice ?? null,
      concentrationReadinessBlockerCount:
        noRepair.v2ConcentrationMaterializerProjection?.crossWeekReadiness
          .blockerCount ?? null,
      slotWeekAllocationReadiness:
        noRepair.v2ConcentrationMaterializerProjection
          ?.donorOffsetRedistributionProjection.summary
          .slotWeekAllocationReadiness ?? "not_available",
      slotWeekAllocationBlockedRowCount:
        noRepair.v2ConcentrationMaterializerProjection
          ?.donorOffsetRedistributionProjection.summary
          .slotWeekAllocationBlockedRowCount ?? 0,
      slotWeekAllocationNextSafeSlice:
        noRepair.v2ConcentrationMaterializerProjection
          ?.donorOffsetRedistributionProjection.summary
          .slotWeekAllocationNextSafeSlice ?? null,
      nextSafeAction:
        failCount > 0
          ? "fix_failed_first_principles_gates"
          : missingEvidenceCount > 0
            ? "collect_missing_benchmark_evidence"
            : warningCount > 0
              ? "review_warning_gates_before_deprecation"
              : "review_legacy_repair_deprecation_candidates",
    },
    slotWeekAllocationAcceptanceProjection,
    gates,
    deprecationReadiness: {
      status: deprecationReady
        ? "ready_for_review"
        : failCount > 0
          ? "blocked"
          : "not_ready",
      evidence: gates
        .filter((row) => row.status === "pass")
        .map((row) => `${row.gate}:pass`),
      missingEvidence: gates.flatMap((row) => row.missingEvidence),
    },
    guardrails: {
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    },
  };
}
