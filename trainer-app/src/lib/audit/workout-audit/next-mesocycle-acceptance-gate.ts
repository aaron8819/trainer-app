import { prisma } from "@/lib/db/prisma";
import { readNextCycleSeedDraft } from "@/lib/api/mesocycle-handoff";
import type { MesocycleSlotPlanSeed } from "@/lib/api/mesocycle-handoff-slot-plan-projection.seed-serialization";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import {
  buildCompletedBlockEvidenceAssessment,
  buildCandidateDecisionSummary,
  buildCandidateEvaluationAssessments,
  buildPriorRiskRows,
  type CandidateCompletedBlockEvidenceAssessment,
  type CandidateCompletedBlockEvidenceRow,
  type CandidateEvaluationAssessments,
} from "./next-mesocycle-candidate-evaluator";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGateRemediation,
  NextMesocycleAcceptanceGateSeverity,
  NextMesocycleAcceptanceGatePayload,
  NextMesocycleAcceptanceGateStatus,
  V2AcceptedSeedPrepareCompareAuditPayload,
  WeeklyRetroAuditPayload,
} from "./types";

type SourceMesocycleState = {
  id: string;
  state: string;
  macroCycleId: string;
  mesoNumber: number;
  sessionsPerWeek: number;
  deloadSessionsCompleted: number;
  nextSeedDraftJson: unknown;
};

type SuccessorMesocycleState = {
  id: string;
  state: string;
} | null;

type IncompleteWorkoutState = {
  id: string;
  status: string;
  sessionIntent: string | null;
}[];

export type CandidateVolumeExerciseRow = {
  id: string;
  name: string;
  aliases?: Array<{ alias: string }>;
  exerciseMuscles?: Array<{
    role: string;
    muscle: { name: string };
  }>;
};

type AcceptanceGateReader = {
  mesocycle: {
    findFirst(args: unknown): Promise<SourceMesocycleState | SuccessorMesocycleState>;
  };
  workout: {
    findMany(args: unknown): Promise<IncompleteWorkoutState>;
  };
  exercise: {
    findMany(args: unknown): Promise<CandidateVolumeExerciseRow[]>;
  };
};

export type CandidateVolumeInput = {
  muscle: string;
  projectedSets: number;
  mev?: number | null;
  productiveTarget?: number | null;
  mav?: number | null;
};
type WeeklyMuscleGateRow =
  NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"][number];

type AcceptanceGateEvidence = {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  sourceMesocycle: SourceMesocycleState | null;
  successorMesocycle?: SuccessorMesocycleState;
  incompleteWorkouts: IncompleteWorkoutState;
  v2PrepareCompare?: V2AcceptedSeedPrepareCompareAuditPayload;
  diagnosticPreview?: MesocycleExplainAuditPayload;
  completedBlockRetros?: WeeklyRetroAuditPayload[];
  candidateVolumeRows?: CandidateVolumeInput[];
};

const REQUIRED_GATE_LABELS = [
  "Candidate identity",
  "Seed truth/runtime contract",
  "Volume floors/zones",
  "Prior-block recurring risks",
  "Slot/lane balance",
  "Exercise/materialization quality",
  "Lifecycle/deload safety",
  "Week 1 trainability",
] as const;

const COMPLETED_BLOCK_WEEKS = [1, 2, 3, 4] as const;

function formatGateNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "unknown";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusFromBooleans(input: {
  fail?: boolean;
  warning?: boolean;
  pass?: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (input.fail) {
    return "fail";
  }
  if (input.warning) {
    return "warning";
  }
  if (input.pass) {
    return "pass";
  }
  return "unknown";
}

function weekOneTrainabilityStatus(input: {
  candidateFound: boolean;
  baseValidationStatus?: string;
  seedShapeCompatible: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (!input.candidateFound) {
    return "unknown";
  }
  if (!input.seedShapeCompatible) {
    return "fail";
  }
  if (input.baseValidationStatus === "pass") {
    return "pass";
  }
  if (input.baseValidationStatus === "pass_with_warnings") {
    return "warning";
  }
  return "fail";
}

function weekOneTrainabilityEvidence(input: {
  baseValidationStatus?: string;
  seedShapeCompatible: boolean;
  status: NextMesocycleAcceptanceGateStatus;
}): string {
  const evidence = [
    `base=${input.baseValidationStatus ?? "unknown"}`,
    `seed_shape=${input.seedShapeCompatible ? "yes" : "no"}`,
  ];
  if (input.status === "warning") {
    evidence.push("post_accept_verification=required");
  }
  return evidence.join(" ");
}

function isActionableSeverity(
  severity: NextMesocycleAcceptanceGateSeverity,
): boolean {
  return (
    severity === "blocker" ||
    severity === "high_risk" ||
    severity === "warning"
  );
}

function planningShapeFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): string | undefined {
  const planningReality =
    preview?.preview.projectionDiagnostics.planningReality;
  return planningReality?.summary?.planningShape;
}

function volumeRowsFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): CandidateVolumeInput[] {
  return (
    preview?.plannerOnlyNoRepair?.weeklyMuscleTotals.map((row) => {
      const landmarks = VOLUME_LANDMARKS[row.muscle];
      return {
        muscle: row.muscle,
        projectedSets: row.projectedEffectiveSets,
        mev: landmarks?.mev ?? row.targetMin,
        productiveTarget: row.targetPreferred ?? row.targetMin,
        mav: landmarks?.mav ?? null,
      };
    }) ?? []
  );
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function musclesByRole(
  exercise: CandidateVolumeExerciseRow,
  role: "PRIMARY" | "SECONDARY",
): string[] {
  return (exercise.exerciseMuscles ?? [])
    .filter((entry) => entry.role === role)
    .map((entry) => entry.muscle.name)
    .sort((left, right) => left.localeCompare(right));
}

export function buildCandidateVolumeRowsFromSlotPlanSeed(input: {
  seed: MesocycleSlotPlanSeed;
  exercises: CandidateVolumeExerciseRow[];
  muscles?: readonly string[];
}): CandidateVolumeInput[] {
  const exerciseById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const totals = new Map<string, number>();

  for (const slot of input.seed.slots) {
    for (const seedExercise of slot.exercises) {
      const exercise = exerciseById.get(seedExercise.exerciseId);
      if (!exercise) {
        continue;
      }
      const contribution = getEffectiveStimulusByMuscle(
        {
          id: exercise.id,
          name: exercise.name,
          aliases: (exercise.aliases ?? []).map((alias) => alias.alias),
          primaryMuscles: musclesByRole(exercise, "PRIMARY"),
          secondaryMuscles: musclesByRole(exercise, "SECONDARY"),
        },
        seedExercise.setCount,
        { logFallback: false },
      );
      for (const [muscle, effectiveSets] of contribution) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + effectiveSets);
      }
    }
  }

  const muscles =
    input.muscles && input.muscles.length > 0
      ? Array.from(new Set(input.muscles))
      : Object.keys(VOLUME_LANDMARKS).filter((muscle) => (totals.get(muscle) ?? 0) > 0);

  return muscles
    .flatMap((muscle) => {
      const landmarks = VOLUME_LANDMARKS[muscle];
      const projectedSets = roundToTenth(totals.get(muscle) ?? 0);
      if (!landmarks && projectedSets <= 0) {
        return [];
      }
      return [
        {
          muscle,
          projectedSets,
          mev: landmarks?.mev ?? null,
          productiveTarget: landmarks?.mev ?? null,
          mav: landmarks?.mav ?? null,
        },
      ];
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function buildWeeklyMuscleTable(
  rows: CandidateVolumeInput[],
): NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"] {
  return rows
    .map((row) => {
      const landmarks = VOLUME_LANDMARKS[row.muscle];
      const mev = row.mev ?? landmarks?.mev ?? 0;
      const mav = row.mav ?? landmarks?.mav ?? 0;
      const productiveTarget = row.productiveTarget ?? null;
      const projectedSets = Math.round(row.projectedSets * 10) / 10;
      const nearMav =
        productiveTarget != null && mav > 0 && productiveTarget >= mav - 1;
      const status: WeeklyMuscleGateRow["status"] =
        projectedSets < mev
          ? "below_mev_fail"
          : mav > 0 && projectedSets > mav
            ? "over_mav_fail_or_warning"
            : productiveTarget != null && projectedSets < productiveTarget
              ? "above_mev_below_target_not_failure"
              : nearMav
                ? "target_near_mav_stretch_cap"
                : "productive_zone";
      const notes =
        status === "below_mev_fail"
          ? "below MEV blocks acceptance"
          : status === "over_mav_fail_or_warning"
            ? "over MAV requires failure/warning review"
            : status === "above_mev_below_target_not_failure"
              ? "above MEV but below target is not a failure"
              : status === "target_near_mav_stretch_cap"
                ? "target near MAV is a stretch/cap, not a quota"
                : "inside productive zone";
      const severity: NextMesocycleAcceptanceGateSeverity =
        status === "below_mev_fail" || status === "over_mav_fail_or_warning"
          ? "high_risk"
          : status === "above_mev_below_target_not_failure" ||
              status === "target_near_mav_stretch_cap"
            ? "info"
            : "pass";

      return {
        muscle: row.muscle,
        projectedSets,
        mev,
        productiveTarget,
        mav,
        status,
        severity,
        notes,
      };
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function buildBlockers(input: AcceptanceGateEvidence): string[] {
  const blockers: string[] = [];
  const source = input.sourceMesocycle;
  const candidateFound =
    input.v2PrepareCompare?.handoffCandidate.found === true;

  if (!source) {
    blockers.push("source mesocycle not found");
  } else if (source.state !== "AWAITING_HANDOFF") {
    blockers.push(`source state not AWAITING_HANDOFF (${source.state})`);
  }

  if (!candidateFound) {
    blockers.push("no persisted handoff candidate");
  }

  if (
    source?.state === "ACTIVE_DELOAD" &&
    source.deloadSessionsCompleted < source.sessionsPerWeek
  ) {
    blockers.push(
      `current deload incomplete (${source.deloadSessionsCompleted}/${source.sessionsPerWeek})`,
    );
  }

  for (const workout of input.incompleteWorkouts) {
    blockers.push(
      `incomplete workout ${workout.id} (${workout.status}${workout.sessionIntent ? ` ${workout.sessionIntent}` : ""})`,
    );
  }

  return Array.from(new Set(blockers));
}

function buildGates(input: {
  evidence: AcceptanceGateEvidence;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  completedBlockAssessment: CandidateCompletedBlockEvidenceAssessment;
  blockers: string[];
  candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"];
  planningShape?: string;
  assessments: CandidateEvaluationAssessments;
}): NextMesocycleAcceptanceGatePayload["gates"] {
  const v2 = input.evidence.v2PrepareCompare;
  const candidateFound = v2?.handoffCandidate.found === true;
  const volumeFailures = input.weeklyRows.filter(
    (row) =>
      row.status === "below_mev_fail" ||
      row.status === "over_mav_fail_or_warning",
  );
  const coverageRows = v2?.identityCoverageComparison.coverageRows ?? [];
  const coverageFailures = coverageRows.filter(
    (row) => row.v2 === false || row.classification === "v2_regresses",
  );
  const mostlyRepairShaped =
    input.planningShape === "mostly_repair_shaped" ||
    input.planningShape === "mixed_upstream_plus_repair_shaped";
  const seedShapePass =
    v2?.boundaryFacts.readOnly === true &&
    v2.boundaryFacts.noWrite === true &&
    v2.seedShapeComparison.executableFieldShape.classification === "v2_preserves" &&
    v2.seedShapeComparison.seedSerializerIdentity.classification === "v2_preserves";
  const materializerPass =
    v2?.provenance.materializerStatus === "materialized" &&
    v2.provenance.seedShapeCompatibility.compatible === true;
  const supportLaneBoundary = input.assessments.supportLaneBoundary;

  return REQUIRED_GATE_LABELS.map((gate) => {
    if (gate === "Candidate identity") {
      const pass = candidateFound && input.candidateKind !== "absent";
      return {
        gate,
        status: pass ? "pass" : "fail",
        severity: pass ? "pass" : "blocker",
        evidence: `candidate_found=${candidateFound ? "yes" : "no"} kind=${input.candidateKind}`,
        notes:
          input.candidateKind === "diagnostic_preview_only"
            ? "diagnostic previews are evidence only and cannot be accepted"
            : pass
              ? "persisted handoff candidate is inspectable without writes"
              : "rerun after handoff exists",
        ownerSeam: "candidate identity",
        smallestSafeFix:
          input.candidateKind === "diagnostic_preview_only"
            ? "wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview"
            : "rerun after the source reaches handoff and a persisted candidate exists",
        mustFixBeforeWeek1: true,
      };
    }

    if (gate === "Seed truth/runtime contract") {
      const status = statusFromBooleans({ pass: candidateFound && seedShapePass });
      return {
        gate,
        status,
        severity:
          status === "pass" ? "pass" : candidateFound ? "blocker" : "info",
        evidence: v2
          ? `serializer=${v2.boundaryFacts.seedSerializer} executable_shape=${v2.seedShapeComparison.executableFieldShape.classification}`
          : "v2 prepare-compare unavailable",
        notes: "runtime contract remains exerciseId/role/setCount only",
        ownerSeam: "seed/runtime contract",
        smallestSafeFix:
          status === "pass"
            ? "no implementation required"
            : "investigate seed serializer/runtime contract compatibility before accepting",
        mustFixBeforeWeek1: candidateFound && status !== "pass",
      };
    }

    if (gate === "Volume floors/zones") {
      const status =
        !candidateFound
          ? "unknown"
          : input.weeklyRows.length === 0
            ? "unknown"
            : volumeFailures.length > 0
              ? "fail"
              : "pass";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "pass"
              ? "pass"
              : "info",
        evidence:
          !candidateFound
            ? input.weeklyRows.length > 0
              ? "diagnostic preview volume only; no persisted candidate"
              : "candidate volume unavailable"
          : volumeFailures.length > 0
            ? volumeFailures
                .map((row) => `${row.muscle}:${row.status}`)
                .join(", ")
            : input.weeklyRows.length > 0
              ? "no below-MEV or over-MAV rows"
              : "candidate volume unavailable",
        notes: "below target but above MEV is informational, not failure",
        ownerSeam: "volume floors",
        smallestSafeFix:
          status === "fail"
            ? "fix candidate weekly volume at the canonical volume-floor/materializer owner before accepting"
            : "no implementation required for above-MEV/below-target rows",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Prior-block recurring risks") {
      const failures = input.completedBlockAssessment.candidateFailureRisks;
      const warnings = input.completedBlockAssessment.candidateWarningRisks;
      const status: NextMesocycleAcceptanceGateStatus =
        failures.length > 0
          ? "fail"
          : !candidateFound
            ? "unknown"
            : warnings.length > 0
              ? "warning"
              : "pass";
      return {
        gate,
        status,
        severity:
          failures.length > 0
            ? "high_risk"
            : warnings.length > 0
              ? "warning"
              : !candidateFound
                ? "info"
                : "pass",
        evidence:
          failures.length > 0
            ? `repeated predictable misses=${failures.join(", ")}`
            : warnings.length > 0
              ? `thin or unverifiable recurring risks=${warnings.join(", ")}`
              : input.completedBlockAssessment.rows.length > 0
                ? "completed-block evidence reviewed"
                : "completed-block evidence unavailable",
        notes: candidateFound
          ? "compares candidate floors against recent weekly-retro evidence"
          : "evidence will be applied when a persisted handoff candidate exists",
        ownerSeam: "audit/readout",
        smallestSafeFix:
          failures.length > 0
            ? "fix only the repeated candidate failure at its canonical owner; do not turn prior evidence into policy by itself"
            : "monitor warning rows; no planner implementation from prior-block evidence alone",
        mustFixBeforeWeek1: failures.length > 0,
      };
    }

    if (gate === "Slot/lane balance") {
      const status: NextMesocycleAcceptanceGateStatus =
        !candidateFound || coverageRows.length === 0
          ? "unknown"
          : coverageFailures.length > 0
            ? "fail"
            : "pass";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "pass"
              ? "pass"
              : "info",
        evidence:
          coverageFailures.length > 0
            ? coverageFailures.map((row) => row.item).join(", ")
            : coverageRows.length > 0
              ? `coverage_rows=${coverageRows.length}`
              : "coverage evidence unavailable",
        notes: "uses prepare-compare class/lane coverage, not runtime policy",
        ownerSeam: "slot allocation",
        smallestSafeFix:
          status === "fail"
            ? "investigate candidate slot allocation/coverage in the handoff preparation seam"
            : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Exercise/materialization quality") {
      const repairBurdenWarning =
        input.assessments.repairBurden.repairBurden === "medium" ||
        input.assessments.repairBurden.repairBurden === "high" ||
        mostlyRepairShaped;
      const status: NextMesocycleAcceptanceGateStatus =
        candidateFound &&
        (!materializerPass || supportLaneBoundary.blockingRows.length > 0)
          ? "fail"
          : candidateFound &&
              (repairBurdenWarning || supportLaneBoundary.warningRows.length > 0)
            ? "warning"
            : candidateFound && materializerPass
              ? "pass"
              : "unknown";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "warning"
              ? "warning"
              : status === "pass"
                ? "pass"
                : "info",
        evidence: [
          v2
            ? `materializer=${v2.provenance.materializerStatus} seed_shape=${v2.provenance.seedShapeCompatibility.compatible ? "yes" : "no"} planning_shape=${input.planningShape ?? "unknown"}`
            : `planning_shape=${input.planningShape ?? "unknown"}`,
          `support_lane_boundary=${supportLaneBoundary.evidence}`,
        ].join(" "),
        notes:
          supportLaneBoundary.blockingRows.length > 0
            ? "authored support lane was budgeted but dropped before selection while the candidate remains below MEV"
            : supportLaneBoundary.warningRows.length > 0
              ? "authored support lane was budgeted but dropped; current candidate floor is not below MEV"
              : mostlyRepairShaped
                ? candidateFound
                  ? "repair-heavy candidate can be trainable but carries planner/materializer quality debt"
                  : "mostly repair-shaped preview is diagnostic evidence only"
                : "diagnostic preview evidence remains non-executable",
        ownerSeam:
          supportLaneBoundary.droppedRows.length > 0
            ? "materializer/exercise-selection capacity"
            : "materializer policy",
        smallestSafeFix:
          status === "fail"
            ? supportLaneBoundary.blockingRows.length > 0
              ? "preserve the authored support lane through the materializer/exercise-selection capacity owner before accepting"
              : "investigate materializer compatibility before accepting"
            : status === "warning"
              ? supportLaneBoundary.warningRows.length > 0
                ? "keep as a watch item; investigate narrow support-lane preservation without changing planner volume math"
                : "train only with watch items; investigate planner/materializer ownership debt separately"
              : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Lifecycle/deload safety") {
      const status = input.blockers.length > 0 ? "fail" : "pass";
      return {
        gate,
        status,
        severity: status === "fail" ? "blocker" : "pass",
        evidence: input.blockers.join(", ") || "no lifecycle blockers found",
        notes: "source must be AWAITING_HANDOFF before acceptance gate is runnable",
        ownerSeam: "lifecycle/handoff",
        smallestSafeFix:
          status === "fail"
            ? "resolve lifecycle/handoff blockers before evaluating acceptance"
            : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    const seedShapeCompatible =
      v2?.provenance.seedShapeCompatibility.compatible === true;
    const status = weekOneTrainabilityStatus({
      candidateFound,
      baseValidationStatus: v2?.provenance.baseValidationStatus,
      seedShapeCompatible,
    });
    return {
      gate,
      status,
      severity:
        status === "pass"
          ? "pass"
          : status === "warning"
            ? "warning"
            : candidateFound
              ? "high_risk"
              : "info",
      evidence: v2
        ? weekOneTrainabilityEvidence({
            baseValidationStatus: v2.provenance.baseValidationStatus,
            seedShapeCompatible,
            status,
          })
        : "candidate trainability evidence unavailable",
      notes:
        status === "warning"
          ? "base validation warnings are watch items when seed shape is compatible; full runtime replay is verified post-accept"
          : "Week 1 must be trainable from persisted candidate evidence",
      ownerSeam: "prescription/readout",
      smallestSafeFix:
        status === "pass"
          ? "no implementation required"
          : status === "warning"
            ? "run post-accept verification before training Week 1; investigate warning owners separately"
            : "investigate base validation and Week 1 prescription readiness before accepting",
      mustFixBeforeWeek1: candidateFound && status === "fail",
    };
  });
}

function buildWatchItems(input: {
  candidateFound: boolean;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  completedBlockRows: CandidateCompletedBlockEvidenceRow[];
  gates: NextMesocycleAcceptanceGatePayload["gates"];
  assessments: CandidateEvaluationAssessments;
}): NextMesocycleAcceptanceGatePayload["watchItems"] {
  if (!input.candidateFound) {
    return [];
  }

  const completedRisks = new Set(
    input.completedBlockRows
      .filter((row) => row.severity === "warning" || row.severity === "high_risk")
      .map((row) => row.risk),
  );
  const watchItems: NextMesocycleAcceptanceGatePayload["watchItems"] = [];
  const maybeFloorWatch = (muscle: "Chest" | "Calves") => {
    const row = input.weeklyRows.find((entry) => entry.muscle === muscle);
    if (!row || row.projectedSets < row.mev || row.projectedSets - row.mev > 1.5) {
      return;
    }
    const priorRisk =
      muscle === "Chest" ? "Chest MEV fragility" : "Calf MEV fragility";
    if (!completedRisks.has(priorRisk)) {
      return;
    }
    watchItems.push({
      risk: `${muscle} floor margin`,
      whyItMatters: `prior block showed ${muscle} MEV fragility; candidate only clears the floor at ${formatGateNumber(row.projectedSets)}/${formatGateNumber(row.mev)}`,
      monitoringPlan: `watch ${muscle} projected volume in Week 1 pre-session readiness and avoid relying on final-session top-up`,
    });
  };

  maybeFloorWatch("Chest");
  maybeFloorWatch("Calves");

  for (const row of input.weeklyRows.filter(
    (entry) =>
      (entry.muscle === "Side Delts" || entry.muscle === "Rear Delts") &&
      entry.projectedSets >= entry.mev &&
      entry.projectedSets - entry.mev <= 1.5,
  )) {
    watchItems.push({
      risk: `${row.muscle} thin margin`,
      whyItMatters: `${row.muscle} is close to MEV after prior delt margin evidence`,
      monitoringPlan:
        "watch direct delt exposure in Upper A/B pre-session readiness before adding work",
    });
  }

  if (
    input.assessments.repairBurden.repairBurden === "medium" ||
    input.assessments.repairBurden.repairBurden === "high"
  ) {
    watchItems.push({
      risk: "Repair burden",
      whyItMatters:
        "candidate appears trainable, but the planner/materializer still shows ownership debt",
      monitoringPlan:
        "train from the persisted candidate only if Week 1 checks stay coherent; investigate planner quality separately",
    });
  }

  if (
    input.completedBlockRows.some(
      (row) => row.risk === "Load calibration drift" && row.severity === "warning",
    )
  ) {
    watchItems.push({
      risk: "Week 1 prescription confidence",
      whyItMatters:
        "prior block had load calibration drift that can make first-week prescriptions lower confidence",
      monitoringPlan:
        "watch Week 1 load/reps/RPE confidence in pre-session readiness; do not mutate loads from this gate",
    });
  }

  const weekOneGate = input.gates.find(
    (gate) => gate.gate === "Week 1 trainability",
  );
  if (weekOneGate?.status === "warning") {
    watchItems.push({
      risk: "Post-accept Week 1 verification",
      whyItMatters:
        "pre-accept candidate evidence has non-blocking base validation warnings, and full runtime replay proof requires a persisted successor",
      monitoringPlan:
        "run next-mesocycle-post-accept-verification after explicit accept and before training Week 1",
    });
  }

  return watchItems;
}

function buildGateFindings(
  gates: NextMesocycleAcceptanceGatePayload["gates"],
): NextMesocycleAcceptanceGateRemediation[] {
  return gates
    .filter(
      (gate) => gate.status !== "pass" && isActionableSeverity(gate.severity),
    )
    .map((gate) => ({
      finding: gate.gate,
      severity: gate.severity,
      ownerSeam: gate.ownerSeam,
      smallestSafeFix: gate.smallestSafeFix,
      mustFixBeforeWeek1: gate.mustFixBeforeWeek1,
      evidence: gate.evidence,
    }));
}

function buildCompletedBlockFindings(
  rows: CandidateCompletedBlockEvidenceRow[],
): NextMesocycleAcceptanceGateRemediation[] {
  return rows
    .filter((row) => isActionableSeverity(row.severity))
    .map((row) => ({
      finding: row.risk,
      severity: row.severity,
      ownerSeam: row.ownerSeam,
      smallestSafeFix: row.smallestSafeFix,
      mustFixBeforeWeek1: row.mustFixBeforeWeek1,
      evidence: row.evidence,
    }));
}

function buildDoNotFixNotes(): NextMesocycleAcceptanceGatePayload["doNotFixNotes"] {
  return [
    {
      item: "below target but above MEV",
      reason:
        "productive target misses are informational unless another floor/cap/trainability failure is present",
    },
    {
      item: "stretch-target miss",
      reason: "stretch targets are not hard acceptance quotas",
    },
    {
      item: "one-off weekly noise",
      reason:
        "completed-block evidence becomes a required fix only when the persisted candidate repeats a real failure",
    },
    {
      item: "diagnostic preview failure before candidate exists",
      reason: "preview evidence cannot be accepted or rejected as the candidate",
    },
    {
      item: "cosmetic output issue",
      reason:
        "formatting/readout polish should not trigger planner/materializer implementation",
    },
  ];
}

function deriveGateResult(input: {
  candidateFound: boolean;
  candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"];
  blockers: string[];
  findings: NextMesocycleAcceptanceGateRemediation[];
  watchItems: NextMesocycleAcceptanceGatePayload["watchItems"];
}): NextMesocycleAcceptanceGatePayload["gateResult"] {
  if (
    !input.candidateFound ||
    input.candidateKind === "absent" ||
    input.candidateKind === "diagnostic_preview_only" ||
    input.blockers.length > 0
  ) {
    return "not_runnable";
  }
  if (
    input.findings.some(
      (finding) =>
        finding.mustFixBeforeWeek1 &&
        (finding.severity === "blocker" || finding.severity === "high_risk"),
    )
  ) {
    return "rejected";
  }
  if (
    input.watchItems.length > 0 ||
    input.findings.some((finding) => finding.severity === "warning")
  ) {
    return "accepted_with_watch_items";
  }
  return "accepted";
}

export function buildNextMesocycleAcceptanceGateFromEvidence(
  evidence: AcceptanceGateEvidence,
): NextMesocycleAcceptanceGatePayload {
  const source = evidence.sourceMesocycle;
  const draftAvailable = Boolean(
    source && readNextCycleSeedDraft(source.nextSeedDraftJson),
  );
  const persistedCandidateFound =
    evidence.v2PrepareCompare?.handoffCandidate.found === true;
  const previewAvailable = Boolean(evidence.diagnosticPreview?.preview);
  const candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"] =
    evidence.successorMesocycle?.id
      ? "accepted"
      : persistedCandidateFound && draftAvailable
        ? "draft"
        : !persistedCandidateFound && previewAvailable
          ? "diagnostic_preview_only"
          : "absent";
  const candidateFound =
    persistedCandidateFound &&
    (candidateKind === "accepted" || candidateKind === "draft");
  const blockers = buildBlockers(evidence);
  const planningShape = planningShapeFromPreview(evidence.diagnosticPreview);
  const weeklyRows = buildWeeklyMuscleTable(
    evidence.candidateVolumeRows?.length
      ? evidence.candidateVolumeRows
      : volumeRowsFromPreview(evidence.diagnosticPreview),
  );
  const assessments = buildCandidateEvaluationAssessments({
    preview: evidence.diagnosticPreview,
    candidateFound,
    weeklyRows,
    candidateTruthFailure: weeklyRows.some(
      (row) =>
        row.status === "below_mev_fail" ||
        row.status === "over_mav_fail_or_warning",
    ),
  });
  const completedBlockAssessment = buildCompletedBlockEvidenceAssessment({
    retros: evidence.completedBlockRetros ?? [],
    weeklyRows,
    candidateFound,
  });
  const gates = buildGates({
    evidence,
    weeklyRows,
    completedBlockAssessment,
    blockers,
    candidateKind,
    planningShape,
    assessments,
  });
  const watchItems = buildWatchItems({
    candidateFound,
    weeklyRows,
    completedBlockRows: completedBlockAssessment.rows,
    gates,
    assessments,
  });
  const findings = [
    ...buildGateFindings(gates),
    ...buildCompletedBlockFindings(completedBlockAssessment.rows),
  ];
  const gateResult = deriveGateResult({
    candidateFound,
    candidateKind,
    blockers,
    findings,
    watchItems,
  });
  const decisionSummary = buildCandidateDecisionSummary({
    candidateFound,
    gates,
    assessments,
  });
  const why =
    gateResult === "not_runnable"
      ? blockers.length > 0
        ? blockers
        : ["no runnable persisted handoff candidate"]
      : gateResult === "rejected"
        ? findings
            .filter((finding) => finding.mustFixBeforeWeek1)
            .map((finding) => `${finding.finding}: ${finding.evidence}`)
        : gateResult === "accepted_with_watch_items"
          ? watchItems.map((item) => `${item.risk}: ${item.whyItMatters}`)
          : ["all read-only acceptance gates passed"];

  return {
    version: NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION,
    source: "next_mesocycle_acceptance_gate_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    gateResult,
    candidateFound,
    why,
    recommendation:
      gateResult === "not_runnable"
        ? "rerun after handoff exists"
        : gateResult === "accepted"
          ? "candidate passes the read-only gate"
          : gateResult === "accepted_with_watch_items"
            ? "candidate is trainable as-is, but monitor watch items through pre-session checks"
            : "fix must-fix findings before Week 1; do not silently repair from this gate",
    decisionSummary,
    candidateIdentity: {
      ...(evidence.ownerEmail ? { ownerEmail: evidence.ownerEmail } : {}),
      sourceMesocycleId: evidence.sourceMesocycleId,
      sourceState: source?.state ?? null,
      candidateKind,
      ...(candidateFound
        ? {
            candidateSeedSource:
              evidence.v2PrepareCompare?.provenance.legacySourceLabel ?? null,
          }
        : {}),
      ...(evidence.successorMesocycle?.id
        ? { candidateMesocycleId: evidence.successorMesocycle.id }
        : persistedCandidateFound && source?.id
          ? { candidateMesocycleId: source.id }
          : {}),
      candidateDraftAvailable: draftAvailable,
      persistedHandoffCandidateFound: persistedCandidateFound,
      writeNeededToInspect: false,
    },
    gates,
    weeklyMuscleTable: weeklyRows,
    priorBlockRecurringRisks: buildPriorRiskRows(weeklyRows),
    completedBlockEvidence: completedBlockAssessment.rows,
    watchItems,
    findings,
    doNotFixNotes: buildDoNotFixNotes(),
    diagnosticPreview: {
      available: previewAvailable,
      label: previewAvailable
        ? "diagnostic_preview_not_candidate"
        : "not_available",
      canBeAccepted: false,
      ...(planningShape ? { planningShape } : {}),
      notes: previewAvailable
        ? [
            "mesocycle-explain preview is diagnostic evidence only",
            "preview evidence cannot satisfy candidate identity without a persisted handoff candidate",
          ]
        : ["no mesocycle-explain preview evidence loaded"],
    },
    blockers,
    supportingEvidence: {
      v2PrepareCompareStatus: evidence.v2PrepareCompare?.compareStatus,
      v2ProductionWriteEligible:
        evidence.v2PrepareCompare?.boundaryFacts.v2ProductionWriteEligible,
      mesocycleExplainPreviewAvailable: previewAvailable,
    },
  };
}

async function loadSourceState(input: {
  userId: string;
  sourceMesocycleId: string;
  reader: AcceptanceGateReader;
}): Promise<SourceMesocycleState | null> {
  return input.reader.mesocycle.findFirst({
    where: {
      id: input.sourceMesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      macroCycleId: true,
      mesoNumber: true,
      sessionsPerWeek: true,
      deloadSessionsCompleted: true,
      nextSeedDraftJson: true,
    },
  }) as Promise<SourceMesocycleState | null>;
}

async function loadSuccessorState(input: {
  source: SourceMesocycleState | null;
  reader: AcceptanceGateReader;
}): Promise<SuccessorMesocycleState> {
  if (!input.source) {
    return null;
  }
  return input.reader.mesocycle.findFirst({
    where: {
      macroCycleId: input.source.macroCycleId,
      mesoNumber: input.source.mesoNumber + 1,
    },
    select: {
      id: true,
      state: true,
    },
  }) as Promise<SuccessorMesocycleState>;
}

async function loadIncompleteWorkouts(input: {
  userId: string;
  sourceMesocycleId: string;
  reader: AcceptanceGateReader;
}): Promise<IncompleteWorkoutState> {
  return input.reader.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.sourceMesocycleId,
      status: { in: ["IN_PROGRESS", "PARTIAL"] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      sessionIntent: true,
    },
  });
}

async function loadPersistedDraftCandidateVolumeRows(input: {
  sourceMesocycle: SourceMesocycleState | null;
  reader: AcceptanceGateReader;
  diagnosticPreview: MesocycleExplainAuditPayload | undefined;
}): Promise<CandidateVolumeInput[] | undefined> {
  const seed =
    readNextCycleSeedDraft(input.sourceMesocycle?.nextSeedDraftJson)
      ?.acceptedSeedDraft?.slotPlanSeedJson ?? null;
  if (!seed) {
    return undefined;
  }
  const candidateMuscles =
    input.diagnosticPreview?.plannerOnlyNoRepair?.weeklyMuscleTotals.map(
      (row) => row.muscle,
    ) ?? [];
  if (candidateMuscles.length === 0) {
    return undefined;
  }

  const exerciseIds = Array.from(
    new Set(
      seed.slots.flatMap((slot) =>
        slot.exercises.map((exercise) => exercise.exerciseId),
      ),
    ),
  );
  if (exerciseIds.length === 0) {
    return buildCandidateVolumeRowsFromSlotPlanSeed({
      seed,
      exercises: [],
      muscles: candidateMuscles,
    });
  }

  const exercises = await input.reader.exercise.findMany({
    where: { id: { in: exerciseIds } },
    select: {
      id: true,
      name: true,
      aliases: { select: { alias: true } },
      exerciseMuscles: {
        select: {
          role: true,
          muscle: { select: { name: true } },
        },
      },
    },
  });

  return buildCandidateVolumeRowsFromSlotPlanSeed({
    seed,
    exercises,
    muscles: candidateMuscles,
  });
}

async function loadCompletedBlockRetros(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycle: SourceMesocycleState | null;
  buildWeeklyRetro: typeof buildWeeklyRetroAuditPayload;
}): Promise<WeeklyRetroAuditPayload[]> {
  if (!input.sourceMesocycle) {
    return [];
  }

  const retros = await Promise.all(
    COMPLETED_BLOCK_WEEKS.map(async (week) => {
      try {
        return await input.buildWeeklyRetro({
          userId: input.userId,
          ownerEmail: input.ownerEmail,
          week,
          mesocycleId: input.sourceMesocycle!.id,
        });
      } catch {
        return null;
      }
    }),
  );

  return retros.filter((retro): retro is WeeklyRetroAuditPayload => retro != null);
}

export async function buildNextMesocycleAcceptanceGateAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  plannerDiagnosticsMode: "standard" | "debug";
  dependencies?: {
    reader?: AcceptanceGateReader;
    buildV2Compare?: typeof buildV2AcceptedSeedPrepareCompareAuditPayload;
    buildMesocycleExplain?: typeof buildMesocycleExplainAuditPayload;
    buildWeeklyRetro?: typeof buildWeeklyRetroAuditPayload;
  };
}): Promise<NextMesocycleAcceptanceGatePayload> {
  const reader = (input.dependencies?.reader ?? prisma) as AcceptanceGateReader;
  const [sourceMesocycle, v2PrepareCompare, diagnosticPreview] =
    await Promise.all([
      loadSourceState({
        userId: input.userId,
        sourceMesocycleId: input.sourceMesocycleId,
        reader,
      }),
      (input.dependencies?.buildV2Compare ??
        buildV2AcceptedSeedPrepareCompareAuditPayload)({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        mesocycleId: input.sourceMesocycleId,
        requestedIdSource: "source_mesocycle_id",
      }),
      (input.dependencies?.buildMesocycleExplain ?? buildMesocycleExplainAuditPayload)({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        sourceMesocycleId: input.sourceMesocycleId,
        retrospectiveMesocycleId: input.sourceMesocycleId,
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
        plannerOnlyNoRepair: {
          enabled: true,
          compareRepaired: true,
        },
      }).catch(() => undefined),
    ]);
  const [
    successorMesocycle,
    incompleteWorkouts,
    completedBlockRetros,
    persistedDraftCandidateVolumeRows,
  ] =
    await Promise.all([
      loadSuccessorState({ source: sourceMesocycle, reader }),
      loadIncompleteWorkouts({
        userId: input.userId,
        sourceMesocycleId: input.sourceMesocycleId,
        reader,
      }),
      loadCompletedBlockRetros({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        sourceMesocycle,
        buildWeeklyRetro:
          input.dependencies?.buildWeeklyRetro ?? buildWeeklyRetroAuditPayload,
      }),
      loadPersistedDraftCandidateVolumeRows({
        sourceMesocycle,
        reader,
        diagnosticPreview,
      }),
    ]);

  return buildNextMesocycleAcceptanceGateFromEvidence({
    userId: input.userId,
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: input.sourceMesocycleId,
    sourceMesocycle,
    successorMesocycle,
    incompleteWorkouts,
    v2PrepareCompare,
    diagnosticPreview,
    completedBlockRetros,
    candidateVolumeRows: persistedDraftCandidateVolumeRows,
  });
}
