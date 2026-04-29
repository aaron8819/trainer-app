import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import {
  loadHandoffSourceMesocycle,
  readMesocycleHandoffSummary,
  toHandoffProjectionSource,
} from "@/lib/api/mesocycle-handoff";
import {
  materializeHandoffArtifacts,
  type HandoffArtifactConstraintsRow,
  type HandoffArtifactRoleRow,
  type HandoffArtifactSource,
  type HandoffArtifactWorkoutRow,
  type MaterializedHandoffArtifacts,
} from "@/lib/api/mesocycle-handoff-artifacts";
import { projectSuccessorMesocycle } from "@/lib/api/mesocycle-handoff-projection";
import {
  buildMesocycleSlotPlanSeed,
  projectSuccessorSlotPlansFromSnapshot,
  type SuccessorSlotPlanProjection,
} from "@/lib/api/mesocycle-handoff-slot-plan-projection";
import {
  createCalvesFourFourPlannerOnlyPolicyOverride,
  type PlannerOnlyPolicyOverride,
} from "@/lib/api/planner-only-policy-override";
import { resolveMesocycleSlotContract } from "@/lib/api/mesocycle-slot-contract";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";
import {
  appendWorkoutHistoryEntryToMappedContext,
  buildProjectedWorkoutHistoryEntry,
  generateProjectedSession,
  listWorkoutExerciseNames,
  loadPreloadedGenerationSnapshot,
  buildMappedGenerationContextFromSnapshot,
} from "@/lib/api/projected-week-volume-shared";
import { getLatestReadinessSignalForReader } from "@/lib/api/readiness";
import type { SessionIntent } from "@/lib/engine/session-types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import {
  buildSessionAuditMutationSummary,
  resolvePersistedOrReconstructedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { getMuscleTargetSemantics } from "@/lib/engine/volume-landmarks";
import {
  buildV2PlannerMesocyclePolicy,
  type V2SetDistributionIntent,
  type V2SupportLanePolicy,
} from "@/lib/engine/planning/v2";
import {
  buildPlannerOwnedAccumulationProjection,
  buildV2ExerciseSelectionPlanDiagnostic,
} from "@/lib/api/planning-reality";
import { resolveSessionSlotPolicy } from "@/lib/planning/session-slot-profile";
import { MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildRepairPromotionScoreboard } from "./mesocycle-explain-v2-repair-scoreboard";
import {
  interpretRuntimeEdits,
  type RuntimeEditExerciseContext,
} from "./runtime-edit-interpretation";
import type {
  MesocycleExplainAuditPayload,
  MesocycleExplainComparisonSlotDiff,
  MesocycleExplainExerciseRationale,
  MesocycleExplainExerciseRow,
  MesocycleExplainPreviewProjectedSession,
  MesocycleExplainProjectionDiagnosticCategory,
  MesocycleExplainProjectionDiagnosticRow,
  MesocycleExplainProjectionDiagnostics,
  MesocycleExplainPlannerOnlyDryRun,
  MesocycleExplainPlannerOnlyNoRepairConcentrationRow,
  MesocycleExplainProjectionComparisonSnapshot,
  MesocycleExplainProjectionMetricDelta,
  MesocycleExplainPlannerOnlyNoRepair,
  MesocycleExplainRealityWorkout,
  MesocycleExplainReasonSource,
  MesocycleExplainSlotRow,
} from "./types";

type ExplainMesocycleRow = Prisma.MesocycleGetPayload<{
  include: {
    blocks: true;
    macroCycle: {
      select: {
        userId: true;
      };
    };
  };
}>;

type ExplainWorkoutRow = Prisma.WorkoutGetPayload<{
  select: {
    id: true;
    scheduledDate: true;
    status: true;
    revision: true;
    advancesSplit: true;
    selectionMode: true;
    sessionIntent: true;
    selectionMetadata: true;
    mesocycleId: true;
    mesocycleWeekSnapshot: true;
    mesoSessionSnapshot: true;
    mesocyclePhaseSnapshot: true;
    exercises: {
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        exerciseId: true;
        orderIndex: true;
        section: true;
        isMainLift: true;
        exercise: {
          select: {
            name: true;
            aliases: {
              select: {
                alias: true;
              };
            };
            exerciseMuscles: {
              select: {
                role: true;
                muscle: {
                  select: {
                    name: true;
                  };
                };
              };
            };
          };
        };
        sets: {
          orderBy: {
            setIndex: "asc";
          };
          select: {
            setIndex: true;
            targetReps: true;
            targetRepMin: true;
            targetRepMax: true;
            targetRpe: true;
            targetLoad: true;
            restSeconds: true;
          };
        };
      };
    };
  };
}>;

type NormalizedSeedSlot = {
  slotId: string;
  slotIndex: number;
  intent: string;
  exercises: MesocycleExplainExerciseRow[];
};

type ComparisonSlotShape = {
  slotId: string | null;
  slotIndex: number | null;
  intent: string | null;
  exercises: Array<{
    exerciseId: string;
    role: string | null;
    setCount?: number;
  }>;
};

type SlotPlanProjectionDiagnostics = SuccessorSlotPlanProjection["diagnostics"];
type PlanningRealityDiagnostic = NonNullable<
  NonNullable<SlotPlanProjectionDiagnostics>["planningReality"]
>;
type SlotCompositionSnapshot = PlanningRealityDiagnostic["initialSlotComposition"][number];
type ProgramQualityDiagnostic = NonNullable<
  NonNullable<SlotPlanProjectionDiagnostics>["programQuality"]
>["evaluation"]["diagnostics"][number];
type DuplicateExerciseReuseDiagnostic = NonNullable<
  NonNullable<SlotPlanProjectionDiagnostics>["duplicateExerciseReuse"]
>[number];
type SlotObligationEvaluation = NonNullable<
  NonNullable<SlotPlanProjectionDiagnostics>["weeklyObligations"]
>["slotEvaluations"][number];
type CalvesFourFourCandidate = NonNullable<
  MesocycleExplainPlannerOnlyDryRun["calvesFourFourCandidate"]
>;

function countWorkoutExercises(workout: {
  warmup: unknown[];
  mainLifts: unknown[];
  accessories: unknown[];
}): number {
  return workout.warmup.length + workout.mainLifts.length + workout.accessories.length;
}

function countWorkoutSets(workout: {
  warmup: Array<{ sets: unknown[] }>;
  mainLifts: Array<{ sets: unknown[] }>;
  accessories: Array<{ sets: unknown[] }>;
}): number {
  return [...workout.warmup, ...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

function normalizeIntent(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.toLowerCase() : null;
}

function normalizeReasonCodes(reasonCodes: string[]): string[] {
  return reasonCodes
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function categorizeProgramQualityDiagnostic(
  diagnostic: Pick<ProgramQualityDiagnostic, "constraint" | "reason" | "pattern">
): MesocycleExplainProjectionDiagnosticCategory {
  if (
    diagnostic.constraint === "per_exercise_efficiency" &&
    diagnostic.reason.includes("soft_cap")
  ) {
    return "set_stacking_pressure";
  }
  if (diagnostic.constraint === "cross_slot_duplicate" || diagnostic.constraint === "redundancy") {
    return "duplicate_exercise_pressure";
  }
  if (
    diagnostic.constraint === "stimulus_diversity" ||
    diagnostic.constraint === "single_exercise_volume_share"
  ) {
    return "diversity_penalty";
  }
  if (diagnostic.constraint === "session_composition" && diagnostic.reason === "same_pattern_count_exceeded") {
    return "diversity_penalty";
  }
  if (
    diagnostic.constraint === "weekly_pattern_balance" &&
    (diagnostic.pattern === "hinge" || diagnostic.pattern === "squat")
  ) {
    return "hinge_squat_balance";
  }
  if (diagnostic.constraint === "isolation_completeness") {
    return "isolation_injection_trigger";
  }
  return "other_projection_quality";
}

function explainProjectionDiagnostic(input: {
  category: MesocycleExplainProjectionDiagnosticCategory;
  reason: string;
  constraint: string;
  source: MesocycleExplainProjectionDiagnosticRow["source"];
}): string {
  if (input.category === "set_stacking_pressure") {
    return input.reason === "soft_cap_exceeded_higher_priority_or_capacity_bound"
      ? "A set-count soft cap remained exceeded because P0 weekly obligations, slot identity, or real slot capacity took precedence over further spreading."
      : "The projection detected pressure from stacking more sets on one exercise than the soft cap prefers.";
  }
  if (input.category === "duplicate_exercise_pressure") {
    return "The projection reused or paired similar work because continuity, inventory, or slot constraints beat the duplicate-pressure penalty.";
  }
  if (input.category === "diversity_penalty") {
    return "The projection detected concentrated stimulus from one exercise or movement pattern after higher-priority coverage was satisfied.";
  }
  if (input.category === "hinge_squat_balance") {
    return "The lower-body projection favored hinge/squat coverage enough to trip the weekly movement-pattern balance readout.";
  }
  if (input.category === "isolation_injection_trigger") {
    return input.source === "program_quality_application"
      ? "A direct isolation was inserted only after projected support remained below the existing Week 1 support floor and a compatible slot had room."
      : "The projection detected a direct-isolation support deficit against the existing Week 1 support floor.";
  }
  if (input.category === "soft_cap_overridden_by_p0") {
    return "This is a read-only marker that a soft set cap yielded to P0 weekly obligation or slot-identity constraints.";
  }
  return `The projection emitted ${input.constraint} as a non-blocking program-quality diagnostic.`;
}

function mapProgramQualityDiagnostic(input: {
  diagnostic: ProgramQualityDiagnostic;
  source: "program_quality_evaluation" | "program_quality_application";
  category?: MesocycleExplainProjectionDiagnosticCategory;
}): MesocycleExplainProjectionDiagnosticRow {
  const category = input.category ?? categorizeProgramQualityDiagnostic(input.diagnostic);
  return {
    label: "projection diagnostics",
    category,
    priority: input.diagnostic.priority,
    constraint: input.diagnostic.constraint,
    reason: input.diagnostic.reason,
    ...(input.diagnostic.blockReason ? { blockReason: input.diagnostic.blockReason } : {}),
    why: explainProjectionDiagnostic({
      category,
      reason: input.diagnostic.reason,
      constraint: input.diagnostic.constraint,
      source: input.source,
    }),
    source: input.source,
    ...(input.diagnostic.slotId ? { slotId: input.diagnostic.slotId } : {}),
    ...(input.diagnostic.exerciseId ? { exerciseId: input.diagnostic.exerciseId } : {}),
    ...(input.diagnostic.name ? { exerciseName: input.diagnostic.name } : {}),
    ...(input.diagnostic.muscle ? { muscle: input.diagnostic.muscle } : {}),
    ...(input.diagnostic.pattern ? { pattern: input.diagnostic.pattern } : {}),
    penalty: input.diagnostic.penalty,
    ...(input.diagnostic.details ? { details: input.diagnostic.details } : {}),
  };
}

function mapDuplicateReuseDiagnostic(
  diagnostic: DuplicateExerciseReuseDiagnostic
): MesocycleExplainProjectionDiagnosticRow {
  return {
    label: "projection diagnostics",
    category: "duplicate_exercise_pressure",
    priority: "P4",
    constraint: "cross_slot_duplicate",
    reason: diagnostic.reason,
    why: explainProjectionDiagnostic({
      category: "duplicate_exercise_pressure",
      reason: diagnostic.reason,
      constraint: "cross_slot_duplicate",
      source: "duplicate_reuse",
    }),
    source: "duplicate_reuse",
    slotId: diagnostic.repeatedInSlotId,
    exerciseId: diagnostic.exerciseId,
    exerciseName: diagnostic.name,
    details: {
      previousSlotIds: diagnostic.previousSlotIds,
      role: diagnostic.role,
      hasCompatibleAlternative: diagnostic.hasCompatibleAlternative,
    },
  };
}

function mapWeeklyObligationDiagnostic(
  row: SlotObligationEvaluation
): MesocycleExplainProjectionDiagnosticRow {
  return {
    label: "projection diagnostics",
    category: "soft_cap_overridden_by_p0",
    priority: "P0",
    constraint: "weekly_obligation",
    reason: row.zeroContribution ? "p0_zero_contribution" : "p0_shortfall",
    why: "A hard Week 1 obligation remained visible as projection context; downstream soft constraints must yield to this slot-level obligation.",
    source: "weekly_obligation",
    slotId: row.slotId,
    muscle: row.muscle,
    details: {
      minEffectiveSets: row.minEffectiveSets,
      projectedEffectiveSets: row.projectedEffectiveSets,
      shortfall: row.shortfall,
      zeroContribution: row.zeroContribution,
    },
  };
}

function buildProjectionDiagnostics(
  diagnostics: SlotPlanProjectionDiagnostics
): MesocycleExplainProjectionDiagnostics {
  const programQuality = diagnostics?.programQuality;
  const evaluationRows =
    programQuality?.evaluation.diagnostics.map((diagnostic) =>
      mapProgramQualityDiagnostic({
        diagnostic,
        source: "program_quality_evaluation",
      })
    ) ?? [];
  const appliedRows =
    programQuality?.appliedDiagnostics.map((diagnostic) =>
      mapProgramQualityDiagnostic({
        diagnostic,
        source: "program_quality_application",
      })
    ) ?? [];
  const programDuplicateKeys = new Set(
    evaluationRows
      .filter((row) => row.constraint === "cross_slot_duplicate")
      .map((row) => `${row.slotId ?? ""}:${row.exerciseId ?? ""}`)
  );
  const duplicateRows = (diagnostics?.duplicateExerciseReuse ?? [])
    .map(mapDuplicateReuseDiagnostic)
    .filter((row) => !programDuplicateKeys.has(`${row.slotId ?? ""}:${row.exerciseId ?? ""}`));
  const weeklyObligationRows = (diagnostics?.weeklyObligations?.slotEvaluations ?? [])
    .filter((row) => row.shortfall > 0 || row.zeroContribution)
    .map(mapWeeklyObligationDiagnostic);
  const constraintsTriggered = [
    ...evaluationRows,
    ...duplicateRows,
    ...weeklyObligationRows,
  ];
  const softCapOverridesByP0 = evaluationRows
    .filter(
      (row) =>
        row.constraint === "per_exercise_efficiency" &&
        row.reason === "soft_cap_exceeded_higher_priority_or_capacity_bound"
    )
    .map((row) => ({
      ...row,
      category: "soft_cap_overridden_by_p0" as const,
      why: explainProjectionDiagnostic({
        category: "soft_cap_overridden_by_p0",
        reason: row.reason,
        constraint: row.constraint,
        source: row.source,
      }),
    }));
  const allRows = [...constraintsTriggered, ...appliedRows, ...softCapOverridesByP0];

  return {
    label: "projection diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      setStackingPressure: allRows.filter((row) => row.category === "set_stacking_pressure").length,
      duplicateExercisePressure: allRows.filter((row) => row.category === "duplicate_exercise_pressure").length,
      diversityPenalties: allRows.filter((row) => row.category === "diversity_penalty").length,
      hingeSquatBalance: allRows.filter((row) => row.category === "hinge_squat_balance").length,
      isolationInjectionTriggers: allRows.filter((row) => row.category === "isolation_injection_trigger").length,
      softCapsOverriddenByP0: softCapOverridesByP0.length,
    },
    constraintsTriggered,
    tradeoffs: appliedRows,
    softCapOverridesByP0,
    ...(diagnostics?.preselectionDemands
      ? { preselectionDemands: diagnostics.preselectionDemands }
      : {}),
    ...(diagnostics?.planningReality
      ? { planningReality: diagnostics.planningReality }
      : {}),
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value) => value.trim().length > 0))
  ).sort((left, right) => left.localeCompare(right));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumSlotStimulusByMuscle(
  slots: ReadonlyArray<SlotCompositionSnapshot>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const slot of slots) {
    for (const [muscle, value] of Object.entries(slot.projectedEffectiveStimulusByMuscle)) {
      totals.set(muscle, roundOne((totals.get(muscle) ?? 0) + value));
    }
  }
  return totals;
}

function formatSnapshotExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): string {
  return `${exercise.exerciseName} (${exercise.setCount} sets)`;
}

function getSlotById(
  slots: ReadonlyArray<SlotCompositionSnapshot>,
  slotId: string
): SlotCompositionSnapshot | undefined {
  return slots.find((slot) => slot.slotId === slotId);
}

function getSlotMuscleStimulus(
  slot: SlotCompositionSnapshot | undefined,
  muscle: string
): number {
  return roundOne(slot?.projectedEffectiveStimulusByMuscle[muscle] ?? 0);
}

function isCalfExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  return (
    exercise.primaryMuscles.includes("Calves") ||
    (exercise.effectiveStimulusByMuscle.Calves ?? 0) > 0
  );
}

function buildCalfShape(
  slot: SlotCompositionSnapshot | undefined
): CalvesFourFourCandidate["currentLowerAShape"] {
  return (slot?.exercises ?? [])
    .filter(isCalfExercise)
    .map((exercise) => ({
      exerciseName: exercise.exerciseName,
      sets: exercise.setCount,
      effectiveCalfSets: roundOne(
        exercise.effectiveStimulusByMuscle.Calves ?? 0
      ),
    }));
}

function getSlotSetBudget(
  planningReality: PlanningRealityDiagnostic,
  slotId: string
): number | null {
  return (
    planningReality.setDistributionIntents.find((intent) => intent.slotId === slotId)
      ?.slotBudget.maxTotalSets ?? null
  );
}

function getSlotPreferredSetBudget(
  planningReality: PlanningRealityDiagnostic,
  slotId: string
): number | null {
  return (
    planningReality.setDistributionIntents.find((intent) => intent.slotId === slotId)
      ?.slotBudget.preferredTotalSets ?? null
  );
}

function hasWeeksTwoToFourUnprojected(
  planningReality: PlanningRealityDiagnostic
): boolean {
  const allocationWeeks =
    planningReality.slotDemandAllocationByWeek?.weeks.filter(
      (week) => week.week >= 2 && week.week <= 4
    ) ?? [];
  const preselectionWeeks =
    planningReality.preselectionDistributionPolicyByWeek?.weeks.filter(
      (week) => week.week >= 2 && week.week <= 4
    ) ?? [];
  return [...allocationWeeks, ...preselectionWeeks].some((week) =>
    week.projectionStatus.includes("not_") ||
    week.projectionStatus.includes("missing") ||
    week.projectionStatus.includes("unprojected")
  );
}

function slotHasHamstringsHingeAndCurl(
  slot: SlotCompositionSnapshot | undefined
): boolean | null {
  if (!slot) {
    return null;
  }
  const hamstringExercises = slot.exercises.filter(
    (exercise) =>
      exercise.primaryMuscles.includes("Hamstrings") ||
      (exercise.effectiveStimulusByMuscle.Hamstrings ?? 0) > 0
  );
  const hasHinge = hamstringExercises.some((exercise) =>
    exercise.movementPatterns.some((pattern) =>
      pattern.toLowerCase().includes("hinge")
    )
  );
  const hasCurl = hamstringExercises.some((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      name.includes("curl") ||
      exercise.movementPatterns.some((pattern) => {
        const normalized = pattern.toLowerCase();
        return normalized.includes("knee_flexion") || normalized.includes("flexion");
      })
    );
  });
  return hasHinge && hasCurl;
}

function parseRepairDependencyCount(
  consequence: string,
  suffix: string
): number {
  const match = consequence.match(
    new RegExp(`repair_would_be_needed_here:(\\d+)_${suffix}`)
  );
  return match ? Number(match[1]) : 0;
}

function sumCalfDirectSets(
  shape: CalvesFourFourCandidate["currentLowerAShape"]
): number {
  return roundOne(shape.reduce((sum, row) => sum + row.sets, 0));
}

function buildProposedCalfShape(
  currentShape: CalvesFourFourCandidate["currentLowerAShape"],
  slotLabel: "lower_a" | "lower_b"
): CalvesFourFourCandidate["proposedLowerAShape"] {
  if (currentShape.length === 0) {
    return [];
  }
  return [
    {
      exerciseClass: "calf_raise",
      proposedSets: 4,
      reason:
        slotLabel === "lower_a"
          ? "lower_a_four_set_direct_calf_allocation_candidate"
          : "lower_b_single_calf_identity_four_set_candidate",
    },
  ];
}

function hasExplicitFourSetCalfAllocation(
  planningReality: PlanningRealityDiagnostic,
  slotId: "lower_a" | "lower_b"
): boolean {
  const weekOne = planningReality.slotDemandAllocationByWeek?.weeks.find(
    (week) => week.week === 1
  );
  const row = weekOne?.slots
    .find((slot) => slot.slotId === slotId)
    ?.allocatedMuscles.find((muscle) => muscle.muscle === "Calves");
  return row?.minEffectiveSets === 4 || row?.preferredEffectiveSets === 4;
}

function isLowerHardPrimaryExercise(
  exercise: SlotCompositionSnapshot["exercises"][number],
  hardPrimaryMuscles: Set<string>
): boolean {
  if (isCalfExercise(exercise)) {
    return false;
  }
  if (exercise.primaryMuscles.some((muscle) => hardPrimaryMuscles.has(muscle))) {
    return true;
  }
  return (
    exercise.role === "main" &&
    exercise.movementPatterns.some((pattern) => {
      const normalized = pattern.toLowerCase();
      return normalized.includes("squat") || normalized.includes("hinge");
    })
  );
}

function buildLowerASafety(input: {
  planningReality: PlanningRealityDiagnostic;
  lowerA: SlotCompositionSnapshot | undefined;
  currentLowerAShape: CalvesFourFourCandidate["currentLowerAShape"];
  lowerAProjectedCalfSets: number | null;
}): CalvesFourFourCandidate["lowerASafety"] {
  const currentTotalSets = input.lowerA?.totalSets ?? null;
  const currentCalfDirectSets = sumCalfDirectSets(input.currentLowerAShape);
  const projectedTotalSets =
    currentTotalSets != null && input.lowerAProjectedCalfSets != null
      ? roundOne(currentTotalSets - currentCalfDirectSets + input.lowerAProjectedCalfSets)
      : null;
  const slotSetCap = getSlotSetBudget(input.planningReality, "lower_a");
  const preferredSetBudget = getSlotPreferredSetBudget(input.planningReality, "lower_a");
  const wouldExceedSlotCap =
    projectedTotalSets == null || slotSetCap == null
      ? null
      : projectedTotalSets > slotSetCap;
  const hardPrimaryMuscles = new Set(
    input.planningReality.shadowSlotDemandAllocation
      .find((slot) => slot.slotId === "lower_a")
      ?.allocatedMuscles.filter(
        (muscle) => muscle.role === "primary" || muscle.targetStatus === "hard"
      )
      .map((muscle) => muscle.muscle) ?? []
  );
  const hardPrimaryExercises =
    input.lowerA?.exercises.filter((exercise) =>
      isLowerHardPrimaryExercise(exercise, hardPrimaryMuscles)
    ) ?? [];
  const displacedExerciseNames =
    wouldExceedSlotCap === true
      ? hardPrimaryExercises.map((exercise) => exercise.exerciseName)
      : [];
  const wouldDisplaceHardPrimary =
    wouldExceedSlotCap == null
      ? null
      : wouldExceedSlotCap && displacedExerciseNames.length > 0;
  const affectedExercises = uniqueSorted([
    ...input.currentLowerAShape.map((row) => row.exerciseName),
    ...displacedExerciseNames,
  ]);
  const evidence = [
    `lower_a_current_total_sets:${currentTotalSets ?? "unknown"}`,
    `lower_a_current_calf_direct_sets:${currentCalfDirectSets}`,
    `lower_a_projected_total_sets:${projectedTotalSets ?? "unknown"}`,
    `lower_a_preferred_total_sets:${preferredSetBudget ?? "unknown"}`,
    `lower_a_slot_set_cap:${slotSetCap ?? "unknown"}`,
    `would_exceed_slot_cap:${wouldExceedSlotCap ?? "unknown"}`,
    `would_displace_hard_primary:${wouldDisplaceHardPrimary ?? "unknown"}`,
  ];
  const status: CalvesFourFourCandidate["lowerASafety"]["status"] =
    currentTotalSets == null ||
    projectedTotalSets == null ||
    slotSetCap == null ||
    wouldExceedSlotCap == null ||
    wouldDisplaceHardPrimary == null
      ? "unknown"
      : wouldExceedSlotCap || wouldDisplaceHardPrimary
        ? "fail"
        : "pass";

  return {
    status,
    currentTotalSets,
    projectedTotalSets,
    slotSetCap,
    wouldExceedSlotCap,
    wouldDisplaceHardPrimary,
    affectedExercises,
    evidence,
  };
}

type CalvesMaterialityEstimate = CalvesFourFourCandidate["materialityEstimate"];
type CalvesMaterialityRemovableRow = CalvesMaterialityEstimate["removableRows"][number];
type CalvesMaterialityPotentialNewRow = CalvesMaterialityEstimate["potentialNewRows"][number];
type CalvesMaterialityUnknown = CalvesMaterialityEstimate["stillUnknown"][number];
type CalvesRepairRow = PlanningRealityDiagnostic["repairMateriality"][number];

function repairDeltaFromKnownRemovals(input: {
  currentCount: number;
  removableRows: number;
}): number | null {
  if (input.currentCount === 0) {
    return 0;
  }
  if (input.removableRows > 0) {
    return -Math.min(input.removableRows, input.currentCount);
  }
  return null;
}

function buildRepairRowKey(row: Pick<CalvesRepairRow, "slotId" | "muscle" | "exerciseId" | "exerciseName" | "repairMechanism" | "action">): string {
  return [
    row.slotId ?? "unknown_slot",
    row.muscle ?? "unknown_muscle",
    row.exerciseId ?? row.exerciseName ?? "unknown_exercise",
    row.repairMechanism,
    row.action,
  ].join("|");
}

function isCalvesRepairRow(row: CalvesRepairRow): boolean {
  return row.muscle === "Calves";
}

function isSupportFloorRepairRow(row: CalvesRepairRow): boolean {
  const text = `${row.repairMechanism} ${row.source} ${row.rationale}`.toLowerCase();
  return text.includes("support") || text.includes("floor");
}

function isSetBumpRepairRow(row: CalvesRepairRow): boolean {
  return row.action === "set_bumped" || row.rawSetDelta > 0;
}

function isCapTrimRepairRow(row: CalvesRepairRow): boolean {
  return row.action === "set_trimmed" || row.action === "removed" || row.rawSetDelta < 0;
}

function addRemovableRow(
  rows: CalvesMaterialityRemovableRow[],
  seen: Set<string>,
  key: string,
  row: CalvesMaterialityRemovableRow
): void {
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  rows.push(row);
}

function addPotentialNewRow(
  rows: CalvesMaterialityPotentialNewRow[],
  row: CalvesMaterialityPotentialNewRow
): void {
  if (
    rows.some(
      (existing) =>
        existing.category === row.category &&
        existing.slotId === row.slotId &&
        existing.muscle === row.muscle &&
        existing.exerciseName === row.exerciseName
    )
  ) {
    return;
  }
  rows.push(row);
}

function buildMaterialityEstimate(input: {
  planningReality: PlanningRealityDiagnostic;
  lowerASafety: CalvesFourFourCandidate["lowerASafety"];
  currentLowerBShape: CalvesFourFourCandidate["currentLowerBShape"];
  wouldRemoveLowerBSameSessionCalfDuplicate: boolean | null;
  wouldReduceSupportFloorClosureRows: boolean | null;
  wouldReduceSetBumps: boolean | null;
  wouldIncreaseCapTrimRows: boolean | null;
}): CalvesMaterialityEstimate {
  const materialRepairCount =
    input.planningReality.shadowRepairSummary?.materialRepairCount ??
    input.planningReality.summary.materialRepairCount;
  const majorRepairCount =
    input.planningReality.shadowRepairSummary?.majorRepairCount ??
    input.planningReality.summary.majorRepairCount;
  const suspiciousRepairCount =
    input.planningReality.suspiciousRepairsNotEligibleForPromotion?.length ?? 0;
  const repairRows = input.planningReality.repairMaterialityAfterShadowAllocation.length > 0
    ? input.planningReality.repairMaterialityAfterShadowAllocation
    : input.planningReality.repairMateriality;
  const calfRepairRows = repairRows.filter(isCalvesRepairRow);
  const supportFloorRows = calfRepairRows.filter(isSupportFloorRepairRow);
  const setBumpRows = calfRepairRows.filter(isSetBumpRepairRow);
  const capTrimRows = calfRepairRows.filter(isCapTrimRepairRow);
  const removableRows: CalvesMaterialityRemovableRow[] = [];
  const removableRowKeys = new Set<string>();
  const removableRepairRowKeys = new Set<string>();

  for (const row of supportFloorRows) {
    const repairKey = buildRepairRowKey(row);
    removableRepairRowKeys.add(repairKey);
    addRemovableRow(removableRows, removableRowKeys, `support|${repairKey}`, {
      category: "support_floor_closure",
      slotId: row.slotId ?? "unknown",
      muscle: row.muscle ?? "unknown",
      exerciseName: row.exerciseName,
      reason: row.rationale || row.repairMechanism,
    });
  }
  for (const row of setBumpRows) {
    const repairKey = buildRepairRowKey(row);
    removableRepairRowKeys.add(repairKey);
    addRemovableRow(removableRows, removableRowKeys, `set_bump|${repairKey}`, {
      category: "set_bump",
      slotId: row.slotId ?? "unknown",
      muscle: row.muscle ?? "unknown",
      exerciseName: row.exerciseName,
      reason: row.rationale || row.repairMechanism,
    });
  }
  for (const row of capTrimRows) {
    const repairKey = buildRepairRowKey(row);
    removableRepairRowKeys.add(repairKey);
    addRemovableRow(removableRows, removableRowKeys, `cap_trim|${repairKey}`, {
      category: "cap_trim",
      slotId: row.slotId ?? "unknown",
      muscle: row.muscle ?? "unknown",
      exerciseName: row.exerciseName,
      reason: row.rationale || row.repairMechanism,
    });
  }

  const duplicateRows =
    input.planningReality.duplicateContinuityJustification?.duplicates ?? [];
  const lowerBDuplicateRows = duplicateRows.filter(
    (row) =>
      row.duplicateType === "same_session_variant" &&
      row.duplicatedInSlots.includes("lower_b") &&
      (row.primaryMuscles.includes("Calves") ||
        (row.exerciseClass ?? "").toLowerCase().includes("calf"))
  );
  if (input.wouldRemoveLowerBSameSessionCalfDuplicate === true) {
    const duplicateNames =
      lowerBDuplicateRows.length > 0
        ? lowerBDuplicateRows.map((row) => row.exerciseName)
        : [
            input.currentLowerBShape
              .map((row) => row.exerciseName)
              .join(" + "),
          ].filter((name) => name.length > 0);
    for (const exerciseName of duplicateNames) {
      addRemovableRow(
        removableRows,
        removableRowKeys,
        `duplicate|lower_b|${exerciseName}`,
        {
          category: "duplicate_variant",
          slotId: "lower_b",
          muscle: "Calves",
          exerciseName,
          reason: "lower_b_single_calf_identity_four_set_candidate_removes_same_session_variant_duplicate",
        }
      );
    }
  }

  const materialRemovableKeys = new Set<string>();
  const majorRemovableKeys = new Set<string>();
  for (const row of calfRepairRows) {
    const repairKey = buildRepairRowKey(row);
    if (!removableRepairRowKeys.has(repairKey)) {
      continue;
    }
    if (row.materiality === "moderate" || row.materiality === "major") {
      materialRemovableKeys.add(repairKey);
      addRemovableRow(removableRows, removableRowKeys, `material|${repairKey}`, {
        category: "material_repair",
        slotId: row.slotId ?? "unknown",
        muscle: row.muscle ?? "unknown",
        exerciseName: row.exerciseName,
        reason: row.rationale || row.repairMechanism,
      });
    }
    if (row.materiality === "major") {
      majorRemovableKeys.add(repairKey);
      addRemovableRow(removableRows, removableRowKeys, `major|${repairKey}`, {
        category: "major_repair",
        slotId: row.slotId ?? "unknown",
        muscle: row.muscle ?? "unknown",
        exerciseName: row.exerciseName,
        reason: row.rationale || row.repairMechanism,
      });
    }
  }

  const suspiciousCalfRows =
    input.planningReality.suspiciousRepairsNotEligibleForPromotion?.filter(
      (row) => row.muscle === "Calves"
    ) ?? [];
  for (const row of suspiciousCalfRows) {
    addRemovableRow(
      removableRows,
      removableRowKeys,
      `suspicious|${row.slotId}|${row.muscle}|${row.exerciseName ?? "unknown"}|${row.repairMechanism}`,
      {
        category: "suspicious_repair",
        slotId: row.slotId,
        muscle: row.muscle,
        exerciseName: row.exerciseName,
        reason: row.reason,
      }
    );
  }

  const expectedMaterialRepairDelta = repairDeltaFromKnownRemovals({
    currentCount: materialRepairCount,
    removableRows: materialRemovableKeys.size,
  });
  const expectedMajorRepairDelta = repairDeltaFromKnownRemovals({
    currentCount: majorRepairCount,
    removableRows: majorRemovableKeys.size,
  });
  const expectedSuspiciousRepairDelta = repairDeltaFromKnownRemovals({
    currentCount: suspiciousRepairCount,
    removableRows: suspiciousCalfRows.length,
  });
  const potentialNewRows: CalvesMaterialityPotentialNewRow[] = [];
  if (input.wouldIncreaseCapTrimRows !== false) {
    addPotentialNewRow(potentialNewRows, {
      category: "cap_trim",
      slotId: "lower_a/lower_b",
      muscle: "Calves",
      exerciseName: null,
      risk: input.wouldIncreaseCapTrimRows === true ? "high" : "unknown",
      reason:
        input.wouldIncreaseCapTrimRows === true
          ? "simulated calf sets exceed a known lower-slot cap"
          : "lower-slot cap trim risk cannot be resolved from available slot budgets",
    });
  }
  if (input.lowerASafety.wouldDisplaceHardPrimary !== false) {
    addPotentialNewRow(potentialNewRows, {
      category: "hard_primary_regression",
      slotId: "lower_a",
      muscle: "hard_primary",
      exerciseName: input.lowerASafety.affectedExercises[0] ?? null,
      risk: input.lowerASafety.wouldDisplaceHardPrimary === true ? "high" : "unknown",
      reason:
        input.lowerASafety.wouldDisplaceHardPrimary === true
          ? "simulated Lower A calf sets would exceed cap and displace a hard primary exercise"
          : "Lower A hard-primary displacement cannot be fully classified from available safety evidence",
    });
  }

  const weeksTwoToFourUnprojected = hasWeeksTwoToFourUnprojected(input.planningReality);
  const fullRepairReclassificationRequired =
    (materialRepairCount > 0 && materialRemovableKeys.size < materialRepairCount) ||
    (majorRepairCount > 0 && majorRemovableKeys.size < majorRepairCount) ||
    (suspiciousRepairCount > 0 && suspiciousCalfRows.length < suspiciousRepairCount) ||
    potentialNewRows.some((row) => row.risk === "unknown");
  const stillUnknown = new Set<CalvesMaterialityUnknown>();
  if (fullRepairReclassificationRequired) {
    stillUnknown.add("exact_repair_reclassification_requires_full_generation");
  }
  if (weeksTwoToFourUnprojected) {
    stillUnknown.add("weeks_2_to_4_unprojected");
    stillUnknown.add("cross_week_progression_unknown");
  }
  if (
    input.planningReality.accumulationWeekProjection?.crossWeekWarnings?.some(
      (warning) =>
        warning.code === "DELOAD_PRESERVATION_STILL_UNPROJECTED"
    ) ||
    input.planningReality.slotDemandAllocationByWeek?.crossWeekAllocationWarnings?.some(
      (warning) => warning.code === "DELOAD_SLOT_ALLOCATION_UNPROJECTED"
    )
  ) {
    stillUnknown.add("deload_preservation_unknown");
  }

  const hasPositiveDelta =
    (expectedMaterialRepairDelta ?? 0) > 0 ||
    (expectedMajorRepairDelta ?? 0) > 0 ||
    (expectedSuspiciousRepairDelta ?? 0) > 0;
  const hasUnknownDelta =
    expectedMaterialRepairDelta == null ||
    expectedMajorRepairDelta == null ||
    expectedSuspiciousRepairDelta == null;
  const hasReducingEvidence =
    input.wouldReduceSupportFloorClosureRows === true ||
    input.wouldReduceSetBumps === true ||
    input.wouldRemoveLowerBSameSessionCalfDuplicate === true ||
    (expectedMaterialRepairDelta != null && expectedMaterialRepairDelta < 0) ||
    (expectedMajorRepairDelta != null && expectedMajorRepairDelta < 0);
  const wouldWorsen =
    input.wouldIncreaseCapTrimRows === true ||
    input.lowerASafety.wouldDisplaceHardPrimary === true ||
    hasPositiveDelta;
  const hasExactRepairUnknown = stillUnknown.has(
    "exact_repair_reclassification_requires_full_generation"
  );
  const status: CalvesMaterialityEstimate["status"] =
    wouldWorsen
      ? "worsens"
      : hasExactRepairUnknown && hasReducingEvidence
        ? "partial"
        : hasUnknownDelta
        ? "unknown"
        : hasReducingEvidence
          ? "improves"
          : "flat";
  const evidence = [
    `current_materialRepairCount:${materialRepairCount}`,
    `current_majorRepairCount:${majorRepairCount}`,
    `current_suspiciousRepairCount:${suspiciousRepairCount}`,
    `removable_calf_repair_rows:${removableRepairRowKeys.size}`,
    `removable_material_repair_rows:${materialRemovableKeys.size}`,
    `removable_major_repair_rows:${majorRemovableKeys.size}`,
    `removable_suspicious_repair_rows:${suspiciousCalfRows.length}`,
    `would_remove_lower_b_duplicate:${input.wouldRemoveLowerBSameSessionCalfDuplicate ?? "unknown"}`,
    `would_reduce_support_floor_closure_rows:${input.wouldReduceSupportFloorClosureRows ?? "unknown"}`,
    `would_reduce_set_bumps:${input.wouldReduceSetBumps ?? "unknown"}`,
    `would_increase_cap_trim_rows:${input.wouldIncreaseCapTrimRows ?? "unknown"}`,
    ...(hasUnknownDelta
      ? ["exact_repair_counter_delta_unknown_without_reprojection"]
      : []),
  ];

  return {
    status,
    expectedMaterialRepairDelta,
    expectedMajorRepairDelta,
    expectedSuspiciousRepairDelta,
    wouldReduceSupportFloorClosureRows: input.wouldReduceSupportFloorClosureRows,
    wouldReduceSetBumps: input.wouldReduceSetBumps,
    wouldIncreaseCapTrimRows: input.wouldIncreaseCapTrimRows,
    removableRows: removableRows.slice(0, 12),
    potentialNewRows: potentialNewRows.slice(0, 8),
    stillUnknown: Array.from(stillUnknown).sort((left, right) =>
      left.localeCompare(right)
    ),
    evidence,
  };
}

function buildCalvesFourFourCandidate(input: {
  planningReality: PlanningRealityDiagnostic;
  overridePlanningReality?: PlanningRealityDiagnostic;
  projectionComparisons?: NonNullable<
    MesocycleExplainPlannerOnlyDryRun["projectionComparisons"]
  >;
  slotComparisons: MesocycleExplainPlannerOnlyDryRun["slotComparisons"];
  repairDependencies: MesocycleExplainPlannerOnlyDryRun["repairDependencies"];
}): CalvesFourFourCandidate {
  const lowerA = getSlotById(input.planningReality.initialSlotComposition, "lower_a");
  const lowerB = getSlotById(input.planningReality.initialSlotComposition, "lower_b");
  const overrideLowerA = input.overridePlanningReality
    ? getSlotById(input.overridePlanningReality.initialSlotComposition, "lower_a")
    : undefined;
  const overrideLowerB = input.overridePlanningReality
    ? getSlotById(input.overridePlanningReality.initialSlotComposition, "lower_b")
    : undefined;
  const currentLowerAShape = buildCalfShape(lowerA);
  const currentLowerBShape = buildCalfShape(lowerB);
  const overrideLowerBShape = buildCalfShape(overrideLowerB);
  const proposedLowerAShape = buildProposedCalfShape(currentLowerAShape, "lower_a");
  const proposedLowerBShape = buildProposedCalfShape(currentLowerBShape, "lower_b");
  const lowerAProjectedCalfSets =
    overrideLowerA
      ? getSlotMuscleStimulus(overrideLowerA, "Calves")
      : proposedLowerAShape.length > 0
        ? proposedLowerAShape[0].proposedSets
        : null;
  const lowerBProjectedCalfSets =
    overrideLowerB
      ? getSlotMuscleStimulus(overrideLowerB, "Calves")
      : proposedLowerBShape.length > 0
        ? proposedLowerBShape[0].proposedSets
        : null;
  const weeklyProjectedCalfEffectiveSets =
    lowerAProjectedCalfSets != null && lowerBProjectedCalfSets != null
      ? roundOne(lowerAProjectedCalfSets + lowerBProjectedCalfSets)
      : null;
  const currentLowerAEffective = roundOne(
    currentLowerAShape.reduce((sum, row) => sum + row.effectiveCalfSets, 0)
  );
  const currentLowerBEffective = roundOne(
    currentLowerBShape.reduce((sum, row) => sum + row.effectiveCalfSets, 0)
  );
  const currentWeeklyEffective = roundOne(currentLowerAEffective + currentLowerBEffective);
  const lowerACalfUnresolved =
    input.slotComparisons
      .find((slot) => slot.slotId === "lower_a")
      ?.unresolvedDemand.some(
        (row) =>
          row.includes("Calves") && row.includes("repair_would_be_needed_here")
      ) ?? false;
  const lowerBDuplicate =
    currentLowerBShape.length > 1 ||
    (input.slotComparisons
      .find((slot) => slot.slotId === "lower_b")
      ?.duplicateViolations.some((row) => row.includes("Calf")) ?? false);
  const lowerASetDelta =
    lowerAProjectedCalfSets == null ? null : lowerAProjectedCalfSets - currentLowerAEffective;
  const lowerBSetDelta =
    lowerBProjectedCalfSets == null ? null : lowerBProjectedCalfSets - currentLowerBEffective;
  const lowerACap = getSlotSetBudget(input.planningReality, "lower_a");
  const lowerBCap = getSlotSetBudget(input.planningReality, "lower_b");
  const lowerATotalAfter =
    lowerA && lowerASetDelta != null ? roundOne(lowerA.totalSets + lowerASetDelta) : null;
  const lowerBTotalAfter =
    lowerB && lowerBSetDelta != null ? roundOne(lowerB.totalSets + lowerBSetDelta) : null;
  let wouldIncreaseCapTrimRows =
    lowerATotalAfter == null || lowerBTotalAfter == null
      ? null
      : lowerACap == null || lowerBCap == null
        ? null
        : lowerATotalAfter > lowerACap || lowerBTotalAfter > lowerBCap;
  const repairedLowerB =
    overrideLowerB ?? getSlotById(input.planningReality.finalSlotPlan, "lower_b") ?? lowerB;
  const preservesLowerBHingeCurlRoute = slotHasHamstringsHingeAndCurl(repairedLowerB);
  const supportRows = input.repairDependencies.find(
    (dependency) => dependency.path === "support-floor closure"
  );
  const setBumpRows = input.repairDependencies.find(
    (dependency) => dependency.path === "set bumping"
  );
  const supportFloorClosureCount = supportRows
    ? parseRepairDependencyCount(supportRows.consequenceWithoutRepair, "support_rows")
    : 0;
  const setBumpCount = setBumpRows
    ? parseRepairDependencyCount(setBumpRows.consequenceWithoutRepair, "set_bumps")
    : 0;
  const wouldReduceSupportFloorClosureRows =
    input.projectionComparisons
      ? input.projectionComparisons.deltas.overrideVsBaselineRepaired
          .supportFloorClosureRowCount < 0
      : weeklyProjectedCalfEffectiveSets == null
      ? null
      : lowerACalfUnresolved || supportFloorClosureCount > 0
        ? (lowerACalfUnresolved &&
            lowerAProjectedCalfSets != null &&
            lowerAProjectedCalfSets > currentLowerAEffective) ||
          weeklyProjectedCalfEffectiveSets >= 8
        : false;
  const wouldReduceSetBumps =
    input.projectionComparisons
      ? input.projectionComparisons.deltas.overrideVsBaselineRepaired
          .setBumpRowCount < 0
      : weeklyProjectedCalfEffectiveSets == null
      ? null
      : setBumpCount > 0
        ? weeklyProjectedCalfEffectiveSets <= currentWeeklyEffective
        : false;
  const wouldRemoveLowerBSameSessionCalfDuplicate =
    currentLowerBShape.length === 0
      ? null
      : input.overridePlanningReality
        ? lowerBDuplicate && overrideLowerBShape.length <= 1
        : lowerBDuplicate;
  const lowerASafety = buildLowerASafety({
    planningReality: input.planningReality,
    lowerA,
    currentLowerAShape,
    lowerAProjectedCalfSets,
  });
  const materialityEstimate = buildMaterialityEstimate({
    planningReality: input.planningReality,
    lowerASafety,
    currentLowerBShape,
    wouldRemoveLowerBSameSessionCalfDuplicate,
    wouldReduceSupportFloorClosureRows,
    wouldReduceSetBumps,
    wouldIncreaseCapTrimRows,
  });
  if (input.projectionComparisons) {
    const delta = input.projectionComparisons.deltas.overrideVsBaselineRepaired;
    const stillUnknown = materialityEstimate.stillUnknown.filter(
      (entry) => entry !== "exact_repair_reclassification_requires_full_generation"
    );
    const hasWorseningDelta =
      delta.materialRepairCount > 0 ||
      delta.majorRepairCount > 0 ||
      delta.suspiciousRepairCount > 0 ||
      delta.highExerciseConcentrationCount > 0 ||
      delta.weakPreselectionConsumptionCount > 0 ||
      delta.forbiddenFinalPrimaryViolationCount > 0 ||
      delta.capTrimRowCount > 0;
    const hasImprovingDelta =
      delta.materialRepairCount < 0 ||
      delta.majorRepairCount < 0 ||
      delta.suspiciousRepairCount < 0 ||
      delta.supportFloorClosureRowCount < 0 ||
      delta.setBumpRowCount < 0 ||
      delta.duplicateRowCount < 0;
    materialityEstimate.status = hasWorseningDelta
      ? "worsens"
      : hasImprovingDelta
        ? "improves"
        : "flat";
    materialityEstimate.expectedMaterialRepairDelta =
      delta.materialRepairCount;
    materialityEstimate.expectedMajorRepairDelta = delta.majorRepairCount;
    materialityEstimate.expectedSuspiciousRepairDelta =
      delta.suspiciousRepairCount;
    materialityEstimate.wouldReduceSupportFloorClosureRows =
      delta.supportFloorClosureRowCount < 0;
    materialityEstimate.wouldReduceSetBumps = delta.setBumpRowCount < 0;
    materialityEstimate.wouldIncreaseCapTrimRows = delta.capTrimRowCount > 0;
    wouldIncreaseCapTrimRows = delta.capTrimRowCount > 0;
    materialityEstimate.stillUnknown = stillUnknown;
    materialityEstimate.evidence = uniqueSorted([
      ...materialityEstimate.evidence.filter(
        (row) => row !== "exact_repair_counter_delta_unknown_without_reprojection"
      ),
      `actual_materialRepairCount_delta:${delta.materialRepairCount}`,
      `actual_majorRepairCount_delta:${delta.majorRepairCount}`,
      `actual_suspiciousRepairCount_delta:${delta.suspiciousRepairCount}`,
      `actual_highExerciseConcentrationCount_delta:${delta.highExerciseConcentrationCount}`,
      `actual_weakPreselectionConsumptionCount_delta:${delta.weakPreselectionConsumptionCount}`,
      `actual_forbiddenFinalPrimaryViolationCount_delta:${delta.forbiddenFinalPrimaryViolationCount}`,
      `actual_capTrimRowCount_delta:${delta.capTrimRowCount}`,
    ]);
  }
  const weeksTwoToFourUnprojected = hasWeeksTwoToFourUnprojected(input.planningReality);
  const blockedReasons = new Set<CalvesFourFourCandidate["blockedReasons"][number]>();

  if (weeksTwoToFourUnprojected) {
    blockedReasons.add("weeks_2_to_4_unprojected");
  }
  if (
    lowerAProjectedCalfSets == null ||
    lowerBProjectedCalfSets == null ||
    weeklyProjectedCalfEffectiveSets == null
  ) {
    blockedReasons.add("insufficient_candidate_evidence");
  }
  if (lowerASetDelta != null && Math.abs(lowerASetDelta) > 0.1) {
    if (
      lowerASafety.status !== "pass" &&
      !hasExplicitFourSetCalfAllocation(input.planningReality, "lower_a")
    ) {
      blockedReasons.add("would_mutate_lower_a_without_policy");
    }
  }
  if (lowerAProjectedCalfSets != null && lowerAProjectedCalfSets > 4) {
    blockedReasons.add("requires_specialization_cap_override");
  }
  if (lowerBProjectedCalfSets != null && lowerBProjectedCalfSets > 4) {
    blockedReasons.add("requires_specialization_cap_override");
  }
  if (preservesLowerBHingeCurlRoute !== true) {
    blockedReasons.add("would_risk_lower_b_hamstrings_route");
  }
  if (wouldIncreaseCapTrimRows == null) {
    blockedReasons.add("cap_trim_risk_unknown");
  }
  if (materialityEstimate.status === "unknown" || materialityEstimate.status === "partial") {
    blockedReasons.add("materiality_delta_unknown");
  }

  const calfDemandDecreases =
    lowerACalfUnresolved &&
    lowerAProjectedCalfSets != null &&
    lowerAProjectedCalfSets > currentLowerAEffective;
  const duplicateBecomesAvoidable = lowerBDuplicate && currentLowerBShape.length > 1;
  const expectedDeltasNonPositive =
    materialityEstimate.expectedMaterialRepairDelta != null &&
    materialityEstimate.expectedMajorRepairDelta != null &&
    materialityEstimate.expectedSuspiciousRepairDelta != null &&
    materialityEstimate.expectedMaterialRepairDelta <= 0 &&
    materialityEstimate.expectedMajorRepairDelta <= 0 &&
    materialityEstimate.expectedSuspiciousRepairDelta <= 0;
  const weekOneShapeSafe =
    lowerASafety.status === "pass" &&
    (materialityEstimate.status === "improves" || materialityEstimate.status === "flat") &&
    expectedDeltasNonPositive &&
    wouldRemoveLowerBSameSessionCalfDuplicate === true &&
    weeklyProjectedCalfEffectiveSets != null &&
    weeklyProjectedCalfEffectiveSets >= 8 &&
    preservesLowerBHingeCurlRoute === true &&
    lowerASafety.wouldDisplaceHardPrimary === false;
  const overrideSnapshot =
    input.projectionComparisons?.plannerOnlyWithOverride;
  const baselineSnapshot =
    input.projectionComparisons?.baselineRepaired;
  const hardPrimaryTargetsMet =
    !overrideSnapshot ||
    input.planningReality.shadowWeeklyDemand
      .filter((row) => row.priority === "primary")
      .every((row) => {
        const minimum = row.minEffectiveSets ?? row.preferredEffectiveSets;
        if (minimum == null) {
          return true;
        }
        return (overrideSnapshot.weeklyMuscleTotals[row.muscle] ?? 0) >= minimum;
      });
  const overrideMetricsSafe =
    !overrideSnapshot ||
    !baselineSnapshot ||
    (overrideSnapshot.materialRepairCount <= baselineSnapshot.materialRepairCount &&
      overrideSnapshot.majorRepairCount <= baselineSnapshot.majorRepairCount &&
      overrideSnapshot.suspiciousRepairCount <= baselineSnapshot.suspiciousRepairCount &&
      overrideSnapshot.highExerciseConcentrationCount <=
        baselineSnapshot.highExerciseConcentrationCount &&
      overrideSnapshot.weakPreselectionConsumptionCount === 0 &&
      overrideSnapshot.forbiddenFinalPrimaryViolationCount === 0 &&
      overrideSnapshot.keyAcceptance.fail <= baselineSnapshot.keyAcceptance.fail &&
      hardPrimaryTargetsMet);
  const gatePasses =
    calfDemandDecreases &&
    duplicateBecomesAvoidable &&
    weekOneShapeSafe &&
    overrideMetricsSafe &&
    wouldReduceSupportFloorClosureRows === true &&
    wouldReduceSetBumps !== null &&
    wouldIncreaseCapTrimRows === false &&
    blockedReasons.size === 0;
  const status: CalvesFourFourCandidate["status"] =
    gatePasses
      ? "pass"
      : blockedReasons.size > 0
        ? "blocked"
        : !calfDemandDecreases || !duplicateBecomesAvoidable
          ? "fail"
          : "ambiguous";
  const hardDoNotTrial =
    blockedReasons.has("requires_specialization_cap_override") ||
    blockedReasons.has("would_risk_lower_b_hamstrings_route");
  const recommendation: CalvesFourFourCandidate["recommendation"] =
    gatePasses
      ? "safe_to_trial_behavior"
      : hardDoNotTrial
        ? "do_not_trial_behavior"
        : "needs_more_projection";
  const policyRemainingBlockers = Array.from(blockedReasons).sort((left, right) =>
    left.localeCompare(right)
  );
  const behaviorReadiness: CalvesFourFourCandidate["policyReadiness"]["behaviorReadiness"] =
    lowerASafety.status !== "pass"
      ? "blocked_by_lower_a_safety"
      : materialityEstimate.status === "worsens"
        ? "blocked_by_materiality_risk"
        : materialityEstimate.status === "unknown" || materialityEstimate.status === "partial"
          ? "needs_more_projection"
          : weekOneShapeSafe && !weeksTwoToFourUnprojected
            ? "safe_to_trial_behavior"
            : "needs_more_projection";

  return {
    status,
    readOnly: true,
    affectsScoringOrGeneration: false,
    lowerAProjectedCalfSets,
    lowerBProjectedCalfSets,
    weeklyProjectedCalfEffectiveSets,
    currentLowerAShape,
    currentLowerBShape,
    proposedLowerAShape,
    proposedLowerBShape,
    wouldRemoveLowerBSameSessionCalfDuplicate,
    wouldReduceSupportFloorClosureRows,
    wouldReduceSetBumps,
    wouldIncreaseCapTrimRows,
    wouldChangeMaterialRepairCount:
      materialityEstimate.expectedMaterialRepairDelta == null
        ? "unknown"
        : materialityEstimate.expectedMaterialRepairDelta < 0
          ? "decrease"
          : materialityEstimate.expectedMaterialRepairDelta > 0
            ? "increase"
            : "flat",
    wouldChangeMajorRepairCount:
      materialityEstimate.expectedMajorRepairDelta == null
        ? "unknown"
        : materialityEstimate.expectedMajorRepairDelta < 0
          ? "decrease"
          : materialityEstimate.expectedMajorRepairDelta > 0
            ? "increase"
            : "flat",
    wouldChangeSuspiciousRepairCount:
      materialityEstimate.expectedSuspiciousRepairDelta == null
        ? "unknown"
        : materialityEstimate.expectedSuspiciousRepairDelta < 0
          ? "decrease"
          : materialityEstimate.expectedSuspiciousRepairDelta > 0
            ? "increase"
            : "flat",
    preservesLowerBHingeCurlRoute,
    lowerASafety,
    materialityEstimate,
    policyReadiness: {
      behaviorReadiness,
      remainingBlockers: policyRemainingBlockers,
    },
    blockedReasons: policyRemainingBlockers,
    recommendation,
  };
}

function buildPlannerOnlyWeeklyMuscleComparison(
  planningReality: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyDryRun["weeklyMuscleComparison"] {
  const repairedTotals = sumSlotStimulusByMuscle(planningReality.finalSlotPlan);
  const plannerTotals = sumSlotStimulusByMuscle(planningReality.initialSlotComposition);
  const targetByMuscle = new Map(
    planningReality.shadowWeeklyDemand.map((row) => [row.muscle, row])
  );
  const fallbackTargetByMuscle = new Map(
    planningReality.weeklyMuscleDemand.map((row) => [row.muscle, row])
  );
  const muscles = uniqueSorted([
    ...Array.from(repairedTotals.keys()),
    ...Array.from(plannerTotals.keys()),
    ...Array.from(targetByMuscle.keys()),
    ...Array.from(fallbackTargetByMuscle.keys()),
  ]);

  return muscles.map((muscle) => {
    const repairedEffectiveSets = repairedTotals.get(muscle) ?? null;
    const plannerOnlyEffectiveSets = plannerTotals.get(muscle) ?? null;
    const target = targetByMuscle.get(muscle);
    const fallback = fallbackTargetByMuscle.get(muscle);
    const min = target?.minEffectiveSets ?? fallback?.mev ?? null;
    const preferred = target?.preferredEffectiveSets ?? fallback?.preferredTarget ?? null;
    const max = target?.maxEffectiveSets ?? fallback?.mav ?? null;
    const targetStatus =
      plannerOnlyEffectiveSets == null || (min == null && max == null)
        ? "unknown"
        : min != null && plannerOnlyEffectiveSets < min
          ? "below"
          : max != null && plannerOnlyEffectiveSets > max
            ? "above"
            : "within";

    return {
      muscle,
      repairedEffectiveSets,
      plannerOnlyEffectiveSets,
      targetStatus,
      evidence: uniqueSorted([
        `planner:${plannerOnlyEffectiveSets ?? "unknown"}`,
        `repaired:${repairedEffectiveSets ?? "unknown"}`,
        `min:${min ?? "unknown"}`,
        `preferred:${preferred ?? "unknown"}`,
        `max:${max ?? "unknown"}`,
      ]),
    };
  });
}

function buildPlannerOnlyDuplicateViolations(
  planningReality: PlanningRealityDiagnostic,
  slotId: string
): string[] {
  const duplicateRows =
    planningReality.duplicateContinuityJustification?.duplicates ?? [];
  return duplicateRows
    .filter((row) => row.duplicatedInSlots.includes(slotId))
    .filter(
      (row) =>
        row.justification === "unjustified" ||
        row.justification === "unknown" ||
        row.compatibleAlternativeExists === true ||
        row.risk === "high"
    )
    .map(
      (row) =>
        `${row.exerciseName}: duplicate_${row.duplicateType}:justification_${row.justification}:risk_${row.risk}`
    );
}

function buildPlannerOnlySetDistributionViolations(
  planningReality: PlanningRealityDiagnostic,
  slot: SlotCompositionSnapshot | undefined
): string[] {
  if (!slot) {
    return [];
  }
  const policies = planningReality.setDistributionIntents.filter(
    (intent) => intent.slotId === slot.slotId
  );
  const policyByMuscle = new Map(
    policies.flatMap((intent) =>
      intent.musclePolicies.map((policy) => [
        `${intent.slotId}:${policy.muscle}`,
        policy,
      ] as const)
    )
  );
  const totals = sumSlotStimulusByMuscle([slot]);
  const violations: string[] = [];

  for (const exercise of slot.exercises) {
    if (exercise.setCount > 5) {
      violations.push(`${exercise.exerciseName}:set_count_gt_5:${exercise.setCount}`);
    }
    for (const [muscle, value] of Object.entries(exercise.effectiveStimulusByMuscle)) {
      const total = totals.get(muscle) ?? 0;
      if (total <= 0 || value <= 0) {
        continue;
      }
      const policy = policyByMuscle.get(`${slot.slotId}:${muscle}`);
      const share = value / total;
      if (policy?.maxSingleExerciseShare != null && share > policy.maxSingleExerciseShare) {
        violations.push(
          `${exercise.exerciseName}:${muscle}:single_exercise_share_${roundOne(share * 100)}%_gt_${roundOne(policy.maxSingleExerciseShare * 100)}%`
        );
      } else if (share > 0.6) {
        violations.push(
          `${exercise.exerciseName}:${muscle}:single_exercise_share_${roundOne(share * 100)}%`
        );
      }
    }
  }

  for (const intent of policies) {
    violations.push(...intent.evidence.concentrationRows);
    violations.push(...intent.evidence.capCleanupRows);
  }

  return uniqueSorted(violations);
}

function buildPlannerOnlySlotComparisons(
  planningReality: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyDryRun["slotComparisons"] {
  const slotIds = uniqueSorted([
    ...planningReality.finalSlotPlan.map((slot) => slot.slotId),
    ...planningReality.initialSlotComposition.map((slot) => slot.slotId),
    ...planningReality.shadowSlotDemandAllocation.map((slot) => slot.slotId),
  ]);
  const allocationDeltaBySlot = new Map(
    planningReality.allocationVsInitialDelta.map((delta) => [delta.slotId, delta])
  );
  const unresolvedCausesBySlot = new Map<string, string[]>();
  for (const row of planningReality.exerciseClassUnresolvedCauses ?? []) {
    if (
      row.initialAlignment !== "missing" &&
      row.initialAlignment !== "partial" &&
      row.initialAlignment !== "violated"
    ) {
      continue;
    }
    const existing = unresolvedCausesBySlot.get(row.slotId) ?? [];
    existing.push(
      `${row.muscle}:${row.initialAlignment}:${row.recommendedOwner}:${row.behaviorReadiness}`
    );
    unresolvedCausesBySlot.set(row.slotId, existing);
  }

  return slotIds.map((slotId) => {
    const repaired = getSlotById(planningReality.finalSlotPlan, slotId);
    const plannerOnly = getSlotById(planningReality.initialSlotComposition, slotId);
    const allocationDelta = allocationDeltaBySlot.get(slotId);
    const unresolvedDemand = uniqueSorted([
      ...(allocationDelta?.underAllocatedMuscles ?? []).map((row) => {
        const shortfall =
          row.shortfall == null ? "unknown" : roundOne(row.shortfall);
        return `repair_would_be_needed_here:${row.muscle}:shortfall_${shortfall}`;
      }),
      ...(unresolvedCausesBySlot.get(slotId) ?? []),
    ]);
    const duplicateViolations = uniqueSorted(
      buildPlannerOnlyDuplicateViolations(planningReality, slotId)
    );
    const setDistributionViolations = buildPlannerOnlySetDistributionViolations(
      planningReality,
      plannerOnly
    );
    const laneStatus =
      duplicateViolations.length > 0 || setDistributionViolations.length > 0
        ? "failed"
        : unresolvedDemand.length === 0
          ? "matched"
          : plannerOnly && plannerOnly.exercises.length > 0
            ? "partial"
            : "missing";

    return {
      slotId,
      repairedExercises: repaired?.exercises.map(formatSnapshotExercise) ?? [],
      plannerOnlyExercises: plannerOnly?.exercises.map(formatSnapshotExercise) ?? [],
      laneStatus,
      unresolvedDemand,
      duplicateViolations,
      setDistributionViolations,
    };
  });
}

function statusFromBoolean(
  passed: boolean,
  partial = false
): "pass" | "fail" | "partial" {
  return passed ? "pass" : partial ? "partial" : "fail";
}

function buildPlannerOnlyAcceptanceChecks(
  planningReality: PlanningRealityDiagnostic,
  weeklyMuscleComparison: MesocycleExplainPlannerOnlyDryRun["weeklyMuscleComparison"]
): MesocycleExplainPlannerOnlyDryRun["acceptanceChecks"] {
  const plannerSlots = planningReality.initialSlotComposition;
  const plannerExercises = plannerSlots.flatMap((slot) =>
    slot.exercises.map((exercise) => ({ slot, exercise }))
  );
  const primaryRows = planningReality.shadowWeeklyDemand.filter(
    (row) => row.priority === "primary"
  );
  const primaryBelowMinimum = primaryRows.filter((row) => {
    const total =
      weeklyMuscleComparison.find((muscle) => muscle.muscle === row.muscle)
        ?.plannerOnlyEffectiveSets ?? 0;
    return row.minEffectiveSets != null && total < row.minEffectiveSets;
  });
  const chestUpperExposures = plannerSlots.filter(
    (slot) =>
      slot.intent.toLowerCase() === "upper" &&
      getSlotMuscleStimulus(slot, "Chest") > 0
  );
  const hamstringExercises = plannerExercises.filter(
    ({ exercise }) =>
      (exercise.effectiveStimulusByMuscle["Hamstrings"] ?? 0) > 0 ||
      exercise.primaryMuscles.includes("Hamstrings")
  );
  const hasHamstringHinge = hamstringExercises.some(({ exercise }) =>
    exercise.movementPatterns.some((pattern) => pattern.toLowerCase().includes("hinge"))
  );
  const hasHamstringCurl = hamstringExercises.some(({ exercise }) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      name.includes("curl") ||
      exercise.movementPatterns.some((pattern) => {
        const normalized = pattern.toLowerCase();
        return normalized.includes("knee_flexion") || normalized.includes("flexion");
      })
    );
  });
  const sideDeltDirect = plannerExercises.filter(({ exercise }) =>
    exercise.primaryMuscles.includes("Side Delts")
  );
  const lowerSlots = plannerSlots.filter((slot) => slot.intent.toLowerCase() === "lower");
  const calfLowerSlots = lowerSlots.filter((slot) => getSlotMuscleStimulus(slot, "Calves") > 0);
  const forbiddenBySlot = new Map<string, Set<string>>();
  for (const intent of planningReality.slotPrescriptionIntents) {
    for (const prescription of intent.musclePrescriptions) {
      if (
        prescription.targetStatus !== "forbidden" &&
        prescription.demandType !== "do_not_train_here"
      ) {
        continue;
      }
      const set = forbiddenBySlot.get(intent.slotId) ?? new Set<string>();
      set.add(prescription.muscle);
      forbiddenBySlot.set(intent.slotId, set);
    }
  }
  const forbiddenPrimary = plannerExercises.filter(({ slot, exercise }) =>
    exercise.primaryMuscles.some((muscle) => forbiddenBySlot.get(slot.slotId)?.has(muscle))
  );
  const backExtensionHamstrings = plannerExercises.filter(
    ({ exercise }) =>
      exercise.exerciseName.toLowerCase().includes("back extension") &&
      (exercise.effectiveStimulusByMuscle["Hamstrings"] ?? 0) > 0
  );
  const duplicateRows =
    planningReality.duplicateContinuityJustification?.duplicates ?? [];
  const unjustifiedDuplicates = duplicateRows.filter(
    (row) =>
      row.justification === "unjustified" ||
      row.justification === "unknown" ||
      row.compatibleAlternativeExists === true ||
      row.risk === "high"
  );
  const overFiveSetExercises = plannerExercises.filter(
    ({ exercise }) => exercise.setCount > 5
  );
  const weeklyTotals = sumSlotStimulusByMuscle(plannerSlots);
  const highShareExercises = plannerExercises.flatMap(({ slot, exercise }) =>
    Object.entries(exercise.effectiveStimulusByMuscle).flatMap(([muscle, value]) => {
      const total = weeklyTotals.get(muscle) ?? 0;
      if (total <= 0 || value <= 0) {
        return [];
      }
      const share = value / total;
      return share > 0.6
        ? [`${slot.slotId}:${exercise.exerciseName}:${muscle}:${roundOne(share * 100)}%`]
        : [];
    })
  );
  const moderateShareExercises = plannerExercises.flatMap(({ slot, exercise }) =>
    Object.entries(exercise.effectiveStimulusByMuscle).flatMap(([muscle, value]) => {
      const total = weeklyTotals.get(muscle) ?? 0;
      if (total <= 0 || value <= 0) {
        return [];
      }
      const share = value / total;
      return share > 0.5 && share <= 0.6
        ? [`${slot.slotId}:${exercise.exerciseName}:${muscle}:${roundOne(share * 100)}%`]
        : [];
    })
  );
  const materialRepairCount =
    planningReality.shadowRepairSummary?.materialRepairCount ??
    planningReality.summary.materialRepairCount;
  const majorRepairCount =
    planningReality.shadowRepairSummary?.majorRepairCount ??
    planningReality.summary.majorRepairCount;
  const suspiciousRepairCount =
    planningReality.suspiciousRepairsNotEligibleForPromotion?.length ?? 0;
  const missingSeedFields = plannerExercises.filter(
    ({ slot, exercise }) =>
      !slot.slotId ||
      !exercise.exerciseId ||
      !Number.isFinite(exercise.setCount) ||
      exercise.setCount <= 0
  );

  return [
    {
      check: "primary muscles above minimum",
      status: statusFromBoolean(primaryBelowMinimum.length === 0),
      evidence:
        primaryBelowMinimum.length === 0
          ? ["all primary planner-only totals meet visible minimums"]
          : primaryBelowMinimum.map(
              (row) => `${row.muscle}:below_min_${row.minEffectiveSets ?? "unknown"}`
            ),
    },
    {
      check: "Chest has two upper-slot exposures",
      status: statusFromBoolean(chestUpperExposures.length >= 2, chestUpperExposures.length === 1),
      evidence: [`upper_chest_exposures:${chestUpperExposures.map((slot) => slot.slotId).join(",") || "none"}`],
    },
    {
      check: "Hamstrings have hinge + curl distribution",
      status: statusFromBoolean(hasHamstringHinge && hasHamstringCurl, hasHamstringHinge || hasHamstringCurl),
      evidence: [
        `hinge:${hasHamstringHinge ? "yes" : "no"}`,
        `curl:${hasHamstringCurl ? "yes" : "no"}`,
      ],
    },
    {
      check: "Side Delts get direct low-collateral work",
      status: statusFromBoolean(sideDeltDirect.length > 0),
      evidence: sideDeltDirect.map(({ slot, exercise }) => `${slot.slotId}:${exercise.exerciseName}`),
    },
    {
      check: "Calves distributed across lower slots if feasible",
      status:
        lowerSlots.length < 2
          ? "unknown"
          : statusFromBoolean(calfLowerSlots.length >= 2, calfLowerSlots.length === 1),
      evidence: [`lower_calf_slots:${calfLowerSlots.map((slot) => slot.slotId).join(",") || "none"}`],
    },
    {
      check: "no primary muscle solved by forbidden slot",
      status: statusFromBoolean(forbiddenPrimary.length === 0),
      evidence:
        forbiddenPrimary.length === 0
          ? ["no planner-only primary exercises violate forbidden slot prescriptions"]
          : forbiddenPrimary.map(
              ({ slot, exercise }) => `${slot.slotId}:${exercise.exerciseName}`
            ),
    },
    {
      check: "no Back Extension as clean Hamstrings closure",
      status: statusFromBoolean(backExtensionHamstrings.length === 0),
      evidence:
        backExtensionHamstrings.length === 0
          ? ["none"]
          : backExtensionHamstrings.map(
              ({ slot, exercise }) => `${slot.slotId}:${exercise.exerciseName}`
            ),
    },
    {
      check: "no duplicate main lift when clean alternative exists unless justified",
      status: statusFromBoolean(unjustifiedDuplicates.length === 0),
      evidence:
        unjustifiedDuplicates.length === 0
          ? ["no unjustified duplicate rows"]
          : unjustifiedDuplicates.map(
              (row) => `${row.exerciseName}:${row.justification}:alternative_${row.compatibleAlternativeExists ?? "unknown"}`
            ),
    },
    {
      check: "no exercise above 5 sets unless justified",
      status: statusFromBoolean(overFiveSetExercises.length === 0),
      evidence:
        overFiveSetExercises.length === 0
          ? ["none"]
          : overFiveSetExercises.map(
              ({ slot, exercise }) => `${slot.slotId}:${exercise.exerciseName}:${exercise.setCount}`
            ),
    },
    {
      check: "no single exercise supplies >50-60% of primary muscle unless intentional",
      status:
        highShareExercises.length > 0
          ? "fail"
          : moderateShareExercises.length > 0
            ? "partial"
            : "pass",
      evidence:
        highShareExercises.length > 0 || moderateShareExercises.length > 0
          ? [...highShareExercises, ...moderateShareExercises]
          : ["none"],
    },
    {
      check: "materialRepairCount = 0 for basic shape",
      status: statusFromBoolean(materialRepairCount === 0),
      evidence: [`materialRepairCount:${materialRepairCount}`],
    },
    {
      check: "majorRepairCount = 0",
      status: statusFromBoolean(majorRepairCount === 0),
      evidence: [`majorRepairCount:${majorRepairCount}`],
    },
    {
      check: "suspicious repairs do not increase",
      status: statusFromBoolean(suspiciousRepairCount === 0),
      evidence: [`suspiciousRepairsNotEligibleForPromotion:${suspiciousRepairCount}`],
    },
    {
      check: "slotPlanSeedJson would replay without reselection",
      status: statusFromBoolean(missingSeedFields.length === 0),
      evidence:
        missingSeedFields.length === 0
          ? ["planner-only snapshot has exercise ids and set counts; dry-run did not persist it"]
          : missingSeedFields.map(
              ({ slot, exercise }) => `${slot.slotId}:${exercise.exerciseName}:missing_seed_field`
            ),
    },
  ];
}

function buildPlanningRealityForSnapshot(
  planningReality: PlanningRealityDiagnostic,
  slots: ReadonlyArray<SlotCompositionSnapshot>
): PlanningRealityDiagnostic {
  return {
    ...planningReality,
    initialSlotComposition: slots.map((slot) => ({
      ...slot,
      exercises: slot.exercises.map((exercise) => ({ ...exercise })),
      projectedEffectiveStimulusByMuscle: {
        ...slot.projectedEffectiveStimulusByMuscle,
      },
    })),
  };
}

function countForbiddenFinalPrimaryViolations(
  planningReality: PlanningRealityDiagnostic,
  slots: ReadonlyArray<SlotCompositionSnapshot>
): number {
  const forbiddenBySlot = new Map<string, Set<string>>();
  for (const intent of planningReality.slotPrescriptionIntents) {
    const forbidden = new Set(
      intent.musclePrescriptions
        .filter(
          (prescription) =>
            prescription.targetStatus === "forbidden" ||
            prescription.demandType === "do_not_train_here"
        )
        .map((prescription) => prescription.muscle)
    );
    if (forbidden.size > 0) {
      forbiddenBySlot.set(intent.slotId, forbidden);
    }
  }

  return slots.reduce((count, slot) => {
    const forbidden = forbiddenBySlot.get(slot.slotId);
    if (!forbidden) {
      return count;
    }
    return (
      count +
      slot.exercises.filter((exercise) =>
        exercise.primaryMuscles.some((muscle) => forbidden.has(muscle))
      ).length
    );
  }, 0);
}

function getMaterialRepairCount(
  planningReality: PlanningRealityDiagnostic
): number {
  return (
    planningReality.shadowRepairSummary?.materialRepairCount ??
    planningReality.summary.materialRepairCount
  );
}

function getMajorRepairCount(
  planningReality: PlanningRealityDiagnostic
): number {
  return (
    planningReality.shadowRepairSummary?.majorRepairCount ??
    planningReality.summary.majorRepairCount
  );
}

function getRepairRowsForMetric(
  planningReality: PlanningRealityDiagnostic
): PlanningRealityDiagnostic["repairMateriality"] {
  return planningReality.repairMateriality;
}

function buildProjectionComparisonSnapshot(input: {
  planningReality: PlanningRealityDiagnostic;
  slots: ReadonlyArray<SlotCompositionSnapshot>;
}): MesocycleExplainProjectionComparisonSnapshot {
  const snapshotReality = buildPlanningRealityForSnapshot(
    input.planningReality,
    input.slots
  );
  const weeklyMuscleComparison =
    buildPlannerOnlyWeeklyMuscleComparison(snapshotReality);
  const acceptanceChecks = buildPlannerOnlyAcceptanceChecks(
    snapshotReality,
    weeklyMuscleComparison
  );
  const repairRows = getRepairRowsForMetric(input.planningReality);
  const countByStatus = (
    status: MesocycleExplainPlannerOnlyDryRun["acceptanceChecks"][number]["status"]
  ) => acceptanceChecks.filter((check) => check.status === status).length;

  return {
    slotExercisesBySlot: Object.fromEntries(
      input.slots.map((slot) => [
        slot.slotId,
        slot.exercises.map(formatSnapshotExercise),
      ])
    ),
    weeklyMuscleTotals: Object.fromEntries(
      Array.from(sumSlotStimulusByMuscle(input.slots).entries()).sort(
        ([left], [right]) => left.localeCompare(right)
      )
    ),
    materialRepairCount: getMaterialRepairCount(input.planningReality),
    majorRepairCount: getMajorRepairCount(input.planningReality),
    suspiciousRepairCount:
      input.planningReality.suspiciousRepairsNotEligibleForPromotion?.length ??
      0,
    highExerciseConcentrationCount:
      input.planningReality.summary.highExerciseConcentrationCount ?? 0,
    weakPreselectionConsumptionCount:
      input.planningReality.weakPreselectionConsumption?.length ?? 0,
    forbiddenFinalPrimaryViolationCount:
      countForbiddenFinalPrimaryViolations(input.planningReality, input.slots),
    supportFloorClosureRowCount: repairRows.filter(isSupportFloorRepairRow)
      .length,
    setBumpRowCount: repairRows.filter(isSetBumpRepairRow).length,
    capTrimRowCount: repairRows.filter(isCapTrimRepairRow).length,
    duplicateRowCount:
      input.planningReality.duplicateContinuityJustification?.summary
        .totalDuplicates ?? 0,
    keyAcceptance: {
      pass: countByStatus("pass"),
      fail: countByStatus("fail"),
      partial: countByStatus("partial"),
      unknown: countByStatus("unknown"),
    },
  };
}

function buildProjectionMetricDelta(input: {
  before: MesocycleExplainProjectionComparisonSnapshot;
  after: MesocycleExplainProjectionComparisonSnapshot;
}): MesocycleExplainProjectionMetricDelta {
  return {
    materialRepairCount:
      input.after.materialRepairCount - input.before.materialRepairCount,
    majorRepairCount:
      input.after.majorRepairCount - input.before.majorRepairCount,
    suspiciousRepairCount:
      input.after.suspiciousRepairCount - input.before.suspiciousRepairCount,
    highExerciseConcentrationCount:
      input.after.highExerciseConcentrationCount -
      input.before.highExerciseConcentrationCount,
    weakPreselectionConsumptionCount:
      input.after.weakPreselectionConsumptionCount -
      input.before.weakPreselectionConsumptionCount,
    forbiddenFinalPrimaryViolationCount:
      input.after.forbiddenFinalPrimaryViolationCount -
      input.before.forbiddenFinalPrimaryViolationCount,
    supportFloorClosureRowCount:
      input.after.supportFloorClosureRowCount -
      input.before.supportFloorClosureRowCount,
    setBumpRowCount: input.after.setBumpRowCount - input.before.setBumpRowCount,
    capTrimRowCount: input.after.capTrimRowCount - input.before.capTrimRowCount,
    duplicateRowCount:
      input.after.duplicateRowCount - input.before.duplicateRowCount,
    keyAcceptanceFailCount:
      input.after.keyAcceptance.fail - input.before.keyAcceptance.fail,
  };
}

function buildProjectionComparisons(input: {
  baselinePlanningReality: PlanningRealityDiagnostic;
  overridePlanningReality: PlanningRealityDiagnostic;
}): NonNullable<MesocycleExplainPlannerOnlyDryRun["projectionComparisons"]> {
  const baselineRepaired = buildProjectionComparisonSnapshot({
    planningReality: input.baselinePlanningReality,
    slots: input.baselinePlanningReality.finalSlotPlan,
  });
  const plannerOnlyBase = buildProjectionComparisonSnapshot({
    planningReality: input.baselinePlanningReality,
    slots: input.baselinePlanningReality.initialSlotComposition,
  });
  const plannerOnlyWithOverride = buildProjectionComparisonSnapshot({
    planningReality: input.overridePlanningReality,
    slots: input.overridePlanningReality.initialSlotComposition,
  });

  return {
    baselineRepaired,
    plannerOnlyBase,
    plannerOnlyWithOverride,
    deltas: {
      overrideVsBaselineRepaired: buildProjectionMetricDelta({
        before: baselineRepaired,
        after: plannerOnlyWithOverride,
      }),
      overrideVsPlannerOnlyBase: buildProjectionMetricDelta({
        before: plannerOnlyBase,
        after: plannerOnlyWithOverride,
      }),
    },
  };
}

function repairRowsMatching(
  planningReality: PlanningRealityDiagnostic,
  predicate: (row: PlanningRealityDiagnostic["repairMateriality"][number]) => boolean
): PlanningRealityDiagnostic["repairMateriality"] {
  return planningReality.repairMateriality.filter(predicate);
}

function hasWarning(
  planningReality: PlanningRealityDiagnostic,
  code: string
): boolean {
  return planningReality.warnings.some((warning) => warning.code === code);
}

function buildPlannerOnlyRepairDependencies(
  planningReality: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyDryRun["repairDependencies"] {
  const materialRows = planningReality.repairMaterialityAfterShadowAllocation.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major"
  );
  const supportFloorRows = repairRowsMatching(
    planningReality,
    (row) =>
      row.repairMechanism.includes("support") ||
      row.source.includes("support") ||
      row.rationale.includes("support")
  );
  const weeklyRows = repairRowsMatching(
    planningReality,
    (row) =>
      row.repairMechanism.includes("weekly") ||
      row.source.includes("weekly") ||
      row.rationale.includes("weekly")
  );
  const identityRows = repairRowsMatching(
    planningReality,
    (row) => row.changedExerciseIdentity
  );
  const setBumpRows = repairRowsMatching(
    planningReality,
    (row) => row.action === "set_bumped" || row.rawSetDelta > 0
  );
  const capTrimRows = repairRowsMatching(
    planningReality,
    (row) => row.action === "set_trimmed" || row.action === "removed" || row.rawSetDelta < 0
  );
  const duplicateRows =
    planningReality.duplicateContinuityJustification?.duplicates ?? [];
  const isolationRows = repairRowsMatching(
    planningReality,
    (row) =>
      row.repairMechanism.includes("isolation") ||
      row.source.includes("isolation") ||
      row.rationale.includes("isolation")
  );
  const forbiddenRemoved =
    planningReality.forbiddenCleanupReroute?.removedExercises ?? [];
  const distributionActions = planningReality.distributionGuardActions ?? [];
  const cleanCurlRows = planningReality.preselectionFeasibility.filter(
    (row) => row.muscle === "Hamstrings" && row.slotId === "lower_b"
  );
  const lowerBHamstringRepairs = materialRows.filter(
    (row) => row.slotId === "lower_b" && row.muscle === "Hamstrings"
  );

  return [
    {
      path: "support-floor closure",
      wouldHaveActed:
        supportFloorRows.length > 0 || hasWarning(planningReality, "SUPPORT_FLOOR_CLOSED_LATE"),
      consequenceWithoutRepair:
        supportFloorRows.length > 0
          ? `repair_would_be_needed_here:${supportFloorRows.length}_support_rows`
          : "no support-floor repair action observed in current projection",
      plannerOwnerRequired: "Support demand must be allocated before selection or left as explicit unresolved demand.",
    },
    {
      path: "weekly obligation closure",
      wouldHaveActed:
        weeklyRows.length > 0 ||
        planningReality.allocationVsInitialDelta.some((delta) => delta.underAllocatedMuscles.length > 0),
      consequenceWithoutRepair:
        weeklyRows.length > 0
          ? `repair_would_be_needed_here:${weeklyRows.length}_weekly_obligation_rows`
          : "planner-only shape must surface any allocation shortfalls instead of closing them late",
      plannerOwnerRequired: "Weekly demand and slot allocation must own hard target closure before selection.",
    },
    {
      path: "program-quality identity changes",
      wouldHaveActed: identityRows.length > 0,
      consequenceWithoutRepair:
        identityRows.length > 0
          ? `repair_would_be_needed_here:${identityRows.length}_identity_changes`
          : "no program-quality identity changes observed",
      plannerOwnerRequired: "Exercise-class distribution and selection objective must choose clean identities up front.",
    },
    {
      path: "set bumping",
      wouldHaveActed: setBumpRows.length > 0,
      consequenceWithoutRepair:
        setBumpRows.length > 0
          ? `repair_would_be_needed_here:${setBumpRows.length}_set_bumps`
          : "no late set bumping observed",
      plannerOwnerRequired: "SetDistributionPlan must assign required sets before final shaping.",
    },
    {
      path: "cap trim",
      wouldHaveActed:
        capTrimRows.length > 0 || hasWarning(planningReality, "FINAL_CAP_TRIM_REQUIRED"),
      consequenceWithoutRepair:
        capTrimRows.length > 0
          ? `repair_would_be_needed_here:${capTrimRows.length}_trim_or_removal_rows`
          : "no final cap trim observed",
      plannerOwnerRequired: "Selection and set distribution must respect exercise/session caps before repair.",
    },
    {
      path: "duplicate penalties",
      wouldHaveActed: duplicateRows.length > 0,
      consequenceWithoutRepair:
        duplicateRows.length > 0
          ? `repair_would_be_needed_here:${duplicateRows.length}_duplicate_rows`
          : "no duplicate penalty repair dependency observed",
      plannerOwnerRequired: "Duplicate policy must be part of exercise-class selection, with justification when duplicates remain.",
    },
    {
      path: "isolation injection",
      wouldHaveActed:
        isolationRows.length > 0 || hasWarning(planningReality, "REPAIR_ADDED_EXERCISE_IDENTITY"),
      consequenceWithoutRepair:
        isolationRows.length > 0
          ? `repair_would_be_needed_here:${isolationRows.length}_isolation_rows`
          : "no isolation injection observed",
      plannerOwnerRequired: "Direct isolation demand must be represented in class/lane intent before selection.",
    },
    {
      path: "forbidden cleanup",
      wouldHaveActed: forbiddenRemoved.length > 0,
      consequenceWithoutRepair:
        forbiddenRemoved.length > 0
          ? `repair_would_be_needed_here:${forbiddenRemoved.length}_forbidden_removed`
          : "no forbidden cleanup observed",
      plannerOwnerRequired: "Forbidden slot/muscle constraints must block invalid primary solutions during selection.",
    },
    {
      path: "distribution guard",
      wouldHaveActed: distributionActions.length > 0,
      consequenceWithoutRepair:
        distributionActions.length > 0
          ? `repair_would_be_needed_here:${distributionActions.length}_distribution_guard_actions`
          : "no distribution guard action observed",
      plannerOwnerRequired: "Set distribution policy must prefer clean alternatives or leave demand unresolved at the limit.",
    },
    {
      path: "clean-curl repair preference",
      wouldHaveActed: cleanCurlRows.length > 0 || lowerBHamstringRepairs.length > 0,
      consequenceWithoutRepair:
        cleanCurlRows.length > 0 || lowerBHamstringRepairs.length > 0
          ? `repair_would_be_needed_here:lower_b_hamstrings_clean_curl_policy`
          : "no lower_b Hamstrings clean-curl repair dependency observed",
      plannerOwnerRequired: "Hamstrings lower_b class intent must choose hinge plus knee-flexion curl before repair.",
    },
  ];
}

export function buildPlannerOnlyDryRunComparison(
  planningReality: PlanningRealityDiagnostic | undefined,
  compareRepaired: boolean,
  plannerOnlyPolicyOverride?: PlannerOnlyPolicyOverride,
  overridePlanningReality?: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyDryRun {
  if (!planningReality) {
    return {
      enabled: true,
      compareRepaired,
      readOnly: true,
      affectsScoringOrGeneration: false,
      ...(plannerOnlyPolicyOverride
        ? {
            policyOverride: {
              id: plannerOnlyPolicyOverride.id,
              readOnly: true,
              appliesOnlyTo: plannerOnlyPolicyOverride.appliesOnlyTo,
              status: "inactive_noop",
              affectsScoringOrGeneration: false,
            },
          }
        : {}),
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        acceptancePassed: 0,
        acceptanceFailed: 1,
        unresolvedDemandCount: 1,
        disabledRepairDependencyCount: 0,
      },
      slotComparisons: [],
      weeklyMuscleComparison: [],
      acceptanceChecks: [
        {
          check: "planningReality available for planner-only dry-run",
          status: "fail",
          evidence: ["planningReality_missing"],
        },
      ],
      repairDependencies: [],
    };
  }

  const slotComparisons = buildPlannerOnlySlotComparisons(planningReality);
  const weeklyMuscleComparison = buildPlannerOnlyWeeklyMuscleComparison(planningReality);
  const acceptanceChecks = buildPlannerOnlyAcceptanceChecks(
    planningReality,
    weeklyMuscleComparison
  );
  const repairDependencies = buildPlannerOnlyRepairDependencies(planningReality);
  const projectionComparisons =
    plannerOnlyPolicyOverride && overridePlanningReality
      ? buildProjectionComparisons({
          baselinePlanningReality: planningReality,
          overridePlanningReality,
        })
      : undefined;
  const calvesFourFourCandidate = buildCalvesFourFourCandidate({
    planningReality,
    overridePlanningReality,
    projectionComparisons,
    slotComparisons,
    repairDependencies,
  });
  const acceptancePassed = acceptanceChecks.filter((check) => check.status === "pass").length;
  const acceptanceFailed = acceptanceChecks.filter((check) => check.status === "fail").length;
  const unresolvedDemandCount = slotComparisons.reduce(
    (sum, slot) => sum + slot.unresolvedDemand.length,
    0
  );
  const disabledRepairDependencyCount = repairDependencies.filter(
    (dependency) => dependency.wouldHaveActed
  ).length;
  const canReplaceRepairedProjection =
    acceptanceFailed === 0 &&
    acceptanceChecks.every((check) => check.status === "pass") &&
    unresolvedDemandCount === 0 &&
    disabledRepairDependencyCount === 0;
  const status =
    canReplaceRepairedProjection
      ? "pass"
      : acceptanceFailed > 0 || unresolvedDemandCount > 0
        ? "fail"
        : "partial";

  return {
    enabled: true,
    compareRepaired,
    readOnly: true,
    affectsScoringOrGeneration: false,
    ...(plannerOnlyPolicyOverride
      ? {
          policyOverride: {
            id: plannerOnlyPolicyOverride.id,
            readOnly: true,
            appliesOnlyTo: plannerOnlyPolicyOverride.appliesOnlyTo,
            status: projectionComparisons ? "active" : "inactive_noop",
            affectsScoringOrGeneration: false,
          },
        }
      : {}),
    ...(projectionComparisons ? { projectionComparisons } : {}),
    canReplaceRepairedProjection,
    summary: {
      status,
      acceptancePassed,
      acceptanceFailed,
      unresolvedDemandCount,
      disabledRepairDependencyCount,
    },
    slotComparisons,
    weeklyMuscleComparison,
    acceptanceChecks,
    repairDependencies,
    calvesFourFourCandidate,
  };
}

function classifyPlannerOnlyExercise(input: {
  exercise: SlotCompositionSnapshot["exercises"][number];
}): { lane: string; exerciseClass: string } {
  const exercise = input.exercise;
  const name = exercise.exerciseName.toLowerCase();
  const patterns = exercise.movementPatterns.map((pattern) =>
    pattern.toLowerCase()
  );
  const primaryMuscles = exercise.primaryMuscles.map((muscle) =>
    muscle.toLowerCase()
  );

  if (name.includes("calf")) {
    return { lane: "calves", exerciseClass: "calf_raise" };
  }
  if (name.includes("leg curl") || name.includes("hamstring curl") || name.includes("nordic")) {
    return { lane: "knee_flexion_curl", exerciseClass: "knee_flexion_curl" };
  }
  if (patterns.some((pattern) => pattern.includes("hinge")) || name.includes("deadlift") || name.includes("rdl")) {
    return { lane: "hinge_anchor", exerciseClass: "hinge" };
  }
  if (name.includes("leg extension")) {
    return { lane: "quad_isolation", exerciseClass: "leg_extension" };
  }
  if (patterns.some((pattern) => pattern.includes("squat")) || name.includes("squat") || name.includes("leg press")) {
    return { lane: "squat_anchor", exerciseClass: "squat_or_quad_support" };
  }
  if (name.includes("lateral raise")) {
    return { lane: "side_delt_isolation", exerciseClass: "lateral_raise" };
  }
  if (name.includes("rear delt") || name.includes("reverse") || name.includes("face pull")) {
    return { lane: "rear_delt", exerciseClass: "rear_delt_isolation" };
  }
  if (name.includes("triceps") || name.includes("pressdown")) {
    return { lane: "triceps", exerciseClass: "triceps_isolation" };
  }
  if (name.includes("curl") && primaryMuscles.includes("biceps")) {
    return { lane: "biceps", exerciseClass: "biceps_curl" };
  }
  if (patterns.some((pattern) => pattern.includes("vertical_pull")) || name.includes("pulldown") || name.includes("pull-up")) {
    return { lane: "vertical_pull", exerciseClass: "vertical_pull" };
  }
  if (patterns.some((pattern) => pattern.includes("horizontal_pull")) || name.includes("row")) {
    return { lane: "row_anchor", exerciseClass: "row" };
  }
  if (patterns.some((pattern) => pattern.includes("vertical_push")) || name.includes("shoulder press") || name.includes("overhead press")) {
    return { lane: "vertical_press", exerciseClass: "vertical_press" };
  }
  if (name.includes("fly") || name.includes("crossover")) {
    return { lane: "chest_secondary", exerciseClass: "chest_isolation" };
  }
  if (primaryMuscles.includes("chest") || name.includes("press") || name.includes("bench")) {
    return { lane: "chest_anchor", exerciseClass: "chest_press" };
  }
  return { lane: "unclassified", exerciseClass: "unclassified" };
}

function buildNoRepairWeeklyMuscleTotals(
  planningReality: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotals"] {
  const totals = sumSlotStimulusByMuscle(planningReality.finalSlotPlan);
  const targetByMuscle = new Map(
    planningReality.shadowWeeklyDemand.map((row) => [row.muscle, row])
  );
  const fallbackTargetByMuscle = new Map(
    planningReality.weeklyMuscleDemand.map((row) => [row.muscle, row])
  );
  const muscles = uniqueSorted([
    ...Array.from(totals.keys()),
    ...Array.from(targetByMuscle.keys()),
    ...Array.from(fallbackTargetByMuscle.keys()),
  ]);

  return muscles.map((muscle) => {
    const projectedEffectiveSets = roundOne(totals.get(muscle) ?? 0);
    const target = targetByMuscle.get(muscle);
    const fallback = fallbackTargetByMuscle.get(muscle);
    const targetMin = target?.minEffectiveSets ?? fallback?.mev ?? null;
    const targetPreferred =
      target?.preferredEffectiveSets ?? fallback?.preferredTarget ?? null;
    const targetMax = target?.maxEffectiveSets ?? fallback?.mav ?? null;
    const status =
      targetMin == null && targetPreferred == null && targetMax == null
        ? "diagnostic"
        : targetMin != null && projectedEffectiveSets < targetMin
          ? "below"
          : targetMax != null && projectedEffectiveSets > targetMax
            ? "above"
            : "within";

    return {
      muscle,
      projectedEffectiveSets,
      targetMin,
      targetPreferred,
      status,
    };
  });
}

function getNoRepairSetAllocationBaseline(input: {
  slotId: string;
  exercise: PlanningRealityDiagnostic["finalSlotPlan"][number]["exercises"][number];
  classified: ReturnType<typeof classifyPlannerOnlyExercise>;
}): { lane: string; setsBefore: number } | null {
  const primaryMuscles = input.exercise.primaryMuscles.map((muscle) =>
    muscle.trim().toLowerCase()
  );
  const name = input.exercise.exerciseName.trim().toLowerCase();
  if (
    input.slotId === "upper_a" &&
    input.classified.lane === "chest_secondary" &&
    primaryMuscles.includes("chest")
  ) {
    return { lane: "chest_secondary", setsBefore: 2 };
  }
  if (
    input.slotId === "upper_b" &&
    primaryMuscles.includes("chest") &&
    (input.classified.exerciseClass === "chest_isolation" ||
      input.classified.exerciseClass === "chest_press")
  ) {
    return { lane: "chest_second_exposure", setsBefore: 3 };
  }
  if (
    input.slotId === "lower_a" &&
    (primaryMuscles.includes("calves") || name.includes("calf raise"))
  ) {
    return { lane: "calves", setsBefore: 3 };
  }
  return null;
}

function buildNoRepairSetAllocationChanges(
  planningReality: PlanningRealityDiagnostic
): MesocycleExplainPlannerOnlyNoRepair["setAllocationChanges"] {
  return planningReality.finalSlotPlan.flatMap((slot) =>
    slot.exercises.flatMap((exercise) => {
      const classified = classifyPlannerOnlyExercise({ exercise });
      const baseline = getNoRepairSetAllocationBaseline({
        slotId: slot.slotId,
        exercise,
        classified,
      });
      if (!baseline || exercise.setCount <= baseline.setsBefore) {
        return [];
      }
      const setDelta = exercise.setCount - baseline.setsBefore;
      const effectiveStimulusDeltaEntries: Array<[string, number]> = [];
      for (const [muscle, stimulus] of Object.entries(
        exercise.effectiveStimulusByMuscle
      )) {
        const stimulusDelta = roundOne((stimulus / exercise.setCount) * setDelta);
        if (stimulusDelta > 0) {
          effectiveStimulusDeltaEntries.push([muscle, stimulusDelta]);
        }
      }
      const effectiveStimulusDeltaByMuscle = Object.fromEntries(
        effectiveStimulusDeltaEntries
      );
      return [
        {
          slotId: slot.slotId,
          lane: baseline.lane,
          exerciseName: exercise.exerciseName,
          setsBefore: baseline.setsBefore,
          setsAfter: exercise.setCount,
          effectiveStimulusDeltaByMuscle,
        },
      ];
    })
  );
}

function classifyNoRepairWeeklyStatus(input: {
  projectedEffectiveSets: number;
  targetMin: number | null;
}): MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotalChanges"][number]["statusBefore"] {
  if (input.targetMin == null) {
    return "diagnostic";
  }
  return input.projectedEffectiveSets < input.targetMin ? "below" : "within";
}

function buildNoRepairWeeklyMuscleTotalChanges(input: {
  weeklyMuscleTotals: MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotals"];
  setAllocationChanges: MesocycleExplainPlannerOnlyNoRepair["setAllocationChanges"];
}): MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotalChanges"] {
  const deltaByMuscle = new Map<string, number>();
  for (const change of input.setAllocationChanges) {
    for (const [muscle, delta] of Object.entries(
      change.effectiveStimulusDeltaByMuscle
    )) {
      deltaByMuscle.set(muscle, roundOne((deltaByMuscle.get(muscle) ?? 0) + delta));
    }
  }

  const totalByMuscle = new Map(
    input.weeklyMuscleTotals.map((row) => [row.muscle, row])
  );
  return Array.from(deltaByMuscle.entries())
    .map(([muscle, deltaEffectiveSets]) => {
      const total = totalByMuscle.get(muscle);
      const afterEffectiveSets = total?.projectedEffectiveSets ?? deltaEffectiveSets;
      const beforeEffectiveSets = roundOne(afterEffectiveSets - deltaEffectiveSets);
      return {
        muscle,
        beforeEffectiveSets,
        afterEffectiveSets,
        deltaEffectiveSets,
        targetMin: total?.targetMin ?? null,
        targetPreferred: total?.targetPreferred ?? null,
        statusBefore: classifyNoRepairWeeklyStatus({
          projectedEffectiveSets: beforeEffectiveSets,
          targetMin: total?.targetMin ?? null,
        }),
        statusAfter: total?.status ?? "diagnostic",
      };
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function buildNoRepairAcceptanceChecks(
  planningReality: PlanningRealityDiagnostic,
  weeklyMuscleTotals: MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotals"],
  concentrationClassification: NoRepairConcentrationClassification
): MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"] {
  const comparisonRows = weeklyMuscleTotals.map((row) => ({
    muscle: row.muscle,
    repairedEffectiveSets: null,
    plannerOnlyEffectiveSets: row.projectedEffectiveSets,
    targetStatus:
      row.status === "diagnostic" ? ("unknown" as const) : row.status,
    evidence: [
      `planner:${row.projectedEffectiveSets}`,
      `min:${row.targetMin ?? "unknown"}`,
      `preferred:${row.targetPreferred ?? "unknown"}`,
    ],
  }));
  const baseChecks = buildPlannerOnlyAcceptanceChecks(
    planningReality,
    comparisonRows
  ).filter(
    (check) =>
      check.check !==
      "no single exercise supplies >50-60% of primary muscle unless intentional"
  );
  return [
    ...baseChecks,
    {
      check: "no concentration acceptance blockers",
      status: statusFromBoolean(
        concentrationClassification.acceptanceFailures.length === 0
      ),
      evidence:
        concentrationClassification.acceptanceFailures.length === 0
          ? [
              `quality_warnings:${concentrationClassification.qualityWarnings.length}`,
              `diagnostic_rows:${concentrationClassification.diagnosticRows.length}`,
              `ignored_rows:${concentrationClassification.ignoredRows.length}`,
            ]
          : concentrationClassification.acceptanceFailures.map(
              formatNoRepairConcentrationRow
            ),
    },
  ];
}

type NoRepairConcentrationClassification = {
  acceptanceFailures: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  qualityWarnings: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  diagnosticRows: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  ignoredRows: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
};

function formatNoRepairConcentrationRow(
  row: MesocycleExplainPlannerOnlyNoRepairConcentrationRow
): string {
  return `${row.slotId}:${row.exerciseName}:${row.muscle}:${row.percentageOfWeeklyStimulus}%:${row.reason}`;
}

function isTinyDiagnosticDenominator(input: {
  muscle: string;
  weeklyEffectiveSets: number;
  explicitlyTargeted: boolean;
}): boolean {
  return !input.explicitlyTargeted && input.weeklyEffectiveSets <= 2;
}

function isCollateralArtifactMuscle(muscle: string): boolean {
  return muscle === "Forearms" || muscle === "Core";
}

function isFatigueSensitiveCollateral(muscle: string): boolean {
  return muscle === "Lower Back" || muscle === "Glutes";
}

function getNoRepairDemandByMuscle(
  planningReality: PlanningRealityDiagnostic
): Map<string, PlanningRealityDiagnostic["shadowWeeklyDemand"][number]> {
  return new Map(
    planningReality.shadowWeeklyDemand.map((row) => [row.muscle, row])
  );
}

function hasExplicitCleanAlternativeSignal(input: {
  planningReality: PlanningRealityDiagnostic;
  muscle: string;
  slotId: string;
}): boolean {
  return (
    input.planningReality.exerciseClassUnresolvedCauses?.some(
      (row) =>
        row.slotId === input.slotId &&
        row.muscle === input.muscle &&
        row.behaviorReadiness === "ready_for_bounded_trial"
    ) ?? false
  );
}

function classifyNoRepairConcentrationRow(input: {
  row: PlanningRealityDiagnostic["exerciseConcentration"][number];
  muscle: string;
  percentage: number;
  weeklyEffectiveSets: number;
  demand?: PlanningRealityDiagnostic["shadowWeeklyDemand"][number];
  planningReality: PlanningRealityDiagnostic;
}): MesocycleExplainPlannerOnlyNoRepairConcentrationRow {
  const semantics = getMuscleTargetSemantics(input.muscle);
  const priority =
    input.demand?.priority ??
    (semantics.targetTier === "A_PRIMARY"
      ? "primary"
      : semantics.targetTier === "B_SUPPORT"
        ? "support"
        : semantics.targetTier === "C_SECONDARY"
          ? "secondary"
          : "implicit");
  const targetStatus = input.demand?.targetStatus ?? "diagnostic";
  const explicitlyTargeted =
    (priority === "primary" || priority === "support") &&
    targetStatus !== "diagnostic";
  const isDirect = input.row.primaryMuscles.includes(input.muscle);
  const isCleanDirect = isDirect && !input.row.isCompound;
  const minEffectiveSets = input.demand?.minEffectiveSets ?? null;
  const maxEffectiveSets = input.demand?.maxEffectiveSets ?? null;
  const belowMinimum =
    minEffectiveSets != null && input.weeklyEffectiveSets < minEffectiveSets;
  const nearMinimum =
    minEffectiveSets != null && input.weeklyEffectiveSets <= minEffectiveSets + 1;
  const gtFive =
    input.row.flags.includes("COMPOUND_GT_5_SETS") ||
    input.row.flags.includes("ISOLATION_GT_5_SETS") ||
    input.row.setCount > 5;
  const overExplicitFatigueCap =
    isFatigueSensitiveCollateral(input.muscle) &&
    maxEffectiveSets != null &&
    input.weeklyEffectiveSets > maxEffectiveSets;
  const warningThresholdShare = input.percentage >= 50;
  const highShare = input.percentage > 60;
  const cleanAlternativeExists = hasExplicitCleanAlternativeSignal({
    planningReality: input.planningReality,
    muscle: input.muscle,
    slotId: input.row.slotId,
  });
  const cleanAlternativeIgnoredWhileUnderDistributed =
    cleanAlternativeExists && belowMinimum;

  const base = {
    slotId: input.row.slotId,
    exerciseName: input.row.exerciseName,
    muscle: input.muscle,
    percentageOfWeeklyStimulus: input.percentage,
    weeklyEffectiveSets: input.weeklyEffectiveSets,
    setCount: input.row.setCount,
    producedOrIncreasedByRepair: input.row.producedOrIncreasedByRepair,
    evidence: [
      `priority:${priority}`,
      `target_status:${targetStatus}`,
      `direct:${isDirect ? "yes" : "no"}`,
      `clean_direct:${isCleanDirect ? "yes" : "no"}`,
      `weekly_effective_sets:${input.weeklyEffectiveSets}`,
      `min:${minEffectiveSets ?? "unknown"}`,
      `max:${maxEffectiveSets ?? "unknown"}`,
      `flags:${input.row.flags.join(",") || "none"}`,
    ],
  };

  if (gtFive) {
    if (
      !input.row.isCompound &&
      !input.row.flags.includes("COMPOUND_GT_5_SETS")
    ) {
      return {
        ...base,
        severity: "quality_warning",
        reason: "isolation_gt_5_sets_session_shaping_review",
      };
    }
    return {
      ...base,
      severity: "acceptance_blocker",
      reason: "exercise_gt_5_sets_without_planner_justification",
    };
  }
  if (input.row.producedOrIncreasedByRepair) {
    return {
      ...base,
      severity: "acceptance_blocker",
      reason: "concentration_created_by_repair_or_set_bump",
    };
  }
  if (overExplicitFatigueCap) {
    return {
      ...base,
      severity: "acceptance_blocker",
      reason: "fatigue_sensitive_collateral_above_explicit_cap",
    };
  }
  if (
    isCollateralArtifactMuscle(input.muscle) ||
    isTinyDiagnosticDenominator({
      muscle: input.muscle,
      weeklyEffectiveSets: input.weeklyEffectiveSets,
      explicitlyTargeted,
    })
  ) {
    return {
      ...base,
      severity: "ignored_for_acceptance",
      reason: isCollateralArtifactMuscle(input.muscle)
        ? "compound_or_curl_collateral_denominator_artifact"
        : "tiny_diagnostic_denominator_artifact",
    };
  }
  if (!explicitlyTargeted) {
    return {
      ...base,
      severity: "diagnostic_only",
      reason: "secondary_or_implicit_collateral_not_acceptance_target",
    };
  }
  if (priority === "support") {
    if (!isDirect && belowMinimum) {
      return {
        ...base,
        severity: "acceptance_blocker",
        reason: "support_target_missing_clean_direct_work_and_substituted_by_collateral",
      };
    }
    if (isDirect && belowMinimum && !nearMinimum) {
      return {
        ...base,
        severity: "acceptance_blocker",
        reason: "support_direct_work_concentrated_while_below_minimum",
      };
    }
    return {
      ...base,
      severity: "quality_warning",
      reason: isCleanDirect
        ? "support_direct_isolation_concentrated_but_clean_and_near_or_at_target"
        : "support_target_high_single_exercise_share_non_blocking",
    };
  }
  if (priority === "primary" && warningThresholdShare) {
    if (belowMinimum || highShare || cleanAlternativeIgnoredWhileUnderDistributed) {
      return {
        ...base,
        severity: "acceptance_blocker",
        reason: "primary_hard_target_excessive_single_exercise_share_unjustified",
      };
    }
    return {
      ...base,
      severity: "quality_warning",
      reason: "primary_hard_target_50_to_60_share_warning_threshold",
    };
  }

  return {
    ...base,
    severity: "quality_warning",
    reason: "high_single_exercise_share_non_blocking_programming_note",
  };
}

function classifyNoRepairConcentrationRows(
  planningReality: PlanningRealityDiagnostic
): NoRepairConcentrationClassification {
  const weeklyTotals = sumSlotStimulusByMuscle(planningReality.finalSlotPlan);
  const demandByMuscle = getNoRepairDemandByMuscle(planningReality);
  const rows = planningReality.exerciseConcentration.flatMap((row) =>
    Object.entries(row.percentageOfWeeklyProjectedStimulusByMuscle)
      .filter(([muscle, percentage]) => {
        const effectiveSets = row.effectiveStimulusContributionByMuscle[muscle] ?? 0;
        return (
          effectiveSets > 0 &&
          (percentage >= 50 ||
            row.setCount > 5 ||
            row.producedOrIncreasedByRepair)
        );
      })
      .map(([muscle, percentage]) =>
        classifyNoRepairConcentrationRow({
          row,
          muscle,
          percentage,
          weeklyEffectiveSets: weeklyTotals.get(muscle) ?? 0,
          demand: demandByMuscle.get(muscle),
          planningReality,
        })
      )
  );

  return {
    acceptanceFailures: rows
      .filter((row) => row.severity === "acceptance_blocker")
      .sort(compareNoRepairConcentrationRows),
    qualityWarnings: rows
      .filter((row) => row.severity === "quality_warning")
      .sort(compareNoRepairConcentrationRows),
    diagnosticRows: rows
      .filter((row) => row.severity === "diagnostic_only")
      .sort(compareNoRepairConcentrationRows),
    ignoredRows: rows
      .filter((row) => row.severity === "ignored_for_acceptance")
      .sort(compareNoRepairConcentrationRows),
  };
}

function compareNoRepairConcentrationRows(
  left: MesocycleExplainPlannerOnlyNoRepairConcentrationRow,
  right: MesocycleExplainPlannerOnlyNoRepairConcentrationRow
): number {
  return (
    left.slotId.localeCompare(right.slotId) ||
    left.muscle.localeCompare(right.muscle) ||
    right.percentageOfWeeklyStimulus - left.percentageOfWeeklyStimulus ||
    left.exerciseName.localeCompare(right.exerciseName)
  );
}

function isNoRepairNonBlockingConcentrationViolation(
  violation: string,
  classification: NoRepairConcentrationClassification
): boolean {
  const nonBlockingRows = [
    ...classification.qualityWarnings,
    ...classification.diagnosticRows,
    ...classification.ignoredRows,
  ];
  return nonBlockingRows.some(
    (row) =>
      violation.includes(row.exerciseName) &&
      violation.includes(row.muscle) &&
      (violation.includes("single_exercise_share") ||
        violation.includes(`${row.slotId}:`) ||
        violation.includes(`${row.muscle}:`))
  );
}

function buildNoRepairSlotPlans(
  planningReality: PlanningRealityDiagnostic,
  concentrationClassification: NoRepairConcentrationClassification
): MesocycleExplainPlannerOnlyNoRepair["slotPlans"] {
  const topDownSlots = new Map(
    planningReality.topDownMesocyclePlan?.slotTargets.map((slot) => [
      slot.slotId,
      slot,
    ]) ?? []
  );
  const allocationDeltaBySlot = new Map(
    planningReality.allocationVsFinalDelta.map((delta) => [delta.slotId, delta])
  );
  const unresolvedCausesBySlot = new Map<string, string[]>();
  for (const row of planningReality.exerciseClassUnresolvedCauses ?? []) {
    if (row.finalAlignment !== "missing" && row.finalAlignment !== "partial" && row.finalAlignment !== "violated") {
      continue;
    }
    const existing = unresolvedCausesBySlot.get(row.slotId) ?? [];
    existing.push(
      `${row.muscle}:${row.finalAlignment}:${row.recommendedOwner}:${row.behaviorReadiness}`
    );
    unresolvedCausesBySlot.set(row.slotId, existing);
  }

  return planningReality.finalSlotPlan.map((slot) => {
    const target = topDownSlots.get(slot.slotId);
    const missingLanes =
      target?.requiredClassLanes
        .filter((lane) => lane.currentStatus !== "matched")
        .map((lane) => `${lane.lane}:${lane.currentStatus}`) ?? [];
    const allocationDelta = allocationDeltaBySlot.get(slot.slotId);
    const unresolvedDemand = uniqueSorted([
      ...(allocationDelta?.underAllocatedMuscles ?? []).map((row) => {
        const shortfall = row.shortfall == null ? "unknown" : roundOne(row.shortfall);
        return `${row.muscle}:shortfall_${shortfall}`;
      }),
      ...(unresolvedCausesBySlot.get(slot.slotId) ?? []),
      ...missingLanes.map((lane) => `missing_lane:${lane}`),
    ]);
    const validationFailures = uniqueSorted([
      ...buildPlannerOnlyDuplicateViolations(planningReality, slot.slotId),
      ...buildPlannerOnlySetDistributionViolations(planningReality, slot).filter(
        (violation) =>
          !isNoRepairNonBlockingConcentrationViolation(
            violation,
            concentrationClassification
          )
      ),
    ]);

    return {
      slotId: slot.slotId,
      exercises: slot.exercises.map((exercise) => {
        const classified = classifyPlannerOnlyExercise({ exercise });
        return {
          exerciseName: exercise.exerciseName,
          lane: classified.lane,
          exerciseClass: classified.exerciseClass,
          sets: exercise.setCount,
        };
      }),
      missingLanes,
      unresolvedDemand,
      validationFailures,
    };
  });
}

function mainNoRepairGaps(input: {
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
  acceptanceChecks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"];
}): string[] {
  return uniqueSorted([
    ...input.slotPlans.flatMap((slot) =>
      [
        ...slot.missingLanes.map((row) => `${slot.slotId}:missing:${row}`),
        ...slot.unresolvedDemand.map((row) => `${slot.slotId}:unresolved:${row}`),
        ...slot.validationFailures.map((row) => `${slot.slotId}:validation:${row}`),
      ]
    ),
    ...input.acceptanceChecks
      .filter((check) => check.status === "fail" || check.status === "partial")
      .map((check) => `${check.check}:${check.status}`),
  ]).slice(0, 12);
}

type NoRepairClassification =
  MesocycleExplainPlannerOnlyNoRepair["acceptanceClassification"];
type NoRepairFinding = NoRepairClassification["hardBlockers"][number];
type V2MesocyclePlan = MesocycleExplainPlannerOnlyNoRepair["v2MesocyclePlan"];
type V2Slot = V2MesocyclePlan["skeleton"]["slots"][number];
type V2Lane = V2Slot["lanes"][number] & {
  targetLaneId?: string;
};
type V2TargetVsNoRepairDiff =
  MesocycleExplainPlannerOnlyNoRepair["v2TargetVsNoRepairDiff"];
type V2TargetVsNoRepairLaneDiff =
  V2TargetVsNoRepairDiff["slotDiffs"][number]["laneDiffs"][number];
type CrossWeekProjectionGate =
  MesocycleExplainPlannerOnlyNoRepair["crossWeekProjectionGate"];
type V2DeloadProjectionDiagnostic =
  MesocycleExplainPlannerOnlyNoRepair["v2DeloadProjectionDiagnostic"];
type V2SetDistributionIntentLane =
  V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number];
type V2SetDistributionIntentPolicyLane = {
  week: number;
  phase: V2SetDistributionIntent["weeks"][number]["phase"];
  lane: V2SetDistributionIntentLane;
};
type V2LaneSetPolicyStatus =
  | "in_budget"
  | "under_budget"
  | "allowed_expansion"
  | "quality_warning"
  | "requires_justification"
  | "hard_blocker"
  | "unknown";

function toV2LaneWeek1Status(
  status?: string
): V2Lane["currentWeek1Status"] {
  if (status === "matched") return "satisfied";
  if (status === "partial") return "partial";
  if (status === "missing") return "missing";
  return "warning";
}

function buildV2Skeleton(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
}): V2MesocyclePlan["skeleton"] {
  const targetSkeleton = buildV2PlannerMesocyclePolicy().targetSkeleton;
  const topDownBySlot = new Map(
    input.noRepair?.topDownMesocyclePlan?.slotTargets.map((slot) => [
      slot.slotId,
      slot,
    ]) ?? []
  );
  const noRepairSlotPlans = new Map(
    input.slotPlans.map((slot) => [slot.slotId, slot])
  );

  return {
    split: targetSkeleton.split,
    weeks: targetSkeleton.weeks,
    slotSequence: targetSkeleton.slotSequence,
    slots: targetSkeleton.slots.map((slot) => {
      const topDownSlot = topDownBySlot.get(slot.slotId);
      const noRepairSlot = noRepairSlotPlans.get(slot.slotId);
      return {
        slotId: slot.slotId,
        intent: slot.intent,
        targetSessionSets: slot.targetSessionSets,
        lanes: slot.lanes.map((lane) => {
          const topDownLaneId = lane.targetLaneId ?? lane.laneId;
          const topDownLane = topDownSlot?.requiredClassLanes.find(
            (row) => row.lane === topDownLaneId
          );
          const missingLane = noRepairSlot?.missingLanes.find((row) =>
            row.includes(lane.laneId) || row.includes(topDownLaneId)
          );
          const exerciseMatched = noRepairSlot?.exercises.some(
            (exercise) =>
              exercise.lane === lane.laneId || exercise.lane === topDownLaneId
          );
          const currentWeek1Status = topDownLane
            ? toV2LaneWeek1Status(topDownLane.currentStatus)
            : missingLane?.includes("partial")
              ? "partial"
              : missingLane?.includes("missing")
                ? "missing"
                : exerciseMatched
                  ? "satisfied"
                  : lane.required
                    ? "missing"
                    : "warning";
          return {
            laneId: lane.laneId,
            required: lane.required,
            role: lane.role,
            primaryMuscles: lane.primaryMuscles,
            preferredExerciseClasses: lane.preferredExerciseClasses,
            targetSets: lane.targetSets,
            currentWeek1Status,
          };
        }),
      };
    }),
  };
}

function v2LaneAliases(lane: V2Lane | V2Slot["lanes"][number]): string[] {
  return uniqueSorted([
    lane.laneId,
    "targetLaneId" in lane && typeof lane.targetLaneId === "string"
      ? lane.targetLaneId
      : "",
  ]);
}

function getTopDownLane(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
}): NonNullable<
  NonNullable<PlanningRealityDiagnostic["topDownMesocyclePlan"]>["slotTargets"][number]["requiredClassLanes"][number]
> | undefined {
  const aliases = v2LaneAliases(input.lane);
  return input.noRepair?.topDownMesocyclePlan?.slotTargets
    .find((slot) => slot.slotId === input.slotId)
    ?.requiredClassLanes.find((row) => aliases.includes(row.lane));
}

function exerciseMatchesV2LaneClass(input: {
  exercise: SlotCompositionSnapshot["exercises"][number];
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  const classified = classifyPlannerOnlyExercise({ exercise: input.exercise });
  if (
    isChestSecondExposureV2Lane(input.lane) &&
    !isDirectChestLaneExercise(input.exercise)
  ) {
    return false;
  }
  if (
    input.lane.laneId === "rear_delt" &&
    !isDirectRearDeltLaneExercise(input.exercise)
  ) {
    return false;
  }
  if (isBicepsV2Lane(input.lane) && !isDirectBicepsLaneExercise(input.exercise)) {
    return false;
  }
  if (isTricepsV2Lane(input.lane) && !isDirectTricepsLaneExercise(input.exercise)) {
    return false;
  }
  const aliases = v2LaneAliases(input.lane);
  if (aliases.includes(classified.lane)) {
    return true;
  }
  const exerciseClass = classified.exerciseClass.toLowerCase();
  const targetClasses = input.lane.preferredExerciseClasses.map((value) =>
    value.toLowerCase()
  );
  return targetClasses.some(
    (targetClass) =>
      targetClass.includes(exerciseClass) ||
      exerciseClass.includes(targetClass) ||
      targetClass.split("_").some((token) => token.length > 3 && exerciseClass.includes(token))
  );
}

function isStrictV2SetBudgetLane(lane: V2Lane | V2Slot["lanes"][number]): boolean {
  return (
    lane.laneId === "squat_anchor" ||
    lane.laneId === "vertical_press" ||
    lane.laneId === "chest_secondary" ||
    lane.laneId === "chest_second_exposure" ||
    lane.laneId === "rear_delt" ||
    isBicepsV2Lane(lane) ||
    isTricepsV2Lane(lane)
  );
}

const V2_SET_POLICY_CLASS_TOKENS = new Set([
  "bench",
  "biceps",
  "calf",
  "curl",
  "delt",
  "extension",
  "fly",
  "hinge",
  "press",
  "pull",
  "raise",
  "row",
  "squat",
  "triceps",
]);

function exerciseMatchesV2LaneSetPolicyClass(input: {
  exercise: SlotCompositionSnapshot["exercises"][number];
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  const classified = classifyPlannerOnlyExercise({ exercise: input.exercise });
  if (
    isChestSecondExposureV2Lane(input.lane) &&
    !isDirectChestLaneExercise(input.exercise)
  ) {
    return false;
  }
  if (
    input.lane.laneId === "rear_delt" &&
    !isDirectRearDeltLaneExercise(input.exercise)
  ) {
    return false;
  }
  if (isBicepsV2Lane(input.lane) && !isDirectBicepsLaneExercise(input.exercise)) {
    return false;
  }
  if (isTricepsV2Lane(input.lane) && !isDirectTricepsLaneExercise(input.exercise)) {
    return false;
  }
  const aliases = v2LaneAliases(input.lane);
  if (aliases.includes(classified.lane)) {
    return true;
  }
  if (isChestSecondExposureV2Lane(input.lane)) {
    return (
      classified.exerciseClass === "chest_press" ||
      classified.exerciseClass === "chest_isolation"
    );
  }
  if (isStrictV2SetBudgetLane(input.lane)) {
    return false;
  }

  const exerciseClass = classified.exerciseClass.toLowerCase();
  const targetClasses = input.lane.preferredExerciseClasses.map((value) =>
    value.toLowerCase()
  );
  if (
    targetClasses.some(
      (targetClass) =>
        targetClass.includes(exerciseClass) || exerciseClass.includes(targetClass)
    )
  ) {
    return true;
  }

  return targetClasses.some((targetClass) =>
    targetClass
      .split("_")
      .filter((token) => V2_SET_POLICY_CLASS_TOKENS.has(token))
      .some((token) => exerciseClass.includes(token))
  );
}

function exerciseSupportsV2Lane(input: {
  exercise: SlotCompositionSnapshot["exercises"][number];
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  if (exerciseMatchesV2LaneClass(input)) {
    return true;
  }
  return input.lane.primaryMuscles.some(
    (muscle) =>
      input.exercise.primaryMuscles.includes(muscle) ||
      (input.exercise.effectiveStimulusByMuscle[muscle] ?? 0) > 0
  );
}

function isDirectRearDeltLaneExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  const name = exercise.exerciseName.toLowerCase();
  const primaryMuscles = exercise.primaryMuscles.map((muscle) =>
    muscle.toLowerCase()
  );
  const hasRearDeltPrimary =
    primaryMuscles.includes("rear delts") ||
    primaryMuscles.includes("rear delt") ||
    primaryMuscles.includes("rear_delts");
  const directName =
    name.includes("rear delt") ||
    name.includes("reverse pec deck") ||
    name.includes("reverse fly") ||
    name.includes("face pull");
  const broadPullOrRowName =
    name.includes("row") ||
    name.includes("pulldown") ||
    name.includes("pull-up");

  return directName && hasRearDeltPrimary && !broadPullOrRowName;
}

function isTricepsV2Lane(lane: V2Lane | V2Slot["lanes"][number]): boolean {
  return (
    lane.laneId === "triceps" ||
    lane.laneId === "optional_triceps_if_under_target" ||
    v2LaneAliases(lane).includes("triceps")
  );
}

function isBicepsV2Lane(lane: V2Lane | V2Slot["lanes"][number]): boolean {
  return lane.laneId === "biceps" || v2LaneAliases(lane).includes("biceps");
}

function isVerticalPressV2Lane(lane: V2Lane | V2Slot["lanes"][number]): boolean {
  return lane.laneId === "vertical_press" || v2LaneAliases(lane).includes("vertical_press");
}

function isChestSecondExposureV2Lane(
  lane: V2Lane | V2Slot["lanes"][number]
): boolean {
  return lane.laneId === "chest_second_exposure";
}

function isDirectChestLaneExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  const classified = classifyPlannerOnlyExercise({ exercise });
  return (
    exercise.primaryMuscles.some(
      (muscle) => muscle.trim().toLowerCase() === "chest"
    ) &&
    (classified.exerciseClass === "chest_press" ||
      classified.exerciseClass === "chest_isolation")
  );
}

function isDirectTricepsLaneExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  const name = exercise.exerciseName.toLowerCase();
  const primaryMuscles = exercise.primaryMuscles.map((muscle) =>
    muscle.toLowerCase()
  );
  const hasTricepsPrimary = primaryMuscles.includes("triceps");
  const directName =
    name.includes("triceps") ||
    name.includes("pressdown") ||
    name.includes("pushdown") ||
    name.includes("skull crusher") ||
    name.includes("extension") ||
    name.includes("kickback");
  const broadPressName =
    name.includes("bench") ||
    name.includes("push-up") ||
    name.includes("push up") ||
    name.includes("dip") ||
    name.includes("chest press") ||
    name.includes("shoulder press") ||
    name.includes("overhead press") ||
    (name.includes("press") && !name.includes("pressdown"));

  return hasTricepsPrimary && directName && !broadPressName;
}

function isDirectBicepsLaneExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  const name = exercise.exerciseName.toLowerCase();
  const primaryMuscles = exercise.primaryMuscles.map((muscle) =>
    muscle.toLowerCase()
  );
  const hasBicepsPrimary = primaryMuscles.includes("biceps");
  const directName =
    name.includes("curl") ||
    name.includes("biceps") ||
    name.includes("preacher") ||
    name.includes("hammer");
  const broadPullName =
    name.includes("row") ||
    name.includes("pulldown") ||
    name.includes("pull-down") ||
    name.includes("pull-up") ||
    name.includes("pullup") ||
    name.includes("chin-up") ||
    name.includes("chinup");

  return hasBicepsPrimary && directName && !broadPullName;
}

function isDirectSideDeltIsolationExercise(
  exercise: SlotCompositionSnapshot["exercises"][number]
): boolean {
  const name = exercise.exerciseName.toLowerCase();
  const classified = classifyPlannerOnlyExercise({ exercise });
  return (
    classified.lane === "side_delt_isolation" ||
    classified.exerciseClass === "lateral_raise" ||
    (exercise.primaryMuscles.includes("Side Delts") &&
      !("isCompound" in exercise && exercise.isCompound === true) &&
      (name.includes("lateral raise") || name.includes("side delt")))
  );
}

function hasDirectSideDeltExposure(input: {
  noRepair?: PlanningRealityDiagnostic;
  excludeExerciseName?: string;
}): boolean {
  return (
    input.noRepair?.finalSlotPlan.some((slot) =>
      slot.exercises.some(
        (exercise) =>
          exercise.exerciseName !== input.excludeExerciseName &&
          isDirectSideDeltIsolationExercise(exercise) &&
          (exercise.effectiveStimulusByMuscle["Side Delts"] ?? 0) > 0
      )
    ) ?? false
  );
}

function normalizeExerciseIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function chestExposureClass(
  exercise: SlotCompositionSnapshot["exercises"][number] | undefined
): string | null {
  if (!exercise || !isDirectChestLaneExercise(exercise)) {
    return null;
  }
  return classifyPlannerOnlyExercise({ exercise }).exerciseClass;
}

function firstUpperAChestAnchor(
  noRepair: PlanningRealityDiagnostic | undefined
): SlotCompositionSnapshot["exercises"][number] | undefined {
  return getSlotById(noRepair?.finalSlotPlan ?? [], "upper_a")?.exercises.find(
    (exercise) => {
      const classified = classifyPlannerOnlyExercise({ exercise });
      return (
        isDirectChestLaneExercise(exercise) &&
        (classified.lane === "chest_anchor" ||
          classified.exerciseClass === "chest_press" ||
          exercise.role === "main")
      );
    }
  );
}

function summarizeChestSecondExposureDistinctness(input: {
  noRepair?: PlanningRealityDiagnostic;
  secondExposureExercises: SlotCompositionSnapshot["exercises"];
}): {
  hasUpperSlotDistribution: boolean;
  hasSecondExposure: boolean;
  exerciseDistinct: boolean;
  classDistinct: boolean;
  duplicateExposure: boolean;
  sameClassExposure: boolean;
} {
  const upperAAnchor = firstUpperAChestAnchor(input.noRepair);
  const upperBSecond = input.secondExposureExercises.find(isDirectChestLaneExercise);
  const upperAClass = chestExposureClass(upperAAnchor);
  const upperBClass = chestExposureClass(upperBSecond);
  const upperAExerciseName = normalizeExerciseIdentity(upperAAnchor?.exerciseName);
  const upperBExerciseName = normalizeExerciseIdentity(upperBSecond?.exerciseName);
  const upperAExerciseId = normalizeExerciseIdentity(upperAAnchor?.exerciseId);
  const upperBExerciseId = normalizeExerciseIdentity(upperBSecond?.exerciseId);
  const sameExercise =
    upperAAnchor != null &&
    upperBSecond != null &&
    ((upperAExerciseId !== "" && upperAExerciseId === upperBExerciseId) ||
      (upperAExerciseName !== "" && upperAExerciseName === upperBExerciseName));
  const sameClass =
    upperAClass != null && upperBClass != null && upperAClass === upperBClass;

  return {
    hasUpperSlotDistribution: upperAAnchor != null && upperBSecond != null,
    hasSecondExposure: upperBSecond != null,
    exerciseDistinct: upperAAnchor != null && upperBSecond != null && !sameExercise,
    classDistinct: upperAClass != null && upperBClass != null && !sameClass,
    duplicateExposure: sameExercise,
    sameClassExposure: sameClass,
  };
}

function collectV2LaneExercises(input: {
  slot?: SlotCompositionSnapshot;
  lane: V2Lane | V2Slot["lanes"][number];
}): SlotCompositionSnapshot["exercises"] {
  const laneMatcher = isStrictV2SetBudgetLane(input.lane)
    ? exerciseMatchesV2LaneSetPolicyClass
    : exerciseSupportsV2Lane;
  return (input.slot?.exercises ?? [])
    .filter((exercise) => laneMatcher({ exercise, lane: input.lane }))
    .sort((left, right) => {
      const leftClassMatch = exerciseMatchesV2LaneClass({
        exercise: left,
        lane: input.lane,
      })
        ? 1
        : 0;
      const rightClassMatch = exerciseMatchesV2LaneClass({
        exercise: right,
        lane: input.lane,
      })
        ? 1
        : 0;
      return (
        rightClassMatch - leftClassMatch ||
        right.setCount - left.setCount ||
        left.exerciseName.localeCompare(right.exerciseName)
      );
    });
}

function getV2SetDistributionPolicyLanes(input: {
  intent?: V2SetDistributionIntent;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
}): V2SetDistributionIntentPolicyLane[] {
  const aliases = v2LaneAliases(input.lane);
  return (
    input.intent?.weeks.flatMap((week) => {
      const lane = week.slots
        .find((slot) => slot.slotId === input.slotId)
        ?.lanes.find((row) => aliases.includes(row.laneId));
      return lane ? [{ week: week.week, phase: week.phase, lane }] : [];
    }) ?? []
  );
}

function shareToRatio(value: number): number {
  return value > 1 ? value / 100 : value;
}

function maxV2LaneConcentrationEvidence(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
  exercises: SlotCompositionSnapshot["exercises"];
}): {
  share: number;
  muscle: string | null;
  row: PlanningRealityDiagnostic["exerciseConcentration"][number] | null;
} {
  if (input.exercises.length === 0) {
    return { share: 0, muscle: null, row: null };
  }
  const exerciseNames = new Set(input.exercises.map((exercise) => exercise.exerciseName));
  let best: {
    share: number;
    muscle: string | null;
    row: PlanningRealityDiagnostic["exerciseConcentration"][number] | null;
  } = { share: 0, muscle: null, row: null };
  for (const row of input.noRepair?.exerciseConcentration ?? []) {
    if (row.slotId !== input.slotId || !exerciseNames.has(row.exerciseName)) {
      continue;
    }
    for (const [muscle, percentage] of Object.entries(
      row.percentageOfWeeklyProjectedStimulusByMuscle
    )) {
      if (!input.lane.primaryMuscles.includes(muscle)) {
        continue;
      }
      const share = shareToRatio(percentage);
      if (share > best.share) {
        best = { share, muscle, row };
      }
    }
  }
  return best;
}

function v2LanePrimaryTargetsMet(input: {
  noRepair?: PlanningRealityDiagnostic;
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  if (!input.noRepair) {
    return false;
  }
  const weeklyTotals = sumSlotStimulusByMuscle(input.noRepair.finalSlotPlan);
  const demandByMuscle = getNoRepairDemandByMuscle(input.noRepair);
  return input.lane.primaryMuscles.every((muscle) => {
    const demand = demandByMuscle.get(muscle);
    if (demand?.minEffectiveSets == null) {
      return true;
    }
    return (weeklyTotals.get(muscle) ?? 0) >= demand.minEffectiveSets;
  });
}

function v2LaneHasPrimaryHardTarget(input: {
  noRepair: PlanningRealityDiagnostic;
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  const demandByMuscle = getNoRepairDemandByMuscle(input.noRepair);
  return input.lane.primaryMuscles.some((muscle) => {
    const demand = demandByMuscle.get(muscle);
    const semantics = getMuscleTargetSemantics(muscle);
    return (
      (demand?.priority === "primary" && demand.targetStatus === "hard") ||
      semantics.targetTier === "A_PRIMARY"
    );
  });
}

function v2LaneMuscleBelowMinimum(input: {
  noRepair: PlanningRealityDiagnostic;
  muscle: string | null;
}): boolean {
  if (!input.muscle) {
    return false;
  }
  const demand = getNoRepairDemandByMuscle(input.noRepair).get(input.muscle);
  if (demand?.minEffectiveSets == null) {
    return false;
  }
  return (sumSlotStimulusByMuscle(input.noRepair.finalSlotPlan).get(input.muscle) ?? 0) <
    demand.minEffectiveSets;
}

function v2LaneHasSecondExposure(input: {
  noRepair: PlanningRealityDiagnostic;
  muscle: string | null;
  exerciseName?: string;
}): boolean {
  if (!input.muscle) {
    return false;
  }
  let exposureCount = 0;
  for (const slot of input.noRepair.finalSlotPlan) {
    for (const exercise of slot.exercises) {
      if (
        exercise.exerciseName !== input.exerciseName &&
        (exercise.effectiveStimulusByMuscle[input.muscle] ?? 0) > 0
      ) {
        exposureCount += 1;
      }
    }
  }
  return exposureCount > 0;
}

function v2LanePrimaryTargetsMetWithDirectEvidence(input: {
  noRepair?: PlanningRealityDiagnostic;
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  if (!input.noRepair) {
    return false;
  }
  const noRepair = input.noRepair;
  const demandByMuscle = getNoRepairDemandByMuscle(noRepair);
  return input.lane.primaryMuscles.every((muscle) => {
    const demand = demandByMuscle.get(muscle);
    if (demand?.minEffectiveSets == null) {
      return true;
    }
    const directWeeklySets = noRepair.finalSlotPlan.reduce((sum, slot) => {
      return sum + slot.exercises.reduce((slotSum, exercise) => {
        const directLaneEvidence = isBicepsV2Lane(input.lane)
          ? isDirectBicepsLaneExercise(exercise)
          : exercise.primaryMuscles.includes(muscle);
        return directLaneEvidence
          ? slotSum + (exercise.effectiveStimulusByMuscle[muscle] ?? 0)
          : slotSum;
      }, 0);
    }, 0);
    return directWeeklySets >= demand.minEffectiveSets;
  });
}

function hasBicepsPullingCollateral(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
}): boolean {
  return (
    getSlotById(input.noRepair?.finalSlotPlan ?? [], input.slotId)?.exercises.some(
      (exercise) => {
        const name = exercise.exerciseName.toLowerCase();
        const patterns = exercise.movementPatterns.map((pattern) =>
          pattern.toLowerCase()
        );
        const isPulling =
          name.includes("row") ||
          name.includes("pulldown") ||
          name.includes("pull-up") ||
          name.includes("pullup") ||
          patterns.some(
            (pattern) =>
              pattern.includes("horizontal_pull") ||
              pattern.includes("vertical_pull")
          );
        return (
          isPulling &&
          !isDirectBicepsLaneExercise(exercise) &&
          (exercise.effectiveStimulusByMuscle["Biceps"] ?? 0) > 0
        );
      }
    ) ?? false
  );
}

function v2BicepsLaneDiagnosticAddenda(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
}): string[] {
  if (!input.noRepair || !isBicepsV2Lane(input.lane)) {
    return [];
  }

  const weeklyTotals = sumSlotStimulusByMuscle(input.noRepair.finalSlotPlan);
  const demandByMuscle = getNoRepairDemandByMuscle(input.noRepair);
  const bicepsDemand = demandByMuscle.get("Biceps");
  const delivered = weeklyTotals.get("Biceps") ?? 0;
  const hasPullingCollateral = hasBicepsPullingCollateral({
    noRepair: input.noRepair,
    slotId: input.slotId,
  });
  const directExposureCount = input.noRepair.finalSlotPlan.reduce((count, slot) => {
    return (
      count +
      (slot.exercises.some(
        (exercise) =>
          isDirectBicepsLaneExercise(exercise) &&
          (exercise.effectiveStimulusByMuscle["Biceps"] ?? 0) > 0
      )
        ? 1
        : 0)
    );
  }, 0);
  const belowMinimum =
    bicepsDemand?.minEffectiveSets != null &&
    delivered < bicepsDemand.minEffectiveSets;

  if (!bicepsDemand && delivered <= 0 && !hasPullingCollateral && directExposureCount === 0) {
    return [];
  }

  return [
    ...(belowMinimum ? ["target_delivery:below_min"] : []),
    ...(directExposureCount === 0
      ? ["exposure:missing_direct_curl"]
      : directExposureCount === 1
        ? ["exposure:single_direct_curl"]
        : ["exposure:multiple_direct_curls"]),
    ...(hasPullingCollateral ? ["concentration:pulling_collateral"] : []),
  ];
}

function v2LaneFatigueRisk(
  exercises: SlotCompositionSnapshot["exercises"]
): { axial: boolean; systemic: boolean } {
  return exercises.reduce<{ axial: boolean; systemic: boolean }>(
    (risk, exercise) => {
      const haystack = [
        exercise.exerciseName,
        exercise.role,
        ...exercise.movementPatterns,
      ]
        .join(" ")
        .toLowerCase();
      return {
        axial:
          risk.axial ||
          haystack.includes("axial_fatigue") ||
          haystack.includes("axial fatigue") ||
          haystack.includes("axial_loading") ||
          haystack.includes("spinal_loading"),
        systemic:
          risk.systemic ||
          haystack.includes("systemic_fatigue") ||
          haystack.includes("systemic fatigue") ||
          haystack.includes("excessive_systemic"),
      };
    },
    { axial: false, systemic: false }
  );
}

function isSmallV2TargetDenominator(input: {
  noRepair: PlanningRealityDiagnostic;
  muscle: string | null;
  budget: V2SetDistributionIntentLane["setBudget"];
}): boolean {
  if (!input.muscle) {
    return input.budget.preferred <= 3;
  }
  const demand = getNoRepairDemandByMuscle(input.noRepair).get(input.muscle);
  const weeklyEffectiveSets =
    sumSlotStimulusByMuscle(input.noRepair.finalSlotPlan).get(input.muscle) ?? 0;
  return (
    input.budget.preferred <= 3 ||
    (demand?.preferredEffectiveSets != null && demand.preferredEffectiveSets <= 4) ||
    weeklyEffectiveSets <= 4
  );
}

function isLowSystemicFatigueV2Lane(
  exercises: SlotCompositionSnapshot["exercises"]
): boolean {
  if (exercises.length === 0) {
    return false;
  }
  return exercises.every((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    const patterns = exercise.movementPatterns.map((pattern) =>
      pattern.toLowerCase()
    );
    return (
      exercise.role !== "main" &&
      !name.includes("deadlift") &&
      !name.includes("squat") &&
      !name.includes("good morning") &&
      !patterns.some(
        (pattern) =>
          pattern.includes("hinge") ||
          pattern.includes("squat") ||
          pattern.includes("axial")
      )
    );
  });
}

function v2SetBudgetDiagnostics(input: {
  setCount: number;
  budget: V2SetDistributionIntentLane["setBudget"];
  status: V2LaneSetPolicyStatus;
}): string[] {
  if (input.setCount < input.budget.min) {
    return [];
  }
  if (input.setCount <= input.budget.preferred) {
    return ["setBudget:within_preferred"];
  }
  if (input.setCount <= input.budget.max) {
    return ["setBudget:above_preferred", "setBudget:within_planned_max"];
  }
  return input.status === "allowed_expansion"
    ? ["setBudget:above_preferred", "setBudget:allowed_expansion"]
    : ["setBudget:above_preferred", "setBudget:requires_justification"];
}

function v2SetBudgetJustifications(input: {
  setCount: number;
  budget: V2SetDistributionIntentLane["setBudget"];
  policyLane: V2SetDistributionIntentLane;
  policyLanes: V2SetDistributionIntentPolicyLane[];
  targetMet: boolean;
  lowSystemicFatigueLane: boolean;
}): string[] {
  if (input.setCount <= input.budget.max) {
    return ["justification:none"];
  }

  const justifications: string[] = [];
  const phaseExpansion = input.policyLanes.some(
    (policy) =>
      (policy.phase === "hard_accumulation" ||
        policy.phase === "peak_overreach_lite") &&
      input.setCount <= policy.lane.setBudget.max
  );
  if (input.policyLane.role === "anchor") {
    justifications.push("justification:slot_anchor");
  }
  if (phaseExpansion) {
    justifications.push("justification:phase_expansion");
  }
  if (!input.targetMet) {
    justifications.push("justification:target_underdelivery");
  }
  if (input.lowSystemicFatigueLane) {
    justifications.push("justification:low_systemic_fatigue");
  }
  return justifications.length > 0
    ? uniqueSorted(justifications)
    : ["justification:none"];
}

function evaluateV2LaneSetPolicy(input: {
  noRepair?: PlanningRealityDiagnostic;
  policyLanes: V2SetDistributionIntentPolicyLane[];
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
  noRepairExercises: SlotCompositionSnapshot["exercises"];
}): {
  status: V2LaneSetPolicyStatus;
  diagnostics: string[];
} {
  const policyLane = input.policyLanes.find((policy) => policy.week === 1)?.lane ??
    input.policyLanes[0]?.lane;
  if (!input.noRepair || !policyLane) {
    return {
      status: "unknown",
      diagnostics: ["setPolicy:unknown"],
    };
  }

  const classMatched = input.noRepairExercises.filter((exercise) =>
    exerciseMatchesV2LaneSetPolicyClass({ exercise, lane: input.lane })
  );
  const policyExercises = classMatched.length > 0
    ? classMatched
    : input.noRepairExercises;
  const setCount = policyExercises.reduce(
    (sum, exercise) => sum + exercise.setCount,
    0
  );
  const maxExerciseSets = Math.max(
    0,
    ...policyExercises.map((exercise) => exercise.setCount)
  );
  const budget = policyLane.setBudget;
  const cap = policyLane.capPolicy;
  const concentration = policyLane.concentrationPolicy;
  const phaseExpansionMax = Math.max(
    budget.max + 1,
    ...input.policyLanes
      .filter(
        (policy) =>
          policy.phase === "hard_accumulation" ||
          policy.phase === "peak_overreach_lite"
      )
      .map((policy) => policy.lane.setBudget.max)
  );
  const allowedExpansionMax = Math.min(
    phaseExpansionMax,
    cap.maxSetsPerExerciseWithoutJustification * Math.max(1, cap.maxDirectExercises)
  );
  const concentrationEvidence = maxV2LaneConcentrationEvidence({
    noRepair: input.noRepair,
    slotId: input.slotId,
    lane: input.lane,
    exercises: policyExercises,
  });
  const concentrationShare = concentrationEvidence.share;
  const targetMet = v2LanePrimaryTargetsMet({
    noRepair: input.noRepair,
    lane: input.lane,
  });
  const directTargetMet = v2LanePrimaryTargetsMetWithDirectEvidence({
    noRepair: input.noRepair,
    lane: input.lane,
  });
  const lowSystemicFatigueLane = isLowSystemicFatigueV2Lane(policyExercises);
  const fatigueRisk = v2LaneFatigueRisk(policyExercises);
  const justifications = v2SetBudgetJustifications({
    setCount,
    budget,
    policyLane,
    policyLanes: input.policyLanes,
    targetMet,
    lowSystemicFatigueLane,
  });
  const hasJustification = justifications.some(
    (row) => row !== "justification:none"
  );
  const aboveFiveSets = maxExerciseSets > 5;
  const overRoleCap =
    maxExerciseSets > cap.maxSetsPerExerciseWithoutJustification &&
    maxExerciseSets <= 5;
  const laneHasPrimaryHardTarget = v2LaneHasPrimaryHardTarget({
    noRepair: input.noRepair,
    lane: input.lane,
  });
  const supportTierConcentration =
    concentration.appliesTo === "support_target" && !laneHasPrimaryHardTarget;
  const smallTargetDenominator = isSmallV2TargetDenominator({
    noRepair: input.noRepair,
    muscle: concentrationEvidence.muscle,
    budget,
  });
  const directLaneOwnedExercise =
    concentrationEvidence.muscle != null &&
    (concentrationEvidence.row?.primaryMuscles.includes(concentrationEvidence.muscle) ??
      false);
  const laneOwnedPolicyExercise =
    concentrationEvidence.row != null &&
    policyExercises.some(
      (exercise) => exercise.exerciseName === concentrationEvidence.row?.exerciseName
    );
  const cleanDirectIsolation =
    directLaneOwnedExercise &&
    concentrationEvidence.row != null &&
    !concentrationEvidence.row.isCompound &&
    lowSystemicFatigueLane;
  const dirtyCollateral =
    supportTierConcentration &&
    concentration.appliesTo !== "diagnostic_only" &&
    concentrationShare >= concentration.warningShare &&
    (concentrationEvidence.row?.isCompound ?? false);
  const belowMinimum = v2LaneMuscleBelowMinimum({
    noRepair: input.noRepair,
    muscle: concentrationEvidence.muscle,
  });
  const hasSecondExposure = v2LaneHasSecondExposure({
    noRepair: input.noRepair,
    muscle: concentrationEvidence.muscle,
    exerciseName: concentrationEvidence.row?.exerciseName,
  });
  const cleanAlternativeIgnored =
    concentrationEvidence.muscle != null &&
    hasExplicitCleanAlternativeSignal({
      planningReality: input.noRepair,
      muscle: concentrationEvidence.muscle,
      slotId: input.slotId,
    });
  const concentrationWarning =
    concentration.appliesTo !== "diagnostic_only" &&
    concentrationShare >= concentration.warningShare;
  const primaryAnchorConcentration =
    concentration.appliesTo === "primary_target" && input.lane.role === "anchor";
  const squatAnchorConcentration =
    input.lane.laneId === "squat_anchor" && primaryAnchorConcentration;
  const verticalPressAnchorConcentration =
    isVerticalPressV2Lane(input.lane) && primaryAnchorConcentration;
  const chestSecondExposureConcentration =
    isChestSecondExposureV2Lane(input.lane) && concentrationWarning;
  const chestSecondExposureDistinctness =
    chestSecondExposureConcentration
      ? summarizeChestSecondExposureDistinctness({
          noRepair: input.noRepair,
          secondExposureExercises: policyExercises,
        })
      : null;
  const repairCreatedConcentration =
    concentrationEvidence.row?.producedOrIncreasedByRepair ?? false;
  const withinPlannedSetBudget =
    setCount <= budget.max &&
    maxExerciseSets <= cap.maxSetsPerExerciseWithoutJustification;
  const squatAnchorExpectedConcentration =
    squatAnchorConcentration &&
    concentrationWarning &&
    directLaneOwnedExercise &&
    directTargetMet &&
    hasSecondExposure &&
    withinPlannedSetBudget &&
    !aboveFiveSets &&
    !repairCreatedConcentration &&
    !fatigueRisk.axial &&
    !fatigueRisk.systemic;
  const directSideDeltExposure = hasDirectSideDeltExposure({
    noRepair: input.noRepair,
    excludeExerciseName: concentrationEvidence.row?.exerciseName,
  });
  const verticalPressCollateralExpected =
    verticalPressAnchorConcentration &&
    concentrationWarning &&
    laneOwnedPolicyExercise &&
    withinPlannedSetBudget &&
    directSideDeltExposure &&
    concentrationEvidence.muscle === "Front Delts" &&
    !aboveFiveSets &&
    !repairCreatedConcentration &&
    !fatigueRisk.axial &&
    !fatigueRisk.systemic;
  const anchorExpectedConcentration =
    squatAnchorExpectedConcentration || verticalPressCollateralExpected;
  const concentrationBlocker =
    concentration.appliesTo !== "diagnostic_only" &&
    concentrationShare > concentration.blockerShare &&
    !(
      chestSecondExposureDistinctness?.hasUpperSlotDistribution === true &&
      chestSecondExposureDistinctness.exerciseDistinct &&
      chestSecondExposureDistinctness.classDistinct &&
      withinPlannedSetBudget &&
      directTargetMet &&
      !aboveFiveSets &&
      !repairCreatedConcentration &&
      !fatigueRisk.axial &&
      !fatigueRisk.systemic
    ) &&
    !anchorExpectedConcentration &&
    (laneHasPrimaryHardTarget ||
      !supportTierConcentration ||
      (belowMinimum && !hasSecondExposure) ||
      !cleanDirectIsolation ||
      (!smallTargetDenominator && cleanAlternativeIgnored));
  const concentratedUnderdelivery =
    concentrationWarning && setCount < budget.min && !targetMet;
  const concentrationDiagnostics: string[] = [];
  if (supportTierConcentration && concentrationWarning) {
    concentrationDiagnostics.push(
      "concentration:support_tier",
      ...(smallTargetDenominator ? ["concentration:small_denominator"] : []),
      ...(dirtyCollateral ? ["concentration:dirty_collateral"] : []),
      ...(cleanDirectIsolation ? ["concentration:justified_direct_isolation"] : []),
      ...(concentrationBlocker ? ["concentration:needs_diversification"] : []),
      ...(cleanDirectIsolation ? ["justification:low_systemic_fatigue"] : []),
      ...(cleanDirectIsolation && smallTargetDenominator
        ? ["justification:small_target_denominator"]
        : [])
    );
  }
  if (primaryAnchorConcentration && concentrationWarning) {
    concentrationDiagnostics.push(
      "concentration:primary_anchor",
      ...(concentrationShare > concentration.blockerShare
        ? ["concentration:over_60_share"]
        : []),
      ...(anchorExpectedConcentration
        ? squatAnchorExpectedConcentration
          ? [
              "concentration:anchor_expected",
              "concentration:quality_warning",
              "justification:squat_anchor",
              "justification:second_quad_exposure",
              "justification:weekly_target_met",
            ]
          : [
              "concentration:vertical_press",
              "concentration:pressing_collateral",
              "concentration:quality_warning",
              "justification:vertical_press_lane",
              "justification:direct_side_delt_exposure",
              "justification:front_delt_collateral_expected",
              ...(targetMet ? ["justification:weekly_target_met"] : []),
            ]
        : [
            ...(concentrationBlocker ? ["concentration:true_blocker"] : []),
            ...(!hasSecondExposure ? ["concentration:needs_diversification"] : []),
            ...(directTargetMet ? ["justification:weekly_target_met"] : []),
            "justification:none",
          ]),
      ...(fatigueRisk.axial ? ["risk:axial_fatigue", "risk:joint_fatigue"] : []),
      ...(fatigueRisk.systemic ? ["risk:systemic_fatigue"] : [])
    );
  }
  if (chestSecondExposureConcentration && chestSecondExposureDistinctness) {
    const distinctJustified =
      chestSecondExposureDistinctness.hasUpperSlotDistribution &&
      chestSecondExposureDistinctness.exerciseDistinct &&
      chestSecondExposureDistinctness.classDistinct &&
      withinPlannedSetBudget &&
      directTargetMet &&
      !aboveFiveSets &&
      !repairCreatedConcentration &&
      !fatigueRisk.axial &&
      !fatigueRisk.systemic;
    concentrationDiagnostics.push(
      "concentration:chest_primary",
      "concentration:second_exposure",
      ...(concentrationShare > concentration.blockerShare
        ? ["concentration:over_60_share"]
        : []),
      ...(chestSecondExposureDistinctness.exerciseDistinct
        ? ["concentration:exercise_distinct"]
        : ["concentration:duplicate_exposure"]),
      ...(chestSecondExposureDistinctness.classDistinct
        ? ["concentration:class_distinct"]
        : ["concentration:needs_distinct_exposure"]),
      ...(distinctJustified
        ? [
            "concentration:quality_warning",
            "justification:second_chest_exposure",
            "justification:weekly_target_met",
            "justification:upper_slot_distribution",
            "justification:class_distinct",
          ]
        : [
            ...(concentrationBlocker ? ["concentration:true_blocker"] : []),
            ...(!chestSecondExposureDistinctness.hasUpperSlotDistribution ||
            !chestSecondExposureDistinctness.classDistinct ||
            !chestSecondExposureDistinctness.exerciseDistinct
              ? ["concentration:needs_distinct_exposure"]
              : []),
            ...(directTargetMet ? ["justification:weekly_target_met"] : []),
            "justification:none",
          ]),
      ...(fatigueRisk.axial ? ["risk:axial_fatigue", "risk:joint_fatigue"] : []),
      ...(fatigueRisk.systemic ? ["risk:systemic_fatigue"] : [])
    );
  }

  let status: V2LaneSetPolicyStatus = "in_budget";
  let reason: string | null = null;
  if (aboveFiveSets) {
    status = "hard_blocker";
    reason = "gt_5_sets";
  } else if (fatigueRisk.axial || fatigueRisk.systemic) {
    status = "hard_blocker";
    reason = fatigueRisk.axial ? "axial_fatigue" : "systemic_fatigue";
  } else if (concentrationBlocker) {
    status = "hard_blocker";
    reason = "over_60_share";
  } else if (concentratedUnderdelivery) {
    status = "hard_blocker";
    reason = "underdelivery_hidden_by_concentration";
  } else if (setCount < budget.min) {
    status = "under_budget";
  } else if ((overRoleCap || setCount > budget.max) && !hasJustification) {
    status = "requires_justification";
    reason = overRoleCap ? "over_role_cap" : "over_planned_max";
  } else if (setCount > allowedExpansionMax) {
    status = "requires_justification";
    reason = "over_allowed_expansion";
  } else if (setCount > budget.max || overRoleCap) {
    status = "allowed_expansion";
  } else if (concentrationWarning) {
    status = "quality_warning";
    reason = supportTierConcentration ? null : "warning_share";
    concentrationDiagnostics.push("concentration:quality_warning");
  }

  const diagnosticJustifications =
    concentrationDiagnostics.some((row) => row.startsWith("justification:"))
      ? justifications.filter((row) => row !== "justification:none")
      : justifications;

  return {
    status,
    diagnostics: compactV2LaneDiagnostics([
      `setPolicy:${status}`,
      ...(reason ? [`setPolicyReason:${reason}`] : []),
      ...v2SetBudgetDiagnostics({ setCount, budget, status }),
      ...diagnosticJustifications,
      ...concentrationDiagnostics,
    ], chestSecondExposureConcentration ? 14 : primaryAnchorConcentration ? 12 : 8),
  };
}

function formatV2SelectedExercises(input: {
  exercises: SlotCompositionSnapshot["exercises"];
  lane: V2Lane | V2Slot["lanes"][number];
}): V2TargetVsNoRepairLaneDiff["currentEvidence"]["selectedExercises"] {
  return input.exercises.slice(0, 3).map((exercise) => {
    const classified = classifyPlannerOnlyExercise({ exercise });
    return {
      name: exercise.exerciseName,
      sets: exercise.setCount,
      ...(exerciseMatchesV2LaneClass({ exercise, lane: input.lane })
        ? { matchedClass: classified.exerciseClass }
        : {}),
      role: exercise.role,
    };
  });
}

function includesAnyLaneToken(value: string, lane: V2Lane | V2Slot["lanes"][number]): boolean {
  const normalized = value.toLowerCase();
  const tokens = normalized
    .split(/[:|,]/)
    .map((token) => token.trim())
    .filter(Boolean);
  return (
    v2LaneAliases(lane).some((alias) => normalized.includes(alias.toLowerCase())) ||
    lane.primaryMuscles.some((muscle) => {
      const normalizedMuscle = muscle.toLowerCase();
      return tokens.some(
        (token) =>
          token === normalizedMuscle ||
          token.startsWith(`${normalizedMuscle}=`) ||
          token.startsWith(`${normalizedMuscle}:`)
      );
    })
  );
}

function strictLaneExerciseNamesFromFinalPlan(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
}): SlotCompositionSnapshot["exercises"] {
  if (!input.noRepair || !isStrictV2SetBudgetLane(input.lane)) {
    return [];
  }
  return (getSlotById(input.noRepair.finalSlotPlan, input.slotId)?.exercises ?? [])
    .filter((exercise) =>
      exerciseMatchesV2LaneSetPolicyClass({ exercise, lane: input.lane })
    );
}

function strictDirectSupportConcentrationDiagnostics(input: {
  diagnostics: string[];
  exercises: SlotCompositionSnapshot["exercises"];
  lane: V2Lane | V2Slot["lanes"][number];
}): string[] {
  if (
    input.exercises.length === 0 ||
    input.lane.role === "anchor" ||
    input.lane.role === "optional"
  ) {
    return [];
  }
  const exerciseNames = new Set(
    input.exercises.map((exercise) => exercise.exerciseName.toLowerCase())
  );
  const supportTierLane =
    isTricepsV2Lane(input.lane) ||
    input.lane.primaryMuscles.every(
      (muscle) => getMuscleTargetSemantics(muscle).targetTier !== "A_PRIMARY"
    );
  if (!supportTierLane) {
    return [];
  }
  const hasDirectShareWarning = input.diagnostics.some((diagnostic) => {
    const normalized = diagnostic.toLowerCase();
    return (
      normalized.includes("single_exercise_share") &&
      input.lane.primaryMuscles.some((muscle) =>
        normalized.includes(muscle.toLowerCase())
      ) &&
      Array.from(exerciseNames).some((name) => normalized.includes(name))
    );
  });
  if (
    !(hasDirectShareWarning || input.diagnostics.includes("setPolicy:quality_warning")) ||
    !(
      isLowSystemicFatigueV2Lane(input.exercises) ||
      (isTricepsV2Lane(input.lane) &&
        input.exercises.every((exercise) => exercise.role !== "main"))
    )
  ) {
    return [];
  }
  const smallTargetDenominator = input.lane.targetSets.preferred <= 3;
  return [
    "concentration:support_tier",
    ...(smallTargetDenominator ? ["concentration:small_denominator"] : []),
    "concentration:quality_warning",
    "concentration:justified_direct_isolation",
    "justification:low_systemic_fatigue",
    ...(smallTargetDenominator
      ? ["justification:small_target_denominator"]
      : []),
  ];
}

function strictChestSecondExposureConcentrationDiagnostics(input: {
  diagnostics: string[];
  exercises: SlotCompositionSnapshot["exercises"];
  lane: V2Lane | V2Slot["lanes"][number];
  noRepair?: PlanningRealityDiagnostic;
}): string[] {
  if (
    !isChestSecondExposureV2Lane(input.lane) ||
    input.exercises.length === 0
  ) {
    return [];
  }
  const exerciseNames = new Set(
    input.exercises.map((exercise) => exercise.exerciseName.toLowerCase())
  );
  const hasDirectShareWarning = input.diagnostics.some((diagnostic) => {
    const normalized = diagnostic.toLowerCase();
    return (
      normalized.includes("single_exercise_share") &&
      normalized.includes("chest") &&
      Array.from(exerciseNames).some((name) => normalized.includes(name))
    );
  });
  if (!hasDirectShareWarning) {
    return [];
  }
  const distinctness = summarizeChestSecondExposureDistinctness({
    noRepair: input.noRepair,
    secondExposureExercises: input.exercises,
  });
  const targetMet = v2LanePrimaryTargetsMetWithDirectEvidence({
    noRepair: input.noRepair,
    lane: input.lane,
  });
  const distinctJustified =
    targetMet &&
    distinctness.hasUpperSlotDistribution &&
    distinctness.exerciseDistinct &&
    distinctness.classDistinct;

  return [
    "concentration:chest_primary",
    "concentration:second_exposure",
    ...(distinctness.exerciseDistinct
      ? ["concentration:exercise_distinct"]
      : ["concentration:duplicate_exposure"]),
    ...(distinctness.classDistinct
      ? ["concentration:class_distinct"]
      : ["concentration:needs_distinct_exposure"]),
    "concentration:quality_warning",
    ...(distinctJustified
      ? [
          "justification:second_chest_exposure",
          "justification:weekly_target_met",
          "justification:upper_slot_distribution",
          "justification:class_distinct",
        ]
      : [
          ...(targetMet ? ["justification:weekly_target_met"] : []),
          "justification:none",
        ]),
  ];
}

function collectV2LaneDiagnostics(input: {
  noRepair?: PlanningRealityDiagnostic;
  repaired?: PlanningRealityDiagnostic;
  noRepairSlotPlan?: MesocycleExplainPlannerOnlyNoRepair["slotPlans"][number];
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
  repairedCreatesLane: boolean;
  setPolicyDiagnostics: string[];
}): string[] {
  const noRepair = input.noRepair;
  const topDownLane = getTopDownLane({
    noRepair,
    slotId: input.slotId,
    lane: input.lane,
  });
  const diagnostics: string[] = [
    ...input.setPolicyDiagnostics,
    ...(topDownLane
      ? [
          `target_status:${topDownLane.currentStatus}`,
          ...topDownLane.evidenceRefs,
          ...topDownLane.limitations,
        ]
      : ["target_status:unknown"]),
    ...(input.noRepairSlotPlan?.missingLanes.filter((row) =>
      includesAnyLaneToken(row, input.lane)
    ) ?? []),
    ...(input.noRepairSlotPlan?.unresolvedDemand.filter((row) =>
      includesAnyLaneToken(row, input.lane)
    ) ?? []),
    ...(input.noRepairSlotPlan?.validationFailures.filter((row) =>
      includesAnyLaneToken(row, input.lane)
    ) ?? []),
    ...(input.repairedCreatesLane ? ["repair_dependent:repaired_projection_has_lane"] : []),
  ];

  if (
    isStrictV2SetBudgetLane(input.lane) &&
    input.setPolicyDiagnostics.includes("setPolicy:in_budget")
  ) {
    const strictExercises = strictLaneExerciseNamesFromFinalPlan({
      noRepair,
      slotId: input.slotId,
      lane: input.lane,
    });
    const bicepsAddenda = v2BicepsLaneDiagnosticAddenda({
      noRepair,
      slotId: input.slotId,
      lane: input.lane,
    });
    const chestSecondExposureDiagnostics =
      strictChestSecondExposureConcentrationDiagnostics({
        diagnostics,
        exercises: strictExercises,
        lane: input.lane,
        noRepair,
      });
    const explainedConcentrationDiagnostics =
      chestSecondExposureDiagnostics.length > 0
        ? chestSecondExposureDiagnostics
        : strictDirectSupportConcentrationDiagnostics({
            diagnostics,
            exercises: strictExercises,
            lane: input.lane,
          });
    const compactDiagnostics =
      explainedConcentrationDiagnostics.length > 0
        ? [
            ...input.setPolicyDiagnostics.filter(
              (row) => row !== "setPolicy:in_budget"
            ),
            "setPolicy:quality_warning",
            ...explainedConcentrationDiagnostics,
            ...bicepsAddenda,
          ]
        : [...input.setPolicyDiagnostics, ...bicepsAddenda];
    return compactV2LaneDiagnostics(
      relabelStaleCalvesShortfallDiagnostics({
        noRepair,
        slotId: input.slotId,
        lane: input.lane,
        diagnostics: compactDiagnostics,
      }),
      chestSecondExposureDiagnostics.length > 0
        ? 14
        : explainedConcentrationDiagnostics.length > 0
          ? 8
          : 6
    );
  }

  if (!noRepair) {
    return compactV2LaneDiagnostics([...diagnostics, "planningReality_missing"], 6);
  }

  const strictLaneExerciseNames = new Set(
    strictLaneExerciseNamesFromFinalPlan({
      noRepair,
      slotId: input.slotId,
      lane: input.lane,
    }).map((exercise) => exercise.exerciseName)
  );

  diagnostics.push(
    ...(noRepair.exerciseClassUnresolvedCauses ?? [])
      .filter(
        (row) =>
          row.slotId === input.slotId &&
          input.lane.primaryMuscles.includes(row.muscle)
      )
      .map(
        (row) =>
          `class_cause:${row.muscle}:${row.owningCause}:${row.behaviorReadiness}`
      )
  );
  diagnostics.push(
    ...(noRepair.duplicateContinuityJustification?.duplicates ?? [])
      .filter((row) => row.duplicatedInSlots.includes(input.slotId))
      .filter(
        (row) =>
          row.primaryMuscles.some((muscle) =>
            input.lane.primaryMuscles.includes(muscle)
          ) ||
          includesAnyLaneToken(row.exerciseClass ?? "", input.lane)
      )
      .map(
        (row) =>
          `duplicate:${row.exerciseName}:${row.justification}:${row.risk}`
      )
  );
  diagnostics.push(
    ...(noRepair.exerciseConcentration ?? [])
      .filter((row) => row.slotId === input.slotId)
      .filter((row) => row.flags.length > 0)
      .filter(
        (row) =>
          !isStrictV2SetBudgetLane(input.lane) ||
          strictLaneExerciseNames.has(row.exerciseName)
      )
      .flatMap((row) =>
        Object.entries(row.percentageOfWeeklyProjectedStimulusByMuscle)
          .filter(([muscle]) => input.lane.primaryMuscles.includes(muscle))
          .map(
            ([muscle, percentage]) =>
              `concentration:${row.exerciseName}:${muscle}:${roundOne(percentage)}%`
          )
      )
  );
  diagnostics.push(
    ...(noRepair.distributionGuardActions ?? [])
      .filter(
        (row) =>
          row.slotId === input.slotId &&
          input.lane.primaryMuscles.includes(row.muscle)
      )
      .map(
        (row) =>
          `distribution_guard:${row.exerciseName}:${row.attemptedAction}:${row.decision}`
      )
  );
  diagnostics.push(
    ...(noRepair.forbiddenCleanupReroute?.reroutedDemand ?? [])
      .filter(
        (row) =>
          (row.fromSlotId === input.slotId || row.toSlotId === input.slotId) &&
          input.lane.primaryMuscles.includes(row.muscle)
      )
      .map(
        (row) =>
          `forbidden_cleanup:${row.muscle}:${row.reason}`
      )
  );
  diagnostics.push(
    ...(input.repaired?.repairMaterialityAfterShadowAllocation ?? [])
      .filter(
        (row) =>
          row.slotId === input.slotId &&
          row.muscle != null &&
          input.lane.primaryMuscles.includes(row.muscle) &&
          (row.materiality === "moderate" || row.materiality === "major")
      )
      .map(
        (row) =>
          `repaired_repair:${row.muscle}:${row.exerciseName ?? "unknown"}:${row.materiality}`
      )
  );
  diagnostics.push(
    ...v2BicepsLaneDiagnosticAddenda({
      noRepair,
      slotId: input.slotId,
      lane: input.lane,
    })
  );

  const explainedConcentrationDiagnostics =
    strictDirectSupportConcentrationDiagnostics({
      diagnostics,
      exercises: strictLaneExerciseNamesFromFinalPlan({
        noRepair,
        slotId: input.slotId,
        lane: input.lane,
      }),
      lane: input.lane,
    });
  const finalDiagnostics =
    explainedConcentrationDiagnostics.length > 0
      ? [
          ...diagnostics.filter((row) => row !== "justification:none"),
          ...explainedConcentrationDiagnostics,
        ]
      : diagnostics;

  return compactV2LaneDiagnostics(
    relabelStaleCalvesShortfallDiagnostics({
      noRepair,
      slotId: input.slotId,
      lane: input.lane,
      diagnostics: finalDiagnostics,
    }),
    finalDiagnostics.includes("concentration:primary_anchor")
      ? 12
      : finalDiagnostics.includes("concentration:second_exposure")
        ? 14
      : finalDiagnostics.includes("concentration:support_tier")
        ? 8
        : 6
  );
}

function isCalvesV2Lane(lane: V2Lane | V2Slot["lanes"][number]): boolean {
  return lane.primaryMuscles.includes("Calves") || lane.laneId === "calves";
}

function calvesLaneWorkSatisfiesTarget(input: {
  noRepair: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
}): boolean {
  const calfExercises = collectV2LaneExercises({
    slot: getSlotById(input.noRepair.finalSlotPlan, input.slotId),
    lane: input.lane,
  }).filter(
    (exercise) =>
      exercise.primaryMuscles.includes("Calves") ||
      (exercise.effectiveStimulusByMuscle.Calves ?? 0) > 0
  );
  const calfSets = calfExercises.reduce(
    (sum, exercise) => sum + (exercise.effectiveStimulusByMuscle.Calves ?? 0),
    0
  );
  return roundOne(calfSets) >= input.lane.targetSets.min;
}

function weeklyCalvesWithinTarget(noRepair: PlanningRealityDiagnostic): boolean {
  const weeklyCalves = buildNoRepairWeeklyMuscleTotals(noRepair).find(
    (row) => row.muscle === "Calves"
  );
  return (
    weeklyCalves?.status === "within" &&
    weeklyCalves.targetMin != null &&
    weeklyCalves.projectedEffectiveSets >= weeklyCalves.targetMin
  );
}

function isStaleCalvesShortfallDiagnostic(diagnostic: string): boolean {
  const normalized = diagnostic.toLowerCase();
  return (
    normalized === "target_delivery:below_min" ||
    (normalized.includes("calves") &&
      (normalized.includes("below") ||
        normalized.includes("missing") ||
        normalized.includes("shortfall") ||
        normalized.includes("unresolved") ||
        normalized.includes("repair_would_be_needed_here")))
  );
}

function relabelStaleCalvesShortfallDiagnostics(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotId: string;
  lane: V2Lane | V2Slot["lanes"][number];
  diagnostics: string[];
}): string[] {
  if (
    !input.noRepair ||
    !isCalvesV2Lane(input.lane) ||
    !weeklyCalvesWithinTarget(input.noRepair) ||
    !calvesLaneWorkSatisfiesTarget({
      noRepair: input.noRepair,
      slotId: input.slotId,
      lane: input.lane,
    })
  ) {
    return input.diagnostics;
  }

  let relabelled = false;
  const diagnostics = input.diagnostics.flatMap((diagnostic) => {
    if (!isStaleCalvesShortfallDiagnostic(diagnostic)) {
      return [diagnostic];
    }
    relabelled = true;
    return [];
  });
  return relabelled
    ? [
        ...diagnostics,
        "readout_note:stale_calves_shortfall_suppressed_weekly_within_lane_satisfied",
      ]
    : diagnostics;
}

function compactV2LaneDiagnostics(evidence: string[], limit = 6): string[] {
  const unique = uniqueSorted(evidence.filter(Boolean));
  const setPolicy = unique.filter((row) => row.startsWith("setPolicy"));
  const setBudget = unique.filter((row) => row.startsWith("setBudget"));
  const justification = unique.filter((row) => row.startsWith("justification"));
  const readoutNotes = unique.filter((row) => row.startsWith("readout_note:"));
  const concentrationPolicyTokens = new Set<string>([
    "concentration:support_tier",
    "concentration:vertical_press",
    "concentration:pressing_collateral",
    "concentration:primary_anchor",
    "concentration:anchor_expected",
    "concentration:small_denominator",
    "concentration:quality_warning",
    "concentration:true_blocker",
    "concentration:over_60_share",
    "concentration:chest_primary",
    "concentration:second_exposure",
    "concentration:needs_distinct_exposure",
    "concentration:duplicate_exposure",
    "concentration:class_distinct",
    "concentration:exercise_distinct",
    "concentration:justified_direct_isolation",
    "concentration:dirty_collateral",
    "concentration:needs_diversification",
    "concentration:pulling_collateral",
    "risk:axial_fatigue",
    "risk:joint_fatigue",
    "risk:systemic_fatigue",
  ]);
  const concentrationPolicy = unique.filter(
    (row) => concentrationPolicyTokens.has(row)
  );
  const other = unique.filter(
    (row) =>
      !row.startsWith("setPolicy") &&
      !row.startsWith("setBudget") &&
      !row.startsWith("justification") &&
      !row.startsWith("readout_note:") &&
      !concentrationPolicyTokens.has(row)
  );
  const blockerOther = other.filter((row) => {
    const lower = row.toLowerCase();
    return (
      lower.includes("forbidden") ||
      lower.includes("dirty") ||
      lower.includes("hard_blocker") ||
      lower.includes("gt_5") ||
      lower.includes("systemic_fatigue") ||
      lower.includes("axial_fatigue")
    );
  });
  const nonBlockerOther = other.filter((row) => !blockerOther.includes(row));
  const compact = [
    ...setPolicy,
    ...setBudget,
    ...blockerOther,
    ...justification,
    ...readoutNotes,
    ...concentrationPolicy,
    ...nonBlockerOther,
  ].slice(0, limit);
  return compact.length > 0 ? compact : ["none"];
}

function inferV2GapCause(input: {
  status: V2TargetVsNoRepairLaneDiff["currentStatus"];
  diagnostics: string[];
}): V2TargetVsNoRepairLaneDiff["gapCause"] {
  if (input.status === "satisfied") return "none";
  if (input.status === "repair_dependent") return "repair_dependency";
  const joined = input.diagnostics.join("|").toLowerCase();
  if (joined.includes("inventory:") || joined.includes("inventory_gap")) {
    return "inventory_gap";
  }
  if (
    joined.includes("inventory_classification_gap") ||
    joined.includes("classification")
  ) {
    return "classification_gap";
  }
  if (
    joined.includes("setpolicyreason:over_60_share") ||
    joined.includes("setpolicyreason:underdelivery_hidden_by_concentration")
  ) {
    return "concentration_policy_gap";
  }
  if (
    joined.includes("slot_capacity") ||
    joined.includes("cap_") ||
    joined.includes("setpolicyreason:gt_5_sets") ||
    joined.includes("set_count_gt_5")
  ) {
    return "capacity_gap";
  }
  if (joined.includes("duplicate")) {
    return "duplicate_policy_gap";
  }
  if (
    joined.includes("distribution_guard") ||
    joined.includes("target_delivery:below_min") ||
    joined.includes("exposure:missing_direct_curl") ||
    joined.includes("set_count") ||
    joined.includes("setbudget:requires_justification") ||
    joined.includes("setpolicyreason:over_planned_max") ||
    joined.includes("setpolicyreason:over_allowed_expansion")
  ) {
    return "set_distribution_gap";
  }
  if (
    joined.includes("concentration") ||
    joined.includes("share_")
  ) {
    return "concentration_policy_gap";
  }
  return "unknown";
}

function hasV2TrueHardBlockerDiagnostic(diagnostics: string[]): boolean {
  const normalized = diagnostics.map((row) => row.toLowerCase());
  const joined = normalized.join("|");
  return (
    normalized.includes("setpolicy:hard_blocker") ||
    normalized.includes("target_status:blocked") ||
    joined.includes("forbidden") ||
    joined.includes("dirty") ||
    joined.includes("back extension") ||
    joined.includes("back_extension") ||
    joined.includes("deload_conflict") ||
    joined.includes("axial") ||
    joined.includes("excessive_systemic") ||
    joined.includes("systemic_fatigue_risk") ||
    joined.includes("fatigue_sensitive") ||
    joined.includes("set_count_gt_5") ||
    joined.includes("compound_gt_5") ||
    joined.includes("isolation_gt_5")
  );
}

function hasExplainedV2ConcentrationWarning(diagnostics: string[]): boolean {
  const hasQualityWarning =
    diagnostics.includes("setPolicy:quality_warning") &&
    diagnostics.includes("concentration:quality_warning");
  const hasExplanation = diagnostics.some(
    (row) =>
      (row.startsWith("justification:") &&
        row !== "justification:none" &&
        row !== "justification:weekly_target_met") ||
      row === "concentration:justified_direct_isolation"
  );
  return (
    hasQualityWarning &&
    hasExplanation &&
    !hasV2TrueHardBlockerDiagnostic(diagnostics)
  );
}

function classifyV2LaneStatus(input: {
  noRepair?: PlanningRealityDiagnostic;
  noRepairExercises: SlotCompositionSnapshot["exercises"];
  repairedExercises: SlotCompositionSnapshot["exercises"];
  lane: V2Lane | V2Slot["lanes"][number];
  diagnostics: string[];
  setPolicyStatus: V2LaneSetPolicyStatus;
}): V2TargetVsNoRepairLaneDiff["currentStatus"] {
  if (!input.noRepair) {
    return "unknown";
  }

  const classMatched = input.noRepairExercises.filter((exercise) =>
    exerciseMatchesV2LaneClass({ exercise, lane: input.lane })
  );
  const hasClassMatch = classMatched.length > 0;
  const hasMeaningfulNoRepairEvidence = input.noRepairExercises.length > 0;
  const repairedCreatesLane =
    !hasClassMatch &&
    input.repairedExercises.some((exercise) =>
      exerciseMatchesV2LaneClass({ exercise, lane: input.lane })
    );
  const setCount = (hasClassMatch ? classMatched : input.noRepairExercises)
    .reduce((sum, exercise) => sum + exercise.setCount, 0);
  const withinTarget =
    setCount >= input.lane.targetSets.min && setCount <= input.lane.targetSets.max;
  const withinTolerance =
    setCount >= Math.max(0, input.lane.targetSets.min - 1) &&
    setCount <= input.lane.targetSets.max + 1;
  const blocked = hasV2TrueHardBlockerDiagnostic(input.diagnostics);
  const diagnosticStatus = input.diagnostics.find((row) =>
    row.startsWith("target_status:")
  );
  const hasQualityWarningDiagnostics = input.diagnostics.includes(
    "concentration:quality_warning"
  );
  const hasTargetUnderdeliveryDiagnostics = input.diagnostics.includes(
    "target_delivery:below_min"
  );

  if (!hasMeaningfulNoRepairEvidence && repairedCreatesLane) {
    return "repair_dependent";
  }
  if (blocked || diagnosticStatus === "target_status:blocked") {
    return "blocked";
  }
  if (
    hasClassMatch &&
    (withinTarget || withinTolerance) &&
    input.setPolicyStatus === "in_budget" &&
    !hasQualityWarningDiagnostics &&
    !hasTargetUnderdeliveryDiagnostics
  ) {
    return "satisfied";
  }
  if (
    hasMeaningfulNoRepairEvidence ||
    diagnosticStatus === "target_status:partial" ||
    diagnosticStatus === "target_status:overdelivered"
  ) {
    return "partial";
  }
  return "missing";
}

function recommendV2Migration(input: {
  status: V2TargetVsNoRepairLaneDiff["currentStatus"];
  gapCause: V2TargetVsNoRepairLaneDiff["gapCause"];
  diagnostics: string[];
  setPolicyStatus: V2LaneSetPolicyStatus;
}): Pick<V2TargetVsNoRepairLaneDiff, "migrationRecommendation" | "severity"> {
  if (input.status === "satisfied") {
    return { migrationRecommendation: "no_action", severity: "pass" };
  }
  if (input.status === "unknown") {
    return {
      migrationRecommendation: "keep_diagnostic_only",
      severity: "diagnostic_only",
    };
  }
  if (input.status === "blocked") {
    if (input.gapCause === "concentration_policy_gap") {
      return {
        migrationRecommendation: "needs_concentration_justification",
        severity: "hard_blocker",
      };
    }
    if (input.gapCause === "classification_gap") {
      return {
        migrationRecommendation: "needs_classification_review",
        severity: "hard_blocker",
      };
    }
    if (input.gapCause === "inventory_gap") {
      return {
        migrationRecommendation: "needs_inventory_review",
        severity: "hard_blocker",
      };
    }
    if (
      input.gapCause === "capacity_gap" ||
      input.gapCause === "set_distribution_gap"
    ) {
      return {
        migrationRecommendation: "needs_set_budget_justification",
        severity: "hard_blocker",
      };
    }
    return {
      migrationRecommendation: "blocked_do_not_promote",
      severity: "hard_blocker",
    };
  }
  if (input.status === "repair_dependent") {
    const suspicious = input.diagnostics.some((row) =>
      row.toLowerCase().includes("suspicious")
    );
    return suspicious
      ? {
          migrationRecommendation: "blocked_do_not_promote",
          severity: "diagnostic_only",
        }
      : {
          migrationRecommendation: "promote_to_planner_later",
          severity: "migration_candidate",
        };
  }
  if (input.gapCause === "classification_gap") {
    return {
      migrationRecommendation: "needs_classification_review",
      severity: "quality_warning",
    };
  }
  if (input.gapCause === "inventory_gap") {
    return {
      migrationRecommendation: "needs_inventory_review",
      severity: "quality_warning",
    };
  }
  if (
    input.gapCause === "capacity_gap" ||
    input.gapCause === "set_distribution_gap"
  ) {
    return {
      migrationRecommendation:
        input.setPolicyStatus === "requires_justification"
          ? "needs_set_budget_justification"
          : "needs_set_distribution_policy",
      severity: "quality_warning",
    };
  }
  if (input.gapCause === "concentration_policy_gap") {
    if (hasExplainedV2ConcentrationWarning(input.diagnostics)) {
      return {
        migrationRecommendation: "keep_diagnostic_only",
        severity: "quality_warning",
      };
    }
    return {
      migrationRecommendation: "needs_concentration_justification",
      severity: "quality_warning",
    };
  }
  if (input.status === "partial") {
    return {
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
    };
  }
  return {
    migrationRecommendation: "keep_diagnostic_only",
    severity: "diagnostic_only",
  };
}

function normalizeOptionalV2MigrationRecommendation(input: {
  lane: V2Lane | V2Slot["lanes"][number];
  diagnostics: string[];
  recommendation: Pick<
    V2TargetVsNoRepairLaneDiff,
    "migrationRecommendation" | "severity"
  >;
}): Pick<V2TargetVsNoRepairLaneDiff, "migrationRecommendation" | "severity"> {
  if (
    input.lane.role !== "optional" ||
    input.recommendation.migrationRecommendation === "no_action" ||
    input.recommendation.severity === "hard_blocker" ||
    hasV2TrueHardBlockerDiagnostic(input.diagnostics)
  ) {
    return input.recommendation;
  }

  return {
    migrationRecommendation: "keep_diagnostic_only",
    severity: "diagnostic_only",
  };
}

function buildV2LaneDiff(input: {
  noRepair?: PlanningRealityDiagnostic;
  repaired?: PlanningRealityDiagnostic;
  noRepairSlotPlan?: MesocycleExplainPlannerOnlyNoRepair["slotPlans"][number];
  v2SetDistributionIntent?: V2SetDistributionIntent;
  slotId: V2TargetVsNoRepairDiff["slotDiffs"][number]["slotId"];
  lane: V2Lane | V2Slot["lanes"][number];
}): V2TargetVsNoRepairLaneDiff {
  const noRepairSlot = getSlotById(input.noRepair?.finalSlotPlan ?? [], input.slotId);
  const repairedSlot = getSlotById(input.repaired?.finalSlotPlan ?? [], input.slotId);
  const noRepairExercises = collectV2LaneExercises({
    slot: noRepairSlot,
    lane: input.lane,
  });
  const repairedExercises = collectV2LaneExercises({
    slot: repairedSlot,
    lane: input.lane,
  });
  const repairedCreatesLane =
    noRepairExercises.length === 0 && repairedExercises.length > 0;
  const setPolicy = evaluateV2LaneSetPolicy({
    noRepair: input.noRepair,
    policyLanes: getV2SetDistributionPolicyLanes({
      intent: input.v2SetDistributionIntent,
      slotId: input.slotId,
      lane: input.lane,
    }),
    slotId: input.slotId,
    lane: input.lane,
    noRepairExercises,
  });
  const diagnostics = collectV2LaneDiagnostics({
    noRepair: input.noRepair,
    repaired: input.repaired,
    noRepairSlotPlan: input.noRepairSlotPlan,
    slotId: input.slotId,
    lane: input.lane,
    repairedCreatesLane,
    setPolicyDiagnostics: setPolicy.diagnostics,
  });
  const currentStatus = classifyV2LaneStatus({
    noRepair: input.noRepair,
    noRepairExercises,
    repairedExercises,
    lane: input.lane,
    diagnostics,
    setPolicyStatus: setPolicy.status,
  });
  const gapCause = inferV2GapCause({ status: currentStatus, diagnostics });
  const recommendation = normalizeOptionalV2MigrationRecommendation({
    lane: input.lane,
    diagnostics,
    recommendation: recommendV2Migration({
      status: currentStatus,
      gapCause,
      diagnostics,
      setPolicyStatus: setPolicy.status,
    }),
  });

  return {
    laneId: input.lane.laneId,
    targetRole: input.lane.role,
    targetPrimaryMuscles: input.lane.primaryMuscles,
    targetExerciseClasses: input.lane.preferredExerciseClasses,
    targetSets: input.lane.targetSets,
    currentStatus,
    currentEvidence: {
      selectedExercises: formatV2SelectedExercises({
        exercises: noRepairExercises,
        lane: input.lane,
      }),
      relevantDiagnostics: diagnostics,
    },
    gapCause,
    ...recommendation,
  };
}

function nextBestV2MigrationSlice(
  laneDiffs: V2TargetVsNoRepairLaneDiff[]
): string | null {
  let candidate: V2TargetVsNoRepairLaneDiff | null = null;
  let candidatePriority = 0;
  for (const lane of laneDiffs.filter(isTrueActionableV2Lane)) {
    const priority = v2MigrationSlicePriority(lane);
    if (priority > candidatePriority) {
      candidate = lane;
      candidatePriority = priority;
    }
  }
  return candidate
    ? `${candidate.laneId}:${candidate.migrationRecommendation}`
    : null;
}

function isTrueActionableV2Lane(lane: V2TargetVsNoRepairLaneDiff): boolean {
  return (
    lane.severity === "hard_blocker" ||
    lane.severity === "migration_candidate" ||
    lane.migrationRecommendation === "blocked_do_not_promote"
  );
}

function formatV2ActionableLaneBlocker(
  lane: V2TargetVsNoRepairLaneDiff
): string {
  return `${lane.laneId}:${lane.migrationRecommendation}`;
}

function v2MigrationSlicePriority(lane: V2TargetVsNoRepairLaneDiff): number {
  if (lane.severity === "hard_blocker") {
    return 100;
  }
  if (lane.migrationRecommendation === "blocked_do_not_promote") {
    return 90;
  }
  if (lane.targetRole === "optional") {
    return 0;
  }
  if (lane.severity === "migration_candidate") {
    return 80;
  }
  const diagnostics = lane.currentEvidence.relevantDiagnostics;
  const belowTarget = diagnostics.includes("target_delivery:below_min");
  if (
    belowTarget &&
    (lane.migrationRecommendation === "needs_set_budget_justification" ||
      lane.migrationRecommendation === "needs_set_distribution_policy")
  ) {
    return 70;
  }
  if (lane.migrationRecommendation === "needs_set_budget_justification") {
    return 60;
  }
  if (lane.migrationRecommendation === "needs_concentration_justification") {
    return 55;
  }
  if (lane.migrationRecommendation === "needs_set_distribution_policy") {
    return 50;
  }
  if (
    lane.migrationRecommendation === "needs_classification_review" ||
    lane.migrationRecommendation === "needs_inventory_review"
  ) {
    return 40;
  }
  return 0;
}

function buildReplacementReadinessBlockers(input: {
  acceptanceClassification: NoRepairClassification;
  laneDiffs: V2TargetVsNoRepairLaneDiff[];
}): string[] {
  const blockedLaneCount = input.laneDiffs.filter(
    (lane) => lane.currentStatus === "blocked"
  ).length;
  const repairDependentLaneCount = input.laneDiffs.filter(
    (lane) => lane.currentStatus === "repair_dependent"
  ).length;
  return uniqueSorted([
    ...input.acceptanceClassification.hardBlockers.map((row) => row.code),
    ...(blockedLaneCount > 0 ? [`blocked_lanes:${blockedLaneCount}`] : []),
    ...(repairDependentLaneCount > 0
      ? [`repair_dependent_lanes:${repairDependentLaneCount}`]
      : []),
    ...input.laneDiffs
      .filter(isTrueActionableV2Lane)
      .map(formatV2ActionableLaneBlocker),
  ]).slice(0, 10);
}

function buildV2TargetVsNoRepairDiff(input: {
  v2Plan: V2MesocyclePlan;
  v2SetDistributionIntent?: V2SetDistributionIntent;
  noRepair?: PlanningRealityDiagnostic;
  repaired?: PlanningRealityDiagnostic;
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
  acceptanceClassification: NoRepairClassification;
}): V2TargetVsNoRepairDiff {
  const noRepairSlotPlans = new Map(
    input.slotPlans.map((slot) => [slot.slotId, slot])
  );
  const slotDiffs = input.v2Plan.skeleton.slots.map((slot) => ({
    slotId: slot.slotId,
    laneDiffs: slot.lanes.map((lane) =>
      buildV2LaneDiff({
        noRepair: input.noRepair,
        repaired: input.repaired,
        noRepairSlotPlan: noRepairSlotPlans.get(slot.slotId),
        v2SetDistributionIntent: input.v2SetDistributionIntent,
        slotId: slot.slotId,
        lane,
      })
    ),
  }));
  const laneDiffs = slotDiffs.flatMap((slot) => slot.laneDiffs);
  const migrationCandidateCount = laneDiffs.filter(
    (lane) => lane.severity === "migration_candidate"
  ).length;
  const suspiciousOrBlockedCount =
    laneDiffs.filter((lane) => lane.currentStatus === "blocked").length +
    (input.repaired?.suspiciousRepairsNotEligibleForPromotion?.length ?? 0);
  const blockers = buildReplacementReadinessBlockers({
    acceptanceClassification: input.acceptanceClassification,
    laneDiffs,
  });

  return {
    version: 1,
    source: "v2_planner_no_repair_experimental",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      targetLaneCount: laneDiffs.length,
      satisfiedLaneCount: laneDiffs.filter((lane) => lane.currentStatus === "satisfied").length,
      partialLaneCount: laneDiffs.filter((lane) => lane.currentStatus === "partial").length,
      missingLaneCount: laneDiffs.filter((lane) => lane.currentStatus === "missing").length,
      blockedLaneCount: laneDiffs.filter((lane) => lane.currentStatus === "blocked").length,
      repairDependentLaneCount: laneDiffs.filter((lane) => lane.currentStatus === "repair_dependent").length,
      migrationCandidateCount,
      suspiciousOrBlockedCount,
    },
    slotDiffs,
    replacementReadinessImpact: {
      canReplaceRepairedProjection: false,
      blockers,
      nextBestMigrationSlice: nextBestV2MigrationSlice(laneDiffs),
    },
  };
}

function checkStatusByName(
  checks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"],
  check: string
): V2MesocyclePlan["validationRules"][number]["week1Status"] {
  const found = checks.find((row) => row.check === check);
  if (!found) return "unknown";
  if (found.status === "pass") return "pass";
  if (found.status === "fail") return "fail";
  if (found.status === "partial") return "pass_with_warning";
  return "unknown";
}

function hasNoRepairFinding(
  findings: NoRepairFinding[],
  code: string
): boolean {
  return findings.some((finding) => finding.code === code);
}

function buildV2ValidationRules(input: {
  classification: NoRepairClassification;
  acceptanceChecks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"];
  targetLanesMissing: number;
}): V2MesocyclePlan["validationRules"] {
  const hardBlockers = input.classification.hardBlockers;
  const duplicateStatus = checkStatusByName(
    input.acceptanceChecks,
    "no duplicate main lift when clean alternative exists unless justified"
  );
  const gt5Status =
    hasNoRepairFinding(
      hardBlockers,
      "compound_hinge_or_press_gt_5_sets_without_justification"
    ) ||
    input.classification.hardBlockers.some((row) =>
      row.code.includes("gt_5_sets")
    )
      ? "fail"
      : checkStatusByName(
          input.acceptanceChecks,
          "no exercise above 5 sets unless justified"
        );
  const requiredLaneStatus =
    input.targetLanesMissing === 0
      ? "pass"
      : hardBlockers.some((row) => row.code.startsWith("required_"))
        ? "fail"
        : "pass_with_warning";
  const progressionLimited: V2MesocyclePlan["validationRules"][number]["fullMesocycleStatus"] =
    "limited";

  return [
    {
      ruleId: "primary_muscles_above_minimum",
      severity: "hard_blocker",
      description: "Primary hard-target muscles must meet Week 1 minimums.",
      week1Status: checkStatusByName(
        input.acceptanceChecks,
        "primary muscles above minimum"
      ),
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "required_lanes_present",
      severity: "hard_blocker",
      description: "Each required slot lane from the target skeleton is present.",
      week1Status: requiredLaneStatus,
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "required_class_intent_satisfied",
      severity: "hard_blocker",
      description: "Required lanes are satisfied by the intended exercise classes.",
      week1Status: requiredLaneStatus,
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "no_forbidden_slot_primary_solution",
      severity: "hard_blocker",
      description: "A forbidden slot must not solve a primary target muscle.",
      week1Status: checkStatusByName(
        input.acceptanceChecks,
        "no primary muscle solved by forbidden slot"
      ),
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "no_back_extension_as_clean_hamstrings_closure",
      severity: "hard_blocker",
      description: "Back Extension does not count as clean Hamstrings closure.",
      week1Status: checkStatusByName(
        input.acceptanceChecks,
        "no Back Extension as clean Hamstrings closure"
      ),
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "no_unjustified_gt_5_sets",
      severity: "hard_blocker",
      description: "Exercises above five hard sets need explicit planner justification.",
      week1Status: gt5Status,
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "no_unjustified_primary_concentration",
      severity: "hard_blocker",
      description: "Primary hard-target stimulus cannot be over-concentrated without intent.",
      week1Status: hasNoRepairFinding(
        hardBlockers,
        "primary_hard_target_excessive_single_exercise_share_unjustified"
      )
        ? "fail"
        : input.classification.qualityWarnings.some((row) =>
              row.code.includes("primary_hard_target_50_to_60")
            )
          ? "pass_with_warning"
          : "pass",
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "no_unjustified_duplicate_main_lift",
      severity: "quality_warning",
      description: "Repeated main lifts need clean continuity or inventory justification.",
      week1Status: duplicateStatus,
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "runtime_seed_replay_deterministic",
      severity: "hard_blocker",
      description: "The resulting seed shape must replay without reselection.",
      week1Status: checkStatusByName(
        input.acceptanceChecks,
        "slotPlanSeedJson would replay without reselection"
      ),
      fullMesocycleStatus: "pass",
    },
    {
      ruleId: "repair_not_required_for_basic_shape",
      severity: "migration_scoreboard",
      description: "Basic Week 1 shape is evaluated separately from repaired-projection replacement.",
      week1Status:
        input.classification.basicMesocycleShapeStatus === "pass"
          ? "pass"
          : input.classification.basicMesocycleShapeStatus === "pass_with_warnings"
            ? "pass_with_warning"
            : input.classification.basicMesocycleShapeStatus === "fail"
              ? "fail"
              : "unknown",
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "full_mesocycle_progression_projected",
      severity: "migration_scoreboard",
      description: "Weeks 2-4 are derived progression views of the stable skeleton, not independent plans.",
      week1Status: "not_applicable",
      fullMesocycleStatus: progressionLimited,
    },
    {
      ruleId: "deload_transform_projected",
      severity: "migration_scoreboard",
      description: "Week 5 deload transform is defined but not production-projected.",
      week1Status: "not_applicable",
      fullMesocycleStatus: progressionLimited,
    },
  ];
}

function buildV2MesocyclePlan(input: {
  noRepair?: PlanningRealityDiagnostic;
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
  acceptanceChecks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"];
  acceptanceClassification: NoRepairClassification;
  targetLanesMissing: number;
}): V2MesocyclePlan {
  const plannerPolicy = buildV2PlannerMesocyclePolicy();
  const basicStatus = input.acceptanceClassification.basicMesocycleShapeStatus;
  const planStatus: V2MesocyclePlan["planStatus"] =
    basicStatus === "pass" || basicStatus === "pass_with_warnings"
      ? "full_mesocycle_limited"
      : input.noRepair
        ? "experimental"
        : "replacement_not_ready";
  const readinessReasons = uniqueSorted([
    input.acceptanceClassification.migrationScoreboard.reason || "not_ready",
    ...(basicStatus === "pass" || basicStatus === "pass_with_warnings"
      ? ["week_1_basic_shape_valid"]
      : [`week_1_basic_shape:${basicStatus}`]),
    "weeks_2_to_4_derived_not_fully_projected",
    "deload_transform_not_production_projected",
    "read_only_non_generative_artifact",
  ]);

  return {
    version: 1,
    source: "v2_planner_no_repair_experimental",
    readOnly: true,
    affectsScoringOrGeneration: false,
    planStatus,
    skeleton: buildV2Skeleton({
      noRepair: input.noRepair,
      slotPlans: input.slotPlans,
    }),
    weeklyProgressionModel: plannerPolicy.weeklyProgressionModel,
    deloadTransform: plannerPolicy.deloadTransform,
    validationRules: buildV2ValidationRules({
      classification: input.acceptanceClassification,
      acceptanceChecks: input.acceptanceChecks,
      targetLanesMissing: input.targetLanesMissing,
    }),
    replacementReadiness: {
      canReplaceRepairedProjection: false,
      reason: readinessReasons,
    },
  };
}

function normalizeWeek1GateStatus(
  status: NoRepairClassification["basicMesocycleShapeStatus"]
): CrossWeekProjectionGate["week1Status"]["status"] {
  if (status === "pass" || status === "pass_with_warnings" || status === "fail") {
    return status;
  }
  return "unknown";
}

function isPlannerOwnedProjectionStatus(status: string | undefined): boolean {
  return Boolean(status?.includes("planner_owned"));
}

function isDiagnosticProjectedStatus(status: string | undefined): boolean {
  return Boolean(
    status &&
      (status.includes("projected") ||
        status.includes("allocated") ||
        status.includes("policy"))
  );
}

function collectMissingProjectionInputs(input: {
  prefix: string;
  week: number;
  status?: string;
}): string[] {
  if (!input.status || !includesIncompleteProjectionStatus(input.status)) {
    return [];
  }
  return [`${input.prefix}:week_${input.week}:${input.status}`];
}

function getV2PlannedSetsByWeek(
  intent: V2SetDistributionIntent
): Map<number, number> {
  return new Map(
    intent.summary.plannedTotalSetsByWeek.map((week) => [
      week.week,
      week.totalSets,
    ])
  );
}

function getPureV2SetDistributionIntent(): V2SetDistributionIntent {
  return buildV2PlannerMesocyclePolicy().v2SetDistributionIntent;
}

function getPureV2SupportLanePolicy(): V2SupportLanePolicy {
  return buildV2PlannerMesocyclePolicy().v2SupportLanePolicy;
}

function buildCrossWeekAccumulationStatus(input: {
  noRepair?: PlanningRealityDiagnostic;
  v2MesocyclePlan: V2MesocyclePlan;
  v2SetDistributionIntent: V2SetDistributionIntent;
  plannerOwnedAccumulationProjection: MesocycleExplainPlannerOnlyNoRepair["plannerOwnedAccumulationProjection"];
}): CrossWeekProjectionGate["accumulationWeeksStatus"] {
  const rows = ([2, 3, 4] as const).map((weekNumber) => {
    const progressionWeek = input.v2MesocyclePlan.weeklyProgressionModel.weeks.find(
      (week) => week.week === weekNumber
    );
    const plannerOwnedWeek = input.plannerOwnedAccumulationProjection.weeks.find(
      (week) => week.week === weekNumber
    );
    const intentWeek = input.v2SetDistributionIntent.weeks.find(
      (week) => week.week === weekNumber
    );
    const allocationWeek =
      input.noRepair?.slotDemandAllocationByWeek?.weeks.find(
        (week) => week.week === weekNumber
      );
    const preselectionWeek =
      input.noRepair?.preselectionDistributionPolicyByWeek?.weeks.find(
        (week) => week.week === weekNumber
      );
    const weeklyDemandWeek = input.noRepair?.weeklyDemandCurve?.weeks.find(
      (week) => week.week === weekNumber
    );
    const allocationStatus = allocationWeek?.projectionStatus;
    const preselectionStatus = preselectionWeek?.projectionStatus;
    const weeklyDemandStatus = weeklyDemandWeek?.projectionStatus;
    const plannerOwned =
      isPlannerOwnedProjectionStatus(allocationStatus) &&
      isPlannerOwnedProjectionStatus(preselectionStatus);
    const plannerOwnedReadOnly =
      plannerOwnedWeek?.projectionStatus === "planner_owned_read_only";
    const hasV2ScaledIntent = intentWeek != null;
    const hasDiagnosticWeekEvidence =
      isDiagnosticProjectedStatus(allocationStatus) ||
      isDiagnosticProjectedStatus(preselectionStatus) ||
      isDiagnosticProjectedStatus(weeklyDemandStatus);
    const projectionBasis: CrossWeekProjectionGate["accumulationWeeksStatus"]["weeks"][number]["projectionBasis"] =
      plannerOwned
        ? "planner_owned_week_projection"
        : plannerOwnedReadOnly
          ? "planner_owned_read_only_projection"
        : hasV2ScaledIntent
          ? "scaled_v2_set_distribution_intent"
          : hasDiagnosticWeekEvidence
            ? "repeat_week_1_shape"
            : "missing";
    const limitations = uniqueSorted([
      ...(progressionWeek?.limitations ?? []),
      ...(allocationWeek?.weekLevelWarnings ?? []),
      ...(preselectionWeek?.weekLevelWarnings ?? []),
      ...(weeklyDemandWeek?.weekLevelLimitations ?? []),
      ...(plannerOwnedReadOnly
        ? [
            ...plannerOwnedWeek.validation.missingInputs,
            ...plannerOwnedWeek.validation.unresolvedDemand,
            ...plannerOwnedWeek.validation.concentrationWarnings,
            ...plannerOwnedWeek.validation.duplicateWarnings,
            "planner_owned_projection_read_only_not_selection_seed_or_runtime_input",
            "safe_for_behavior_promotion_false",
          ]
        : [
            ...collectMissingProjectionInputs({
              prefix: "weeklyDemandCurve",
              week: weekNumber,
              status: weeklyDemandStatus,
            }),
            ...collectMissingProjectionInputs({
              prefix: "slotDemandAllocationByWeek",
              week: weekNumber,
              status: allocationStatus,
            }),
            ...collectMissingProjectionInputs({
              prefix: "preselectionDistributionPolicyByWeek",
              week: weekNumber,
              status: preselectionStatus,
            }),
          ]),
      ...(plannerOwned
        ? []
        : plannerOwnedReadOnly
          ? [
              "planner_owned_week_projection_exists_but_is_diagnostic_only",
              "accepted_seed_runtime_consumption_missing",
            ]
          : [
            "planner_owned_week_allocation_missing",
            "repeated_week_1_diagnostic_projection_not_true_cross_week_projection",
          ]),
      ...(hasV2ScaledIntent && !plannerOwned
        ? plannerOwnedReadOnly
          ? ["v2_set_distribution_intent_used_as_lane_budget_policy_only"]
          : ["scaled_v2_set_distribution_intent_is_read_only"]
        : []),
    ]);

    return {
      week: weekNumber,
      phase: progressionWeek?.phase ?? intentWeek?.phase ?? allocationWeek?.phase ?? "unknown",
      volumeMultiplier:
        intentWeek?.volumeMultiplier ?? progressionWeek?.volumeMultiplier ?? 1,
      rirTarget: progressionWeek?.rirTarget ?? intentWeek?.rirTarget ?? "unknown",
      projectionBasis,
      limitations,
      safeForBehaviorPromotion: false as const,
    };
  });

  const status: CrossWeekProjectionGate["accumulationWeeksStatus"]["status"] =
    rows.every((week) => week.projectionBasis === "planner_owned_week_projection")
      ? "ready"
      : rows.every((week) => week.projectionBasis === "planner_owned_read_only_projection")
        ? "projected_with_limitations"
      : rows.some((week) => week.projectionBasis === "scaled_v2_set_distribution_intent")
        ? "diagnostic_projection_only"
        : rows.some((week) => week.projectionBasis === "repeat_week_1_shape")
          ? "projected_with_limitations"
          : "not_projected";

  return { status, weeks: rows };
}

function buildCrossWeekDeloadStatus(input: {
  noRepair?: PlanningRealityDiagnostic;
  v2MesocyclePlan: V2MesocyclePlan;
  v2DeloadProjectionDiagnostic: V2DeloadProjectionDiagnostic;
}): CrossWeekProjectionGate["deloadStatus"] {
  const deloadWeek = input.v2MesocyclePlan.weeklyProgressionModel.weeks.find(
    (week) => week.phase === "deload"
  );
  const allocationWeek =
    input.noRepair?.slotDemandAllocationByWeek?.weeks.find(
      (week) => week.phase === "deload" || week.week === 5
    );
  const preselectionWeek =
    input.noRepair?.preselectionDistributionPolicyByWeek?.weeks.find(
      (week) => week.phase === "deload" || week.week === 5
    );
  const weeklyDemandWeek = input.noRepair?.weeklyDemandCurve?.weeks.find(
    (week) => week.phase === "deload" || week.week === 5
  );
  const transform = input.v2MesocyclePlan.deloadTransform;
  const diagnosticProjected =
    input.v2DeloadProjectionDiagnostic.status === "projected_with_limitations" &&
    input.v2DeloadProjectionDiagnostic.summary.identitiesPreservedCount > 0 &&
    input.v2DeloadProjectionDiagnostic.summary.movementsIntroducedCount === 0 &&
    input.v2DeloadProjectionDiagnostic.blockers.length === 0;
  const plannerOwned =
    isPlannerOwnedProjectionStatus(allocationWeek?.projectionStatus) &&
    isPlannerOwnedProjectionStatus(preselectionWeek?.projectionStatus);
  const projectionBasis: CrossWeekProjectionGate["deloadStatus"]["projectionBasis"] =
    plannerOwned
      ? "planner_owned_deload_projection"
      : transform.projectionStatus !== "not_yet_projected"
        ? "v2_deload_transform_read_only"
        : "missing";
  const limitations = uniqueSorted([
    ...(deloadWeek?.limitations ?? []),
    ...transform.limitations,
    ...(allocationWeek?.weekLevelWarnings ?? []),
    ...(preselectionWeek?.weekLevelWarnings ?? []),
    ...(weeklyDemandWeek?.weekLevelLimitations ?? []),
    ...collectMissingProjectionInputs({
      prefix: "weeklyDemandCurve",
      week: deloadWeek?.week ?? 5,
      status: weeklyDemandWeek?.projectionStatus,
    }),
    ...collectMissingProjectionInputs({
      prefix: "slotDemandAllocationByWeek",
      week: deloadWeek?.week ?? 5,
      status: allocationWeek?.projectionStatus,
    }),
    ...collectMissingProjectionInputs({
      prefix: "preselectionDistributionPolicyByWeek",
      week: deloadWeek?.week ?? 5,
      status: preselectionWeek?.projectionStatus,
    }),
    ...(plannerOwned
      ? []
      : [
          ...(diagnosticProjected
            ? ["deload_projection_read_only_not_consumed"]
            : ["accepted_seed_identity_set_reduction_projection_missing"]),
          "runtime_replay_consumption_path_missing",
          "safe_for_behavior_promotion_false",
        ]),
  ]);
  const status: CrossWeekProjectionGate["deloadStatus"]["status"] = plannerOwned
    ? "ready"
    : diagnosticProjected
      ? "projected_with_limitations"
    : projectionBasis === "v2_deload_transform_read_only"
      ? "diagnostic_projection_only"
      : "not_projected";

  return {
    status,
    projectionBasis,
    preserveIdentities: transform.preserveExerciseIdentities,
    targetVolumeReductionPercent: transform.targetVolumeReductionPercent,
    targetRir: transform.targetRir,
    limitations,
    safeForBehaviorPromotion: false,
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildV2DeloadProjectionDiagnostic(input: {
  v2MesocyclePlan: V2MesocyclePlan;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2ExerciseSelectionPlanDiagnostic: MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"];
}): V2DeloadProjectionDiagnostic {
  const transform = input.v2MesocyclePlan.deloadTransform;
  const deloadIntentWeek = input.v2SetDistributionIntent.weeks.find(
    (week) => week.phase === "deload" || week.week === 5
  );
  const week1IdentitySlots =
    input.v2ExerciseSelectionPlanDiagnostic.weeks.find((week) => week.week === 1)
      ?.slots ?? [];
  const week1IdentityByLane = new Map(
    week1IdentitySlots.flatMap((slot) =>
      slot.lanes.map((lane) => [`${slot.slotId}:${lane.laneId}`, lane] as const)
    )
  );
  const missingInputs = uniqueSorted([
    ...(!deloadIntentWeek ? ["v2SetDistributionIntent:week_5:missing"] : []),
    ...(week1IdentitySlots.length === 0
      ? ["v2ExerciseSelectionPlanDiagnostic:week_1:missing"]
      : []),
  ]);
  const blockers = uniqueSorted([
    ...(!transform.preserveExerciseIdentities
      ? ["v2_deload_transform:preserveExerciseIdentities:false"]
      : []),
    ...(transform.introduceNewMovements
      ? ["v2_deload_transform:introduceNewMovements:true"]
      : []),
    ...(deloadIntentWeek ? [] : ["v2_deload_set_distribution_intent_missing"]),
  ]);

  const slots =
    deloadIntentWeek?.slots.map((slot) => ({
      slotId: slot.slotId,
      lanes: slot.lanes.map((lane) => {
        const identityLane = week1IdentityByLane.get(
          `${slot.slotId}:${lane.laneId}`
        );
        const selected = identityLane?.selectedIdentity;
        const laneLimitations = uniqueSorted([
          "diagnostic_only_not_runtime_consumed",
          "no_new_movement_substitution_attempted",
          ...(identityLane?.limitations ?? []),
          ...(selected ? [] : ["week_1_selected_identity_missing"]),
        ]);
        if (!selected || selected.setCount <= 0) {
          return {
            laneId: lane.laneId,
            status: "not_evaluated" as const,
            limitations: laneLimitations,
            exercises: [],
          };
        }

        const week1Sets = selected.setCount;
        const deloadProjectedSets = Math.max(1, Math.floor(week1Sets * 0.5));
        const setReductionPercent = roundPercent(
          ((week1Sets - deloadProjectedSets) / week1Sets) * 100
        );
        const reductionInTargetRange =
          setReductionPercent >= transform.targetVolumeReductionPercent.min &&
          setReductionPercent <= transform.targetVolumeReductionPercent.max;
        const exerciseLimitations = uniqueSorted([
          "diagnostic_only_not_runtime_consumed",
          "preserves_week_1_identity",
          ...(reductionInTargetRange
            ? []
            : ["set_reduction_outside_40_60_integer_rounding"]),
        ]);

        return {
          laneId: lane.laneId,
          status: "projected_with_limitations" as const,
          limitations: uniqueSorted([
            ...laneLimitations,
            ...(reductionInTargetRange
              ? []
              : ["set_reduction_outside_40_60_integer_rounding"]),
          ]),
          exercises: [
            {
              preservedIdentity: {
                exerciseId: selected.exerciseId,
                exerciseName: selected.exerciseName,
                sourceWeek: 1 as const,
              },
              week1Sets,
              deloadProjectedSets,
              setReductionPercent,
              targetRir: transform.targetRir,
              introducesNewMovement: false as const,
              status: reductionInTargetRange
                ? ("projected" as const)
                : ("projected_with_warning" as const),
              limitations: exerciseLimitations,
            },
          ],
        };
      }),
    })) ?? [];

  const lanes = slots.flatMap((slot) => slot.lanes);
  const exercises = lanes.flatMap((lane) => lane.exercises);
  const warnings = uniqueSorted([
    ...lanes.flatMap((lane) =>
      lane.status === "not_evaluated"
        ? [`${lane.laneId}:week_1_identity_not_evaluated`]
        : []
    ),
    ...slots.flatMap((slot) =>
      slot.lanes.flatMap((lane) =>
        lane.exercises
          .filter((exercise) => exercise.status === "projected_with_warning")
          .map(
            (exercise) =>
              `${slot.slotId}:${lane.laneId}:${exercise.preservedIdentity.exerciseName}:set_reduction_outside_40_60`
          )
      )
    ),
  ]);
  const totalWeek1Sets = exercises.reduce(
    (sum, exercise) => sum + exercise.week1Sets,
    0
  );
  const totalDeloadProjectedSets = exercises.reduce(
    (sum, exercise) => sum + exercise.deloadProjectedSets,
    0
  );
  const volumeReductionPercent =
    totalWeek1Sets > 0
      ? roundPercent(
          ((totalWeek1Sets - totalDeloadProjectedSets) / totalWeek1Sets) * 100
        )
      : null;
  const status: V2DeloadProjectionDiagnostic["status"] =
    blockers.length > 0
      ? "blocked"
      : exercises.length > 0
        ? "projected_with_limitations"
        : "not_evaluated";

  return {
    version: 1,
    source: "v2_deload_projection_diagnostic",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    identityBasis: "week_1_selected_identities",
    projectionBasis: "v2_deload_transform_read_only",
    slots,
    summary: {
      identitiesPreservedCount: exercises.length,
      movementsIntroducedCount: 0,
      totalWeek1Sets,
      totalDeloadProjectedSets,
      volumeReductionPercent,
      blockedLaneCount: blockers.length > 0 ? Math.max(1, lanes.length) : 0,
      warningCount: warnings.length,
    },
    blockers,
    warnings,
    missingInputs,
    safeForBehaviorPromotion: false,
  };
}

function buildCrossWeekProjectionGate(input: {
  noRepair?: PlanningRealityDiagnostic;
  acceptanceClassification: NoRepairClassification;
  v2MesocyclePlan: V2MesocyclePlan;
  v2SetDistributionIntent: V2SetDistributionIntent;
  plannerOwnedAccumulationProjection: MesocycleExplainPlannerOnlyNoRepair["plannerOwnedAccumulationProjection"];
  v2TargetVsNoRepairDiff: V2TargetVsNoRepairDiff;
  v2ExerciseSelectionPlanDiagnostic: MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"];
  v2DeloadProjectionDiagnostic: V2DeloadProjectionDiagnostic;
}): CrossWeekProjectionGate {
  const week1Status = {
    status: normalizeWeek1GateStatus(
      input.acceptanceClassification.basicMesocycleShapeStatus
    ),
    basis: uniqueSorted([
      `basicMesocycleShapeStatus:${input.acceptanceClassification.basicMesocycleShapeStatus}`,
      `replacementReadinessStatus:${input.acceptanceClassification.replacementReadinessStatus}`,
      `targetLanesBlocked:${input.v2TargetVsNoRepairDiff.summary.blockedLaneCount}`,
      "week_1_no_repair_shape_only",
      "does_not_imply_replacement_readiness",
    ]),
  };
  const accumulationWeeksStatus = buildCrossWeekAccumulationStatus({
    noRepair: input.noRepair,
    v2MesocyclePlan: input.v2MesocyclePlan,
    v2SetDistributionIntent: input.v2SetDistributionIntent,
    plannerOwnedAccumulationProjection: input.plannerOwnedAccumulationProjection,
  });
  const deloadStatus = buildCrossWeekDeloadStatus({
    noRepair: input.noRepair,
    v2MesocyclePlan: input.v2MesocyclePlan,
    v2DeloadProjectionDiagnostic: input.v2DeloadProjectionDiagnostic,
  });
  const deloadReadOnlyProjectionExists =
    input.v2DeloadProjectionDiagnostic.status === "projected_with_limitations" &&
    input.v2DeloadProjectionDiagnostic.summary.identitiesPreservedCount > 0 &&
    input.v2DeloadProjectionDiagnostic.summary.movementsIntroducedCount === 0 &&
    input.v2DeloadProjectionDiagnostic.blockers.length === 0;
  const plannedSetsByWeek = getV2PlannedSetsByWeek(input.v2SetDistributionIntent);
  const missingInputs = uniqueSorted([
    ...accumulationWeeksStatus.weeks.flatMap((week) =>
      week.limitations.filter((limitation) => limitation.includes("missing"))
    ),
    ...deloadStatus.limitations.filter((limitation) =>
      limitation.includes("missing")
    ),
  ]);
  const blockers = uniqueSorted([
    ...input.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ...(input.v2ExerciseSelectionPlanDiagnostic.status === "blocked"
      ? ["exercise_selection_plan_diagnostic_blocked"]
      : []),
    ...(accumulationWeeksStatus.status === "ready"
      ? []
      : accumulationWeeksStatus.status === "projected_with_limitations"
        ? ["weeks_2_to_4_planner_owned_projection_read_only_not_consumed"]
        : ["weeks_2_to_4_planner_owned_projection_missing"]),
    ...(deloadStatus.status === "ready"
      ? []
      : deloadReadOnlyProjectionExists
        ? ["deload_projection_read_only_not_consumed"]
        : ["deload_seed_runtime_projection_missing"]),
    "accepted_seed_runtime_consumption_path_undefined_for_gate",
    "repair_dependency_must_not_worsen_before_promotion",
  ]);
  const warnings = uniqueSorted([
    ...(week1Status.status === "pass_with_warnings"
      ? ["week_1_basic_shape_passes_with_warnings_only"]
      : []),
    ...(accumulationWeeksStatus.weeks.some(
      (week) => week.projectionBasis === "repeat_week_1_shape"
    )
      ? ["repeated_week_1_projection_is_diagnostic_only"]
      : []),
    ...(accumulationWeeksStatus.weeks.some(
      (week) => week.projectionBasis === "scaled_v2_set_distribution_intent"
    )
      ? ["scaled_v2_set_distribution_intent_is_diagnostic_only"]
      : []),
    ...(accumulationWeeksStatus.status === "projected_with_limitations"
      ? ["planner_owned_weeks_2_to_4_projection_is_read_only"]
      : []),
    ...(deloadStatus.projectionBasis === "v2_deload_transform_read_only"
      ? ["v2_deload_transform_not_applied_to_seed_or_runtime"]
      : []),
    ...(deloadReadOnlyProjectionExists
      ? ["v2_deload_projection_is_read_only_not_runtime_consumed"]
      : []),
  ]);
  const replacementReadinessStatus: CrossWeekProjectionGate["replacementReadinessStatus"] =
    input.v2TargetVsNoRepairDiff.replacementReadinessImpact
      .canReplaceRepairedProjection &&
    blockers.length === 0 &&
    accumulationWeeksStatus.status === "ready" &&
    deloadStatus.status === "ready"
      ? "ready"
      : blockers.length > 0
        ? "not_ready"
        : "limited";
  const projectedWeekSummaries =
    input.v2MesocyclePlan.weeklyProgressionModel.weeks.map((week) => {
      const accumulationWeek = accumulationWeeksStatus.weeks.find(
        (row) => row.week === week.week
      );
      const isDeload = week.phase === "deload";
      return {
        week: week.week,
        phase: week.phase,
        volumeMultiplier: week.volumeMultiplier ?? 1,
        totalPlannedSets: plannedSetsByWeek.get(week.week) ?? null,
        projectionBasis: isDeload
          ? deloadStatus.projectionBasis
          : week.week === 1
            ? "week_1_no_repair_shape"
            : (accumulationWeek?.projectionBasis ?? "missing"),
        limitations: isDeload
          ? deloadStatus.limitations
          : week.week === 1
            ? ["week_1_no_repair_shape_only"]
            : (accumulationWeek?.limitations ?? ["missing_week_projection"]),
      };
    });

  return {
    readOnly: true,
    affectsScoringOrGeneration: false,
    week1Status,
    accumulationWeeksStatus,
    deloadStatus,
    replacementReadinessStatus,
    blockers,
    warnings,
    missingInputs,
    projectedWeekSummaries,
    deloadSummary: {
      targetVolumeReductionPercent: deloadStatus.targetVolumeReductionPercent,
      preserveExerciseIdentities: deloadStatus.preserveIdentities,
      introducesNewMovements: false,
      projectionBasis: deloadStatus.projectionBasis,
      limitations: deloadStatus.limitations,
    },
    safeToPromoteBehavior: false,
  };
}

function compactEvidence(evidence: string[], limit = 6): string[] {
  const compact = uniqueSorted(evidence.filter(Boolean)).slice(0, limit);
  return compact.length > 0 ? compact : ["none"];
}

function noRepairFinding(
  code: string,
  evidence: string[],
  limit?: number
): NoRepairFinding {
  return { code, evidence: compactEvidence(evidence, limit) };
}

function noRepairConcentrationFindings(
  rows: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[]
): NoRepairFinding[] {
  const byReason = new Map<string, string[]>();
  for (const row of rows) {
    byReason.set(row.reason, [
      ...(byReason.get(row.reason) ?? []),
      formatNoRepairConcentrationRow(row),
    ]);
  }
  return Array.from(byReason.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, evidence]) =>
      noRepairFinding(reason, evidence, 6)
    );
}

function noRepairCheckFinding(
  code: string,
  check: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"][number]
): NoRepairFinding {
  return noRepairFinding(code, check.evidence);
}

function includesIncompleteProjectionStatus(status: string): boolean {
  return (
    status.includes("not_") ||
    status.includes("missing") ||
    status.includes("unprojected")
  );
}

function hasDeloadProjectionIncomplete(
  planningReality: PlanningRealityDiagnostic
): boolean {
  const preselectionDeload =
    planningReality.preselectionDistributionPolicyByWeek?.weeks.some(
      (week) =>
        week.phase === "deload" &&
        includesIncompleteProjectionStatus(week.projectionStatus)
    ) ?? false;
  const allocationDeload =
    planningReality.slotDemandAllocationByWeek?.weeks.some(
      (week) =>
        week.phase === "deload" &&
        includesIncompleteProjectionStatus(week.projectionStatus)
    ) ?? false;
  const warningDeload =
    (planningReality.accumulationWeekProjection?.crossWeekWarnings?.some(
      (warning) => warning.code === "DELOAD_PRESERVATION_STILL_UNPROJECTED"
    ) ??
      false) ||
    (planningReality.slotDemandAllocationByWeek?.crossWeekAllocationWarnings?.some(
      (warning) => warning.code === "DELOAD_SLOT_ALLOCATION_UNPROJECTED"
    ) ??
      false);
  return preselectionDeload || allocationDeload || warningDeload;
}

function isCompoundHingeOrPressOverFiveExercise(input: {
  exercise: SlotCompositionSnapshot["exercises"][number];
}): boolean {
  if (input.exercise.setCount <= 5) {
    return false;
  }
  const patterns = input.exercise.movementPatterns
    .map((pattern) => pattern.toLowerCase())
    .join("|");
  const name = input.exercise.exerciseName.toLowerCase();
  return (
    input.exercise.role === "main" ||
    patterns.includes("hinge") ||
    patterns.includes("press") ||
    patterns.includes("squat") ||
    name.includes("press") ||
    name.includes("squat") ||
    name.includes("deadlift")
  );
}

function buildNoRepairCompoundOverFiveBlockers(
  planningReality: PlanningRealityDiagnostic
): string[] {
  return planningReality.finalSlotPlan.flatMap((slot) =>
    slot.exercises
      .filter((exercise) => isCompoundHingeOrPressOverFiveExercise({ exercise }))
      .map(
        (exercise) =>
          `${slot.slotId}:${exercise.exerciseName}:${exercise.setCount}`
      )
  );
}

function buildNoRepairMigrationScoreboard(input: {
  noRepair: PlanningRealityDiagnostic;
  repairedPlanningReality?: PlanningRealityDiagnostic;
  canReplaceRepairedProjection: boolean;
  repairedProjectionAvailable: boolean;
  targetLanesMissing: number;
  unresolvedDemandCount: number;
  validationFailureCount: number;
  hardBlockerCount: number;
}): NoRepairClassification["migrationScoreboard"] {
  const scoreboardReality = input.repairedPlanningReality ?? input.noRepair;
  const materialRepairCount =
    scoreboardReality.shadowRepairSummary?.materialRepairCount ??
    scoreboardReality.summary.materialRepairCount ??
    null;
  const majorRepairCount =
    scoreboardReality.shadowRepairSummary?.majorRepairCount ??
    scoreboardReality.summary.majorRepairCount ??
    null;
  const suspiciousRepairs =
    scoreboardReality.suspiciousRepairsNotEligibleForPromotion?.length ?? null;
  const weeksTwoToFourUnprojected = hasWeeksTwoToFourUnprojected(input.noRepair);
  const deloadProjectionIncomplete = hasDeloadProjectionIncomplete(input.noRepair);
  const canReplaceRepairedProjection =
    input.canReplaceRepairedProjection &&
    input.repairedProjectionAvailable &&
    input.hardBlockerCount === 0 &&
    !weeksTwoToFourUnprojected &&
    !deloadProjectionIncomplete &&
    (materialRepairCount ?? 0) === 0 &&
    (majorRepairCount ?? 0) === 0 &&
    (suspiciousRepairs ?? 0) === 0;
  const reasons: string[] = [];
  if (!input.repairedProjectionAvailable) reasons.push("repaired_projection_unavailable");
  if (input.hardBlockerCount > 0) reasons.push(`hard_blockers:${input.hardBlockerCount}`);
  if (input.targetLanesMissing > 0) reasons.push(`target_lanes_missing:${input.targetLanesMissing}`);
  if (input.unresolvedDemandCount > 0) reasons.push(`raw_unresolved_demand:${input.unresolvedDemandCount}`);
  if (input.validationFailureCount > 0) reasons.push(`raw_validation_failures:${input.validationFailureCount}`);
  if (weeksTwoToFourUnprojected) reasons.push("weeks_2_to_4_unprojected");
  if (deloadProjectionIncomplete) reasons.push("deload_projection_incomplete");
  if ((materialRepairCount ?? 0) > 0) reasons.push(`materialRepairCount:${materialRepairCount}`);
  if ((majorRepairCount ?? 0) > 0) reasons.push(`majorRepairCount:${majorRepairCount}`);
  if ((suspiciousRepairs ?? 0) > 0) reasons.push(`suspiciousRepairs:${suspiciousRepairs}`);

  return {
    materialRepairCount,
    majorRepairCount,
    suspiciousRepairs,
    canReplaceRepairedProjection,
    reason: canReplaceRepairedProjection ? "ready" : reasons.join("; ") || "not_ready",
  };
}

function buildNoRepairAcceptanceClassification(input: {
  noRepair: PlanningRealityDiagnostic;
  repairedPlanningReality?: PlanningRealityDiagnostic;
  repairedProjectionAvailable: boolean;
  canReplaceRepairedProjection: boolean;
  targetLanesMissing: number;
  unresolvedDemandCount: number;
  validationFailureCount: number;
  acceptanceChecks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"];
  concentrationClassification: NoRepairConcentrationClassification;
  setAllocationChanges: MesocycleExplainPlannerOnlyNoRepair["setAllocationChanges"];
  weeklyMuscleTotals: MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotals"];
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
}): NoRepairClassification {
  const hardBlockers: NoRepairFinding[] = [
    ...noRepairConcentrationFindings(
      input.concentrationClassification.acceptanceFailures
    ),
  ];
  const qualityWarnings: NoRepairFinding[] = [
    ...noRepairConcentrationFindings(
      input.concentrationClassification.qualityWarnings
    ),
  ];
  const diagnosticOnly: NoRepairFinding[] = [
    ...noRepairConcentrationFindings(
      input.concentrationClassification.diagnosticRows
    ),
    ...noRepairConcentrationFindings(
      input.concentrationClassification.ignoredRows
    ),
  ];
  const sessionShaping: NoRepairFinding[] = [];
  const hasTargetedDemand = (
    muscle: string,
    priorities: Array<PlanningRealityDiagnostic["shadowWeeklyDemand"][number]["priority"]>
  ): boolean => {
    const demand = input.noRepair.shadowWeeklyDemand.find(
      (row) => row.muscle === muscle
    );
    return (
      demand != null &&
      priorities.includes(demand.priority) &&
      demand.targetStatus !== "diagnostic"
    );
  };

  const hardCheckCodes: Record<string, string> = {
    "primary muscles above minimum": "primary_hard_target_below_minimum",
    "no primary muscle solved by forbidden slot": "forbidden_slot_primary_solution",
    "no Back Extension as clean Hamstrings closure": "back_extension_hamstrings_closure",
    "slotPlanSeedJson would replay without reselection": "runtime_seed_replay_failure",
  };

  for (const check of input.acceptanceChecks) {
    if (check.status === "pass") {
      continue;
    }
    if (check.check === "no concentration acceptance blockers") {
      continue;
    }
    if (
      check.check === "materialRepairCount = 0 for basic shape" ||
      check.check === "majorRepairCount = 0" ||
      check.check === "suspicious repairs do not increase"
    ) {
      continue;
    }
    if (check.check === "no exercise above 5 sets unless justified") {
      continue;
    }
    if (
      check.check === "Chest has two upper-slot exposures" &&
      hasTargetedDemand("Chest", ["primary"])
    ) {
      hardBlockers.push(
        noRepairCheckFinding("required_chest_upper_exposures_missing", check)
      );
      continue;
    }
    if (
      check.check === "Hamstrings have hinge + curl distribution" &&
      hasTargetedDemand("Hamstrings", ["primary"])
    ) {
      hardBlockers.push(
        noRepairCheckFinding("required_hamstrings_hinge_curl_missing", check)
      );
      continue;
    }
    if (
      check.check === "Side Delts get direct low-collateral work" &&
      hasTargetedDemand("Side Delts", ["support"])
    ) {
      hardBlockers.push(
        noRepairCheckFinding("required_side_delts_direct_work_missing", check)
      );
      continue;
    }
    if (check.check === "Calves distributed across lower slots if feasible") {
      const calvesTargeted = hasTargetedDemand("Calves", ["support", "primary"]);
      const finding = noRepairCheckFinding(
        check.status === "fail" && calvesTargeted
          ? "required_calves_lower_slot_distribution_missing"
          : "calf_split_session_shaping",
        check
      );
      if (check.status === "fail" && calvesTargeted) {
        hardBlockers.push(finding);
      } else {
        sessionShaping.push(finding);
      }
      continue;
    }
    if (
      check.check ===
      "no duplicate main lift when clean alternative exists unless justified"
    ) {
      qualityWarnings.push(
        noRepairCheckFinding("duplicate_main_lift_needs_review", check)
      );
      continue;
    }
    const hardCode = hardCheckCodes[check.check];
    if (hardCode) {
      hardBlockers.push(noRepairCheckFinding(hardCode, check));
    } else if (check.status === "unknown") {
      diagnosticOnly.push(noRepairCheckFinding(`unknown_check:${check.check}`, check));
    } else {
      qualityWarnings.push(noRepairCheckFinding(`non_blocking_check:${check.check}`, check));
    }
  }

  const compoundOverFiveBlockers =
    buildNoRepairCompoundOverFiveBlockers(input.noRepair);
  if (compoundOverFiveBlockers.length > 0) {
    hardBlockers.push(
      noRepairFinding(
        "compound_hinge_or_press_gt_5_sets_without_justification",
        compoundOverFiveBlockers
      )
    );
  }

  const supportBelowPreferred = input.weeklyMuscleTotals.filter((row) => {
    const semantics = getMuscleTargetSemantics(row.muscle);
    if (semantics.targetTier !== "B_SUPPORT") {
      return false;
    }
    return (
      row.targetPreferred != null &&
      row.projectedEffectiveSets < row.targetPreferred &&
      row.projectedEffectiveSets > 0
    );
  });
  if (supportBelowPreferred.length > 0) {
    qualityWarnings.push(
      noRepairFinding(
        "support_below_preferred_with_direct_work",
        supportBelowPreferred.map(
          (row) =>
            `${row.muscle}:${row.projectedEffectiveSets}_of_${row.targetPreferred}`
        )
      )
    );
  }

  const abovePreferred = input.weeklyMuscleTotals.filter(
    (row) =>
      row.status === "above" &&
      getMuscleTargetSemantics(row.muscle).targetTier !== "A_PRIMARY"
  );
  if (abovePreferred.length > 0) {
    qualityWarnings.push(
      noRepairFinding(
        "above_preferred_but_recoverable",
        abovePreferred.map((row) => `${row.muscle}:${row.projectedEffectiveSets}`)
      )
    );
  }

  if (input.setAllocationChanges.length > 0) {
    sessionShaping.push(
      noRepairFinding(
        "planner_owned_set_allocation_changes",
        input.setAllocationChanges.map(
          (row) =>
            `${row.slotId}:${row.lane}:${row.exerciseName}:${row.setsBefore}->${row.setsAfter}`
        )
      )
    );
  }

  const nonBlockingValidationRows = input.slotPlans.flatMap((slot) =>
    slot.validationFailures.map((row) => `${slot.slotId}:${row}`)
  );
  if (nonBlockingValidationRows.length > 0) {
    sessionShaping.push(
      noRepairFinding("non_blocking_session_shaping_rows", nonBlockingValidationRows)
    );
  }

  if (hasWeeksTwoToFourUnprojected(input.noRepair)) {
    diagnosticOnly.push(
      noRepairFinding("weeks_2_to_4_projection_incomplete", [
        "weeks_2_to_4_unprojected",
      ])
    );
  }
  if (hasDeloadProjectionIncomplete(input.noRepair)) {
    diagnosticOnly.push(
      noRepairFinding("deload_projection_incomplete", [
        "deload_projection_incomplete",
      ])
    );
  }

  const migrationScoreboard = buildNoRepairMigrationScoreboard({
    noRepair: input.noRepair,
    repairedPlanningReality: input.repairedPlanningReality,
    canReplaceRepairedProjection: input.canReplaceRepairedProjection,
    repairedProjectionAvailable: input.repairedProjectionAvailable,
    targetLanesMissing: input.targetLanesMissing,
    unresolvedDemandCount: input.unresolvedDemandCount,
    validationFailureCount: input.validationFailureCount,
    hardBlockerCount: hardBlockers.length,
  });

  const hasWarnings =
    qualityWarnings.length > 0 ||
    diagnosticOnly.length > 0 ||
    sessionShaping.length > 0;
  const basicMesocycleShapeStatus =
    hardBlockers.length > 0
      ? "fail"
      : hasWarnings
        ? "pass_with_warnings"
        : "pass";
  const replacementReadinessStatus =
    hardBlockers.length > 0
      ? "blocked"
      : migrationScoreboard.canReplaceRepairedProjection
        ? "ready"
        : "not_ready";

  return {
    basicMesocycleShapeStatus,
    replacementReadinessStatus,
    hardBlockers,
    qualityWarnings,
    diagnosticOnly,
    sessionShaping,
    migrationScoreboard,
  };
}

export function buildPlannerOnlyNoRepairComparison(input: {
  noRepairPlanningReality: PlanningRealityDiagnostic | undefined;
  repairedPlanningReality?: PlanningRealityDiagnostic;
  compareRepaired: boolean;
  repairedProjectionAvailable: boolean;
}): MesocycleExplainPlannerOnlyNoRepair {
  const repairDependenciesDisabled = [
    "support-floor closure",
    "weekly obligation closure",
    "program-quality identity repair",
    "late set bumping",
    "isolation injection/accessory-lane rescue",
    "clean-curl repair preference",
    "duplicate/program-quality repair shaping",
    "cap trim",
    "MAV trim",
    "forbidden cleanup mutation",
    "seed/runtime persistence",
  ];
  const repairedPasses =
    input.repairedProjectionAvailable &&
    ((input.repairedPlanningReality?.finalSlotPlan.length ?? 0) > 0 ||
      input.repairedPlanningReality == null);
  if (!input.noRepairPlanningReality) {
    const repairPromotionScoreboard = buildRepairPromotionScoreboard(
      input.repairedPlanningReality
    );
    const acceptanceClassification: NoRepairClassification = {
      basicMesocycleShapeStatus: "fail",
      replacementReadinessStatus: "blocked",
      hardBlockers: [
        noRepairFinding("runtime_seed_replay_failure", ["planningReality_missing"]),
      ],
      qualityWarnings: [],
      diagnosticOnly: [],
      sessionShaping: [],
      migrationScoreboard: {
        materialRepairCount: input.repairedPlanningReality
          ? getMaterialRepairCount(input.repairedPlanningReality)
          : null,
        majorRepairCount: input.repairedPlanningReality
          ? getMajorRepairCount(input.repairedPlanningReality)
          : null,
        suspiciousRepairs: input.repairedPlanningReality
          ? input.repairedPlanningReality.suspiciousRepairsNotEligibleForPromotion
              ?.length ?? 0
          : null,
        canReplaceRepairedProjection: false,
        reason: "planningReality_missing",
      },
    };
    const acceptanceChecks: MesocycleExplainPlannerOnlyNoRepair["acceptanceChecks"] = [
      {
        check: "planner-only no-repair planningReality available",
        status: "fail",
        evidence: ["planningReality_missing"],
      },
    ];
    const v2MesocyclePlan = buildV2MesocyclePlan({
      slotPlans: [],
      acceptanceChecks,
      acceptanceClassification,
      targetLanesMissing: 1,
    });
    const v2SetDistributionIntent = getPureV2SetDistributionIntent();
    const v2SupportLanePolicy = getPureV2SupportLanePolicy();
    const plannerOwnedAccumulationProjection =
      buildPlannerOwnedAccumulationProjection({
        weeklyDemandCurve: undefined,
        v2SetDistributionIntent,
      });
    const v2TargetVsNoRepairDiff = buildV2TargetVsNoRepairDiff({
      v2Plan: v2MesocyclePlan,
      v2SetDistributionIntent,
      repaired: input.repairedPlanningReality,
      slotPlans: [],
      acceptanceClassification,
    });
    const v2ExerciseSelectionPlanDiagnostic =
      buildV2ExerciseSelectionPlanDiagnostic({
        plannerOwnedAccumulationProjection,
        week1SelectedIdentities: [],
        v2SetDistributionIntent,
        v2TargetVsNoRepairDiff,
      });
    const v2DeloadProjectionDiagnostic = buildV2DeloadProjectionDiagnostic({
      v2MesocyclePlan,
      v2SetDistributionIntent,
      v2ExerciseSelectionPlanDiagnostic,
    });
    const crossWeekProjectionGate = buildCrossWeekProjectionGate({
      acceptanceClassification,
      v2MesocyclePlan,
      v2SetDistributionIntent,
      plannerOwnedAccumulationProjection,
      v2TargetVsNoRepairDiff,
      v2ExerciseSelectionPlanDiagnostic,
      v2DeloadProjectionDiagnostic,
    });
    return {
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        targetLanesSatisfied: 0,
        targetLanesMissing: 1,
        unresolvedDemandCount: 1,
        validationFailureCount: 1,
      },
      acceptanceClassification,
      ...(repairPromotionScoreboard ? { repairPromotionScoreboard } : {}),
      v2MesocyclePlan,
      v2DeloadProjectionDiagnostic,
      crossWeekProjectionGate,
      v2TargetVsNoRepairDiff,
      v2SetDistributionIntent,
      v2SupportLanePolicy,
      plannerOwnedAccumulationProjection,
      v2ExerciseSelectionPlanDiagnostic,
      slotPlans: [],
      weeklyMuscleTotals: [],
      setAllocationChanges: [],
      weeklyMuscleTotalChanges: [],
      acceptanceChecks,
      acceptanceFailures: [],
      qualityWarnings: [],
      diagnosticRows: [],
      ignoredRows: [],
      repairDependenciesDisabled,
      ...(input.compareRepaired
        ? {
            comparisonToRepaired: {
              repairedPasses,
              noRepairPasses: false,
              mainGaps: ["planningReality_missing"],
            },
          }
        : {}),
    };
  }

  const noRepair = input.noRepairPlanningReality;
  const concentrationClassification = classifyNoRepairConcentrationRows(noRepair);
  const slotPlans = buildNoRepairSlotPlans(
    noRepair,
    concentrationClassification
  );
  const weeklyMuscleTotals = buildNoRepairWeeklyMuscleTotals(noRepair);
  const setAllocationChanges = buildNoRepairSetAllocationChanges(noRepair);
  const weeklyMuscleTotalChanges = buildNoRepairWeeklyMuscleTotalChanges({
    weeklyMuscleTotals,
    setAllocationChanges,
  });
  const acceptanceChecks = buildNoRepairAcceptanceChecks(
    noRepair,
    weeklyMuscleTotals,
    concentrationClassification
  );
  const targetLanesSatisfied =
    noRepair.topDownMesocyclePlan?.summary.matchedTargetLanes ??
    slotPlans.reduce((sum, slot) => sum + Math.max(0, slot.exercises.length - slot.missingLanes.length), 0);
  const explicitMissing =
    (noRepair.topDownMesocyclePlan?.summary.missingTargetLanes ?? 0) +
    (noRepair.topDownMesocyclePlan?.summary.partialTargetLanes ?? 0) +
    slotPlans.reduce((sum, slot) => sum + slot.missingLanes.length, 0);
  const targetLanesMissing = Math.max(0, explicitMissing);
  const unresolvedDemandCount = slotPlans.reduce(
    (sum, slot) => sum + slot.unresolvedDemand.length,
    0
  );
  const validationFailureCount =
    slotPlans.reduce((sum, slot) => sum + slot.validationFailures.length, 0) +
    acceptanceChecks.filter((check) => check.status === "fail").length;
  const canReplaceRepairedProjection =
    targetLanesMissing === 0 &&
    unresolvedDemandCount === 0 &&
    validationFailureCount === 0 &&
    acceptanceChecks.every((check) => check.status === "pass");
  const acceptanceClassification = buildNoRepairAcceptanceClassification({
    noRepair,
    repairedPlanningReality: input.repairedPlanningReality,
    repairedProjectionAvailable: input.repairedProjectionAvailable,
    canReplaceRepairedProjection,
    targetLanesMissing,
    unresolvedDemandCount,
    validationFailureCount,
    acceptanceChecks,
    concentrationClassification,
    setAllocationChanges,
    weeklyMuscleTotals,
    slotPlans,
  });
  const gaps = mainNoRepairGaps({ slotPlans, acceptanceChecks });
  const v2MesocyclePlan = buildV2MesocyclePlan({
    noRepair,
    slotPlans,
    acceptanceChecks,
    acceptanceClassification,
    targetLanesMissing,
  });
  const v2SetDistributionIntent = getPureV2SetDistributionIntent();
  const v2SupportLanePolicy = getPureV2SupportLanePolicy();
  const plannerOwnedAccumulationProjection =
    buildPlannerOwnedAccumulationProjection({
      weeklyDemandCurve: noRepair.weeklyDemandCurve,
      v2SetDistributionIntent,
    });
  const v2TargetVsNoRepairDiff = buildV2TargetVsNoRepairDiff({
    v2Plan: v2MesocyclePlan,
    v2SetDistributionIntent,
    noRepair,
    repaired: input.repairedPlanningReality,
    slotPlans,
    acceptanceClassification,
  });
  const v2ExerciseSelectionPlanDiagnostic =
    buildV2ExerciseSelectionPlanDiagnostic({
      plannerOwnedAccumulationProjection,
      week1SelectedIdentities: noRepair.finalSlotPlan,
      v2SetDistributionIntent,
      v2TargetVsNoRepairDiff,
      exerciseClassDistributionBySlot: noRepair.exerciseClassDistributionBySlot,
      exerciseClassAlignment: noRepair.exerciseClassAlignment,
      exerciseClassUnresolvedCauses: noRepair.exerciseClassUnresolvedCauses,
      duplicateContinuityJustification: noRepair.duplicateContinuityJustification,
      exerciseConcentration: noRepair.exerciseConcentration,
    });
  const v2DeloadProjectionDiagnostic = buildV2DeloadProjectionDiagnostic({
    v2MesocyclePlan,
    v2SetDistributionIntent,
    v2ExerciseSelectionPlanDiagnostic,
  });
  const crossWeekProjectionGate = buildCrossWeekProjectionGate({
    noRepair,
    acceptanceClassification,
    v2MesocyclePlan,
    v2SetDistributionIntent,
    plannerOwnedAccumulationProjection,
    v2TargetVsNoRepairDiff,
    v2ExerciseSelectionPlanDiagnostic,
    v2DeloadProjectionDiagnostic,
  });
  const repairPromotionScoreboard = buildRepairPromotionScoreboard(
    input.repairedPlanningReality,
    {
      weeklyMuscleTotals,
      slotPlans,
      v2MesocyclePlan,
      v2SetDistributionIntent,
      v2TargetVsNoRepairDiff,
      v2ExerciseSelectionPlanDiagnostic,
    }
  );

  return {
    enabled: true,
    readOnly: true,
    affectsScoringOrGeneration: false,
    canReplaceRepairedProjection,
    summary: {
      status: acceptanceClassification.basicMesocycleShapeStatus,
      targetLanesSatisfied,
      targetLanesMissing,
      unresolvedDemandCount,
      validationFailureCount,
    },
    acceptanceClassification,
    ...(repairPromotionScoreboard ? { repairPromotionScoreboard } : {}),
    crossWeekProjectionGate,
    v2MesocyclePlan,
    v2DeloadProjectionDiagnostic,
    v2TargetVsNoRepairDiff,
    v2SetDistributionIntent,
    v2SupportLanePolicy,
    plannerOwnedAccumulationProjection,
    v2ExerciseSelectionPlanDiagnostic,
    slotPlans,
    weeklyMuscleTotals,
    setAllocationChanges,
    weeklyMuscleTotalChanges,
    acceptanceChecks,
    acceptanceFailures: concentrationClassification.acceptanceFailures,
    qualityWarnings: concentrationClassification.qualityWarnings,
    diagnosticRows: concentrationClassification.diagnosticRows,
    ignoredRows: concentrationClassification.ignoredRows,
    repairDependenciesDisabled,
    ...(input.compareRepaired
      ? {
          comparisonToRepaired: {
            repairedPasses,
            noRepairPasses: canReplaceRepairedProjection,
            mainGaps: gaps,
          },
        }
      : {}),
  };
}

function buildComparisonKey(slotIndex: number | null, slotId: string | null): string {
  if (slotIndex != null) {
    return `index:${slotIndex}`;
  }
  return `slot:${slotId ?? "unknown"}`;
}

function buildSlotObligationSummary(input: {
  slotId: string;
  intent: string;
  slotSequenceJson: unknown;
  weeklySchedule: string[];
}): string[] {
  const resolved = resolveMesocycleSlotContract({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const slot = resolved.slots.find((entry) => entry.slotId === input.slotId);
  const sessionPolicy = resolveSessionSlotPolicy({
    sessionIntent: input.intent as SessionIntent,
    slotId: input.slotId,
    slotSequence: {
      slots: resolved.slots.map((entry, sequenceIndex) => ({
        slotId: entry.slotId,
        intent: entry.intent,
        sequenceIndex,
        authoredSemantics: entry.authoredSemantics,
      })),
    },
  }).currentSession;

  const obligations: string[] = [];
  if (slot?.authoredSemantics?.slotArchetype) {
    obligations.push(`slot_archetype:${slot.authoredSemantics.slotArchetype}`);
  }
  if (slot?.authoredSemantics?.continuityScope) {
    obligations.push(`continuity_scope:${slot.authoredSemantics.continuityScope}`);
  }
  const requiredPatterns = sessionPolicy?.sessionShape?.requiredMovementPatterns ?? [];
  if (requiredPatterns.length > 0) {
    obligations.push(`required_patterns:${requiredPatterns.join(",")}`);
  }
  const supportContract = slot?.authoredSemantics?.supportCoverageContract;
  if (supportContract) {
    obligations.push(`support_coverage:${JSON.stringify(supportContract)}`);
  }
  const primaryLane = slot?.authoredSemantics?.primaryLaneContract;
  if (primaryLane) {
    obligations.push(`primary_lane:${JSON.stringify(primaryLane)}`);
  }

  return obligations;
}

function buildExerciseNameMap(input: {
  slotRows: MesocycleExplainSlotRow[];
  workouts: ExplainWorkoutRow[];
  carryForward: MaterializedHandoffArtifacts["carryForwardRecommendations"];
}): Map<string, string> {
  const byId = new Map<string, string>();

  for (const slot of input.slotRows) {
    for (const exercise of slot.exercises) {
      byId.set(exercise.exerciseId, exercise.exerciseName);
    }
  }

  for (const workout of input.workouts) {
    for (const exercise of workout.exercises) {
      byId.set(exercise.exerciseId, exercise.exercise.name);
    }
  }

  for (const recommendation of input.carryForward) {
    byId.set(recommendation.exerciseId, recommendation.exerciseName);
  }

  return byId;
}

function normalizeSeedSlots(input: {
  slotPlanSeedJson: unknown;
  slotSequenceJson: unknown;
  weeklySchedule: string[];
  exerciseNameById: Map<string, string>;
}): NormalizedSeedSlot[] {
  const parsedSeed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  if (!parsedSeed) {
    return [];
  }

  const resolvedSlots = resolveMesocycleSlotContract({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  }).slots;
  const seedBySlotId = new Map(parsedSeed.slots.map((slot) => [slot.slotId, slot.exercises]));

  return resolvedSlots.flatMap((slot, slotIndex) => {
    const exercises = seedBySlotId.get(slot.slotId);
    if (!exercises || exercises.length === 0) {
      return [];
    }

    return [{
      slotId: slot.slotId,
      slotIndex,
      intent: slot.intent,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: input.exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
        role: exercise.role,
        ...(exercise.setCount != null ? { setCount: exercise.setCount } : {}),
      })),
    }];
  });
}

async function loadExplainMesocycle(input: {
  userId: string;
  mesocycleId: string;
}): Promise<ExplainMesocycleRow> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    include: {
      blocks: {
        orderBy: { blockNumber: "asc" },
      },
      macroCycle: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!mesocycle) {
    throw new Error(`No mesocycle found for mesocycle-explain mesocycleId=${input.mesocycleId}.`);
  }

  return mesocycle;
}

async function resolveSourceMesocycleId(userId: string): Promise<string> {
  const activeMesocycle = await loadActiveMesocycle(userId);
  if (activeMesocycle) {
    return activeMesocycle.id;
  }

  const latestMesocycle = await prisma.mesocycle.findFirst({
    where: {
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    select: {
      id: true,
    },
  });

  if (!latestMesocycle) {
    throw new Error("No mesocycle found for mesocycle-explain.");
  }

  return latestMesocycle.id;
}

async function loadPreviewArtifacts(input: {
  sourceMesocycle: ExplainMesocycleRow;
}): Promise<{
  rationaleBasis: "persisted_handoff_summary" | "reconstructed_now";
  artifacts: MaterializedHandoffArtifacts;
}> {
  const persistedSummary = readMesocycleHandoffSummary(input.sourceMesocycle.handoffSummaryJson);
  if (persistedSummary?.recommendedDesign && persistedSummary.recommendedNextSeed) {
    return {
      rationaleBasis: "persisted_handoff_summary",
      artifacts: {
        summary: persistedSummary,
        recommendedDesign: persistedSummary.recommendedDesign,
        recommendedNextSeed: persistedSummary.recommendedNextSeed,
        carryForwardRecommendations: persistedSummary.carryForwardRecommendations,
      },
    };
  }

  const handoffSource = await loadHandoffSourceMesocycle(prisma, input.sourceMesocycle.id);
  const roles = await prisma.mesocycleExerciseRole.findMany({
    where: { mesocycleId: input.sourceMesocycle.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      exerciseId: true,
      sessionIntent: true,
      role: true,
      exercise: {
        select: {
          name: true,
        },
      },
    },
  }) satisfies HandoffArtifactRoleRow[];
  const candidateExerciseIds = Array.from(new Set(roles.map((role) => role.exerciseId)));
  const [constraints, workouts, latestReadiness] = await Promise.all([
    prisma.constraints.findUnique({
      where: { userId: input.sourceMesocycle.macroCycle.userId },
      select: { weeklySchedule: true, daysPerWeek: true, splitType: true },
    }) as Promise<HandoffArtifactConstraintsRow | null>,
    prisma.workout.findMany({
      where: { mesocycleId: input.sourceMesocycle.id },
      orderBy: [{ scheduledDate: "desc" }],
      select: {
        scheduledDate: true,
        completedAt: true,
        status: true,
        sessionIntent: true,
        selectionMode: true,
        selectionMetadata: true,
        advancesSplit: true,
        mesocyclePhaseSnapshot: true,
        exercises: {
          where:
            candidateExerciseIds.length > 0
              ? { exerciseId: { in: candidateExerciseIds } }
              : undefined,
          select: {
            id: true,
            exerciseId: true,
          },
        },
      },
    }) as Promise<HandoffArtifactWorkoutRow[]>,
    getLatestReadinessSignalForReader(prisma, input.sourceMesocycle.macroCycle.userId),
  ]);

  return {
    rationaleBasis: "reconstructed_now",
    artifacts: materializeHandoffArtifacts({
      source: handoffSource as HandoffArtifactSource,
      constraints,
      roles,
      workouts,
      latestReadiness,
      closedAt: input.sourceMesocycle.closedAt ?? new Date(),
      existingSummary: persistedSummary,
    }),
  };
}

function buildPreviewSlotRows(input: {
  slotPlans: Array<{
    slotId: string;
    intent: string;
    exercises: Array<{
      exerciseId: string;
      role: string;
      setCount?: number;
    }>;
  }>;
  exerciseNameById: Map<string, string>;
}): MesocycleExplainSlotRow[] {
  return input.slotPlans.map((slot, slotIndex) => ({
    slotId: slot.slotId,
    slotIndex,
    intent: slot.intent,
    exercises: slot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: input.exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
      role: exercise.role,
      ...(exercise.setCount != null ? { setCount: exercise.setCount } : {}),
    })),
  }));
}

function buildSyntheticProjectedMesocycle(input: {
  sourceMesocycle: ExplainMesocycleRow;
  projection: ReturnType<typeof projectSuccessorMesocycle>;
  slotPlanSeedJson: ReturnType<typeof buildMesocycleSlotPlanSeed>;
}): ExplainMesocycleRow {
  const nextMesocycleId = `preview-${input.sourceMesocycle.id}-${input.projection.mesocycle.mesoNumber}`;

  return {
    ...input.sourceMesocycle,
    id: nextMesocycleId,
    mesoNumber: input.projection.mesocycle.mesoNumber,
    startWeek: input.projection.mesocycle.startWeek,
    durationWeeks: input.projection.mesocycle.durationWeeks,
    focus: input.projection.mesocycle.focus,
    volumeTarget: input.projection.mesocycle.volumeTarget,
    intensityBias: input.projection.mesocycle.intensityBias,
    isActive: true,
    state: "ACTIVE_ACCUMULATION",
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: input.projection.mesocycle.sessionsPerWeek,
    daysPerWeek: input.projection.mesocycle.daysPerWeek,
    splitType: input.projection.mesocycle.splitType,
    slotSequenceJson: input.projection.mesocycle.slotSequence as Prisma.JsonValue,
    slotPlanSeedJson: input.slotPlanSeedJson as Prisma.JsonValue,
    closedAt: null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    blocks: input.projection.trainingBlocks.map((block) => ({
      ...(input.sourceMesocycle.blocks[0] ?? {}),
      id: `${nextMesocycleId}-block-${block.blockNumber}`,
      mesocycleId: nextMesocycleId,
      blockNumber: block.blockNumber,
      blockType: block.blockType,
      startWeek: block.startWeek,
      durationWeeks: block.durationWeeks,
      volumeTarget: block.volumeTarget,
      intensityBias: block.intensityBias,
      adaptationType: block.adaptationType,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as ExplainMesocycleRow["blocks"],
  };
}

async function buildPreviewProjectedSessions(input: {
  userId: string;
  sourceMesocycle: ExplainMesocycleRow;
  projection: ReturnType<typeof projectSuccessorMesocycle>;
  slotPlanSeedJson: ReturnType<typeof buildMesocycleSlotPlanSeed>;
  plannerDiagnosticsMode: "standard" | "debug";
  limitations: string[];
}): Promise<MesocycleExplainPreviewProjectedSession[]> {
  const syntheticMesocycle = buildSyntheticProjectedMesocycle({
    sourceMesocycle: input.sourceMesocycle,
    projection: input.projection,
    slotPlanSeedJson: input.slotPlanSeedJson,
  });
  const snapshot = await loadPreloadedGenerationSnapshot(input.userId, {
    activeMesocycle: syntheticMesocycle,
    forceAccumulation: true,
  });
  const mapped = buildMappedGenerationContextFromSnapshot(input.userId, snapshot, {
    forceAccumulation: true,
  });
  const projectionStartTime = new Date();
  const sessions: MesocycleExplainPreviewProjectedSession[] = [];

  for (const [slotIndex, slot] of input.projection.mesocycle.slotSequence.slots.entries()) {
    const generation = await generateProjectedSession({
      userId: input.userId,
      mapped,
      intent: slot.intent.toLowerCase() as SessionIntent,
      slotId: slot.slotId,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
    });
    if ("error" in generation) {
      input.limitations.push(
        `Preview projected session generation stopped at slot ${slot.slotId} because canonical seeded runtime generation failed: ${generation.error}`
      );
      break;
    }

    sessions.push({
      sessionIndex: slotIndex + 1,
      slotId: slot.slotId,
      slotIndex,
      intent: slot.intent,
      exerciseCount: countWorkoutExercises(generation.workout),
      totalSets: countWorkoutSets(generation.workout),
      exerciseIds: [...generation.workout.mainLifts, ...generation.workout.accessories].map(
        (exercise) => exercise.exercise.id
      ),
    });

    const projectedAt = new Date(projectionStartTime.getTime() + slotIndex * 60_000);
    appendWorkoutHistoryEntryToMappedContext({
      mapped,
      historyEntry: buildProjectedWorkoutHistoryEntry({
        mapped,
        workout: generation.workout,
        slotId: slot.slotId,
        intent: slot.intent.toLowerCase() as SessionIntent,
        week: 1,
        sessionNumber: slotIndex + 1,
        occurredAt: projectedAt,
      }),
      occurredAt: projectedAt,
      rotationExerciseNames: listWorkoutExerciseNames(generation.workout),
    });
  }

  return sessions;
}

function buildPreviewExerciseRationale(input: {
  previewSlots: MesocycleExplainSlotRow[];
  design: MaterializedHandoffArtifacts["recommendedDesign"];
  carryForwardReasons: MaterializedHandoffArtifacts["carryForwardRecommendations"];
  rationaleBasis: "persisted_handoff_summary" | "reconstructed_now";
  slotSequenceJson: unknown;
  weeklySchedule: string[];
  repairedSlotIds: Set<string>;
}): MesocycleExplainExerciseRationale[] {
  return input.previewSlots.flatMap((slot) =>
    slot.exercises.map((exercise) => {
      const keepDecision =
        input.design.carryForward.decisions.find((decision) => {
          if (decision.exerciseId !== exercise.exerciseId || decision.role !== exercise.role) {
            return false;
          }
          if (decision.targetSlotId) {
            return decision.targetSlotId === slot.slotId;
          }
          return decision.targetIntent === slot.intent.toUpperCase();
        }) ?? null;
      const carryForwardReason =
        input.carryForwardReasons.find(
          (reason) =>
            reason.exerciseId === exercise.exerciseId &&
            reason.role === exercise.role &&
            reason.recommendation === "keep"
        ) ?? null;
      const constraints = [
        ...(keepDecision ? normalizeReasonCodes(keepDecision.reasonCodes) : []),
        ...(carryForwardReason ? normalizeReasonCodes(carryForwardReason.reasonCodes) : []),
        ...(input.repairedSlotIds.has(slot.slotId) ? ["protected_coverage_repair_applied"] : []),
        ...(keepDecision || carryForwardReason ? [] : ["selected_via_canonical_slot_plan_projection"]),
      ];

      return {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        intent: slot.intent,
        role: exercise.role,
        reasonSource:
          input.rationaleBasis === "persisted_handoff_summary"
            ? ("persisted" as const)
            : ("reconstructed" as const),
        slotObligation: buildSlotObligationSummary({
          slotId: slot.slotId,
          intent: slot.intent.toLowerCase(),
          slotSequenceJson: input.slotSequenceJson,
          weeklySchedule: input.weeklySchedule,
        }),
        constraints,
        continuity: normalizeReasonCodes(
          [
            ...(keepDecision ? keepDecision.reasonCodes : []),
            ...(carryForwardReason ? carryForwardReason.reasonCodes : []),
          ].filter((code) => code.includes("keep") || code.includes("continu"))
        ),
        ranking: null,
      };
    })
  );
}

function buildSeedExerciseRationale(input: {
  seedSlots: NormalizedSeedSlot[];
  slotSequenceJson: unknown;
  weeklySchedule: string[];
}): MesocycleExplainExerciseRationale[] {
  return input.seedSlots.flatMap((slot) =>
    slot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      role: exercise.role,
      reasonSource: "persisted" as const,
      slotObligation: buildSlotObligationSummary({
        slotId: slot.slotId,
        intent: slot.intent.toLowerCase(),
        slotSequenceJson: input.slotSequenceJson,
        weeklySchedule: input.weeklySchedule,
      }),
      constraints: ["accepted_slot_plan_seed_membership"],
      continuity: [],
      ranking: null,
    }))
  );
}

function resolveSeedSlotForWorkout(input: {
  seedSlots: NormalizedSeedSlot[];
  slotId: string | null;
  slotIndex: number | null;
}): {
  seedSlot: NormalizedSeedSlot | null;
  comparisonBasis: "slot_id" | "slot_sequence_index" | "none";
} {
  if (input.slotId) {
    const bySlotId = input.seedSlots.find((slot) => slot.slotId === input.slotId) ?? null;
    if (bySlotId) {
      return {
        seedSlot: bySlotId,
        comparisonBasis: "slot_id",
      };
    }
  }

  if (input.slotIndex != null) {
    const byIndex = input.seedSlots.find((slot) => slot.slotIndex === input.slotIndex) ?? null;
    if (byIndex) {
      return {
        seedSlot: byIndex,
        comparisonBasis: "slot_sequence_index",
      };
    }
  }

  return {
    seedSlot: null,
    comparisonBasis: "none",
  };
}

function buildRuntimeExerciseContexts(
  workout: ExplainWorkoutRow
): RuntimeEditExerciseContext[] {
  return workout.exercises.map((workoutExercise) => ({
    exerciseId: workoutExercise.exerciseId,
    exerciseName: workoutExercise.exercise.name,
    primaryMuscles: workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "PRIMARY")
      .map((mapping) => mapping.muscle.name),
    secondaryMuscles: workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "SECONDARY")
      .map((mapping) => mapping.muscle.name),
    aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
  }));
}

function buildRuntimeDriftLabels(
  interpretations: MesocycleExplainRealityWorkout["runtimeInterpretations"]
): string[] {
  return Array.from(
    new Set(
      interpretations.map((interpretation) => {
        if (interpretation.intent === "target_gap_closure") {
          return "runtime_addition_target_gap_closure";
        }
        if (interpretation.intent === "opportunistic_extra") {
          return "runtime_addition_opportunistic_extra";
        }
        if (interpretation.intent === "substitution") {
          return "runtime_substitution";
        }
        if (
          interpretation.intent === "pain_avoidance" ||
          interpretation.intent === "fatigue_adjustment"
        ) {
          return `runtime_${interpretation.intent}`;
        }
        return "runtime_unclassified_drift";
      })
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildRealityRows(input: {
  workouts: ExplainWorkoutRow[];
  seedSlots: NormalizedSeedSlot[];
}): {
  rows: MesocycleExplainRealityWorkout[];
  latestRealityBySlot: ComparisonSlotShape[];
} {
  const latestRealityByKey = new Map<string, ComparisonSlotShape & { scheduledDate: string }>();
  const rows = input.workouts.map((workout) => {
    const { sessionSnapshot } = resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: workout.selectionMetadata,
      workoutId: workout.id,
      revision: workout.revision,
      status: workout.status,
      advancesSplit: workout.advancesSplit,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    });
    const generatedVsSaved = buildSessionAuditMutationSummary({
      snapshot: sessionSnapshot,
      savedSelectionMode: workout.selectionMode,
      savedSessionIntent: workout.sessionIntent,
      persistedExercises: workout.exercises,
    });
    const slotSnapshot = readSessionSlotSnapshot(workout.selectionMetadata);
    const actualExerciseIds = workout.exercises.map((exercise) => exercise.exerciseId);
    const resolvedSeed = resolveSeedSlotForWorkout({
      seedSlots: input.seedSlots,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
    });
    const seedExerciseIds = resolvedSeed.seedSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const runtimeInterpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: readRuntimeEditReconciliation(workout.selectionMetadata),
      exerciseContexts: buildRuntimeExerciseContexts(workout),
      legacyReconciliation: generatedVsSaved,
    });
    const row: MesocycleExplainRealityWorkout = {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate.toISOString(),
      status: workout.status,
      selectionMode: workout.selectionMode ?? undefined,
      sessionIntent: workout.sessionIntent ?? undefined,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
      generatedVsSaved,
      seedDrift: {
        comparable: resolvedSeed.seedSlot != null,
        comparisonBasis: resolvedSeed.comparisonBasis,
        addedExerciseIds: actualExerciseIds.filter((exerciseId) => !seedExerciseIds.includes(exerciseId)),
        removedExerciseIds: seedExerciseIds.filter((exerciseId) => !actualExerciseIds.includes(exerciseId)),
        notes:
          resolvedSeed.seedSlot == null
            ? ["no_matching_seed_slot"]
            : [],
      },
      runtimeInterpretations,
      runtimeDriftLabels: buildRuntimeDriftLabels(runtimeInterpretations),
    };

    if (row.slotId || row.slotIndex != null) {
      const comparisonKey = buildComparisonKey(row.slotIndex, row.slotId);
      const existing = latestRealityByKey.get(comparisonKey);
      if (!existing || existing.scheduledDate < row.scheduledDate) {
        latestRealityByKey.set(comparisonKey, {
          slotId: row.slotId,
          slotIndex: row.slotIndex,
          intent: normalizeIntent(workout.sessionIntent),
          exercises: workout.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            role: exercise.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
            setCount: exercise.sets.length,
          })),
          scheduledDate: row.scheduledDate,
        });
      }
    }

    return row;
  });

  return {
    rows,
    latestRealityBySlot: Array.from(latestRealityByKey.values()).map((entry) => ({
      slotId: entry.slotId,
      slotIndex: entry.slotIndex,
      intent: entry.intent,
      exercises: entry.exercises,
    })),
  };
}

function buildRealityExerciseRationale(input: {
  workouts: ExplainWorkoutRow[];
  seedSlots: NormalizedSeedSlot[];
  weeklySchedule: string[];
  slotSequenceJson: unknown;
}): MesocycleExplainExerciseRationale[] {
  return input.workouts.flatMap((workout) => {
    const { sessionSnapshot } = resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: workout.selectionMetadata,
      workoutId: workout.id,
      revision: workout.revision,
      status: workout.status,
      advancesSplit: workout.advancesSplit,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    });
    const mutation = buildSessionAuditMutationSummary({
      snapshot: sessionSnapshot,
      savedSelectionMode: workout.selectionMode,
      savedSessionIntent: workout.sessionIntent,
      persistedExercises: workout.exercises,
    });
    const runtimeInterpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: readRuntimeEditReconciliation(workout.selectionMetadata),
      exerciseContexts: buildRuntimeExerciseContexts(workout),
      legacyReconciliation: mutation,
    });
    const slotSnapshot = readSessionSlotSnapshot(workout.selectionMetadata);
    const resolvedSeed = resolveSeedSlotForWorkout({
      seedSlots: input.seedSlots,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
    });
    const seedExerciseIds = new Set(
      resolvedSeed.seedSlot?.exercises.map((exercise) => exercise.exerciseId) ?? []
    );

    return workout.exercises.map((exercise) => {
      const fromSeed = seedExerciseIds.has(exercise.exerciseId);
      const runtimeAdded = mutation.addedExerciseIds.includes(exercise.exerciseId);
      const runtimeIntent = runtimeInterpretations.find(
        (interpretation) => interpretation.exerciseId === exercise.exerciseId
      )?.intent;
      const reasonSource: MesocycleExplainReasonSource =
        fromSeed ? "persisted" : runtimeAdded ? "reconstructed" : "unavailable";

      return {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exercise.name,
        slotId: slotSnapshot?.slotId ?? null,
        slotIndex: slotSnapshot?.sequenceIndex ?? null,
        intent: normalizeIntent(workout.sessionIntent),
        role: exercise.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
        reasonSource,
        slotObligation:
          slotSnapshot?.slotId && workout.sessionIntent
            ? buildSlotObligationSummary({
                slotId: slotSnapshot.slotId,
                intent: workout.sessionIntent.toLowerCase(),
                slotSequenceJson: input.slotSequenceJson,
                weeklySchedule: input.weeklySchedule,
              })
            : [],
        constraints: [
          ...(runtimeAdded ? ["runtime_edit_added_exercise"] : []),
          ...(runtimeIntent ? [`runtime_intent:${runtimeIntent}`] : []),
        ],
        continuity: fromSeed ? ["present_in_canonical_seed"] : [],
        ranking: null,
      };
    });
  });
}

function buildComparisonSlotDiffs(input: {
  previewSlots: ComparisonSlotShape[];
  retrospectiveSlots: ComparisonSlotShape[];
  slotsComparable?: boolean;
}): MesocycleExplainComparisonSlotDiff[] {
  const previewByKey = new Map(
    input.previewSlots.map((slot) => [buildComparisonKey(slot.slotIndex, slot.slotId), slot])
  );
  const retrospectiveByKey = new Map(
    input.retrospectiveSlots.map((slot) => [buildComparisonKey(slot.slotIndex, slot.slotId), slot])
  );
  const keys = Array.from(new Set([...previewByKey.keys(), ...retrospectiveByKey.keys()])).sort();

  return keys.map((key) => {
    const preview = previewByKey.get(key) ?? null;
    const retrospective = retrospectiveByKey.get(key) ?? null;
    const previewExercises = preview?.exercises ?? [];
    const retrospectiveExercises = retrospective?.exercises ?? [];
    const previewExerciseIds = previewExercises.map((exercise) => exercise.exerciseId);
    const retrospectiveExerciseIds = retrospectiveExercises.map((exercise) => exercise.exerciseId);
    const retrospectiveByExerciseId = new Map(
      retrospectiveExercises.map((exercise) => [exercise.exerciseId, exercise])
    );
    const sharedExerciseIds = previewExerciseIds.filter((exerciseId) =>
      retrospectiveExerciseIds.includes(exerciseId)
    );
    const roleMismatches = sharedExerciseIds.flatMap((exerciseId) => {
      const previewExercise = previewExercises.find((exercise) => exercise.exerciseId === exerciseId);
      const retrospectiveExercise = retrospectiveByExerciseId.get(exerciseId);
      const previewRole = previewExercise?.role ?? null;
      const retrospectiveRole = retrospectiveExercise?.role ?? null;
      return previewRole !== retrospectiveRole
        ? [{ exerciseId, previewRole, retrospectiveRole }]
        : [];
    });
    const setCountMismatches = sharedExerciseIds.flatMap((exerciseId) => {
      const previewExercise = previewExercises.find((exercise) => exercise.exerciseId === exerciseId);
      const retrospectiveExercise = retrospectiveByExerciseId.get(exerciseId);
      const previewSetCount = previewExercise?.setCount ?? null;
      const retrospectiveSetCount = retrospectiveExercise?.setCount ?? null;
      return previewSetCount !== retrospectiveSetCount
        ? [{ exerciseId, previewSetCount, retrospectiveSetCount }]
        : [];
    });
    const orderedExerciseIdsMatch =
      previewExerciseIds.length === retrospectiveExerciseIds.length &&
      previewExerciseIds.every((exerciseId, index) => retrospectiveExerciseIds[index] === exerciseId);
    const exactMatch =
      preview != null &&
      retrospective != null &&
      normalizeIntent(preview.intent) === normalizeIntent(retrospective.intent) &&
      orderedExerciseIdsMatch &&
      roleMismatches.length === 0 &&
      setCountMismatches.length === 0;

    return {
      comparisonKey: key,
      previewSlotId: preview?.slotId ?? null,
      retrospectiveSlotId: retrospective?.slotId ?? null,
      previewIntent: preview?.intent ?? null,
      retrospectiveIntent: retrospective?.intent ?? null,
      previewOnlyExerciseIds: previewExerciseIds.filter(
        (exerciseId) => !retrospectiveExerciseIds.includes(exerciseId)
      ),
      retrospectiveOnlyExerciseIds: retrospectiveExerciseIds.filter(
        (exerciseId) => !previewExerciseIds.includes(exerciseId)
      ),
      sharedExerciseIds,
      orderedExerciseIdsMatch,
      roleMismatches,
      setCountMismatches,
      exactMatch,
      comparable: input.slotsComparable !== false && preview != null && retrospective != null,
    };
  });
}

export async function buildMesocycleExplainAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId?: string;
  retrospectiveMesocycleId?: string;
  plannerDiagnosticsMode: "standard" | "debug";
  plannerOnlyDryRun?: {
    enabled: true;
    compareRepaired: true;
    plannerOnlyPolicyOverride?: PlannerOnlyPolicyOverride;
  };
  plannerOnlyNoRepair?: {
    enabled: true;
    compareRepaired: boolean;
  };
}): Promise<MesocycleExplainAuditPayload> {
  const sourceMesocycleId = input.sourceMesocycleId ?? (await resolveSourceMesocycleId(input.userId));
  const retrospectiveMesocycleId = input.retrospectiveMesocycleId ?? sourceMesocycleId;
  const [sourceMesocycle, retrospectiveMesocycle, constraints] = await Promise.all([
    loadExplainMesocycle({ userId: input.userId, mesocycleId: sourceMesocycleId }),
    loadExplainMesocycle({ userId: input.userId, mesocycleId: retrospectiveMesocycleId }),
    prisma.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent.toLowerCase());
  const limitations: string[] = [];

  const previewArtifacts = await loadPreviewArtifacts({
    sourceMesocycle,
  });
  const sourceProjection = toHandoffProjectionSource(
    (await loadHandoffSourceMesocycle(prisma, sourceMesocycle.id)) as HandoffArtifactSource
  );
  const projectedMesocycle = projectSuccessorMesocycle({
    source: sourceProjection,
    design: previewArtifacts.artifacts.recommendedDesign,
  });
  const sourceSnapshot = await loadPreloadedGenerationSnapshot(input.userId, {
    activeMesocycle: sourceMesocycle,
  });
  const plannerOnlyPolicyOverride =
    input.plannerOnlyDryRun?.enabled && input.plannerOnlyDryRun.compareRepaired
      ? input.plannerOnlyDryRun.plannerOnlyPolicyOverride ??
        createCalvesFourFourPlannerOnlyPolicyOverride()
      : undefined;
  const slotPlanProjection = projectSuccessorSlotPlansFromSnapshot({
    userId: input.userId,
    source: sourceProjection,
    design: previewArtifacts.artifacts.recommendedDesign,
    snapshot: sourceSnapshot,
  });
  const plannerOnlyOverrideProjection = plannerOnlyPolicyOverride
    ? projectSuccessorSlotPlansFromSnapshot({
        userId: input.userId,
        source: sourceProjection,
        design: previewArtifacts.artifacts.recommendedDesign,
        snapshot: sourceSnapshot,
        plannerOnlyPolicyOverride,
      })
    : undefined;
  const plannerOnlyNoRepairProjection = input.plannerOnlyNoRepair?.enabled
    ? projectSuccessorSlotPlansFromSnapshot({
        userId: input.userId,
        source: sourceProjection,
        design: previewArtifacts.artifacts.recommendedDesign,
        snapshot: sourceSnapshot,
        experimentalPlannerOnlyNoRepair: true,
      })
    : undefined;

  if ("error" in slotPlanProjection) {
    limitations.push(
      `Preview slot-plan projection could not fully materialize through the canonical handoff projection seam: ${slotPlanProjection.error}`
    );
  }
  if (plannerOnlyOverrideProjection && "error" in plannerOnlyOverrideProjection) {
    limitations.push(
      `Planner-only override projection could not fully materialize through the canonical handoff projection seam: ${plannerOnlyOverrideProjection.error}`
    );
  }
  if (plannerOnlyNoRepairProjection && "error" in plannerOnlyNoRepairProjection) {
    limitations.push(
      `Planner-only no-repair projection reported unresolved demand without repair: ${plannerOnlyNoRepairProjection.error}`
    );
  }

  const previewSlotPlansRaw = "error" in slotPlanProjection ? (slotPlanProjection.slotPlans ?? []) : slotPlanProjection.slotPlans;
  const seedWorkouts = await prisma.workout.findMany({
    where: {
      mesocycleId: retrospectiveMesocycle.id,
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduledDate: true,
      status: true,
      revision: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          exercise: {
            select: {
              name: true,
              aliases: {
                select: {
                  alias: true,
                },
              },
              exerciseMuscles: {
                select: {
                  role: true,
                  muscle: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          sets: {
            orderBy: { setIndex: "asc" },
            select: {
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
            },
          },
        },
      },
    },
  });
  const previewSlotRows = buildPreviewSlotRows({
    slotPlans: previewSlotPlansRaw.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      exercises: slot.exercises,
    })),
    exerciseNameById: new Map(
      previewArtifacts.artifacts.carryForwardRecommendations.map((row) => [row.exerciseId, row.exerciseName])
    ),
  });
  const exerciseNameById = buildExerciseNameMap({
    slotRows: previewSlotRows,
    workouts: seedWorkouts,
    carryForward: previewArtifacts.artifacts.carryForwardRecommendations,
  });
  const previewSlotPlans = buildPreviewSlotRows({
    slotPlans: previewSlotPlansRaw.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      exercises: slot.exercises,
    })),
    exerciseNameById,
  });

  let previewProjectedSessions: MesocycleExplainPreviewProjectedSession[] = [];
  if (previewSlotPlansRaw.length > 0) {
    const previewSeed = buildMesocycleSlotPlanSeed({
      slotSequence: projectedMesocycle.mesocycle.slotSequence,
      slotPlans: previewSlotPlansRaw,
    });
    previewProjectedSessions = await buildPreviewProjectedSessions({
      userId: input.userId,
      sourceMesocycle,
      projection: projectedMesocycle,
      slotPlanSeedJson: previewSeed,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      limitations,
    });
  } else {
    limitations.push(
      "Preview slot plans are unavailable because the canonical handoff slot-plan projection did not return any slot plans."
    );
  }

  const seedSlots =
    retrospectiveMesocycle.slotPlanSeedJson != null
      ? normalizeSeedSlots({
          slotPlanSeedJson: retrospectiveMesocycle.slotPlanSeedJson,
          slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
          weeklySchedule,
          exerciseNameById,
        })
      : [];
  if (retrospectiveMesocycle.slotPlanSeedJson == null) {
    limitations.push(
      `Retrospective mesocycle ${retrospectiveMesocycle.id} has no persisted slotPlanSeedJson, so accepted-seed comparisons are unavailable.`
    );
  } else if (seedSlots.length === 0) {
    limitations.push(
      `Retrospective mesocycle ${retrospectiveMesocycle.id} has a persisted slotPlanSeedJson that could not be normalized against the canonical slot sequence.`
    );
  }

  const reality = buildRealityRows({
    workouts: seedWorkouts,
    seedSlots,
  });
  const previewVsSeed = buildComparisonSlotDiffs({
    previewSlots: previewSlotPlans.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    retrospectiveSlots: seedSlots.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    slotsComparable: false,
  });
  const previewVsReality = buildComparisonSlotDiffs({
    previewSlots: previewSlotPlans.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    retrospectiveSlots: reality.latestRealityBySlot,
  });

  limitations.push(
    "Historical acceptance-time candidate ranking rationale is not persisted for accepted mesocycle seeds, so ranking remains unavailable in seed and retrospective comparisons."
  );
  limitations.push(
    "Preview exercise rationale is strongest for slot obligation, carry-forward continuity, and protected-coverage reconstruction; per-candidate winner-over-alternative ranking is not claimed unless canonically persisted."
  );
  limitations.push(
    "Preview slot plans are fresh reprojections from the current canonical handoff projection seam, not persisted acceptance-time projection artifacts; preview-vs-seed diffs are diagnostic and are not marked comparable to the accepted seed."
  );
  if (sourceMesocycle.id !== retrospectiveMesocycle.id) {
    limitations.push(
      `Preview is generated from source mesocycle ${sourceMesocycle.id} while seed/reality read from retrospective mesocycle ${retrospectiveMesocycle.id}; cross-mesocycle diffs are structural comparisons, not a one-to-one replay.`
    );
  }
  if (reality.rows.some((row) => row.seedDrift.comparisonBasis === "none")) {
    limitations.push(
      "Some retrospective workouts were missing canonical slot identity, so seed-vs-reality drift falls back to unavailable for those sessions."
    );
  }
  const projectionDiagnostics = buildProjectionDiagnostics(slotPlanProjection.diagnostics);
  const plannerOnlyOverrideDiagnostics = plannerOnlyOverrideProjection
    ? buildProjectionDiagnostics(plannerOnlyOverrideProjection.diagnostics)
    : undefined;
  const plannerOnlyNoRepairDiagnostics = plannerOnlyNoRepairProjection
    ? buildProjectionDiagnostics(plannerOnlyNoRepairProjection.diagnostics)
    : undefined;
  const plannerOnlyDryRun =
    input.plannerOnlyDryRun?.enabled && input.plannerOnlyDryRun.compareRepaired
      ? buildPlannerOnlyDryRunComparison(
          projectionDiagnostics.planningReality,
          input.plannerOnlyDryRun.compareRepaired,
          plannerOnlyPolicyOverride,
          plannerOnlyOverrideDiagnostics?.planningReality
        )
      : undefined;
  const plannerOnlyNoRepair = input.plannerOnlyNoRepair?.enabled
    ? buildPlannerOnlyNoRepairComparison({
        noRepairPlanningReality: plannerOnlyNoRepairDiagnostics?.planningReality,
        repairedPlanningReality: projectionDiagnostics.planningReality,
        compareRepaired: input.plannerOnlyNoRepair.compareRepaired,
        repairedProjectionAvailable: !("error" in slotPlanProjection),
      })
    : undefined;

  return {
    version: MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION,
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: sourceMesocycle.id,
    retrospectiveMesocycleId: retrospectiveMesocycle.id,
    preview: {
      sourceMesocycleId: sourceMesocycle.id,
      rationaleBasis: previewArtifacts.rationaleBasis,
      designBasis: {
        focus: previewArtifacts.artifacts.recommendedDesign.profile.focus,
        splitType: previewArtifacts.artifacts.recommendedDesign.structure.splitType,
        sessionsPerWeek: previewArtifacts.artifacts.recommendedDesign.structure.sessionsPerWeek,
        daysPerWeek: previewArtifacts.artifacts.recommendedDesign.structure.daysPerWeek,
        durationWeeks: previewArtifacts.artifacts.recommendedDesign.profile.durationWeeks,
        volumeTarget: previewArtifacts.artifacts.recommendedDesign.profile.volumeTarget,
        intensityBias: previewArtifacts.artifacts.recommendedDesign.profile.intensityBias,
        profileReasonCodes: previewArtifacts.artifacts.recommendedDesign.explainability.profileReasonCodes,
        structureReasonCodes: previewArtifacts.artifacts.recommendedDesign.explainability.structureReasonCodes,
        startingPointReasonCodes:
          previewArtifacts.artifacts.recommendedDesign.explainability.startingPointReasonCodes,
      },
      carryForwardReasons: previewArtifacts.artifacts.carryForwardRecommendations.map((row) => ({
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        sessionIntent: row.sessionIntent,
        role: row.role,
        recommendation: row.recommendation,
        signalQuality: row.signalQuality,
        reasonCodes: row.reasonCodes,
      })),
      slotPlans: previewSlotPlans,
      projectedSessions: previewProjectedSessions,
      projectionDiagnostics,
      exerciseRationale: buildPreviewExerciseRationale({
        previewSlots: previewSlotPlans,
        design: previewArtifacts.artifacts.recommendedDesign,
        carryForwardReasons: previewArtifacts.artifacts.carryForwardRecommendations,
        rationaleBasis: previewArtifacts.rationaleBasis,
        slotSequenceJson: projectedMesocycle.mesocycle.slotSequence,
        weeklySchedule,
        repairedSlotIds: new Set(
          ("error" in slotPlanProjection
            ? slotPlanProjection.diagnostics?.protectedCoverage.repairedSlotIds
            : slotPlanProjection.diagnostics?.protectedCoverage.repairedSlotIds) ?? []
        ),
      }),
    },
    seed: {
      mesocycleId: retrospectiveMesocycle.id,
      available: seedSlots.length > 0,
      slotPlans: seedSlots.map((slot) => ({
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        intent: slot.intent,
        exercises: slot.exercises,
      })),
      exerciseRationale: buildSeedExerciseRationale({
        seedSlots,
        slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
        weeklySchedule,
      }),
    },
    reality: {
      mesocycleId: retrospectiveMesocycle.id,
      workoutCount: reality.rows.length,
      generatedVsSaved: reality.rows,
      runtimeDrift: reality.rows.filter(
        (row) =>
          row.seedDrift.addedExerciseIds.length > 0 ||
          row.seedDrift.removedExerciseIds.length > 0 ||
          row.generatedVsSaved.hasDrift
      ),
      exerciseRationale: buildRealityExerciseRationale({
        workouts: seedWorkouts,
        seedSlots,
        weeklySchedule,
        slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
      }),
    },
    comparison: {
      previewVsSeed: {
        comparable: false,
        comparisonBasis:
          seedSlots.length > 0 && previewSlotPlans.length > 0 ? "fresh_reprojection" : "none",
        slotDiffs: previewVsSeed,
      },
      seedVsReality: {
        comparable: seedSlots.length > 0 && reality.rows.length > 0,
        workoutDrift: reality.rows,
      },
      previewVsReality: {
        comparable: previewSlotPlans.length > 0 && reality.latestRealityBySlot.length > 0,
        comparisonBasis:
          previewSlotPlans.length > 0 && reality.latestRealityBySlot.length > 0
            ? "latest_saved_by_slot"
            : "none",
        slotDiffs: previewVsReality,
      },
    },
    limitations: Array.from(new Set(limitations)),
    ...(plannerOnlyDryRun ? { plannerOnlyDryRun } : {}),
    ...(plannerOnlyNoRepair ? { plannerOnlyNoRepair } : {}),
  };
}
