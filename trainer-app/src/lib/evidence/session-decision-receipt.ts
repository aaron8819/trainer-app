import type { AutoregulationModification } from "@/lib/engine/readiness/types";
import { toMuscleId } from "@/lib/engine/stimulus";
import type { PlannerDiagnostics } from "@/lib/planner-diagnostics/types";
import type {
  CycleContextSnapshot,
  DeloadDecision,
  LifecycleRirTarget,
  PlannerDiagnosticsMode,
  SessionDecisionException,
  SessionDecisionReadinessScaling,
  SessionDecisionReceipt,
  SessionDecisionVolumeTargetSource,
} from "./types";

type JsonRecord = Record<string, unknown>;

type ReadinessReceiptInput = {
  wasAutoregulated?: boolean;
  signalAgeHours?: number | null;
  fatigueScoreOverall?: number | null;
  rationale?: string;
  modifications?: AutoregulationModification[];
  intensityScaling?: Partial<SessionDecisionReadinessScaling>;
};

const DEFAULT_DELOAD_DECISION: DeloadDecision = {
  mode: "none",
  reason: [],
  reductionPercent: 0,
  appliedTo: "none",
};

function toObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  const parsed = parseStringArray(value);
  return parsed.length > 0 ? parsed : undefined;
}

export function parseCycleContextSnapshot(value: unknown): CycleContextSnapshot | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (
    typeof record.weekInMeso !== "number" ||
    typeof record.weekInBlock !== "number" ||
    typeof record.phase !== "string" ||
    typeof record.blockType !== "string" ||
    typeof record.isDeload !== "boolean" ||
    (record.source !== "computed" && record.source !== "fallback")
  ) {
    return undefined;
  }

  return {
    weekInMeso: record.weekInMeso,
    weekInBlock: record.weekInBlock,
    blockDurationWeeks:
      typeof record.blockDurationWeeks === "number" ? record.blockDurationWeeks : undefined,
    mesocycleLength:
      typeof record.mesocycleLength === "number" ? record.mesocycleLength : undefined,
    phase: record.phase as CycleContextSnapshot["phase"],
    blockType: record.blockType as CycleContextSnapshot["blockType"],
    isDeload: record.isDeload,
    source: record.source,
  };
}

export function parseDeloadDecision(value: unknown): DeloadDecision | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (
    typeof record.mode !== "string" ||
    !Array.isArray(record.reason) ||
    typeof record.reductionPercent !== "number" ||
    typeof record.appliedTo !== "string"
  ) {
    return undefined;
  }

  return {
    mode: record.mode as DeloadDecision["mode"],
    reason: parseStringArray(record.reason),
    reductionPercent: record.reductionPercent,
    appliedTo: record.appliedTo as DeloadDecision["appliedTo"],
  };
}

export function parseLifecycleRirTarget(value: unknown): LifecycleRirTarget | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (typeof record.min !== "number" || typeof record.max !== "number") {
    return undefined;
  }
  return { min: record.min, max: record.max };
}

function parseVolumeTargets(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const targets: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      targets[key] = entry;
    }
  }
  return Object.keys(targets).length > 0 ? targets : undefined;
}

function parseVolumeTargetSource(value: unknown): SessionDecisionVolumeTargetSource | undefined {
  return value === "lifecycle" ||
    value === "soreness_adjusted_lifecycle" ||
    value === "unknown"
    ? value
    : undefined;
}

function parsePlannerDiagnosticsMode(value: unknown): PlannerDiagnosticsMode | undefined {
  return value === "standard" || value === "debug" ? value : undefined;
}

function parseRecordOfFiniteNumbers(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  const parsed: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const finite = toFiniteNumber(entry);
    if (finite != null) {
      parsed[key] = finite;
    }
  }
  return parsed;
}

function parseInventoryCandidates(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    const item = toObject(entry);
    if (
      !item ||
      typeof item.exerciseId !== "string" ||
      typeof item.exerciseName !== "string" ||
      typeof item.inventoryKind !== "string" ||
      typeof item.eligibilityReason !== "string" ||
      typeof item.selected !== "boolean"
    ) {
      return [];
    }
    return [{
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      inventoryKind: item.inventoryKind as "standard" | "closure" | "rescue",
      eligibilityReason: item.eligibilityReason,
      selected: item.selected,
      selectedSets: toFiniteNumber(item.selectedSets),
      rationale: typeof item.rationale === "string" ? item.rationale : undefined,
      rejectionReason: typeof item.rejectionReason === "string" ? item.rejectionReason : undefined,
    }];
  });
}

function parseDeficitSnapshots(value: unknown) {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([muscle, entry]) => {
      const item = toObject(entry);
      if (
        !item ||
        toFiniteNumber(item.weeklyTarget) == null ||
        toFiniteNumber(item.performedEffectiveVolumeBeforeSession) == null ||
        toFiniteNumber(item.plannedEffectiveVolume) == null ||
        toFiniteNumber(item.projectedEffectiveVolume) == null ||
        toFiniteNumber(item.remainingDeficit) == null
      ) {
        return [];
      }
      return [[muscle, {
        weeklyTarget: item.weeklyTarget as number,
        performedEffectiveVolumeBeforeSession: item.performedEffectiveVolumeBeforeSession as number,
        plannedEffectiveVolume: item.plannedEffectiveVolume as number,
        projectedEffectiveVolume: item.projectedEffectiveVolume as number,
        remainingDeficit: item.remainingDeficit as number,
      }]];
    })
  );
}

function parseTradeoffs(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    const item = toObject(entry);
    if (
      !item ||
      typeof item.layer !== "string" ||
      typeof item.code !== "string" ||
      typeof item.message !== "string"
    ) {
      return [];
    }
    return [{
      layer: item.layer as "anchor" | "standard" | "supplemental" | "closure" | "rescue",
      code: item.code,
      message: item.message,
      exerciseId: typeof item.exerciseId === "string" ? item.exerciseId : undefined,
      muscle: typeof item.muscle === "string" ? item.muscle : undefined,
    }];
  });
}

function sanitizePlannerDiagnosticsForMode(
  plannerDiagnostics: PlannerDiagnostics | undefined,
  mode: PlannerDiagnosticsMode
): PlannerDiagnostics | undefined {
  if (!plannerDiagnostics) {
    return undefined;
  }
  if (mode === "debug") {
    return plannerDiagnostics;
  }
  return {
    ...plannerDiagnostics,
    standard: plannerDiagnostics.standard
      ? {
          ...plannerDiagnostics.standard,
          candidates: undefined,
        }
      : undefined,
    supplemental: plannerDiagnostics.supplemental
      ? {
          ...plannerDiagnostics.supplemental,
          candidates: undefined,
        }
      : undefined,
    closure: {
      ...plannerDiagnostics.closure,
      actions: plannerDiagnostics.closure.actions,
      firstIterationCandidates: undefined,
    },
    rescue: plannerDiagnostics.rescue
      ? {
          ...plannerDiagnostics.rescue,
          candidates: undefined,
        }
      : undefined,
  };
}

function parsePlannerDiagnostics(value: unknown): PlannerDiagnostics | undefined {
  const record = toObject(value);
  const musclesRecord = toObject(record?.muscles);
  const exercisesRecord = toObject(record?.exercises);
  const closureRecord = toObject(record?.closure);
  if (!record || !musclesRecord || !exercisesRecord || !closureRecord) {
    return undefined;
  }

  const muscles = Object.fromEntries(
    Object.entries(musclesRecord).flatMap(([muscle, entry]) => {
      const item = toObject(entry);
      if (!item) {
        return [];
      }

      const weeklyTarget = toFiniteNumber(item.weeklyTarget);
      const performedEffectiveVolumeBeforeSession = toFiniteNumber(
        item.performedEffectiveVolumeBeforeSession
      );
      const plannedEffectiveVolumeAfterRoleBudgeting = toFiniteNumber(
        item.plannedEffectiveVolumeAfterRoleBudgeting
      );
      const projectedEffectiveVolumeAfterRoleBudgeting = toFiniteNumber(
        item.projectedEffectiveVolumeAfterRoleBudgeting
      );
      const deficitAfterRoleBudgeting = toFiniteNumber(item.deficitAfterRoleBudgeting);
      const plannedEffectiveVolumeAfterClosure = toFiniteNumber(
        item.plannedEffectiveVolumeAfterClosure
      );
      const projectedEffectiveVolumeAfterClosure = toFiniteNumber(
        item.projectedEffectiveVolumeAfterClosure
      );
      const finalRemainingDeficit = toFiniteNumber(item.finalRemainingDeficit);

      if (
        weeklyTarget == null ||
        performedEffectiveVolumeBeforeSession == null ||
        plannedEffectiveVolumeAfterRoleBudgeting == null ||
        projectedEffectiveVolumeAfterRoleBudgeting == null ||
        deficitAfterRoleBudgeting == null ||
        plannedEffectiveVolumeAfterClosure == null ||
        projectedEffectiveVolumeAfterClosure == null ||
        finalRemainingDeficit == null
      ) {
        return [];
      }

      return [[muscle, {
        weeklyTarget,
        performedEffectiveVolumeBeforeSession,
        plannedEffectiveVolumeAfterRoleBudgeting,
        projectedEffectiveVolumeAfterRoleBudgeting,
        deficitAfterRoleBudgeting,
        plannedEffectiveVolumeAfterClosure,
        projectedEffectiveVolumeAfterClosure,
        finalRemainingDeficit,
      }]];
    })
  );

  const exercises = Object.fromEntries(
    Object.entries(exercisesRecord).flatMap(([exerciseId, entry]) => {
      const item = toObject(entry);
      const anchorUsed = toObject(item?.anchorUsed);
      const anchorBudgetDecision = toObject(item?.anchorBudgetDecision);
      const overshootAdjustmentsApplied = toObject(item?.overshootAdjustmentsApplied);
      if (
        !item ||
        typeof item.exerciseName !== "string" ||
        toFiniteNumber(item.assignedSetCount) == null ||
        !toObject(item.stimulusVector)
      ) {
        return [];
      }

      const stimulusVector = parseVolumeTargets(item.stimulusVector) ?? {};
      const parsedAnchorUsed =
        anchorUsed &&
        ((anchorUsed.kind === "muscle" && typeof anchorUsed.muscle === "string") ||
          (anchorUsed.kind === "movement_pattern" &&
            typeof anchorUsed.movementPattern === "string"))
          ? (anchorUsed as PlannerDiagnostics["exercises"][string]["anchorUsed"])
          : undefined;

      const parsedAnchorBudgetDecision =
        anchorBudgetDecision &&
        toFiniteNumber(anchorBudgetDecision.weeklyTarget) != null &&
        toFiniteNumber(anchorBudgetDecision.performedEffectiveVolumeBeforeSession) != null &&
        toFiniteNumber(anchorBudgetDecision.plannedEffectiveVolumeBeforeAssignment) != null &&
        toFiniteNumber(anchorBudgetDecision.reservedEffectiveVolumeForRemainingRoleFixtures) != null &&
        toFiniteNumber(anchorBudgetDecision.anchorRemainingBeforeAssignment) != null &&
        toFiniteNumber(anchorBudgetDecision.anchorContributionPerSet) != null &&
        toFiniteNumber(anchorBudgetDecision.desiredSetTarget) != null &&
        toFiniteNumber(anchorBudgetDecision.anchorConstrainedContinuousSetTarget) != null
          ? {
              weeklyTarget: anchorBudgetDecision.weeklyTarget as number,
              performedEffectiveVolumeBeforeSession:
                anchorBudgetDecision.performedEffectiveVolumeBeforeSession as number,
              plannedEffectiveVolumeBeforeAssignment:
                anchorBudgetDecision.plannedEffectiveVolumeBeforeAssignment as number,
              reservedEffectiveVolumeForRemainingRoleFixtures:
                anchorBudgetDecision.reservedEffectiveVolumeForRemainingRoleFixtures as number,
              anchorRemainingBeforeAssignment:
                anchorBudgetDecision.anchorRemainingBeforeAssignment as number,
              anchorContributionPerSet: anchorBudgetDecision.anchorContributionPerSet as number,
              desiredSetTarget: anchorBudgetDecision.desiredSetTarget as number,
              anchorConstrainedContinuousSetTarget:
                anchorBudgetDecision.anchorConstrainedContinuousSetTarget as number,
            }
          : undefined;

      const parsedOvershootAdjustments =
        overshootAdjustmentsApplied &&
        toFiniteNumber(overshootAdjustmentsApplied.initialSetTarget) != null &&
        toFiniteNumber(overshootAdjustmentsApplied.finalSetTarget) != null &&
        toFiniteNumber(overshootAdjustmentsApplied.reductionsApplied) != null
          ? {
              initialSetTarget: overshootAdjustmentsApplied.initialSetTarget as number,
              finalSetTarget: overshootAdjustmentsApplied.finalSetTarget as number,
              reductionsApplied: overshootAdjustmentsApplied.reductionsApplied as number,
              limitingMuscles: parseStringArray(overshootAdjustmentsApplied.limitingMuscles),
            }
          : undefined;

      return [[exerciseId, {
        exerciseId,
        exerciseName: item.exerciseName,
        assignedSetCount: item.assignedSetCount as number,
        stimulusVector,
        anchorUsed: parsedAnchorUsed,
        anchorBudgetDecision: parsedAnchorBudgetDecision,
        overshootAdjustmentsApplied: parsedOvershootAdjustments,
        isRoleFixture: item.isRoleFixture === true,
        isClosureAddition: item.isClosureAddition === true,
        isSetExpandedCarryover: item.isSetExpandedCarryover === true,
        closureSetDelta: toFiniteNumber(item.closureSetDelta) ?? 0,
      }]];
    })
  );

  const actions = Array.isArray(closureRecord.actions)
    ? closureRecord.actions.flatMap((entry) => {
        const item = toObject(entry);
        if (
          !item ||
          typeof item.exerciseId !== "string" ||
          typeof item.exerciseName !== "string" ||
          (item.kind !== "add" && item.kind !== "expand") ||
          toFiniteNumber(item.setDelta) == null ||
          toFiniteNumber(item.deficitReduction) == null ||
          toFiniteNumber(item.collateralOvershoot) == null ||
          toFiniteNumber(item.fatigueCost) == null ||
          toFiniteNumber(item.score) == null
        ) {
          return [];
        }

        return [{
          exerciseId: item.exerciseId,
          exerciseName: item.exerciseName,
          kind: item.kind as "add" | "expand",
          setDelta: item.setDelta as number,
          deficitReduction: item.deficitReduction as number,
          collateralOvershoot: item.collateralOvershoot as number,
          fatigueCost: item.fatigueCost as number,
          score: item.score as number,
        }];
      })
    : [];

  const firstIterationCandidates = Array.isArray(closureRecord.firstIterationCandidates)
    ? closureRecord.firstIterationCandidates.flatMap((entry) => {
        const item = toObject(entry);
        const parsedScore =
          toFiniteNumber(item?.score) ??
          toFiniteNumber(item?.totalScore) ??
          null;
        const parsedRejectionReason =
          typeof item?.rejectionReason === "string"
            ? item.rejectionReason
            : typeof item?.filteredOutReason === "string"
              ? item.filteredOutReason
              : undefined;
        const parsedDecision: "selected" | "rejected" =
          item?.decision === "selected" || item?.decision === "rejected"
            ? (item.decision as "selected" | "rejected")
            : parsedRejectionReason
              ? "rejected"
              : "selected";
        const dominantDeficitKey =
          typeof item?.dominantDeficitMuscleId === "string"
            ? item.dominantDeficitMuscleId
            : typeof item?.dominantDeficitMuscle === "string"
              ? item.dominantDeficitMuscle
              : undefined;
        if (
          !item ||
          typeof item.exerciseId !== "string" ||
          (item.kind !== "add" && item.kind !== "expand") ||
          toFiniteNumber(item.setDelta) == null ||
          toFiniteNumber(item.dominantDeficitContribution) == null
        ) {
          return [];
        }

        return [{
          exerciseId: item.exerciseId,
          kind: item.kind as "add" | "expand",
          setDelta: item.setDelta as number,
          dominantDeficitMuscleId:
            typeof dominantDeficitKey === "string"
              ? toMuscleId(dominantDeficitKey)
              : undefined,
          dominantDeficitRemaining: toFiniteNumber(item.dominantDeficitRemaining),
          dominantDeficitContribution: item.dominantDeficitContribution as number,
          decision: parsedDecision,
          rejectionReason: parsedRejectionReason,
          deficitReduction: toFiniteNumber(item.deficitReduction),
          dominantDeficitReduction: toFiniteNumber(item.dominantDeficitReduction),
          collateralOvershoot: toFiniteNumber(item.collateralOvershoot),
          fatigueCost: toFiniteNumber(item.fatigueCost),
          score: parsedScore,
          exerciseName:
            typeof item.exerciseName === "string" ? item.exerciseName : undefined,
        }];
      })
    : [];

  type ParsedSessionIntent =
    | "push"
    | "pull"
    | "legs"
    | "upper"
    | "lower"
    | "full_body"
    | "body_part";
  type ParsedOpportunityCharacter = "upper" | "lower" | "full_body" | "specialized";
  type ParsedInventoryKind = "standard" | "closure" | "rescue";
  type ParsedPlannerLayer = "anchor" | "standard" | "supplemental" | "closure" | "rescue";

  const opportunityRecord = toObject(record.opportunity);
  const opportunity =
    opportunityRecord &&
    typeof opportunityRecord.opportunityKey === "string" &&
    typeof opportunityRecord.sessionIntent === "string" &&
    typeof opportunityRecord.sessionCharacter === "string"
      ? {
          opportunityKey: opportunityRecord.opportunityKey,
          sessionIntent: opportunityRecord.sessionIntent as ParsedSessionIntent,
          sessionCharacter: opportunityRecord.sessionCharacter as ParsedOpportunityCharacter,
          targetMuscles: parseOptionalStringArray(opportunityRecord.targetMuscles),
          planningInventoryKind:
            opportunityRecord.planningInventoryKind === "standard" ||
            opportunityRecord.planningInventoryKind === "rescue"
              ? (opportunityRecord.planningInventoryKind as "standard" | "rescue")
              : "standard",
          closureInventoryKind:
            opportunityRecord.closureInventoryKind === "standard" ||
            opportunityRecord.closureInventoryKind === "closure" ||
            opportunityRecord.closureInventoryKind === "rescue"
              ? (opportunityRecord.closureInventoryKind as "standard" | "closure" | "rescue")
              : "closure",
          currentSessionMuscleOpportunity: Object.fromEntries(
            Object.entries(toObject(opportunityRecord.currentSessionMuscleOpportunity) ?? {}).flatMap(
              ([muscle, entry]) => {
                const item = toObject(entry);
                if (
                  !item ||
                  toFiniteNumber(item.sessionOpportunityWeight) == null ||
                  toFiniteNumber(item.weeklyTarget) == null ||
                  toFiniteNumber(item.performedEffectiveVolumeBeforeSession) == null ||
                  toFiniteNumber(item.startingDeficit) == null
                ) {
                  return [];
                }
                return [[muscle, {
                  sessionOpportunityWeight: item.sessionOpportunityWeight as number,
                  weeklyTarget: item.weeklyTarget as number,
                  performedEffectiveVolumeBeforeSession:
                    item.performedEffectiveVolumeBeforeSession as number,
                  startingDeficit: item.startingDeficit as number,
                  weeklyOpportunityUnits: toFiniteNumber(item.weeklyOpportunityUnits),
                  futureOpportunityUnits: toFiniteNumber(item.futureOpportunityUnits),
                  futureCapacity: toFiniteNumber(item.futureCapacity),
                  requiredNow: toFiniteNumber(item.requiredNow),
                  urgencyMultiplier: toFiniteNumber(item.urgencyMultiplier),
                }]];
              }
            )
          ),
          remainingWeek: (() => {
            const remainingWeekRecord = toObject(opportunityRecord.remainingWeek);
            if (
              !remainingWeekRecord ||
              !Array.isArray(remainingWeekRecord.futureSlots) ||
              toFiniteNumber(remainingWeekRecord.futureCapacityFactor) == null
            ) {
              return undefined;
            }
            return {
              futureSlots: parseStringArray(remainingWeekRecord.futureSlots) as ParsedSessionIntent[],
              futureSlotCounts: (parseRecordOfFiniteNumbers(remainingWeekRecord.futureSlotCounts) ??
                {}) as Partial<Record<ParsedSessionIntent, number>>,
              futureCapacityFactor: remainingWeekRecord.futureCapacityFactor as number,
            };
          })(),
        }
      : undefined;

  const anchorRecord = toObject(record.anchor);
  const anchor =
    anchorRecord &&
    typeof anchorRecord.used === "boolean" &&
    toObject(anchorRecord.policy)
      ? {
          used: anchorRecord.used,
          policy: {
            coreMinimumSets: toFiniteNumber(toObject(anchorRecord.policy)?.coreMinimumSets) ?? 0,
            accessoryMinimumSets:
              toFiniteNumber(toObject(anchorRecord.policy)?.accessoryMinimumSets) ?? 0,
            coreDeferredDeficitCarryFraction:
              toFiniteNumber(toObject(anchorRecord.policy)?.coreDeferredDeficitCarryFraction) ?? 0,
            accessoryDeferredDeficitCarryFraction:
              toFiniteNumber(toObject(anchorRecord.policy)?.accessoryDeferredDeficitCarryFraction) ?? 0,
            supplementalInventory:
              toObject(anchorRecord.policy)?.supplementalInventory === "standard"
                ? ("standard" as const)
                : ("closure" as const),
          },
          consideredFixtureIds: parseStringArray(anchorRecord.consideredFixtureIds),
          keptFixtureIds: parseStringArray(anchorRecord.keptFixtureIds),
          droppedFixtureIds: parseStringArray(anchorRecord.droppedFixtureIds),
          fixtures: Array.isArray(anchorRecord.fixtures)
            ? anchorRecord.fixtures.flatMap((entry) => {
                const item = toObject(entry);
                const anchorUsed = toObject(item?.anchor);
                const parsedAnchor =
                  anchorUsed &&
                  ((anchorUsed.kind === "muscle" && typeof anchorUsed.muscle === "string") ||
                    (anchorUsed.kind === "movement_pattern" &&
                      typeof anchorUsed.movementPattern === "string"))
                    ? (anchorUsed as PlannerDiagnostics["exercises"][string]["anchorUsed"])
                    : undefined;
                if (
                  !item ||
                  typeof item.exerciseId !== "string" ||
                  typeof item.exerciseName !== "string" ||
                  typeof item.role !== "string" ||
                  typeof item.priority !== "string" ||
                  toFiniteNumber(item.proposedSets) == null ||
                  toFiniteNumber(item.minimumSets) == null ||
                  toFiniteNumber(item.desiredSets) == null ||
                  toFiniteNumber(item.plannedSets) == null ||
                  typeof item.kept !== "boolean" ||
                  typeof item.decisionCode !== "string" ||
                  typeof item.reason !== "string"
                ) {
                  return [];
                }
                return [{
                  exerciseId: item.exerciseId,
                  exerciseName: item.exerciseName,
                  role: item.role as "CORE_COMPOUND" | "ACCESSORY" | "UNASSIGNED",
                  priority: item.priority as "core" | "accessory",
                  anchor: parsedAnchor,
                  proposedSets: item.proposedSets as number,
                  minimumSets: item.minimumSets as number,
                  desiredSets: item.desiredSets as number,
                  plannedSets: item.plannedSets as number,
                  kept: item.kept,
                  decisionCode: item.decisionCode as
                    | "deload_passthrough"
                    | "passed_through_without_anchor"
                    | "kept_at_desired_target"
                    | "kept_at_floor"
                    | "trimmed_by_anchor_budget"
                    | "trimmed_by_collateral_guardrail"
                    | "trimmed_by_anchor_budget_and_collateral_guardrail"
                    | "dropped_by_anchor_budget",
                  reason: item.reason,
                  anchorBudgetDecision:
                    item.anchorBudgetDecision &&
                    toFiniteNumber(toObject(item.anchorBudgetDecision)?.weeklyTarget) != null
                      ? (item.anchorBudgetDecision as PlannerDiagnostics["exercises"][string]["anchorBudgetDecision"])
                      : undefined,
                  overshootAdjustmentsApplied:
                    item.overshootAdjustmentsApplied &&
                    toFiniteNumber(toObject(item.overshootAdjustmentsApplied)?.initialSetTarget) != null
                      ? (item.overshootAdjustmentsApplied as PlannerDiagnostics["exercises"][string]["overshootAdjustmentsApplied"])
                      : undefined,
                }];
              })
            : [],
        }
      : undefined;
  const standardRecord = toObject(record.standard);
  const standard =
    standardRecord &&
    typeof standardRecord.used === "boolean" &&
    typeof standardRecord.reason === "string" &&
    standardRecord.inventoryKind === "standard"
      ? {
          used: standardRecord.used,
          reason: standardRecord.reason,
          inventoryKind: "standard" as const,
          selectedExerciseIds: parseStringArray(standardRecord.selectedExerciseIds),
          candidateCount: toFiniteNumber(standardRecord.candidateCount) ?? 0,
          candidates: parseInventoryCandidates(standardRecord.candidates),
        }
      : undefined;

  const supplementalRecord = toObject(record.supplemental);
  const supplemental =
    supplementalRecord &&
    typeof supplementalRecord.allowed === "boolean" &&
    typeof supplementalRecord.used === "boolean" &&
    typeof supplementalRecord.reason === "string"
      ? {
          allowed: supplementalRecord.allowed,
          used: supplementalRecord.used,
          reason: supplementalRecord.reason,
          inventoryKind:
            supplementalRecord.inventoryKind === "standard" ||
            supplementalRecord.inventoryKind === "closure" ||
            supplementalRecord.inventoryKind === "rescue"
              ? (supplementalRecord.inventoryKind as "standard" | "closure" | "rescue")
              : undefined,
          deficitsTargeted: parseStringArray(supplementalRecord.deficitsTargeted),
          selectedExerciseIds: parseStringArray(supplementalRecord.selectedExerciseIds),
          candidateCount: toFiniteNumber(supplementalRecord.candidateCount) ?? 0,
          candidates: parseInventoryCandidates(supplementalRecord.candidates),
        }
      : undefined;

  const rescueRecord = toObject(record.rescue);
  const rescue =
    rescueRecord &&
    typeof rescueRecord.eligible === "boolean" &&
    typeof rescueRecord.used === "boolean" &&
    typeof rescueRecord.reason === "string"
      ? {
          eligible: rescueRecord.eligible,
          used: rescueRecord.used,
          reason: rescueRecord.reason,
          rescueOnlyCandidateCount: toFiniteNumber(rescueRecord.rescueOnlyCandidateCount) ?? 0,
          rescueOnlyExerciseIds: parseStringArray(rescueRecord.rescueOnlyExerciseIds),
          selectedExerciseIds: parseStringArray(rescueRecord.selectedExerciseIds),
          candidates: parseInventoryCandidates(rescueRecord.candidates),
        }
      : undefined;

  const outcomeRecord = toObject(record.outcome);
  const outcome =
    outcomeRecord
      ? {
          layersUsed: parseStringArray(outcomeRecord.layersUsed) as ParsedPlannerLayer[],
          startingDeficits: parseDeficitSnapshots(outcomeRecord.startingDeficits) ?? {},
          deficitsAfterBaseSession: parseDeficitSnapshots(outcomeRecord.deficitsAfterBaseSession) ?? {},
          deficitsAfterSupplementation:
            parseDeficitSnapshots(outcomeRecord.deficitsAfterSupplementation) ?? {},
          deficitsAfterClosure: parseDeficitSnapshots(outcomeRecord.deficitsAfterClosure) ?? {},
          unresolvedDeficits: parseStringArray(outcomeRecord.unresolvedDeficits),
          keyTradeoffs: parseTradeoffs(outcomeRecord.keyTradeoffs) ?? [],
        }
      : undefined;

  return {
    opportunity,
    anchor,
    standard,
    supplemental,
    muscles,
    exercises,
    closure: {
      eligible: closureRecord.eligible === true,
      used: closureRecord.used === true,
      reason: typeof closureRecord.reason === "string" ? closureRecord.reason : undefined,
      inventoryKind:
        closureRecord.inventoryKind === "standard" ||
        closureRecord.inventoryKind === "closure" ||
        closureRecord.inventoryKind === "rescue"
          ? (closureRecord.inventoryKind as "standard" | "closure" | "rescue")
          : undefined,
      eligibleExerciseIds: parseStringArray(closureRecord.eligibleExerciseIds),
      winningAction: Array.isArray(closureRecord.actions) && actions[0] ? actions[0] : undefined,
      actions,
      firstIterationCandidates,
    },
    rescue,
    outcome,
  };
}

function summarizeIntensityScaling(
  modifications: AutoregulationModification[] | undefined,
  existing?: Partial<SessionDecisionReadinessScaling>
): SessionDecisionReadinessScaling {
  const scaledExerciseIds = new Set<string>(existing?.exerciseIds ?? []);
  let scaledUpCount = existing?.scaledUpCount ?? 0;
  let scaledDownCount = existing?.scaledDownCount ?? 0;

  for (const mod of modifications ?? []) {
    if (mod.type !== "intensity_scale") {
      continue;
    }
    if (mod.exerciseId) {
      scaledExerciseIds.add(mod.exerciseId);
    }
    if (mod.direction === "up") {
      scaledUpCount += 1;
    } else if (mod.direction === "down") {
      scaledDownCount += 1;
    }
  }

  const computedApplied = scaledExerciseIds.size > 0 || scaledUpCount > 0 || scaledDownCount > 0;
  const applied = existing?.applied === true || computedApplied;

  return {
    applied,
    exerciseIds: [...scaledExerciseIds],
    scaledUpCount,
    scaledDownCount,
  };
}

function buildExceptions(input: {
  sorenessSuppressedMuscles: string[];
  deloadDecision: DeloadDecision;
  intensityScaling: SessionDecisionReadinessScaling;
  additionalExceptions?: SessionDecisionException[];
}): SessionDecisionException[] {
  const output: SessionDecisionException[] = [];
  if (input.sorenessSuppressedMuscles.length > 0) {
    output.push({
      code: "soreness_suppression",
      message: `Held back weekly volume for ${input.sorenessSuppressedMuscles.join(", ")} due to soreness.`,
    });
  }
  if (input.deloadDecision.mode !== "none") {
    output.push({
      code: "deload",
      message:
        input.deloadDecision.reason[0] ??
        `Applied ${input.deloadDecision.mode} deload (${input.deloadDecision.reductionPercent}% ${input.deloadDecision.appliedTo}).`,
    });
  }
  if (input.intensityScaling.applied) {
    output.push({
      code: "readiness_scale",
      message: `Readiness scaled ${input.intensityScaling.exerciseIds.length} exercise(s): ${input.intensityScaling.scaledDownCount} down, ${input.intensityScaling.scaledUpCount} up.`,
    });
  }
  for (const additional of input.additionalExceptions ?? []) {
    if (output.some((entry) => entry.code === additional.code && entry.message === additional.message)) {
      continue;
    }
    output.push(additional);
  }
  return output;
}

export function buildSessionDecisionReceipt(input: {
  cycleContext: CycleContextSnapshot;
  targetMuscles?: string[];
  lifecycleRirTarget?: LifecycleRirTarget;
  lifecycleVolumeTargets?: Record<string, number>;
  sorenessSuppressedMuscles?: string[];
  deloadDecision?: DeloadDecision | null;
  autoregulation?: ReadinessReceiptInput;
  plannerDiagnostics?: PlannerDiagnostics;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
  additionalExceptions?: SessionDecisionException[];
}): SessionDecisionReceipt {
  const sorenessSuppressedMuscles = input.sorenessSuppressedMuscles ?? [];
  const deloadDecision = input.deloadDecision ?? DEFAULT_DELOAD_DECISION;
  const intensityScaling = summarizeIntensityScaling(
    input.autoregulation?.modifications,
    input.autoregulation?.intensityScaling
  );
  const lifecycleVolumeSource: SessionDecisionVolumeTargetSource =
    input.lifecycleVolumeTargets
      ? sorenessSuppressedMuscles.length > 0
        ? "soreness_adjusted_lifecycle"
        : "lifecycle"
      : "unknown";
  const plannerDiagnosticsMode = input.plannerDiagnosticsMode ?? "standard";

  return {
    version: 1,
    cycleContext: input.cycleContext,
    targetMuscles: parseOptionalStringArray(input.targetMuscles),
    lifecycleRirTarget: input.lifecycleRirTarget,
    lifecycleVolume: {
      targets: input.lifecycleVolumeTargets,
      source: lifecycleVolumeSource,
    },
    sorenessSuppressedMuscles,
    deloadDecision,
    plannerDiagnosticsMode,
    plannerDiagnostics: sanitizePlannerDiagnosticsForMode(
      input.plannerDiagnostics,
      plannerDiagnosticsMode
    ),
    readiness: {
      wasAutoregulated:
        (input.autoregulation?.wasAutoregulated ?? false) || intensityScaling.applied,
      signalAgeHours: input.autoregulation?.signalAgeHours ?? null,
      fatigueScoreOverall: input.autoregulation?.fatigueScoreOverall ?? null,
      intensityScaling,
      rationale: input.autoregulation?.rationale,
    },
    exceptions: buildExceptions({
      sorenessSuppressedMuscles,
      deloadDecision,
      intensityScaling,
      additionalExceptions: input.additionalExceptions,
    }),
  };
}

function parsePersistedReceipt(value: unknown): SessionDecisionReceipt | undefined {
  const record = toObject(value);
  if (!record || record.version !== 1) {
    return undefined;
  }

  const cycleContext = parseCycleContextSnapshot(record.cycleContext);
  const deloadDecision = parseDeloadDecision(record.deloadDecision);
  const readinessRecord = toObject(record.readiness);
  const intensityScalingRecord = toObject(readinessRecord?.intensityScaling);
  if (!cycleContext || !deloadDecision || !readinessRecord || !intensityScalingRecord) {
    return undefined;
  }

  return {
    version: 1,
    cycleContext,
    targetMuscles: parseOptionalStringArray(record.targetMuscles),
    lifecycleRirTarget: parseLifecycleRirTarget(record.lifecycleRirTarget),
    lifecycleVolume: {
      targets: parseVolumeTargets(toObject(record.lifecycleVolume)?.targets),
      source: parseVolumeTargetSource(toObject(record.lifecycleVolume)?.source) ?? "unknown",
    },
    sorenessSuppressedMuscles: parseStringArray(record.sorenessSuppressedMuscles),
    deloadDecision,
    plannerDiagnosticsMode: parsePlannerDiagnosticsMode(record.plannerDiagnosticsMode) ?? "standard",
    plannerDiagnostics: parsePlannerDiagnostics(record.plannerDiagnostics),
    readiness: {
      wasAutoregulated: readinessRecord.wasAutoregulated === true,
      signalAgeHours: toFiniteNumber(readinessRecord.signalAgeHours) ?? null,
      fatigueScoreOverall: toFiniteNumber(readinessRecord.fatigueScoreOverall) ?? null,
      intensityScaling: {
        applied: intensityScalingRecord.applied === true,
        exerciseIds: parseStringArray(intensityScalingRecord.exerciseIds),
        scaledUpCount: toFiniteNumber(intensityScalingRecord.scaledUpCount) ?? 0,
        scaledDownCount: toFiniteNumber(intensityScalingRecord.scaledDownCount) ?? 0,
      },
      rationale:
        typeof readinessRecord.rationale === "string" ? readinessRecord.rationale : undefined,
    },
    exceptions: Array.isArray(record.exceptions)
      ? record.exceptions.flatMap((entry) => {
          const item = toObject(entry);
          if (!item || typeof item.code !== "string" || typeof item.message !== "string") {
            return [];
          }
          if (
            item.code !== "soreness_suppression" &&
            item.code !== "deload" &&
            item.code !== "readiness_scale" &&
            item.code !== "optional_gap_fill" &&
            item.code !== "supplemental_deficit_session"
          ) {
            return [];
          }
          return [
            {
              code: item.code as SessionDecisionException["code"],
              message: item.message,
            },
          ];
        })
      : [],
  };
}

export function extractSessionDecisionReceipt(value: unknown): SessionDecisionReceipt | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  return parsePersistedReceipt(record.sessionDecisionReceipt);
}

export function readSessionDecisionReceipt(
  selectionMetadata: unknown
): SessionDecisionReceipt | undefined {
  return extractSessionDecisionReceipt(selectionMetadata);
}

export function normalizeSelectionMetadataWithReceipt(input: {
  selectionMetadata: unknown;
  cycleContext: CycleContextSnapshot;
}): JsonRecord {
  const record = toObject(input.selectionMetadata) ?? {};
  const existingReceipt = extractSessionDecisionReceipt(record);

  return {
    ...record,
    sessionDecisionReceipt: buildSessionDecisionReceipt({
      cycleContext: input.cycleContext,
      targetMuscles: existingReceipt?.targetMuscles,
      lifecycleRirTarget: existingReceipt?.lifecycleRirTarget,
      lifecycleVolumeTargets: existingReceipt?.lifecycleVolume.targets,
      sorenessSuppressedMuscles: existingReceipt?.sorenessSuppressedMuscles ?? [],
      deloadDecision: existingReceipt?.deloadDecision,
      plannerDiagnostics: existingReceipt?.plannerDiagnostics,
      plannerDiagnosticsMode: "standard",
      additionalExceptions:
        existingReceipt?.exceptions.filter(
          (entry) =>
            entry.code === "optional_gap_fill" ||
            entry.code === "supplemental_deficit_session"
        ) ?? [],
      autoregulation: existingReceipt
        ? {
            wasAutoregulated: existingReceipt.readiness.wasAutoregulated,
            signalAgeHours: existingReceipt.readiness.signalAgeHours,
            fatigueScoreOverall: existingReceipt.readiness.fatigueScoreOverall,
            rationale: existingReceipt.readiness.rationale,
            intensityScaling: existingReceipt.readiness.intensityScaling,
          }
        : undefined,
    }),
  };
}
