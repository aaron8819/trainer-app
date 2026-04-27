import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { isExerciseEligibleForSessionInventory } from "@/lib/planning/session-opportunities";
import type { ProtectedWeekOneCoverageMuscle } from "@/lib/planning/session-slot-profile";
import {
  roundToTenth,
  type ProjectedSlotWorkout,
  type SupportFloorRepairReason,
} from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type {
  ProgramQualityDiagnostic,
  ProgramQualityEvaluation,
} from "../mesocycle-handoff-slot-plan-projection.program-quality";
import type { DistributionGuardAction } from "../mesocycle-handoff-slot-plan-projection.repair-engine";
import type {
  DuplicateExerciseReuseDiagnostic,
  SlotObligationEvaluation,
  WeeklyMuscleObligationPlan,
} from "../mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { SESSION_CAPS } from "../template-session/selection-adapter";
import type { MappedGenerationContext } from "../template-session/types";
import type {
  ActiveMesocycleForDiagnostics,
  AllocationVsCompositionDelta,
  CleanPreselectionCandidateInventory,
  CleanPreselectionFeasibility,
  ExerciseConcentrationDiagnostic,
  ExerciseRow,
  PreselectionDemandDiagnosticLike,
  ProgramShapeWarningCode,
  ProjectedDeliveryDiagnostic,
  PromotionCandidate,
  RearDeltCollateralSummary,
  RepairMateriality,
  RepairMaterialityDiagnostic,
  SetDistributionIntent,
  ShadowRepairMaterialityDiagnostic,
  ShadowRepairSummary,
  ShadowSlotDemandAllocation,
  ShadowWeeklyMuscleDemand,
  SlotCompositionSnapshotDiagnostic,
  SlotDemandAllocationDiagnostic,
  SlotPlanPlanningRealityDiagnostic,
  SlotPrescriptionIntent,
  SuspiciousRepairNotEligibleForPromotion,
  WeakPreselectionConsumptionDiagnostic,
  WeeklyMuscleDemandDiagnostic,
} from "./types";
import {
  buildExerciseRowMap,
  buildExerciseRows,
  getExerciseKey,
  getTargetForMuscle,
  getWeeklyTotals,
  normalizeMuscle,
} from "./shared-evidence";
import { sortPrescriptionStrings, type MusclePrescription } from "./planner-intent";
export function buildShadowRepairMateriality(input: {
  repairMateriality: RepairMaterialityDiagnostic[];
  shadowWeeklyDemand: ShadowWeeklyMuscleDemand[];
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
}): ShadowRepairMaterialityDiagnostic[] {
  const demandByMuscle = new Map(input.shadowWeeklyDemand.map((row) => [row.muscle, row]));
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const allocatedMuscles = new Set(
    input.shadowSlotDemandAllocation.flatMap((slot) =>
      slot.allocatedMuscles.map((allocation) => allocation.muscle)
    )
  );

  return input.repairMateriality.map((row) => {
    const demand = row.muscle ? demandByMuscle.get(row.muscle) : undefined;
    const slotAllocation = row.slotId ? allocationBySlotId.get(row.slotId) : undefined;
    const sameSlotAllocation = slotAllocation?.allocatedMuscles.find(
      (allocation) => allocation.muscle === row.muscle
    );
    const materialRepair = row.materiality === "major" || row.materiality === "moderate";
    const likelyAvoidableWithShadowAllocation = Boolean(
      materialRepair &&
        row.muscle &&
        sameSlotAllocation &&
        (row.action === "added" || row.action === "set_bumped") &&
        sameSlotAllocation.targetStatus !== "diagnostic"
    );
    const shadowAllocationBasis: ShadowRepairMaterialityDiagnostic["shadowAllocationBasis"] =
      sameSlotAllocation
        ? "slot_owned_muscle_before_selection"
        : row.muscle && allocatedMuscles.has(row.muscle)
          ? "weekly_demand_owned_elsewhere"
          : row.materiality === "none" || row.action === "set_trimmed" || row.action === "removed"
            ? "diagnostic_or_cap_cleanup"
            : "not_shadow_allocated";

    return {
      ...row,
      likelyAvoidableWithShadowAllocation,
      shadowAllocationBasis,
      shadowRationale: [
        ...(sameSlotAllocation
          ? [`shadow_slot_allocation:${sameSlotAllocation.role}:${sameSlotAllocation.targetStatus}`]
          : []),
        ...(demand ? [`shadow_weekly_demand:${demand.priority}:${demand.targetStatus}`] : []),
        ...(likelyAvoidableWithShadowAllocation
          ? ["repair likely represents demand that should move upstream before exercise selection"]
          : ["repair remains cap cleanup, unowned stimulus, or unresolved by current shadow allocation"]),
      ],
    };
  });
}

export function isMaterialRepair(row: Pick<RepairMaterialityDiagnostic, "materiality">): boolean {
  return row.materiality === "major" || row.materiality === "moderate";
}

export function toSortedCountRecord(entries: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(
      ([leftMuscle, leftCount], [rightMuscle, rightCount]) =>
        rightCount - leftCount || leftMuscle.localeCompare(rightMuscle)
    )
  );
}

export function buildShadowRepairSummary(
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>
): ShadowRepairSummary {
  const materialRows = repairRows.filter(isMaterialRepair);
  const majorRows = repairRows.filter((row) => row.materiality === "major");
  const likelyAvoidableMaterialRows = materialRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );
  const remainingMaterialRows = materialRows.filter(
    (row) => !row.likelyAvoidableWithShadowAllocation
  );
  const likelyAvoidableMajorRows = majorRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );

  return {
    materialRepairCount: materialRows.length,
    majorRepairCount: majorRows.length,
    likelyAvoidableMaterialRepairCount: likelyAvoidableMaterialRows.length,
    remainingMaterialRepairCount: remainingMaterialRows.length,
    likelyAvoidableMajorRepairCount: likelyAvoidableMajorRows.length,
    remainingMajorRepairCount: majorRows.length - likelyAvoidableMajorRows.length,
    likelyAvoidableByMuscle: toSortedCountRecord(
      likelyAvoidableMaterialRows.flatMap((row) => (row.muscle ? [row.muscle] : []))
    ),
    remainingByMuscle: toSortedCountRecord(
      remainingMaterialRows.flatMap((row) => (row.muscle ? [row.muscle] : []))
    ),
  };
}

const UPPER_BODY_PROMOTION_MUSCLES = new Set([
  "Biceps",
  "Chest",
  "Front Delts",
  "Lats",
  "Rear Delts",
  "Side Delts",
  "Triceps",
  "Upper Back",
]);

const LOWER_BODY_PROMOTION_MUSCLES = new Set([
  "Abductors",
  "Adductors",
  "Calves",
  "Glutes",
  "Hamstrings",
  "Quads",
]);

export function getSlotRegion(slot: ShadowSlotDemandAllocation | undefined): "upper" | "lower" | "other" {
  const slotArchetype = slot?.slotArchetype ?? "";
  const intent = slot?.intent ?? "";
  const slotId = slot?.slotId ?? "";
  if (
    slotArchetype.startsWith("upper_") ||
    intent.toLowerCase() === "upper" ||
    slotId.toLowerCase().startsWith("upper")
  ) {
    return "upper";
  }
  if (
    slotArchetype.startsWith("lower_") ||
    intent.toLowerCase() === "lower" ||
    slotId.toLowerCase().startsWith("lower")
  ) {
    return "lower";
  }
  return "other";
}

export function buildSuspiciousRepairReasons(input: {
  row: ShadowRepairMaterialityDiagnostic;
  slotAllocation: ShadowSlotDemandAllocation | undefined;
}): string[] {
  const row = input.row;
  const reasons: string[] = [];
  const materialRepair = isMaterialRepair(row);
  const positiveRepair = row.action === "added" || row.action === "set_bumped";
  const muscle = row.muscle ?? "";
  const slotRegion = getSlotRegion(input.slotAllocation);

  if (
    materialRepair &&
    positiveRepair &&
    row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
  ) {
    reasons.push("shadow allocation marks this muscle as weekly_demand_owned_elsewhere");
  }
  if (
    materialRepair &&
    positiveRepair &&
    slotRegion === "lower" &&
    UPPER_BODY_PROMOTION_MUSCLES.has(muscle)
  ) {
    reasons.push("upper-body primary/support muscle was materially repaired into a lower-body slot");
  }
  if (
    materialRepair &&
    positiveRepair &&
    slotRegion === "upper" &&
    LOWER_BODY_PROMOTION_MUSCLES.has(muscle)
  ) {
    reasons.push("lower-body primary/support muscle was materially repaired into an upper-body slot");
  }
  if (
    materialRepair &&
    row.changedExerciseIdentity &&
    row.shadowAllocationBasis !== "slot_owned_muscle_before_selection"
  ) {
    reasons.push("repair added exercise identity in a slot that does not shadow-own the muscle");
  }
  if (
    materialRepair &&
    (row.action === "removed" ||
      row.action === "set_trimmed" ||
      row.shadowAllocationBasis === "diagnostic_or_cap_cleanup")
  ) {
    reasons.push("repair is cap cleanup, removal, or diagnostic collateral rather than promote-ready demand");
  }

  return Array.from(new Set(reasons));
}

export function buildSuspiciousRepairs(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
}): SuspiciousRepairNotEligibleForPromotion[] {
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );

  return input.repairRows
    .flatMap((row) => {
      if (!row.slotId || !row.muscle) {
        return [];
      }
      const reasons = buildSuspiciousRepairReasons({
        row,
        slotAllocation: allocationBySlotId.get(row.slotId),
      });
      if (reasons.length === 0) {
        return [];
      }
      return [{
        slotId: row.slotId,
        muscle: row.muscle,
        exerciseName: row.exerciseName,
        repairMechanism: row.repairMechanism,
        reason: reasons.join("; "),
        recommendation:
          "Do not promote this repair upstream; inspect slot ownership, compatibility, or cleanup cause first.",
      }];
    })
    .sort((left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "")
    );
}

export function getPromotionSuggestion(
  row: ShadowRepairMaterialityDiagnostic,
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number]
): PromotionCandidate["suggestedPromotion"] {
  if (allocation.role === "primary" && allocation.targetStatus === "hard") {
    return "slot_preselection_demand";
  }
  if (row.action === "set_bumped") {
    return "set_distribution_hint";
  }
  return row.changedExerciseIdentity ? "selection_scoring_hint" : "set_distribution_hint";
}

export function buildPromotionCandidates(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  shadowWeeklyDemand: ReadonlyArray<ShadowWeeklyMuscleDemand>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  suspiciousRepairs: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
}): PromotionCandidate[] {
  const demandByMuscle = new Map(input.shadowWeeklyDemand.map((row) => [row.muscle, row]));
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const suspiciousKeys = new Set(
    input.suspiciousRepairs.map((row) =>
      `${row.slotId}:${row.muscle}:${row.exerciseName ?? ""}:${row.repairMechanism}`
    )
  );

  const candidates = input.repairRows
    .flatMap((row) => {
      if (!row.slotId || !row.muscle || !row.likelyAvoidableWithShadowAllocation) {
        return [];
      }
      const suspiciousKey = `${row.slotId}:${row.muscle}:${row.exerciseName ?? ""}:${row.repairMechanism}`;
      if (suspiciousKeys.has(suspiciousKey)) {
        return [];
      }
      const demand = demandByMuscle.get(row.muscle);
      if (!demand || demand.priority === "secondary" || demand.priority === "implicit") {
        return [];
      }
      const allocation = allocationBySlotId
        .get(row.slotId)
        ?.allocatedMuscles.find((entry) => entry.muscle === row.muscle);
      if (
        !allocation ||
        (allocation.role !== "primary" && allocation.role !== "support") ||
        allocation.targetStatus === "diagnostic"
      ) {
        return [];
      }
      const role = allocation.role;
      const targetStatus = allocation.targetStatus;
      return [{
        slotId: row.slotId,
        muscle: row.muscle,
        role,
        targetStatus,
        evidence: Array.from(
          new Set([
            `repair:${row.action}:${row.materiality}`,
            `mechanism:${row.repairMechanism}`,
            `shadow_allocation:${row.shadowAllocationBasis}`,
            ...row.shadowRationale,
          ])
        ),
        suggestedPromotion: getPromotionSuggestion(row, allocation),
      }];
    });
  const deduped = new Map<string, PromotionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.slotId}:${candidate.muscle}:${candidate.role}:${candidate.targetStatus}:${candidate.suggestedPromotion}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    existing.evidence = Array.from(
      new Set([...existing.evidence, ...candidate.evidence])
    ).sort((left, right) => left.localeCompare(right));
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.slotId.localeCompare(right.slotId) ||
    left.muscle.localeCompare(right.muscle) ||
    left.suggestedPromotion.localeCompare(right.suggestedPromotion)
  );
}

export function buildWeakPreselectionConsumption(input: {
  preselectionDemands: ReadonlyArray<PreselectionDemandDiagnosticLike>;
}): WeakPreselectionConsumptionDiagnostic[] {
  return input.preselectionDemands
    .filter((demand) => demand.consumedBySelection && !demand.targetMet)
    .map((demand) => ({
      slotId: demand.slotId,
      muscle: demand.muscle,
      role: demand.role ?? "support",
      targetStatus: demand.targetStatus ?? "soft",
      selectedEffectiveSets: demand.selectedEffectiveSets,
      preferredEffectiveSets: demand.preferredEffectiveSets ?? null,
      minEffectiveSets: demand.minEffectiveSets ?? null,
      targetMet: demand.targetMet,
      consumedBySelection: demand.consumedBySelection,
      reason: "consumed_but_target_not_met" as const,
    }))
    .sort((left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      left.reason.localeCompare(right.reason)
    );
}


export function findAppliedProgramQualityDiagnostic(input: {
  diagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotId: string;
  exerciseId: string;
  muscle: string;
}): ProgramQualityDiagnostic | undefined {
  return input.diagnostics.find((diagnostic) => {
    if (diagnostic.slotId && diagnostic.slotId !== input.slotId) {
      return false;
    }
    if (diagnostic.exerciseId && diagnostic.exerciseId !== input.exerciseId) {
      return false;
    }
    if (diagnostic.muscle && normalizeMuscle(diagnostic.muscle) !== input.muscle) {
      return false;
    }
    const toExerciseId = diagnostic.details?.toExerciseId;
    return (
      diagnostic.exerciseId === input.exerciseId ||
      toExerciseId === input.exerciseId ||
      !diagnostic.exerciseId
    );
  });
}

export function chooseRepairMechanism(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  muscle: string;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): { mechanism: string; source: string; rationale: string } {
  const appliedDiagnostic = findAppliedProgramQualityDiagnostic({
    diagnostics: input.programQualityAppliedDiagnostics,
    slotId: input.slotId,
    exerciseId: input.exerciseId,
    muscle: input.muscle,
  });
  if (appliedDiagnostic) {
    return {
      mechanism:
        appliedDiagnostic.constraint === "isolation_completeness"
          ? "deficit_driven_isolation_insertion"
          : `program_quality:${appliedDiagnostic.constraint}`,
      source: "program_quality_application",
      rationale: appliedDiagnostic.reason,
    };
  }

  const supportReasons =
    input.supportFloorRepairReasons[input.muscle as ProtectedWeekOneCoverageMuscle] ?? [];
  if (supportReasons.includes("support_accessory_replacement") && input.action === "added") {
    return {
      mechanism: "support_floor_closure",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair added or replaced an accessory to close coverage",
    };
  }
  if (supportReasons.includes("existing_accessory_set_bump") && input.action === "set_bumped") {
    return {
      mechanism: "support_floor_set_bump",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair increased an existing exercise set count",
    };
  }

  const weeklyObligation = input.weeklyObligationEvaluations.find(
    (row) => row.slotId === input.slotId && row.muscle === input.muscle
  );
  if (weeklyObligation) {
    return {
      mechanism: "weekly_obligation_closure",
      source: "weekly_obligation_plan",
      rationale: "final shaping adjusted the slot toward an allocated hard weekly obligation",
    };
  }

  if (input.action === "set_trimmed" || input.action === "removed") {
    return {
      mechanism: "final_cap_trim_or_redistribution",
      source: "final_projection_shaping",
      rationale: "final shaping reduced exercise sets or identity after cap/quality passes",
    };
  }

  return {
    mechanism: "final_projection_repair",
    source: "projection_diff",
    rationale: "final slot plan differs from initial slot composition after read-only repair/shaping passes",
  };
}

export function classifyMateriality(input: {
  action: RepairMaterialityDiagnostic["action"];
  muscle: string | null;
  rawSetDelta: number;
  effectiveStimulusDelta: number;
  initialTotal: number;
  finalTotal: number;
  preferredTarget: number | null;
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
}): RepairMateriality {
  if (input.action === "diagnostic_only" || input.rawSetDelta === 0 && input.effectiveStimulusDelta === 0) {
    return "none";
  }
  const closesTarget =
    input.preferredTarget != null &&
    input.initialTotal + 1e-9 < input.preferredTarget &&
    input.finalTotal + 1e-9 >= input.preferredTarget;
  if (
    input.action === "added" ||
    input.action === "removed" ||
    (closesTarget && input.targetStatus !== "diagnostic")
  ) {
    return "major";
  }
  if (Math.abs(input.effectiveStimulusDelta) >= 2 || Math.abs(input.rawSetDelta) >= 2) {
    return "moderate";
  }
  return "minor";
}

export function buildRepairRowsForDelta(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  setDelta: number;
  contributionDeltaByMuscle: Record<string, number>;
  changedExerciseIdentity: boolean;
  initialTotals: Record<string, number>;
  finalTotals: Record<string, number>;
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): RepairMaterialityDiagnostic[] {
  const muscles = Object.keys(input.contributionDeltaByMuscle).filter(
    (muscle) => input.contributionDeltaByMuscle[muscle] !== 0
  );
  if (muscles.length === 0) {
    muscles.push(null as never);
  }

  return muscles.map((muscle) => {
    const target = muscle
      ? getTargetForMuscle({
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          muscle,
        })
      : null;
    const effectiveStimulusDelta = muscle ? roundToTenth(input.contributionDeltaByMuscle[muscle] ?? 0) : 0;
    const materiality = classifyMateriality({
      action: input.action,
      muscle,
      rawSetDelta: input.setDelta,
      effectiveStimulusDelta,
      initialTotal: muscle ? input.initialTotals[muscle] ?? 0 : 0,
      finalTotal: muscle ? input.finalTotals[muscle] ?? 0 : 0,
      preferredTarget: target?.preferredTarget ?? null,
      targetStatus: target?.targetStatus ?? "diagnostic",
    });
    const mechanism = muscle
      ? chooseRepairMechanism({
          action: input.action,
          slotId: input.slotId,
          exerciseId: input.exerciseId,
          muscle,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      : {
          mechanism: "final_projection_repair",
          source: "projection_diff",
          rationale: "exercise identity changed without measurable stimulus contribution",
        };

    return {
      repairMechanism: mechanism.mechanism,
      materiality,
      muscle,
      slotId: input.slotId,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
      action: input.action,
      effectiveStimulusAdded: roundToTenth(Math.max(0, effectiveStimulusDelta)),
      effectiveStimulusDelta,
      rawSetsAdded: Math.max(0, input.setDelta),
      rawSetDelta: input.setDelta,
      changedExerciseIdentity: input.changedExerciseIdentity,
      changedSlotShapeMaterially:
        input.changedExerciseIdentity || Math.abs(input.setDelta) >= 2 || materiality === "major",
      behaviorClass:
        materiality === "major" || materiality === "moderate"
          ? "program_shaping"
          : "minor_safety_net",
      source: mechanism.source,
      rationale: mechanism.rationale,
    };
  });
}

export function diffContribution(
  after: Record<string, number>,
  before: Record<string, number>
): Record<string, number> {
  const muscles = Array.from(new Set([...Object.keys(after), ...Object.keys(before)]));
  return Object.fromEntries(
    muscles
      .map((muscle) => [muscle, roundToTenth((after[muscle] ?? 0) - (before[muscle] ?? 0))] as const)
      .filter(([, value]) => value !== 0)
  );
}

export function buildRepairMateriality(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
}): RepairMaterialityDiagnostic[] {
  const initialRows = buildExerciseRows(input.initialProjectedSlots);
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const beforeByKey = buildExerciseRowMap(initialRows);
  const afterByKey = buildExerciseRowMap(finalRows);
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()]));
  const rows: RepairMaterialityDiagnostic[] = [];

  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    const row = after ?? before;
    if (!row) {
      continue;
    }
    const setDelta = (after?.setCount ?? 0) - (before?.setCount ?? 0);
    const contributionDelta = diffContribution(
      after?.contributionByMuscle ?? {},
      before?.contributionByMuscle ?? {}
    );
    if (!after && before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "removed",
          slotId: before.slotId,
          exerciseId: before.exercise.exercise.id,
          exerciseName: before.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (after && !before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "added",
          slotId: after.slotId,
          exerciseId: after.exercise.exercise.id,
          exerciseName: after.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (setDelta !== 0) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: setDelta > 0 ? "set_bumped" : "set_trimmed",
          slotId: row.slotId,
          exerciseId: row.exercise.exercise.id,
          exerciseName: row.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: false,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
    }
  }

  const existingDiagnosticKeys = new Set(
    rows.map((row) => `${row.source}:${row.slotId ?? ""}:${row.exerciseId ?? ""}:${row.muscle ?? ""}`)
  );
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    const key = `program_quality_application:${diagnostic.slotId ?? ""}:${diagnostic.exerciseId ?? ""}:${diagnostic.muscle ?? ""}`;
    if (existingDiagnosticKeys.has(key)) {
      continue;
    }
    rows.push({
      repairMechanism: `program_quality:${diagnostic.constraint}`,
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_application",
      rationale: diagnostic.reason,
    });
  }

  for (const [muscle, reasons] of Object.entries(input.supportFloorRepairReasons)) {
    for (const reason of reasons ?? []) {
      const hasMaterialRow = rows.some(
        (row) => row.muscle === normalizeMuscle(muscle) && row.source === "protected_coverage_support_floor"
      );
      if (hasMaterialRow) {
        continue;
      }
      rows.push({
        repairMechanism: `support_floor:${reason}`,
        materiality: "none",
        muscle: normalizeMuscle(muscle),
        slotId: null,
        exerciseId: null,
        exerciseName: null,
        action: "diagnostic_only",
        effectiveStimulusAdded: 0,
        effectiveStimulusDelta: 0,
        rawSetsAdded: 0,
        rawSetDelta: 0,
        changedExerciseIdentity: false,
        changedSlotShapeMaterially: false,
        behaviorClass: "minor_safety_net",
        source: "protected_coverage_support_floor",
        rationale: "support-floor repair reason was emitted without a remaining net exercise/set delta",
      });
    }
  }

  for (const diagnostic of input.programQualityEvaluation.diagnostics) {
    if (
      diagnostic.constraint !== "per_exercise_efficiency" ||
      diagnostic.reason !== "soft_cap_exceeded_higher_priority_or_capacity_bound"
    ) {
      continue;
    }
    const exists = rows.some(
      (row) => row.slotId === diagnostic.slotId && row.exerciseId === diagnostic.exerciseId
    );
    if (exists) {
      continue;
    }
    rows.push({
      repairMechanism: "program_quality:soft_cap_override",
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_evaluation",
      rationale: diagnostic.reason,
    });
  }

  return rows.sort((left, right) => {
    const materialityOrder: Record<RepairMateriality, number> = {
      major: 0,
      moderate: 1,
      minor: 2,
      none: 3,
    };
    return (
      materialityOrder[left.materiality] - materialityOrder[right.materiality] ||
      (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
      (left.muscle ?? "").localeCompare(right.muscle ?? "")
    );
  });
}

export function buildExerciseConcentration(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): ExerciseConcentrationDiagnostic[] {
  const initialRowsByKey = buildExerciseRowMap(buildExerciseRows(input.initialProjectedSlots));
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const finalWeeklyTotals = getWeeklyTotals(input.finalProjectedSlots);

  return finalRows.map((row) => {
    const before = initialRowsByKey.get(getExerciseKey(row.slotId, row.exercise.exercise.id));
    const percentages = Object.fromEntries(
      Object.entries(row.contributionByMuscle).map(([muscle, effectiveSets]) => [
        muscle,
        finalWeeklyTotals[muscle] && finalWeeklyTotals[muscle] > 0
          ? roundToTenth((effectiveSets / finalWeeklyTotals[muscle]) * 100)
          : 0,
      ])
    );
    const producedOrIncreasedByRepair = !before || row.setCount > before.setCount;
    const flags: ExerciseConcentrationDiagnostic["flags"] = [];
    if (row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("COMPOUND_GT_5_SETS");
    }
    if (!row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("ISOLATION_GT_5_SETS");
    }
    if (Object.values(percentages).some((percent) => percent >= 60)) {
      flags.push("EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS");
    } else if (Object.values(percentages).some((percent) => percent >= 50)) {
      flags.push("EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS");
    }
    if (!before) {
      flags.push("EXERCISE_ADDED_BY_REPAIR");
    } else if (row.setCount > before.setCount) {
      flags.push("SET_COUNT_INCREASED_BY_REPAIR");
    }

    return {
      slotId: row.slotId,
      intent: row.intent,
      exerciseId: row.exercise.exercise.id,
      exerciseName: row.exercise.exercise.name,
      setCount: row.setCount,
      role: row.role,
      isCompound: row.exercise.exercise.isCompound ?? false,
      primaryMuscles: [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle),
      effectiveStimulusContributionByMuscle: row.contributionByMuscle,
      percentageOfWeeklyProjectedStimulusByMuscle: percentages,
      producedOrIncreasedByRepair,
      flags,
    };
  });
}

const REAR_DELT_DIRECT_MUSCLE = "Rear Delts";
const UPPER_BACK_COLLATERAL_MUSCLE = "Upper Back";
const MATERIAL_UPPER_BACK_COLLATERAL_DELTA = 1;
const PULL_COLLATERAL_CONCENTRATION_MUSCLES = new Set([
  "Biceps",
  "Forearms",
  "Lats",
  "Upper Back",
]);

export function exercisePrimaryMuscles(row: ExerciseRow): string[] {
  return [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle);
}

export function sumDirectStimulusForMuscle(
  rows: ReadonlyArray<ExerciseRow>,
  muscle: string
): number {
  return roundToTenth(
    rows
      .filter((row) => exercisePrimaryMuscles(row).includes(muscle))
      .reduce((sum, row) => sum + (row.contributionByMuscle[muscle] ?? 0), 0)
  );
}

export function sumEffectiveStimulusForMuscle(
  rows: ReadonlyArray<ExerciseRow>,
  muscle: string
): number {
  return roundToTenth(
    rows.reduce((sum, row) => sum + (row.contributionByMuscle[muscle] ?? 0), 0)
  );
}

export function isPullCollateralConcentration(row: ExerciseConcentrationDiagnostic): boolean {
  const muscles = new Set([
    ...row.primaryMuscles.map(normalizeMuscle),
    ...Object.keys(row.effectiveStimulusContributionByMuscle).map(normalizeMuscle),
  ]);
  return (
    row.producedOrIncreasedByRepair &&
    row.flags.some(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER")
    ) &&
    Array.from(muscles).some((muscle) => PULL_COLLATERAL_CONCENTRATION_MUSCLES.has(muscle))
  );
}

export function buildRearDeltCollateralSummary(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  preselectionDemands: ReadonlyArray<PreselectionDemandDiagnosticLike>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): RearDeltCollateralSummary | null {
  const rearDeltPreselectionDemands = input.preselectionDemands.filter(
    (demand) => normalizeMuscle(demand.muscle) === REAR_DELT_DIRECT_MUSCLE
  );
  if (rearDeltPreselectionDemands.length === 0) {
    return null;
  }

  const initialRows = buildExerciseRows(input.initialProjectedSlots);
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const directRearDeltStimulusBefore = sumDirectStimulusForMuscle(
    initialRows,
    REAR_DELT_DIRECT_MUSCLE
  );
  const directRearDeltStimulusAfter = sumDirectStimulusForMuscle(
    finalRows,
    REAR_DELT_DIRECT_MUSCLE
  );
  const upperBackCollateralDelta = roundToTenth(
    sumEffectiveStimulusForMuscle(finalRows, UPPER_BACK_COLLATERAL_MUSCLE) -
      sumEffectiveStimulusForMuscle(initialRows, UPPER_BACK_COLLATERAL_MUSCLE)
  );
  const rearDeltPreselectionConsumed = rearDeltPreselectionDemands.some(
    (demand) => demand.consumedBySelection
  );
  const suspiciousRepairDelta = input.suspiciousRepairsNotEligibleForPromotion.filter(
    (row) => normalizeMuscle(row.muscle) !== REAR_DELT_DIRECT_MUSCLE
  ).length;
  const pullPatternConcentrationDelta = input.exerciseConcentration.filter(
    isPullCollateralConcentration
  ).length;
  const capTrimOrRemovalDelta = input.repairMaterialityAfterShadowAllocation.filter(
    (row) => isMaterialRepair(row) && (row.action === "set_trimmed" || row.action === "removed")
  ).length;
  const directRearDeltImproved =
    directRearDeltStimulusAfter > directRearDeltStimulusBefore;
  const upperBackCollateralMaterial =
    upperBackCollateralDelta >= MATERIAL_UPPER_BACK_COLLATERAL_DELTA;
  const programWorse =
    suspiciousRepairDelta > 0 ||
    pullPatternConcentrationDelta > 0 ||
    capTrimOrRemovalDelta > 0;
  const reasons: string[] = [];

  if (!rearDeltPreselectionConsumed) {
    reasons.push("rear_delt_preselection_not_consumed");
  } else {
    reasons.push("rear_delt_preselection_consumed");
    if (directRearDeltImproved) {
      reasons.push("direct_rear_delt_stimulus_increased");
    } else {
      reasons.push("rear_delt_preselection_consumed_without_direct_closure");
    }
  }
  if (upperBackCollateralMaterial) {
    reasons.push("REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE");
  }
  if (pullPatternConcentrationDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_PULL_CONCENTRATION");
  }
  if (capTrimOrRemovalDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_CAP_TRIM");
  }
  if (suspiciousRepairDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE");
  }
  if (rearDeltPreselectionConsumed && (programWorse || upperBackCollateralMaterial || !directRearDeltImproved)) {
    reasons.push("REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE");
    reasons.push("consumed_preselection_demand_alone_is_not_success");
  }

  const verdict: RearDeltCollateralSummary["verdict"] =
    !rearDeltPreselectionConsumed
      ? "not_applicable"
      : programWorse || !directRearDeltImproved
        ? "worse_collateral"
        : upperBackCollateralMaterial
          ? "mixed_collateral"
          : "clean_improvement";

  return {
    directRearDeltStimulusBefore,
    directRearDeltStimulusAfter,
    rearDeltPreselectionConsumed,
    upperBackCollateralDelta,
    pullPatternConcentrationDelta,
    suspiciousRepairDelta,
    capTrimOrRemovalDelta,
    verdict,
    reasons: Array.from(new Set(reasons)),
  };
}

const CLEAN_PRESELECTION_SLOT_ID = "lower_b";
const CLEAN_PRESELECTION_MUSCLE = "Hamstrings";
const BACK_EXTENSION_NAME_PATTERN = /back extension/i;
const STIFF_LEGGED_DEADLIFT_NAME_PATTERN = /stiff[- ]leg(?:ged)? deadlift/i;
const LEG_CURL_NAME_PATTERN = /\bcurl\b/i;
const HINGE_NAME_PATTERN = /\b(deadlift|rdl|romanian|good morning|hinge)\b/i;
const MATERIAL_COLLATERAL_DELTA = 1;
type DiagnosticExerciseLibrary = MappedGenerationContext["exerciseLibrary"];
type DiagnosticExercise = DiagnosticExerciseLibrary[number];

export function findSlotSnapshot(
  slots: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
  slotId: string
): SlotCompositionSnapshotDiagnostic | undefined {
  return slots.find((slot) => slot.slotId === slotId);
}

export function slotStimulus(
  slot: SlotCompositionSnapshotDiagnostic | undefined,
  muscle: string
): number | null {
  return slot ? roundToTenth(slot.projectedEffectiveStimulusByMuscle[muscle] ?? 0) : null;
}

export function computeShortfall(target: number | null, actual: number | null): number | null {
  if (target == null || actual == null) {
    return null;
  }
  return roundToTenth(Math.max(0, target - actual));
}

export function isHamstringExercise(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return exercise.primaryMuscles.map(normalizeMuscle).includes(CLEAN_PRESELECTION_MUSCLE);
}

export function isKneeFlexionCurl(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return isHamstringExercise(exercise) && LEG_CURL_NAME_PATTERN.test(exercise.exerciseName);
}

export function isHingeCompound(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return (
    isHamstringExercise(exercise) &&
    exercise.role === "main" &&
    HINGE_NAME_PATTERN.test(exercise.exerciseName) &&
    !BACK_EXTENSION_NAME_PATTERN.test(exercise.exerciseName)
  );
}

export function normalizeExerciseMuscles(values: ReadonlyArray<string> | undefined): string[] {
  return sortPrescriptionStrings((values ?? []).map(normalizeMuscle));
}

export function getExerciseStimulusPerSet(
  exercise: DiagnosticExercise,
  muscle: string
): number | null {
  const value = getEffectiveStimulusByMuscle(exercise, 1, {
    logFallback: false,
  }).get(muscle);
  return value == null || value <= 0 ? null : roundToTenth(value);
}

export function hasMuscleStimulus(exercise: DiagnosticExercise, muscle: string): boolean {
  return (getExerciseStimulusPerSet(exercise, muscle) ?? 0) > 0;
}

export function classifyCleanPreselectionCandidate(
  exercise: DiagnosticExercise
): CleanPreselectionCandidateInventory["candidateClass"] {
  const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
  const movementPatterns = exercise.movementPatterns ?? [];
  const isHamstringsPrimary = primaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE);
  if (
    BACK_EXTENSION_NAME_PATTERN.test(exercise.name) ||
    (isHamstringsPrimary &&
      movementPatterns.includes("extension") &&
      primaryMuscles.includes("Lower Back"))
  ) {
    return "dirty_extension";
  }
  if (
    isHamstringsPrimary &&
    (LEG_CURL_NAME_PATTERN.test(exercise.name) || movementPatterns.includes("flexion"))
  ) {
    return "knee_flexion_curl";
  }
  if (
    isHamstringsPrimary &&
    ((exercise.isCompound ?? false) || movementPatterns.includes("hinge")) &&
    (movementPatterns.includes("hinge") || HINGE_NAME_PATTERN.test(exercise.name))
  ) {
    return "hinge_compound";
  }
  return "unknown";
}

export function getCandidateClassRank(
  candidateClass: CleanPreselectionCandidateInventory["candidateClass"]
): number {
  switch (candidateClass) {
    case "knee_flexion_curl":
      return 0;
    case "hinge_compound":
      return 1;
    case "dirty_extension":
      return 2;
    case "unknown":
      return 3;
  }
}

export function collectSelectedSlotIdsByExercise(input: {
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
}): Map<string, string[]> {
  const byExercise = new Map<string, Set<string>>();
  const append = (exerciseId: string, slotId: string) => {
    const slots = byExercise.get(exerciseId) ?? new Set<string>();
    slots.add(slotId);
    byExercise.set(exerciseId, slots);
  };

  for (const slot of [...input.initialSlotComposition, ...input.finalSlotPlan]) {
    for (const exercise of slot.exercises) {
      append(exercise.exerciseId, slot.slotId);
    }
  }

  return new Map(
    Array.from(byExercise.entries()).map(([exerciseId, slotIds]) => [
      exerciseId,
      Array.from(slotIds).sort((left, right) => left.localeCompare(right)),
    ])
  );
}

export function isExerciseSelectedInSlot(input: {
  slots: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  slotId: string;
  exerciseId: string;
}): boolean {
  return Boolean(
    input.slots
      .find((slot) => slot.slotId === input.slotId)
      ?.exercises.some((exercise) => exercise.exerciseId === input.exerciseId)
  );
}

export function isInventoryCandidateRelevant(exercise: DiagnosticExercise): boolean {
  const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
  const secondaryMuscles = normalizeExerciseMuscles(exercise.secondaryMuscles);
  return (
    primaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE) ||
    secondaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE) ||
    hasMuscleStimulus(exercise, CLEAN_PRESELECTION_MUSCLE) ||
    LEG_CURL_NAME_PATTERN.test(exercise.name) ||
    BACK_EXTENSION_NAME_PATTERN.test(exercise.name) ||
    STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(exercise.name)
  );
}

export function buildCandidateInventory(input: {
  exerciseLibrary: ReadonlyArray<DiagnosticExercise>;
  prescription: MusclePrescription;
  slotIntent: SlotPrescriptionIntent | undefined;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): CleanPreselectionCandidateInventory[] {
  const selectedSlotIdsByExercise = collectSelectedSlotIdsByExercise({
    initialSlotComposition: input.initialSlotComposition,
    finalSlotPlan: input.finalSlotPlan,
  });
  const lowerBFinalExerciseCount =
    findSlotSnapshot(input.finalSlotPlan, CLEAN_PRESELECTION_SLOT_ID)?.exerciseCount ?? 0;
  const lowerBCapacityAvailable = lowerBFinalExerciseCount < SESSION_CAPS.maxExercises;

  return input.exerciseLibrary
    .filter(isInventoryCandidateRelevant)
    .map((exercise) => {
      const candidateClass = classifyCleanPreselectionCandidate(exercise);
      const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
      const secondaryMuscles = normalizeExerciseMuscles(exercise.secondaryMuscles);
      const movementPatterns = sortPrescriptionStrings(exercise.movementPatterns ?? []);
      const hamstringsStimulusPerSet = getExerciseStimulusPerSet(
        exercise,
        CLEAN_PRESELECTION_MUSCLE
      );
      const glutesStimulusPerSet = getExerciseStimulusPerSet(exercise, "Glutes");
      const lowerBackStimulusPerSet = getExerciseStimulusPerSet(
        exercise,
        "Lower Back"
      );
      const lowerSlotCompatible = isExerciseEligibleForSessionInventory(
        exercise,
        "lower",
        "standard"
      );
      const classAllowed =
        candidateClass !== "unknown" &&
        input.prescription.allowedExerciseClasses.includes(candidateClass);
      const patternAllowed = movementPatterns.some((pattern) =>
        input.prescription.allowedPatterns.includes(pattern)
      );
      const classPatternBridgeMismatch =
        classAllowed && movementPatterns.length > 0 && !patternAllowed;
      const selectedInLowerBInitial = isExerciseSelectedInSlot({
        slots: input.initialSlotComposition,
        slotId: CLEAN_PRESELECTION_SLOT_ID,
        exerciseId: exercise.id,
      });
      const selectedInLowerBFinal = isExerciseSelectedInSlot({
        slots: input.finalSlotPlan,
        slotId: CLEAN_PRESELECTION_SLOT_ID,
        exerciseId: exercise.id,
      });
      const alreadySelectedSlotIds = selectedSlotIdsByExercise.get(exercise.id) ?? [];
      const alreadySelectedInWeek = alreadySelectedSlotIds.length > 0;
      const selectedOutsideLowerB = alreadySelectedSlotIds.some(
        (slotId) => slotId !== CLEAN_PRESELECTION_SLOT_ID
      );
      const duplicateDiagnostic = input.duplicateExerciseReuse.find(
        (row) =>
          row.exerciseId === exercise.id &&
          row.repeatedInSlotId === CLEAN_PRESELECTION_SLOT_ID
      );
      const lowerBCompatible =
        lowerSlotCompatible &&
        input.prescription.targetStatus !== "forbidden" &&
        candidateClass !== "dirty_extension" &&
        candidateClass !== "unknown" &&
        (classAllowed || patternAllowed);
      const reasons = sortPrescriptionStrings([
        `candidate_class:${candidateClass}`,
        `lower_slot_compatible:${lowerSlotCompatible ? "yes" : "no"}`,
        `lower_b_compatible:${lowerBCompatible ? "yes" : "no"}`,
        `lower_b_capacity:${lowerBFinalExerciseCount}/${SESSION_CAPS.maxExercises}`,
        ...(lowerBCapacityAvailable ? ["lower_b_capacity_available"] : ["lower_b_capacity_full"]),
        ...(classAllowed ? [`allowed_exercise_class:${candidateClass}`] : []),
        ...(patternAllowed
          ? movementPatterns
              .filter((pattern) => input.prescription.allowedPatterns.includes(pattern))
              .map((pattern) => `allowed_pattern:${pattern}`)
          : []),
        ...(classPatternBridgeMismatch
          ? [
              `classification_mismatch:movementPatterns_${movementPatterns.join("+")}_not_in_allowedPatterns_${input.prescription.allowedPatterns.join("+") || "none"}_but_class_${candidateClass}_is_allowed`,
            ]
          : []),
        ...(alreadySelectedInWeek
          ? [`already_selected_slots:${alreadySelectedSlotIds.join(",")}`]
          : ["not_selected_in_projected_week"]),
        ...(selectedOutsideLowerB
          ? ["duplicate_week_placement_possible_blocker"]
          : []),
        ...(duplicateDiagnostic
          ? [
              `duplicate_diagnostic:${duplicateDiagnostic.reason}`,
              `duplicate_previous_slots:${duplicateDiagnostic.previousSlotIds.join(",")}`,
              `duplicate_has_compatible_alternative:${duplicateDiagnostic.hasCompatibleAlternative ? "yes" : "no"}`,
            ]
          : ["duplicate_reuse_diagnostic_not_present_for_lower_b"]),
        ...(input.slotIntent
          ? [`slot_prescription_intent:${input.slotIntent.slotArchetype ?? "unknown"}`]
          : ["slot_prescription_intent_missing"]),
        ...(candidateClass === "dirty_extension"
          ? ["not_clean_closure:extension_collateral_sensitive"]
          : []),
        ...(candidateClass === "hinge_compound"
          ? ["not_knee_flexion_curl:hinge_collateral_sensitive"]
          : []),
      ]);

      let availability: CleanPreselectionCandidateInventory["availability"];
      if (candidateClass === "dirty_extension" || candidateClass === "hinge_compound") {
        availability = "dirty_not_clean_candidate";
      } else if (candidateClass === "unknown") {
        availability = "unknown_blocker";
      } else if (!lowerBCompatible && classPatternBridgeMismatch) {
        availability = "available_but_classification_mismatch";
      } else if (!lowerBCompatible) {
        availability = "unknown_blocker";
      } else if (duplicateDiagnostic) {
        availability = "available_but_duplicate_blocked";
      } else if (selectedOutsideLowerB && !selectedInLowerBFinal) {
        availability = "available_but_already_used_elsewhere";
      } else if (!lowerBCapacityAvailable && !selectedInLowerBFinal) {
        availability = "available_but_capacity_blocked";
      } else {
        availability = "clean_available";
      }

      return {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        candidateClass,
        primaryMuscles,
        secondaryMuscles,
        movementPatterns,
        hamstringsStimulusPerSet,
        glutesStimulusPerSet,
        lowerBackStimulusPerSet,
        lowerSlotCompatible,
        lowerBCompatible,
        alreadySelectedInWeek,
        alreadySelectedSlotIds,
        selectedInLowerBInitial,
        selectedInLowerBFinal,
        availability,
        reasons,
      };
    })
    .sort(
      (left, right) =>
        getCandidateClassRank(left.candidateClass) -
          getCandidateClassRank(right.candidateClass) ||
        left.exerciseName.localeCompare(right.exerciseName)
    );
}

export function formatExerciseEvidence(
  slotId: string,
  source: "initialSlotComposition" | "finalSlotPlan",
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): string {
  return `${source}:${slotId}:${exercise.exerciseName}:${exercise.setCount} sets`;
}

export function collectCleanPathEvidence(input: {
  initialSlot: SlotCompositionSnapshotDiagnostic | undefined;
  finalSlot: SlotCompositionSnapshotDiagnostic | undefined;
}): CleanPreselectionFeasibility["preferredCleanPath"] {
  const rows = [
    ...(input.initialSlot?.exercises ?? []).map((exercise) => ({
      source: "initialSlotComposition" as const,
      exercise,
    })),
    ...(input.finalSlot?.exercises ?? []).map((exercise) => ({
      source: "finalSlotPlan" as const,
      exercise,
    })),
  ];
  const curlEvidence = rows
    .filter((row) => isKneeFlexionCurl(row.exercise))
    .map((row) => formatExerciseEvidence(CLEAN_PRESELECTION_SLOT_ID, row.source, row.exercise));
  const hingeEvidence = rows
    .filter((row) => isHingeCompound(row.exercise))
    .map((row) => formatExerciseEvidence(CLEAN_PRESELECTION_SLOT_ID, row.source, row.exercise));

  return [
    {
      exerciseClass: "knee_flexion_curl",
      available: curlEvidence.length > 0,
      evidence: sortPrescriptionStrings(curlEvidence),
    },
    {
      exerciseClass: "hinge_compound",
      available: hingeEvidence.length > 0,
      evidence: sortPrescriptionStrings(hingeEvidence),
    },
    {
      exerciseClass: "existing_anchor_plus_curl",
      available: curlEvidence.length > 0 && hingeEvidence.length > 0,
      evidence: sortPrescriptionStrings([...hingeEvidence, ...curlEvidence]),
    },
  ];
}

export function appendDirtySignal(
  signals: CleanPreselectionFeasibility["dirtyClosureSignals"],
  signal: CleanPreselectionFeasibility["dirtyClosureSignals"][number]["signal"],
  evidence: ReadonlyArray<string>
): void {
  const normalizedEvidence = sortPrescriptionStrings(evidence);
  if (normalizedEvidence.length === 0) {
    return;
  }
  const existing = signals.find((row) => row.signal === signal);
  if (!existing) {
    signals.push({ signal, evidence: normalizedEvidence });
    return;
  }
  existing.evidence = sortPrescriptionStrings([
    ...existing.evidence,
    ...normalizedEvidence,
  ]);
}

export function buildCleanPreselectionFeasibility(input: {
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  allocationVsInitialDelta: ReadonlyArray<AllocationVsCompositionDelta>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  distributionGuardActions: ReadonlyArray<DistributionGuardAction>;
  duplicateExerciseReuse?: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): CleanPreselectionFeasibility[] {
  const slotIntent = input.slotPrescriptionIntents.find(
    (intent) => intent.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const prescription = slotIntent?.musclePrescriptions.find(
    (row) =>
      row.muscle === CLEAN_PRESELECTION_MUSCLE &&
      row.targetStatus !== "forbidden" &&
      row.demandType === "direct_required"
  );
  if (!prescription) {
    return [];
  }

  const initialSlot = findSlotSnapshot(input.initialSlotComposition, CLEAN_PRESELECTION_SLOT_ID);
  const finalSlot = findSlotSnapshot(input.finalSlotPlan, CLEAN_PRESELECTION_SLOT_ID);
  const targetEffectiveSets =
    prescription.minEffectiveSets ?? prescription.desiredEffectiveSets ?? null;
  const currentInitialEffectiveSets = slotStimulus(initialSlot, CLEAN_PRESELECTION_MUSCLE);
  const currentFinalEffectiveSets = slotStimulus(finalSlot, CLEAN_PRESELECTION_MUSCLE);
  const shortfallBeforeRepair = computeShortfall(
    targetEffectiveSets,
    currentInitialEffectiveSets
  );
  const preferredCleanPath = collectCleanPathEvidence({ initialSlot, finalSlot });
  const candidateInventory = buildCandidateInventory({
    exerciseLibrary: input.exerciseLibrary ?? [],
    prescription,
    slotIntent,
    initialSlotComposition: input.initialSlotComposition,
    finalSlotPlan: input.finalSlotPlan,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
  });
  const glutesDelta = roundToTenth(
    (slotStimulus(finalSlot, "Glutes") ?? 0) - (slotStimulus(initialSlot, "Glutes") ?? 0)
  );
  const lowerBackDelta = roundToTenth(
    (slotStimulus(finalSlot, "Lower Back") ?? 0) -
      (slotStimulus(initialSlot, "Lower Back") ?? 0)
  );
  const dirtyClosureSignals: CleanPreselectionFeasibility["dirtyClosureSignals"] = [];
  const lowerBRepairRows = input.repairMaterialityAfterShadowAllocation.filter(
    (row) => row.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const positiveRepairRows = lowerBRepairRows.filter(
    (row) =>
      (row.action === "added" || row.action === "set_bumped") &&
      (row.effectiveStimulusDelta > 0 || row.effectiveStimulusAdded > 0)
  );
  const backExtensionRows = positiveRepairRows.filter(
    (row) =>
      BACK_EXTENSION_NAME_PATTERN.test(row.exerciseName ?? "") &&
      [CLEAN_PRESELECTION_MUSCLE, "Glutes", "Lower Back"].includes(row.muscle ?? "")
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "back_extension_closure",
    backExtensionRows
      .filter((row) => row.muscle === CLEAN_PRESELECTION_MUSCLE)
      .map((row) => `${row.slotId}:${row.exerciseName}:${row.repairMechanism}:${row.action}`)
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "glute_collateral",
    [
      ...backExtensionRows
        .filter((row) => row.muscle === "Glutes")
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.muscle}:${row.effectiveStimulusDelta}`),
      ...(glutesDelta >= MATERIAL_COLLATERAL_DELTA
        ? [`collateralEstimate:Glutes:+${glutesDelta}`]
        : []),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "lower_back_collateral",
    [
      ...backExtensionRows
        .filter((row) => row.muscle === "Lower Back")
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.muscle}:${row.effectiveStimulusDelta}`),
      ...(lowerBackDelta >= MATERIAL_COLLATERAL_DELTA
        ? [`collateralEstimate:Lower Back:+${lowerBackDelta}`]
        : []),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "suspicious_repair",
    input.suspiciousRepairsNotEligibleForPromotion
      .filter(
        (row) =>
          row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
          [CLEAN_PRESELECTION_MUSCLE, "Glutes", "Lower Back"].includes(row.muscle) &&
          !row.reason.includes("cap cleanup")
      )
      .map((row) => `${row.slotId}:${row.muscle}:${row.exerciseName ?? row.repairMechanism}:${row.reason}`)
  );

  const setDistributionIntent = input.setDistributionIntents.find(
    (intent) => intent.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "sldl_concentration",
    [
      ...input.repairMaterialityAfterShadowAllocation
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row.exerciseName ?? "") &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE &&
            row.action !== "set_trimmed" &&
            row.action !== "removed"
        )
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.repairMechanism}:${row.action}`),
      ...(setDistributionIntent?.evidence.concentrationRows ?? []).filter((row) =>
        STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row)
      ),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "cap_cleanup",
    [
      ...lowerBRepairRows
        .filter(
          (row) =>
            (row.action === "set_trimmed" || row.action === "removed") &&
            (row.muscle === CLEAN_PRESELECTION_MUSCLE ||
              STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row.exerciseName ?? ""))
        )
        .map((row) => `${row.slotId}:${row.exerciseName ?? row.exerciseId}:${row.muscle}:${row.action}`),
      ...(setDistributionIntent?.evidence.capCleanupRows ?? []),
      ...input.distributionGuardActions
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE
        )
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.attemptedAction}:${row.decision}:${row.reason ?? "no_reason"}`),
    ]
  );

  const allocationDelta = input.allocationVsInitialDelta.find(
    (row) => row.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const initialHamstringShortfall = allocationDelta?.underAllocatedMuscles.find(
    (row) => row.muscle === CLEAN_PRESELECTION_MUSCLE
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "weak_preselection_risk",
    [
      ...input.weakPreselectionConsumption
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE
        )
        .map((row) => `${row.slotId}:${row.muscle}:selected_${row.selectedEffectiveSets}:targetMet_${row.targetMet}`),
      ...(initialHamstringShortfall && (currentInitialEffectiveSets ?? 0) > 0
        ? [
            `${CLEAN_PRESELECTION_SLOT_ID}:${CLEAN_PRESELECTION_MUSCLE}:initial_${currentInitialEffectiveSets}_shortfall_${initialHamstringShortfall.shortfall ?? "unknown"}`,
          ]
        : []),
    ]
  );

  const cleanPathAvailable = preferredCleanPath.some(
    (path) =>
      path.available &&
      (path.exerciseClass === "knee_flexion_curl" ||
        path.exerciseClass === "existing_anchor_plus_curl")
  );
  const targetMet =
    targetEffectiveSets != null &&
    currentFinalEffectiveSets != null &&
    currentFinalEffectiveSets + 1e-9 >= targetEffectiveSets;
  const hasDirtySignals = dirtyClosureSignals.length > 0;
  const hasDistributionOnlyDirtySignals =
    hasDirtySignals &&
    dirtyClosureSignals.every((row) =>
      row.signal === "sldl_concentration" || row.signal === "cap_cleanup"
    );
  const candidateStatus: CleanPreselectionFeasibility["candidateStatus"] =
    hasDirtySignals
      ? "dirty_candidate"
      : cleanPathAvailable && targetMet
        ? "clean_candidate"
        : currentFinalEffectiveSets === 0
          ? "not_feasible"
          : "needs_more_inventory_detail";
  const recommendation: CleanPreselectionFeasibility["recommendation"] =
    candidateStatus === "clean_candidate"
      ? "safe_to_trial_preselection"
      : hasDistributionOnlyDirtySignals
        ? "requires_distribution_policy_first"
        : candidateStatus === "needs_more_inventory_detail" || candidateStatus === "not_feasible"
          ? "requires_inventory_or_exercise_class_fix"
          : "do_not_promote_yet";
  const reasons = sortPrescriptionStrings([
    "read_only_diagnostic_only",
    "candidate_scope:lower_b_Hamstrings",
    "derived_from_planningReality_existing_rows",
    ...(input.promotionCandidates.some(
      (row) =>
        row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
        row.muscle === CLEAN_PRESELECTION_MUSCLE &&
        row.suggestedPromotion === "slot_preselection_demand"
    )
      ? ["existing_promotion_candidate_slot_preselection_demand"]
      : []),
    ...(cleanPathAvailable ? ["clean_knee_flexion_path_evidence_present"] : ["clean_path_evidence_missing_or_incomplete"]),
    ...(candidateInventory.some((candidate) => candidate.candidateClass === "knee_flexion_curl")
      ? ["inventory_clean_knee_flexion_candidates_visible"]
      : ["inventory_clean_knee_flexion_candidates_missing_or_not_passed"]),
    ...(targetMet ? ["final_target_met"] : ["final_target_not_met_or_unknown"]),
    ...dirtyClosureSignals.map((row) => `dirty_signal:${row.signal}`),
  ]);

  return [
    {
      slotId: CLEAN_PRESELECTION_SLOT_ID,
      muscle: CLEAN_PRESELECTION_MUSCLE,
      role: prescription.role === "support" ? "support" : "primary",
      targetStatus: prescription.targetStatus === "soft" ? "soft" : "hard",
      demandType: prescription.demandType,
      candidateStatus,
      targetEffectiveSets,
      currentInitialEffectiveSets,
      currentFinalEffectiveSets,
      shortfallBeforeRepair,
      preferredCleanPath,
      dirtyClosureSignals: dirtyClosureSignals.sort((left, right) =>
        left.signal.localeCompare(right.signal)
      ),
      collateralEstimate: {
        glutesDelta,
        lowerBackDelta,
      },
      candidateInventory,
      recommendation,
      reasons,
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
  ];
}

export function buildWarnings(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  projectedDelivery: ProjectedDeliveryDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
  exerciseConcentration: ExerciseConcentrationDiagnostic[];
  rearDeltCollateralSummary?: RearDeltCollateralSummary | null;
}): SlotPlanPlanningRealityDiagnostic["warnings"] {
  const warnings: SlotPlanPlanningRealityDiagnostic["warnings"] = [];
  const add = (
    code: ProgramShapeWarningCode,
    severity: "info" | "warning",
    message: string,
    evidence: string[]
  ) => {
    if (!warnings.some((warning) => warning.code === code)) {
      warnings.push({ code, severity, message, evidence });
    }
  };

  const materialSupportRepairs = input.repairMateriality.filter(
    (row) =>
      row.behaviorClass === "program_shaping" &&
      row.materiality !== "none" &&
      (row.repairMechanism.includes("support_floor") ||
        input.weeklyMuscleDemand.find((demand) => demand.muscle === row.muscle)?.targetStatus === "soft")
  );
  if (materialSupportRepairs.length > 0) {
    add(
      "REPAIR_CREATED_MATERIAL_SUPPORT_COVERAGE",
      "warning",
      "Final repair/shaping materially created support coverage.",
      materialSupportRepairs.slice(0, 4).map((row) => `${row.slotId ?? "week"}:${row.muscle}:${row.repairMechanism}`)
    );
  }

  const addedIdentity = input.repairMateriality.filter((row) => row.changedExerciseIdentity && row.action === "added");
  if (addedIdentity.length > 0) {
    add(
      "REPAIR_ADDED_EXERCISE_IDENTITY",
      "warning",
      "Final repair/shaping added exercise identity after initial slot composition.",
      addedIdentity.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const concentrationFlags = input.exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER"))
  );
  if (concentrationFlags.length > 0) {
    add(
      "EXERCISE_CONCENTRATION_HIGH",
      "warning",
      "One exercise supplies a high share of a muscle's projected weekly stimulus.",
      concentrationFlags.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const localSlots = input.slotDemandAllocation.filter(
    (slot) => slot.allocationBasis === "local_movement_or_lane_semantics" || slot.allocationBasis === "unclear"
  );
  if (localSlots.length > 0) {
    add(
      "SLOT_ALLOCATION_NOT_EXPLICIT",
      "info",
      "One or more slots have no explicit weekly demand allocation and are explained by local slot/movement semantics.",
      localSlots.map((slot) => slot.slotId)
    );
  }

  const primaryBelowBeforeRepair = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "hard" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget
  );
  if (primaryBelowBeforeRepair.length > 0) {
    add(
      "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR",
      "warning",
      "A hard weekly-demand muscle was below target before final repair/shaping.",
      primaryBelowBeforeRepair.slice(0, 4).map((row) => `${row.muscle}:${row.projectedEffectiveStimulusAfterInitialSlotComposition}/${row.preferredTarget}`)
    );
  }

  const supportClosedLate = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "soft" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping >= row.preferredTarget
  );
  if (supportClosedLate.length > 0) {
    add(
      "SUPPORT_FLOOR_CLOSED_LATE",
      "warning",
      "Support-floor coverage closed only after final repair/shaping.",
      supportClosedLate.slice(0, 4).map((row) => row.muscle)
    );
  }

  const trims = input.repairMateriality.filter(
    (row) => row.action === "set_trimmed" || row.action === "removed"
  );
  if (trims.length > 0) {
    add(
      "FINAL_CAP_TRIM_REQUIRED",
      "info",
      "Final shaping trimmed sets or removed exercise identity after initial slot composition.",
      trims.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}:${row.rawSetDelta}`)
    );
  }

  const rearDelt = input.rearDeltCollateralSummary;
  if (rearDelt?.rearDeltPreselectionConsumed) {
    if (rearDelt.upperBackCollateralDelta >= MATERIAL_UPPER_BACK_COLLATERAL_DELTA) {
      add(
        "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE",
        "warning",
        "Rear Delts preselection was consumed while Upper Back collateral stimulus increased materially.",
        [`Upper Back +${rearDelt.upperBackCollateralDelta}`]
      );
    }
    if ((rearDelt.pullPatternConcentrationDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_PULL_CONCENTRATION",
        "warning",
        "Rear Delts preselection was consumed while pull-pattern concentration burden increased.",
        [`pullPatternConcentrationDelta:${rearDelt.pullPatternConcentrationDelta}`]
      );
    }
    if ((rearDelt.capTrimOrRemovalDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_CAP_TRIM",
        "warning",
        "Rear Delts preselection was consumed while final cap trim or removal burden remained.",
        [`capTrimOrRemovalDelta:${rearDelt.capTrimOrRemovalDelta}`]
      );
    }
    if ((rearDelt.suspiciousRepairDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE",
        "warning",
        "Rear Delts preselection was consumed while suspicious repair burden increased.",
        [`suspiciousRepairDelta:${rearDelt.suspiciousRepairDelta}`]
      );
    }
    if (rearDelt.verdict === "mixed_collateral" || rearDelt.verdict === "worse_collateral") {
      add(
        "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
        "warning",
        "Consumed Rear Delts preselection demand alone is not success when total-program collateral worsens.",
        rearDelt.reasons
      );
    }
  }

  return warnings;
}

