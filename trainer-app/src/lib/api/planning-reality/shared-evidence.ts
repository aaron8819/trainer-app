import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getMuscleTargetSemantics,
  normalizeExposedMuscle,
  VOLUME_LANDMARKS,
  type MuscleTargetTier,
  type VolumeSoftTargetRange,
} from "@/lib/engine/volume-landmarks";
import {
  getProjectionPreferredSupportMuscles,
  getProjectionRepairCompatibleMuscles,
  getProjectionSoftPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { getWeeklyVolumeTarget } from "../mesocycle-lifecycle";
import {
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  getWorkoutExercises,
  roundToTenth,
  toSessionIntent,
  type ProjectedSlotWorkout,
  type ProtectedWeekOneCoverageEvaluation,
  type SupportFloorRepairReason,
} from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type { ProgramQualityDiagnostic } from "../mesocycle-handoff-slot-plan-projection.program-quality";
import {
  getSlotWeeklyObligations,
  HARD_WEEKLY_OBLIGATION_MUSCLES,
  type WeeklyMuscleObligationPlan,
} from "../mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { getWeekOneSupportFloor } from "../template-session/role-budgeting";
import type {
  ActiveMesocycleForDiagnostics,
  AllocationVsCompositionDelta,
  ExerciseRow,
  ProjectedDeliveryDiagnostic,
  ShadowSlotDemandAllocation,
  ShadowWeeklyMuscleDemand,
  SlotCompositionSnapshotDiagnostic,
  SlotDemandAllocationDiagnostic,
  SlotSequenceEntry,
  WeeklyMuscleDemandDiagnostic,
} from "./types";

export function sortPrescriptionStrings(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
export function normalizeMuscle(muscle: string): string {
  return normalizeExposedMuscle(muscle);
}

export function toRoundedRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [rawMuscle, rawValue] of map) {
    const muscle = normalizeMuscle(rawMuscle);
    record[muscle] = roundToTenth((record[muscle] ?? 0) + rawValue);
  }
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function mergeContributionRecords(records: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [muscle, value] of Object.entries(record)) {
      merged[muscle] = roundToTenth((merged[muscle] ?? 0) + value);
    }
  }
  return Object.fromEntries(
    Object.entries(merged)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function isHardObligationMuscle(muscle: string): muscle is (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number] {
  return HARD_WEEKLY_OBLIGATION_MUSCLES.includes(
    muscle as (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number]
  );
}

export function getWeeklyObligationEntry(
  plan: WeeklyMuscleObligationPlan,
  muscle: string
) {
  return isHardObligationMuscle(muscle) ? plan.muscles[muscle] : null;
}

export function getTargetForMuscle(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  muscle: string;
}): {
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  explicitUpstream: boolean;
  inferredDownstream: boolean;
  source: string[];
} {
  const targetSemantics = getMuscleTargetSemantics(input.muscle);
  const weeklyObligation = getWeeklyObligationEntry(input.weeklyObligationPlan, input.muscle);
  const supportFloor = getWeekOneSupportFloor(input.muscle as ProtectedWeekOneCoverageMuscle);
  const explicitUpstream = Boolean(
    weeklyObligation && (weeklyObligation.targetSets > 0 || weeklyObligation.allocatedSlots.length > 0)
  );
  const inferredDownstream = !explicitUpstream && (
    supportFloor != null ||
    targetSemantics.targetTier === "B_SUPPORT" ||
    targetSemantics.targetKind === "soft"
  );
  const preferredTarget =
    explicitUpstream && weeklyObligation
      ? weeklyObligation.targetSets
      : supportFloor != null
        ? supportFloor
        : targetSemantics.softTargetRange
          ? roundToTenth((targetSemantics.softTargetRange.min + targetSemantics.softTargetRange.max) / 2)
          : VOLUME_LANDMARKS[input.muscle]
            ? getWeeklyVolumeTarget(input.activeMesocycle, input.muscle, 1)
            : null;
  const source = [
    ...(explicitUpstream ? ["weekly_obligation_plan:getWeeklyVolumeTarget(week=1)"] : []),
    ...(supportFloor != null ? ["week_one_support_floor"] : []),
    ...(targetSemantics.softTargetRange ? ["volume_landmarks:soft_target_range"] : []),
    ...(targetSemantics.targetTier ? [`volume_landmarks:target_tier:${targetSemantics.targetTier}`] : []),
  ];

  return {
    targetStatus: explicitUpstream
      ? "hard"
      : inferredDownstream
        ? "soft"
        : "diagnostic",
    targetRange: targetSemantics.softTargetRange,
    preferredTarget,
    explicitUpstream,
    inferredDownstream,
    source: source.length > 0 ? source : ["projected_stimulus_observed"],
  };
}

export function buildExerciseRows(slots: ReadonlyArray<ProjectedSlotWorkout>): ExerciseRow[] {
  return slots.flatMap((slot) =>
    getWorkoutExercises(slot.workout).map((exercise) => ({
      slotId: slot.slotPlan.slotId,
      intent: slot.slotPlan.intent,
      exercise,
      role: exercise.isMainLift || exercise.role === "main" ? "main" : "accessory",
      setCount: exercise.sets.length,
      contributionByMuscle: toRoundedRecord(
        getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length, {
          logFallback: false,
        })
      ),
    }))
  );
}

export function getExerciseKey(slotId: string, exerciseId: string): string {
  return `${slotId}:${exerciseId}`;
}

export function buildExerciseRowMap(rows: ReadonlyArray<ExerciseRow>): Map<string, ExerciseRow> {
  return new Map(rows.map((row) => [getExerciseKey(row.slotId, row.exercise.exercise.id), row]));
}

export function collectRelevantMuscles(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
}): string[] {
  const muscles = new Set<string>();
  const add = (muscle: string | null | undefined) => {
    if (muscle && muscle.trim().length > 0) {
      muscles.add(normalizeMuscle(muscle));
    }
  };

  for (const muscle of HARD_WEEKLY_OBLIGATION_MUSCLES) {
    const obligation = input.weeklyObligationPlan.muscles[muscle];
    if (obligation.targetSets > 0 || obligation.allocatedSlots.length > 0) {
      add(muscle);
    }
  }
  for (const row of input.protectedCoverage.muscles) {
    add(row.muscle);
  }
  for (const muscle of Object.keys(input.supportFloorRepairReasons)) {
    add(muscle);
  }
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    add(diagnostic.muscle);
  }
  for (const slot of [...input.initialProjectedSlots, ...input.finalProjectedSlots]) {
    for (const [muscle, value] of slot.projectedContributionByMuscle) {
      if (value > 0) {
        add(muscle);
      }
    }
  }
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  for (const slot of input.slotSequence) {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of getProjectionPreferredSupportMuscles(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      add(muscle);
    }
  }

  return Array.from(muscles).sort((left, right) => left.localeCompare(right));
}

export function buildWeeklyMuscleDemand(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  relevantMuscles: string[];
}): WeeklyMuscleDemandDiagnostic[] {
  const protectedMuscles = new Set(input.protectedCoverage.muscles.map((row) => normalizeMuscle(row.muscle)));

  return input.relevantMuscles.map((muscle) => {
    const targetSemantics = getMuscleTargetSemantics(muscle);
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const landmark = VOLUME_LANDMARKS[muscle] ?? null;
    const source = Array.from(
      new Set([
        ...target.source,
        ...(protectedMuscles.has(muscle) ? ["protected_week_one_coverage_evaluation"] : []),
      ])
    );

    return {
      muscle,
      targetTier: targetSemantics.targetTier,
      targetKind: targetSemantics.targetKind,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      mev: landmark?.mev ?? null,
      mav: landmark?.mav ?? null,
      explicitUpstream: target.explicitUpstream,
      inferredDownstream: target.inferredDownstream || protectedMuscles.has(muscle),
      source,
    };
  });
}

export function appendSlotObligation(
  obligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"],
  obligation: SlotDemandAllocationDiagnostic["expectedMuscleObligations"][number]
): void {
  const existing = obligations.find(
    (entry) => entry.muscle === obligation.muscle && entry.source === obligation.source
  );
  if (!existing) {
    obligations.push(obligation);
  }
}

export function getNormalizedTargetTier(muscle: string): MuscleTargetTier {
  return getMuscleTargetSemantics(muscle).targetTier ?? "IMPLICIT";
}

export function getShadowDemandTargets(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  muscle: string;
}): Pick<
  ShadowWeeklyMuscleDemand,
  "targetTier" | "targetStatus" | "minEffectiveSets" | "preferredEffectiveSets" | "maxEffectiveSets" | "priority"
> & { source: string[]; rationale: string[] } {
  const targetTier = getNormalizedTargetTier(input.muscle);
  const targetSemantics = getMuscleTargetSemantics(input.muscle);
  const landmark = VOLUME_LANDMARKS[input.muscle] ?? null;
  const weeklyObligation = getWeeklyObligationEntry(input.weeklyObligationPlan, input.muscle);
  const supportFloor = getWeekOneSupportFloor(input.muscle);
  const source = [`volume_landmarks:target_tier:${targetTier}`];
  const rationale: string[] = [];

  if (weeklyObligation && (weeklyObligation.targetSets > 0 || weeklyObligation.allocatedSlots.length > 0)) {
    source.push("weekly_obligation_plan:getWeeklyVolumeTarget(week=1)");
    rationale.push("A primary driver has an explicit Week 1 weekly obligation before slot composition.");
    return {
      targetTier,
      targetStatus: "hard",
      minEffectiveSets: landmark?.mev ?? weeklyObligation.targetSets,
      preferredEffectiveSets: weeklyObligation.targetSets,
      maxEffectiveSets: landmark?.mav ?? null,
      priority: "primary",
      source,
      rationale,
    };
  }

  if (targetTier === "B_SUPPORT") {
    if (supportFloor != null) {
      source.push("week_one_support_floor");
    }
    rationale.push("Support-tier muscle should be visible upstream as protected or preferred support, not only late repair.");
    return {
      targetTier,
      targetStatus: supportFloor != null ? "soft" : "diagnostic",
      minEffectiveSets: supportFloor ?? null,
      preferredEffectiveSets: supportFloor ?? null,
      maxEffectiveSets: landmark?.mav ?? null,
      priority: "support",
      source,
      rationale,
    };
  }

  if (targetTier === "C_SECONDARY") {
    if (targetSemantics.softTargetRange) {
      source.push("volume_landmarks:soft_target_range");
    }
    rationale.push("Secondary muscle remains a diagnostic/readout unless an authored slot explicitly owns it.");
    return {
      targetTier,
      targetStatus: "diagnostic",
      minEffectiveSets: targetSemantics.softTargetRange?.min ?? null,
      preferredEffectiveSets: targetSemantics.softTargetRange
        ? roundToTenth((targetSemantics.softTargetRange.min + targetSemantics.softTargetRange.max) / 2)
        : null,
      maxEffectiveSets: targetSemantics.softTargetRange?.max ?? landmark?.mav ?? null,
      priority: "secondary",
      source,
      rationale,
    };
  }

  rationale.push("Implicit muscle is fatigue/readout context unless explicitly targeted by a slot.");
  return {
    targetTier,
    targetStatus: "diagnostic",
    minEffectiveSets: null,
    preferredEffectiveSets: null,
    maxEffectiveSets: null,
    priority: "implicit",
    source,
    rationale,
  };
}

export function getAllocationFatigueBudget(slotArchetype: string | null | undefined): ShadowSlotDemandAllocation["fatigueBudget"] {
  switch (slotArchetype) {
    case "lower_hinge_dominant":
      return { systemic: "high", axial: "high" };
    case "lower_squat_dominant":
      return { systemic: "high", axial: "moderate" };
    case "upper_horizontal_balanced":
    case "upper_vertical_balanced":
      return { systemic: "moderate", axial: "low" };
    default:
      return { systemic: "moderate", axial: "moderate" };
  }
}

export function appendAllocatedMuscle(
  allocatedMuscles: ShadowSlotDemandAllocation["allocatedMuscles"],
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number]
): void {
  const existing = allocatedMuscles.find((row) => row.muscle === allocation.muscle);
  if (!existing) {
    allocatedMuscles.push(allocation);
    return;
  }

  const roleOrder: Record<ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"], number> = {
    primary: 0,
    support: 1,
    secondary: 2,
    implicit: 3,
  };
  const statusOrder: Record<ShadowSlotDemandAllocation["allocatedMuscles"][number]["targetStatus"], number> = {
    hard: 0,
    soft: 1,
    diagnostic: 2,
  };

  existing.role = roleOrder[allocation.role] < roleOrder[existing.role] ? allocation.role : existing.role;
  existing.targetStatus =
    statusOrder[allocation.targetStatus] < statusOrder[existing.targetStatus]
      ? allocation.targetStatus
      : existing.targetStatus;
  existing.minEffectiveSets =
    existing.minEffectiveSets == null
      ? allocation.minEffectiveSets
      : allocation.minEffectiveSets == null
        ? existing.minEffectiveSets
        : Math.max(existing.minEffectiveSets, allocation.minEffectiveSets);
  existing.preferredEffectiveSets =
    existing.preferredEffectiveSets == null
      ? allocation.preferredEffectiveSets
      : allocation.preferredEffectiveSets == null
        ? existing.preferredEffectiveSets
        : Math.max(existing.preferredEffectiveSets, allocation.preferredEffectiveSets);
  existing.maxEffectiveSets =
    existing.maxEffectiveSets == null
      ? allocation.maxEffectiveSets
      : allocation.maxEffectiveSets == null
        ? existing.maxEffectiveSets
        : Math.min(existing.maxEffectiveSets, allocation.maxEffectiveSets);
  existing.allocationReason = Array.from(
    new Set([...existing.allocationReason, ...allocation.allocationReason])
  );
}

export function getCompatibleShadowSupportSlots(input: {
  muscle: string;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): string[] {
  return input.slotSequence.flatMap((slot) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: input.slotSequenceEntries },
    }).currentSession;
    return getProjectionRepairCompatibleMuscles(slotPolicy, [input.muscle]).includes(
      input.muscle as ProtectedWeekOneCoverageMuscle
    )
      ? [slot.slotId]
      : [];
  });
}

export function buildShadowSlotDemandAllocation(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
}): ShadowSlotDemandAllocation[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const supportMuscles = Array.from(
    new Set([
      ...input.relevantMuscles.filter((muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT"),
      ...Object.keys(VOLUME_LANDMARKS).filter(
        (muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT" && getWeekOneSupportFloor(muscle) != null
      ),
    ])
  );
  const compatibleSupportSlotIdsByMuscle = new Map(
    supportMuscles.map((muscle) => [
      muscle,
      getCompatibleShadowSupportSlots({
        muscle,
        slotSequence: input.slotSequence,
        slotSequenceEntries,
      }),
    ])
  );

  return input.slotSequence.map((slot, slotIndex) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const allocatedMuscles: ShadowSlotDemandAllocation["allocatedMuscles"] = [];

    for (const obligation of getSlotWeeklyObligations({
      plan: input.weeklyObligationPlan,
      slotId: slot.slotId,
    })) {
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: obligation.muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: obligation.muscle,
        role: obligation.priority === "primary" ? "primary" : "support",
        targetStatus: "hard",
        minEffectiveSets: obligation.minEffectiveSets,
        preferredEffectiveSets: obligation.minEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: [
          "weekly_obligation_allocated_to_compatible_slot",
          `weekly_priority:${obligation.priority}`,
        ],
      });
    }

    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle,
        role: demand.priority === "primary" ? "primary" : "support",
        targetStatus: demand.targetStatus === "hard" ? "hard" : "soft",
        minEffectiveSets: demand.targetStatus === "hard" ? null : demand.minEffectiveSets,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_protected_week_one_coverage"],
      });
    }

    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      const normalizedMuscle = normalizeMuscle(muscle);
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: normalizedMuscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: normalizedMuscle,
        role: demand.priority === "primary" ? "primary" : "secondary",
        targetStatus: demand.targetStatus,
        minEffectiveSets: null,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_primary_lane_preferred_muscle"],
      });
    }

    for (const muscle of getProjectionPreferredSupportMuscles(slotPolicy)) {
      const normalizedMuscle = normalizeMuscle(muscle);
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: normalizedMuscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: normalizedMuscle,
        role: demand.priority === "primary" ? "primary" : "support",
        targetStatus: demand.targetStatus === "hard" ? "hard" : "soft",
        minEffectiveSets: demand.targetStatus === "hard" ? null : demand.minEffectiveSets,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_preferred_support_muscle"],
      });
    }

    for (const muscle of supportMuscles) {
      const compatibleSlotIds = compatibleSupportSlotIdsByMuscle.get(muscle) ?? [];
      if (!compatibleSlotIds.includes(slot.slotId)) {
        continue;
      }
      const supportFloor = getWeekOneSupportFloor(muscle);
      const perSlotPreferred =
        supportFloor != null && compatibleSlotIds.length > 0
          ? roundToTenth(supportFloor / compatibleSlotIds.length)
          : null;
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle,
        role: "support",
        targetStatus: demand.targetStatus === "diagnostic" ? "diagnostic" : "soft",
        minEffectiveSets: null,
        preferredEffectiveSets: perSlotPreferred,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["slot_profile_support_compatible", "support_floor_distributed_across_compatible_slots"],
      });
    }

    return {
      slotId: slot.slotId,
      slotIndex,
      slotArchetype: slotPolicy?.slotArchetype ?? "unresolved",
      intent: toSessionIntent(slot.intent),
      allocatedMuscles: allocatedMuscles.sort((left, right) => {
        const roleOrder: Record<typeof left.role, number> = {
          primary: 0,
          support: 1,
          secondary: 2,
          implicit: 3,
        };
        return roleOrder[left.role] - roleOrder[right.role] || left.muscle.localeCompare(right.muscle);
      }),
      fatigueBudget: getAllocationFatigueBudget(slotPolicy?.slotArchetype),
    };
  });
}

export function buildShadowWeeklyDemand(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
}): ShadowWeeklyMuscleDemand[] {
  const allocatedMuscles = new Set(
    input.shadowSlotDemandAllocation.flatMap((slot) =>
      slot.allocatedMuscles.map((allocation) => allocation.muscle)
    )
  );
  const muscles = Array.from(
    new Set([
      ...input.relevantMuscles,
      ...allocatedMuscles,
      ...Object.keys(VOLUME_LANDMARKS).filter(
        (muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT" && getWeekOneSupportFloor(muscle) != null
      ),
    ])
  ).sort((left, right) => left.localeCompare(right));

  return muscles.map((muscle) => {
    const demand = getShadowDemandTargets({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const desiredExposureCount = input.shadowSlotDemandAllocation.filter((slot) =>
      slot.allocatedMuscles.some((allocation) => allocation.muscle === muscle)
    ).length;

    return {
      muscle,
      targetTier: demand.targetTier,
      targetStatus: demand.targetStatus,
      minEffectiveSets: demand.minEffectiveSets,
      preferredEffectiveSets: demand.preferredEffectiveSets,
      maxEffectiveSets: demand.maxEffectiveSets,
      desiredExposureCount: desiredExposureCount > 0 ? desiredExposureCount : null,
      priority: demand.priority,
      source: Array.from(
        new Set([
          ...demand.source,
          ...(desiredExposureCount > 0 ? ["shadow_slot_demand_allocation"] : []),
        ])
      ),
      rationale:
        desiredExposureCount > 0
          ? [...demand.rationale, "At least one authored slot can own this demand before exercise selection."]
          : demand.rationale,
    };
  });
}

export function buildSlotCompositionSnapshots(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotCompositionSnapshotDiagnostic[] {
  const projectedSlotById = new Map(
    input.projectedSlots.map((slot) => [slot.slotPlan.slotId, slot])
  );

  return input.slotSequence.map((slot, slotIndex) => {
    const projectedSlot = projectedSlotById.get(slot.slotId);
    const exerciseRows = projectedSlot ? buildExerciseRows([projectedSlot]) : [];
    return {
      slotId: slot.slotId,
      slotIndex,
      intent: toSessionIntent(slot.intent),
      exerciseCount: exerciseRows.length,
      totalSets: exerciseRows.reduce((sum, row) => sum + row.setCount, 0),
      projectedEffectiveStimulusByMuscle: toRoundedRecord(
        projectedSlot?.projectedContributionByMuscle ?? new Map()
      ),
      exercises: exerciseRows.map((row) => ({
        exerciseId: row.exercise.exercise.id,
        exerciseName: row.exercise.exercise.name,
        role: row.role,
        setCount: row.setCount,
        primaryMuscles: [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle),
        movementPatterns: sortPrescriptionStrings(
          row.exercise.exercise.movementPatterns ?? [],
        ),
        effectiveStimulusByMuscle: row.contributionByMuscle,
      })),
    };
  });
}

export function classifyResponsibilityLoad(
  allocation: ShadowSlotDemandAllocation | undefined
): AllocationVsCompositionDelta["responsibilityLoad"] {
  if (!allocation || allocation.allocatedMuscles.length === 0) {
    return "unclear";
  }
  const actionable = allocation.allocatedMuscles.filter(
    (row) => row.targetStatus === "hard" || row.targetStatus === "soft"
  );
  const hard = allocation.allocatedMuscles.filter((row) => row.targetStatus === "hard");
  return actionable.length > 6 || hard.length > 3 ? "overloaded" : "clear";
}

export function buildAllocationDeltas(input: {
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
  composition: SlotCompositionSnapshotDiagnostic[];
  comparison: AllocationVsCompositionDelta["comparison"];
}): AllocationVsCompositionDelta[] {
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );

  return input.composition.map((slot) => {
    const allocation = allocationBySlotId.get(slot.slotId);
    const allocatedByMuscle = new Map(
      (allocation?.allocatedMuscles ?? []).map((row) => [row.muscle, row])
    );
    const underAllocatedMuscles = (allocation?.allocatedMuscles ?? [])
      .flatMap((row) => {
        const expected = row.targetStatus === "hard"
          ? row.minEffectiveSets
          : row.preferredEffectiveSets;
        const actual = roundToTenth(slot.projectedEffectiveStimulusByMuscle[row.muscle] ?? 0);
        if (expected == null || actual + 1e-9 >= expected) {
          return [];
        }
        return [{
          muscle: row.muscle,
          role: row.role,
          targetStatus: row.targetStatus,
          expectedEffectiveSets: expected,
          actualEffectiveSets: actual,
          shortfall: roundToTenth(expected - actual),
        }];
      })
      .sort((left, right) => (right.shortfall ?? 0) - (left.shortfall ?? 0) || left.muscle.localeCompare(right.muscle));
    const unallocatedStimulusMuscles = Object.entries(slot.projectedEffectiveStimulusByMuscle)
      .filter(([muscle, effectiveSets]) => !allocatedByMuscle.has(muscle) && effectiveSets >= 2)
      .map(([muscle, actualEffectiveSets]) => ({ muscle, actualEffectiveSets }))
      .sort((left, right) => right.actualEffectiveSets - left.actualEffectiveSets || left.muscle.localeCompare(right.muscle));
    const responsibilityLoad = classifyResponsibilityLoad(allocation);
    const notes = [
      ...(responsibilityLoad === "unclear" ? ["no_shadow_slot_allocation"] : []),
      ...(responsibilityLoad === "overloaded" ? ["shadow_slot_has_many_actionable_responsibilities"] : []),
      ...(underAllocatedMuscles.length > 0 ? ["allocated_muscles_under_initial_or_final_composition"] : []),
      ...(unallocatedStimulusMuscles.length > 0 ? ["composition_serves_muscles_not_owned_by_shadow_slot"] : []),
    ];

    return {
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      comparison: input.comparison,
      responsibilityLoad,
      underAllocatedMuscles,
      unallocatedStimulusMuscles,
      notes,
    };
  });
}


export function buildSlotDemandAllocation(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotDemandAllocationDiagnostic[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const projectedSlotById = new Map(
    input.finalProjectedSlots.map((slot) => [slot.slotPlan.slotId, slot])
  );

  return input.slotSequence.map((slot, index) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const projectedSlot = projectedSlotById.get(slot.slotId);
    const projectedStimulus = toRoundedRecord(projectedSlot?.projectedContributionByMuscle ?? new Map());
    const expectedMuscleObligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"] = [];

    for (const obligation of getSlotWeeklyObligations({
      plan: input.weeklyObligationPlan,
      slotId: slot.slotId,
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: obligation.muscle,
        source: "weekly_obligation",
        targetStatus: "hard",
        explicitUpstream: true,
        minEffectiveSets: obligation.minEffectiveSets,
        priority: obligation.priority,
      });
    }

    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle,
        source: "authored_protected_coverage",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle) ?? 2,
        priority: "support",
      });
    }

    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_primary_lane",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "diagnostic",
        explicitUpstream: false,
        minEffectiveSets: null,
        priority: "lane",
      });
    }

    for (const muscle of getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_support_preference",
        targetStatus: "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle as ProtectedWeekOneCoverageMuscle) ?? null,
        priority: "support",
      });
    }

    const hardObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source === "weekly_obligation"
    );
    const authoredObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source !== "weekly_obligation"
    );
    const meaningfullyServedMuscles = Object.entries(projectedStimulus)
      .filter(([muscle, value]) => {
        const obligation = expectedMuscleObligations.find((entry) => entry.muscle === muscle);
        const floor = obligation?.minEffectiveSets ?? 2;
        return value >= Math.min(2, floor) || (obligation != null && value > 0);
      })
      .map(([muscle]) => muscle)
      .sort((left, right) => left.localeCompare(right));
    const satisfiesKnownWeeklyDemand = hardObligations.some((obligation) => {
      const projected = projectedStimulus[obligation.muscle] ?? 0;
      return projected + 1e-9 >= (obligation.minEffectiveSets ?? 0);
    });
    const allocationBasis =
      hardObligations.length > 0
        ? "explicit_weekly_demand"
        : authoredObligations.length > 0
          ? "authored_slot_semantics"
          : Object.keys(projectedStimulus).length > 0
            ? "local_movement_or_lane_semantics"
            : "unclear";

    return {
      slotId: slot.slotId,
      slotIndex: index,
      slotLabel: `${slot.intent}@${slot.slotId}`,
      intent: toSessionIntent(slot.intent),
      authoredSlotRole: slotPolicy?.slotArchetype ?? null,
      slotProfile: {
        slotArchetype: slotPolicy?.slotArchetype ?? null,
        continuityScope: slotPolicy?.continuityScope ?? null,
        requiredMovementPatterns: [...(slotPolicy?.sessionShape?.requiredMovementPatterns ?? [])],
        preferredPrimaryMuscles: [
          ...(slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []),
          ...(slotPolicy?.compoundControl?.lanes.flatMap((lane) => lane.preferredPrimaryMuscles ?? []) ?? []),
        ],
        preferredSupportMuscles: getProjectionPreferredSupportMuscles(slotPolicy),
        protectedCoverageMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
      },
      expectedMuscleObligations,
      projectedEffectiveStimulusByMuscle: projectedStimulus,
      meaningfullyServedMuscles,
      allocationBasis,
      satisfiesKnownWeeklyDemand,
    };
  });
}

export function getWeeklyTotals(slots: ReadonlyArray<ProjectedSlotWorkout>): Record<string, number> {
  return toRoundedRecord(
    computeProjectedWeeklyContributionByMuscle({
      projectedSlots: slots,
      currentSlotContribution: new Map(),
    })
  );
}

export function buildProjectedDelivery(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalExerciseRows: ReadonlyArray<ExerciseRow>;
}): ProjectedDeliveryDiagnostic[] {
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const exposureCountByMuscle = new Map<string, number>();
  for (const slot of input.finalProjectedSlots) {
    const slotContribution = toRoundedRecord(slot.projectedContributionByMuscle);
    for (const [muscle, value] of Object.entries(slotContribution)) {
      if (value > 0) {
        exposureCountByMuscle.set(muscle, (exposureCountByMuscle.get(muscle) ?? 0) + 1);
      }
    }
  }

  return input.relevantMuscles.map((muscle) => {
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const finalTotal = finalTotals[muscle] ?? 0;
    const contributors = input.finalExerciseRows
      .map((row) => ({
        slotId: row.slotId,
        exerciseId: row.exercise.exercise.id,
        exerciseName: row.exercise.exercise.name,
        effectiveStimulus: row.contributionByMuscle[muscle] ?? 0,
        percentOfWeeklyStimulus:
          finalTotal > 0
            ? roundToTenth(((row.contributionByMuscle[muscle] ?? 0) / finalTotal) * 100)
            : 0,
      }))
      .filter((row) => row.effectiveStimulus > 0)
      .sort((left, right) => right.effectiveStimulus - left.effectiveStimulus || left.exerciseName.localeCompare(right.exerciseName))
      .slice(0, 4);

    return {
      muscle,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      projectedEffectiveStimulusAfterInitialSlotComposition:
        input.initialProjectedSlots.length > 0 ? roundToTenth(initialTotals[muscle] ?? 0) : null,
      projectedEffectiveStimulusAfterRepairAndFinalShaping: roundToTenth(finalTotal),
      deltaFromPreferredTarget:
        target.preferredTarget == null ? null : roundToTenth(finalTotal - target.preferredTarget),
      exposureCount: exposureCountByMuscle.get(muscle) ?? 0,
      majorContributingExercises: contributors,
    };
  });
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

