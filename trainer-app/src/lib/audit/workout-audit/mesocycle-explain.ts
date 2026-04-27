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
import { resolveSessionSlotPolicy } from "@/lib/planning/session-slot-profile";
import { MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION } from "./constants";
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
  MesocycleExplainProjectionComparisonSnapshot,
  MesocycleExplainProjectionMetricDelta,
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
  const plannerOnlyDryRun =
    input.plannerOnlyDryRun?.enabled && input.plannerOnlyDryRun.compareRepaired
      ? buildPlannerOnlyDryRunComparison(
          projectionDiagnostics.planningReality,
          input.plannerOnlyDryRun.compareRepaired,
          plannerOnlyPolicyOverride,
          plannerOnlyOverrideDiagnostics?.planningReality
        )
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
  };
}
