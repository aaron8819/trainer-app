import type { ProtectedWeekOneCoverageMuscle } from "@/lib/planning/session-slot-profile";
import type {
  ProjectedSlotWorkout,
  ProtectedWeekOneCoverageEvaluation,
  SupportFloorRepairReason,
} from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type {
  ProgramQualityDiagnostic,
  ProgramQualityEvaluation,
} from "../mesocycle-handoff-slot-plan-projection.program-quality";
import type {
  DistributionGuardAction,
  ForbiddenCleanupRerouteDiagnostic,
} from "../mesocycle-handoff-slot-plan-projection.repair-engine";
import type {
  DuplicateExerciseReuseDiagnostic,
  SlotObligationEvaluation,
  WeeklyMuscleObligationPlan,
} from "../mesocycle-handoff-slot-plan-projection.weekly-obligations";
import type {
  ActiveMesocycleForDiagnostics,
  DiagnosticExercise,
  PreselectionDemandDiagnosticLike,
  RepairMaterialityDiagnostic,
  SlotDemandAllocationDiagnostic,
  SlotPlanPlanningRealityDiagnostic,
  SlotSequenceEntry,
  WeeklyMuscleDemandDiagnostic,
} from "./types";
import {
  buildAllocationDeltas,
  buildExerciseRows,
  buildProjectedDelivery,
  buildShadowSlotDemandAllocation,
  buildShadowWeeklyDemand,
  buildSlotCompositionSnapshots,
  buildSlotDemandAllocation,
  buildWeeklyMuscleDemand,
  collectRelevantMuscles,
} from "./shared-evidence";
import {
  buildCleanPreselectionFeasibility,
  buildExerciseConcentration,
  buildPromotionCandidates,
  buildRearDeltCollateralSummary,
  buildRepairMateriality,
  buildShadowRepairMateriality,
  buildShadowRepairSummary,
  buildSuspiciousRepairs,
  buildWarnings,
  buildWeakPreselectionConsumption,
} from "./repair-materiality";
import {
  buildAccumulationWeekProjection,
  buildPreselectionDistributionPolicyByWeek,
  buildSetDistributionIntents,
  buildSlotDemandAllocationByWeek,
  buildSlotPrescriptionIntents,
  buildWeeklyDemandCurve,
} from "./planner-intent";
import {
  buildDuplicateContinuityJustification,
  buildExerciseClassAlignment,
  buildExerciseClassDistributionBySlot,
} from "./selection-alignment";
import { buildCleanupCandidateFeasibility } from "./cleanup-feasibility";
import { buildTopDownMesocyclePlan } from "./top-down-mesocycle-plan";

export type * from "./types";
export { buildPlannerOwnedAccumulationProjection } from "./planner-intent";
export {
  buildV2ExerciseSelectionPlanDiagnostic,
  type V2ExerciseSelectionPlanDiagnostic,
} from "./exercise-selection-plan-diagnostic";
export {
  buildV2SupportLaneProjectionDiagnostic,
  type V2SupportLaneProjectionDiagnostic,
} from "./support-lane-projection-diagnostic";
export {
  buildV2SelectionCapacityPlanDiagnostic,
  type V2SelectionCapacityPlanDiagnostic,
} from "./selection-capacity-plan-diagnostic";
function classifyPlanningShape(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
}): SlotPlanPlanningRealityDiagnostic["summary"]["planningShape"] {
  const hardDemandCount = input.weeklyMuscleDemand.filter(
    (row) => row.targetStatus === "hard",
  ).length;
  const explicitSlotCount = input.slotDemandAllocation.filter(
    (row) => row.allocationBasis === "explicit_weekly_demand",
  ).length;
  const materialRepairCount = input.repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major",
  ).length;
  const majorRepairCount = input.repairMateriality.filter(
    (row) => row.materiality === "major",
  ).length;

  if (hardDemandCount === 0 && explicitSlotCount === 0) {
    return "unclear_due_to_missing_instrumentation";
  }
  if (
    materialRepairCount === 0 &&
    explicitSlotCount >= Math.max(1, input.slotDemandAllocation.length / 2)
  ) {
    return "mostly_upstream_planned";
  }
  if (
    majorRepairCount >= Math.max(1, hardDemandCount) ||
    materialRepairCount > explicitSlotCount
  ) {
    return "mostly_repair_shaped";
  }
  return "mixed_upstream_plus_repair_shaped";
}

export function buildWeeklyDemandSlotAllocationDiagnostic(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<
    Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
  >;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
  preselectionDemands?: ReadonlyArray<PreselectionDemandDiagnosticLike>;
  duplicateExerciseReuse?: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  distributionGuardActions?: ReadonlyArray<DistributionGuardAction>;
  forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
}): SlotPlanPlanningRealityDiagnostic {
  const relevantMuscles = collectRelevantMuscles({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    slotSequence: input.slotSequence,
  });
  const weeklyMuscleDemand = buildWeeklyMuscleDemand({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    relevantMuscles,
  });
  const slotDemandAllocation = buildSlotDemandAllocation({
    slotSequence: input.slotSequence,
    weeklyObligationPlan: input.weeklyObligationPlan,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const shadowSlotDemandAllocation = buildShadowSlotDemandAllocation({
    activeMesocycle: input.activeMesocycle,
    slotSequence: input.slotSequence,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
  });
  const shadowWeeklyDemand = buildShadowWeeklyDemand({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
    shadowSlotDemandAllocation,
  });
  const initialSlotComposition = buildSlotCompositionSnapshots({
    slotSequence: input.slotSequence,
    projectedSlots: input.initialProjectedSlots,
  });
  const finalSlotPlan = buildSlotCompositionSnapshots({
    slotSequence: input.slotSequence,
    projectedSlots: input.finalProjectedSlots,
  });
  const allocationVsInitialDelta = buildAllocationDeltas({
    shadowSlotDemandAllocation,
    composition: initialSlotComposition,
    comparison: "allocation_vs_initial",
  });
  const allocationVsFinalDelta = buildAllocationDeltas({
    shadowSlotDemandAllocation,
    composition: finalSlotPlan,
    comparison: "allocation_vs_final",
  });
  const finalExerciseRows = buildExerciseRows(input.finalProjectedSlots);
  const projectedDelivery = buildProjectedDelivery({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    finalExerciseRows,
  });
  const repairMateriality = buildRepairMateriality({
    activeMesocycle: input.activeMesocycle,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    weeklyObligationEvaluations: input.weeklyObligationEvaluations,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    programQualityEvaluation: input.programQualityEvaluation,
  });
  const repairMaterialityAfterShadowAllocation = buildShadowRepairMateriality({
    repairMateriality,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
  });
  const shadowRepairSummary = buildShadowRepairSummary(
    repairMaterialityAfterShadowAllocation,
  );
  const suspiciousRepairsNotEligibleForPromotion = buildSuspiciousRepairs({
    repairRows: repairMaterialityAfterShadowAllocation,
    shadowSlotDemandAllocation,
  });
  const promotionCandidates = buildPromotionCandidates({
    repairRows: repairMaterialityAfterShadowAllocation,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
    suspiciousRepairs: suspiciousRepairsNotEligibleForPromotion,
  });
  const weakPreselectionConsumption = buildWeakPreselectionConsumption({
    preselectionDemands: input.preselectionDemands ?? [],
  });
  const slotPrescriptionIntents = buildSlotPrescriptionIntents({
    slotSequence: input.slotSequence,
    slotDemandAllocation,
    shadowSlotDemandAllocation,
    finalSlotPlan,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
  });
  const exerciseConcentration = buildExerciseConcentration({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const setDistributionIntents = buildSetDistributionIntents({
    slotPrescriptionIntents,
    finalSlotPlan,
    exerciseConcentration,
    repairMaterialityAfterShadowAllocation,
  });
  const distributionGuardActions = Array.from(
    new Map(
      (input.distributionGuardActions ?? []).map((action) => [
        [
          action.slotId,
          action.exerciseName,
          action.muscle,
          action.attemptedAction,
          action.decision,
          action.alternativeExerciseName ?? "",
        ].join(":"),
        action,
      ]),
    ).values(),
  ).sort(
    (left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      left.exerciseName.localeCompare(right.exerciseName),
  );
  const rearDeltCollateralSummary = buildRearDeltCollateralSummary({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    preselectionDemands: input.preselectionDemands ?? [],
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    exerciseConcentration,
  });
  const preselectionFeasibility = buildCleanPreselectionFeasibility({
    exerciseLibrary: input.exerciseLibrary,
    initialSlotComposition,
    finalSlotPlan,
    allocationVsInitialDelta,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
    weakPreselectionConsumption,
    slotPrescriptionIntents,
    setDistributionIntents,
    distributionGuardActions,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
  });
  const warnings = buildWarnings({
    weeklyMuscleDemand,
    slotDemandAllocation,
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
    rearDeltCollateralSummary,
  });
  const preselectionDistributionPolicyByWeek =
    buildPreselectionDistributionPolicyByWeek({
      activeMesocycle: input.activeMesocycle,
      slotPrescriptionIntents,
      setDistributionIntents,
      finalSlotPlan,
      projectedDelivery,
      duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
      warnings,
    });
  const weeklyDemandCurve = buildWeeklyDemandCurve({
    activeMesocycle: input.activeMesocycle,
    shadowWeeklyDemand,
    projectedDelivery,
    exerciseConcentration,
  });
  const slotDemandAllocationByWeek = buildSlotDemandAllocationByWeek({
    activeMesocycle: input.activeMesocycle,
    weeklyDemandCurve,
    shadowSlotDemandAllocation,
    finalSlotPlan,
    projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
    exerciseConcentration,
  });
  const exerciseClassDistributionBySlot = buildExerciseClassDistributionBySlot({
    activeMesocycle: input.activeMesocycle,
    slotPrescriptionIntents,
    setDistributionIntents,
    slotDemandAllocationByWeek,
    finalSlotPlan,
    preselectionFeasibility,
    weakPreselectionConsumption,
    repairMaterialityAfterShadowAllocation,
    exerciseConcentration,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
  });
  const {
    alignment: exerciseClassAlignment,
    unresolvedCauses: exerciseClassUnresolvedCauses,
  } = buildExerciseClassAlignment({
    exerciseClassDistributionBySlot,
    initialSlotComposition,
    finalSlotPlan,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    exerciseConcentration,
    weakPreselectionConsumption,
    distributionGuardActions,
  });
  const accumulationWeekProjection = buildAccumulationWeekProjection({
    activeMesocycle: input.activeMesocycle,
    weeklyDemandCurve,
    finalSlotPlan,
    projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
    exerciseConcentration,
  });
  const duplicateContinuityJustification =
    buildDuplicateContinuityJustification({
      finalSlotPlan,
      exerciseLibrary: input.exerciseLibrary,
      duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
      exerciseClassDistributionBySlot,
      exerciseClassUnresolvedCauses,
      preselectionFeasibility,
      projectedDelivery,
      accumulationWeekProjection,
    });
  const cleanupCandidateFeasibility = buildCleanupCandidateFeasibility({
    finalSlotPlan,
    projectedDelivery,
    shadowWeeklyDemand,
    setDistributionIntents,
  });
  const materialRepairCount = repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major",
  ).length;
  const majorRepairCount = repairMateriality.filter(
    (row) => row.materiality === "major",
  ).length;
  const highExerciseConcentrationCount = exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER")),
  ).length;
  const summary: SlotPlanPlanningRealityDiagnostic["summary"] = {
    planningShape: classifyPlanningShape({
      weeklyMuscleDemand,
      slotDemandAllocation,
      repairMateriality,
    }),
    explicitWeeklyDemandMuscles: weeklyMuscleDemand.filter(
      (row) => row.explicitUpstream,
    ).length,
    inferredDemandMuscles: weeklyMuscleDemand.filter(
      (row) => row.inferredDownstream,
    ).length,
    slotsWithExplicitWeeklyDemand: slotDemandAllocation.filter(
      (row) => row.allocationBasis === "explicit_weekly_demand",
    ).length,
    slotsWithOnlyLocalOrInferredSemantics: slotDemandAllocation.filter(
      (row) =>
        row.allocationBasis === "local_movement_or_lane_semantics" ||
        row.allocationBasis === "unclear",
    ).length,
    materialRepairCount,
    majorRepairCount,
    highExerciseConcentrationCount,
    warningCodes: warnings.map((warning) => warning.code),
  };
  const topDownMesocyclePlan = buildTopDownMesocyclePlan({
    summary,
    weeklyMuscleDemand,
    projectedDelivery,
    finalSlotPlan,
    shadowRepairSummary,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairCount: suspiciousRepairsNotEligibleForPromotion.length,
    weakPreselectionConsumption,
    slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    exerciseClassAlignment,
    exerciseClassUnresolvedCauses,
    duplicateContinuityJustification,
    cleanupCandidateFeasibility,
    accumulationWeekProjection,
    exerciseConcentration,
    forbiddenCleanupReroute: input.forbiddenCleanupReroute,
  });

  return {
    label: "weekly demand / slot allocation diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary,
    weeklyMuscleDemand,
    slotDemandAllocation,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
    initialSlotComposition,
    finalSlotPlan,
    allocationVsInitialDelta,
    allocationVsFinalDelta,
    repairMaterialityAfterShadowAllocation,
    shadowRepairSummary,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
    weakPreselectionConsumption,
    slotPrescriptionIntents,
    setDistributionIntents,
    distributionGuardActions,
    preselectionFeasibility,
    preselectionDistributionPolicyByWeek,
    weeklyDemandCurve,
    slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    exerciseClassAlignment,
    exerciseClassUnresolvedCauses,
    duplicateContinuityJustification,
    cleanupCandidateFeasibility,
    topDownMesocyclePlan,
    accumulationWeekProjection,
    ...(input.forbiddenCleanupReroute
      ? { forbiddenCleanupReroute: input.forbiddenCleanupReroute }
      : {}),
    ...(rearDeltCollateralSummary ? { rearDeltCollateralSummary } : {}),
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
    warnings,
    limitations: [
      "Shadow weekly demand and slot demand allocation are upstream-planning diagnostics only; they are not consumed by slot-local selection, repair, scoring, seed serialization, or runtime replay.",
      "Initial slot composition means the selected slot workout after slot-local candidate selection and before final program-quality/support-floor/weekly-obligation shaping.",
      "Repair materiality is inferred from initial-vs-final projection deltas plus existing program-quality and coverage diagnostics; historical candidate ranking internals are not persisted here.",
      "This diagnostic is read-only and does not feed scoring, generation, seed parsing, or runtime replay.",
    ],
  };
}
