import type { WorkoutPlan } from "@/lib/engine/types";
import type { SlotPreselectionDemand } from "@/lib/engine/selection-v2";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getProjectionPreferredSupportMuscles,
  getProjectionRepairCompatibleMuscles,
  getProjectionSoftPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { composeIntentSessionFromMappedContext } from "./template-session";
import type { NextMesocycleDesign } from "./mesocycle-handoff-contract";
import type { SuccessorMesocycleProjectionSource } from "./mesocycle-handoff-projection";
import { SESSION_CAPS } from "./template-session/selection-adapter";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import { selectAccessoryLaneInsertion } from "@/lib/planning/accessory-lane";
import type { PreloadedGenerationSnapshot } from "./template-session/context-loader";
import type { MappedGenerationContext } from "./template-session/types";
import {
  applyProjectedSlotToMappedContext,
  buildSyntheticProjectionContext,
  selectBestProjectedSlotComposition,
} from "./mesocycle-handoff-slot-plan-projection.candidate-selection";
import {
  addSupportFloorRepairReason,
  buildAccessoryLaneWeeklyTargets,
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  computeWorkoutContributionByMuscle,
  evaluateProtectedWeekOneCoverage,
  evaluateUpperProtectedSupportQuality,
  mergeSupportFloorRepairReasons,
  preservesSlotIdentity,
  ProjectedSlotWorkout,
  ProtectedWeekOneCoverageEvaluation,
  roundToTenth,
  SupportFloorRepairReason,
  toSessionIntent,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import {
  appendAccessory,
  applyPostForbiddenCleanupReroute,
  applyExistingAccessorySupportFloorBumps,
  applyFinalMavTrim,
  applyFinalMinimumViableSetRedistribution,
  applyFinalSetDistributionCaps,
  applyFinalSupportFloorClosure,
  applyFinalWeeklyObligationClosure,
  buildSupportAccessoryExercise,
  preserveLowerPatternPrimacy,
  rebalanceUpperSupportProjection,
  removeForbiddenSlotPrimaryRepairExercises,
  trimRedundantUpperPullSupportProjection,
  type DistributionGuardAction,
  type ForbiddenCleanupRerouteDiagnostic,
} from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import {
  mapProjectedWorkoutToSlotPlan,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import {
  applyProgramQualityConstraints,
  evaluateProgramQualityConstraints,
  PROGRAM_QUALITY_CONSTRAINT_PRIORITY,
  PROGRAM_QUALITY_PENALTY_MODEL,
  type ProgramQualityDiagnostic,
  type ProgramQualityEvaluation,
} from "./mesocycle-handoff-slot-plan-projection.program-quality";
import {
  buildWeeklyDemandSlotAllocationDiagnostic,
  type SlotPlanPlanningRealityDiagnostic,
} from "./mesocycle-handoff-slot-plan-projection.diagnostics";
import {
  buildWeeklyMuscleObligationPlan,
  evaluateDuplicateExerciseReuse,
  evaluateWeeklyObligationPlan,
  getSlotWeeklyObligations,
  sumWeeklyHardMuscleTotals,
  type DuplicateExerciseReuseDiagnostic,
  type SlotObligationEvaluation,
  type WeeklyMuscleObligationPlan,
} from "./mesocycle-handoff-slot-plan-projection.weekly-obligations";

export {
  evaluateLowerPatternPrimacy,
  evaluateUpperProtectedSupportQuality,
  evaluateUpperSupportTypeQuality,
  preservesSlotIdentity,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
export { buildMesocycleSlotPlanSeed } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
export type {
  MesocycleSlotPlanSeed,
  MesocycleSlotPlanSeedExercise,
  ProjectedSuccessorSlotPlan,
  ProjectedSuccessorSlotPlanExercise,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";

export type SuccessorSlotPlanProjection = {
  slotPlans: ProjectedSuccessorSlotPlan[];
  diagnostics?: {
    protectedCoverage: {
      beforeRepair: ProtectedWeekOneCoverageEvaluation;
      afterRepair: ProtectedWeekOneCoverageEvaluation;
      attemptedRepair: boolean;
      repairedSlotIds: string[];
      slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]>;
      supportFloorRepairReasons: Partial<
        Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
      >;
      unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
    };
    weeklyObligations?: {
      plan: WeeklyMuscleObligationPlan;
      slotEvaluations: SlotObligationEvaluation[];
      zeroContributionSlots: SlotObligationEvaluation[];
      weeklyHardMuscleTotals: Record<string, number>;
    };
    preselectionDemands?: SlotPreselectionDemandDiagnostic[];
    duplicateExerciseReuse?: DuplicateExerciseReuseDiagnostic[];
    programQuality?: {
      constraintPriority: typeof PROGRAM_QUALITY_CONSTRAINT_PRIORITY;
      penaltyModel: typeof PROGRAM_QUALITY_PENALTY_MODEL;
      appliedDiagnostics: ProgramQualityDiagnostic[];
      evaluation: ProgramQualityEvaluation;
    };
    planningReality?: SlotPlanPlanningRealityDiagnostic;
  };
};

export type SlotPreselectionDemandDiagnostic = SlotPreselectionDemand & {
  selectedEffectiveSets: number;
  consumedBySelection: boolean;
  targetMet: boolean;
};

type FailedSuccessorSlotPlanProjection = {
  error: string;
  slotPlans?: ProjectedSuccessorSlotPlan[];
  diagnostics?: SuccessorSlotPlanProjection["diagnostics"];
};

function mergeForbiddenCleanupRerouteDiagnostics(
  existing: ForbiddenCleanupRerouteDiagnostic | undefined,
  next: ForbiddenCleanupRerouteDiagnostic,
): ForbiddenCleanupRerouteDiagnostic | undefined {
  if (
    next.removedExercises.length === 0 &&
    next.reroutedDemand.length === 0 &&
    next.unresolvedDemand.length === 0
  ) {
    return existing;
  }

  return {
    removedExercises: [
      ...(existing?.removedExercises ?? []),
      ...next.removedExercises,
    ],
    reroutedDemand: [...(existing?.reroutedDemand ?? []), ...next.reroutedDemand],
    unresolvedDemand: [
      ...(existing?.unresolvedDemand ?? []),
      ...next.unresolvedDemand,
    ],
  };
}

function projectSlotPlansPass(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  snapshot: PreloadedGenerationSnapshot;
  projectionNow: Date;
}):
  | {
      projectedSlots: ProjectedSlotWorkout[];
      slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]>;
      supportFloorRepairReasons: Partial<
        Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
      >;
      activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
      weeklyObligationPlan: WeeklyMuscleObligationPlan;
      exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
      programQualityAppliedDiagnostics: ProgramQualityDiagnostic[];
      initialProjectedSlots: ProjectedSlotWorkout[];
      preselectionDemandDiagnostics: SlotPreselectionDemandDiagnostic[];
      distributionGuardActions: DistributionGuardAction[];
      forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
    }
  | { error: string } {
  const projectionContext = buildSyntheticProjectionContext({
    userId: input.userId,
    source: input.source,
    design: input.design,
    snapshot: input.snapshot,
    now: input.projectionNow,
  });
  const activeMesocycle = projectionContext.mapped.activeMesocycle;
  if (!activeMesocycle) {
    return {
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:missing_active_mesocycle",
    };
  }

  const slotSequence = input.design.structure.slots;
  let projectedSlots: ProjectedSlotWorkout[] = [];
  const slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]> =
    {};
  const supportFloorRepairReasons: Partial<
    Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
  > = {};
  const slotSequenceEntries = buildSlotSequenceEntries(slotSequence);
  const accessoryLaneWeeklyTargets =
    buildAccessoryLaneWeeklyTargets(activeMesocycle);
  const weeklyObligationPlan = buildWeeklyMuscleObligationPlan({
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
  });
  let accessoryLaneInsertionCount = 0;
  const programQualityAppliedDiagnostics: ProgramQualityDiagnostic[] = [];
  const preselectionDemandDiagnostics: SlotPreselectionDemandDiagnostic[] = [];
  const distributionGuardActions: DistributionGuardAction[] = [];
  let forbiddenCleanupReroute: ForbiddenCleanupRerouteDiagnostic | undefined;

  for (const [index, slot] of slotSequence.entries()) {
    if (slot.intent === "BODY_PART") {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot ${slot.slotId} requires target muscles for deterministic projection.`,
      };
    }

    const currentEvaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots,
      activeMesocycle,
      slotSequence,
    });
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: {
        slots: slotSequenceEntries,
      },
    }).currentSession;
    const slotProtectedCoverageMuscles =
      getProtectedWeekOneCoverageObligations(slotPolicy);
    const futurePrimaryProtectedMuscles = new Set(
      slotSequence.slice(index + 1).flatMap((futureSlot) =>
        getProtectedWeekOneCoverageObligations(
          resolveSessionSlotPolicy({
            sessionIntent: toSessionIntent(futureSlot.intent),
            slotId: futureSlot.slotId,
            slotSequence: {
              slots: slotSequenceEntries,
            },
          }).currentSession,
        ),
      ),
    );
    const compatibleRepairMuscles = getProjectionRepairCompatibleMuscles(
      slotPolicy,
      currentEvaluation.unresolvedProtectedMuscles,
    ).filter(
      (muscle) =>
        slotProtectedCoverageMuscles.includes(muscle) ||
        !futurePrimaryProtectedMuscles.has(muscle),
    );
    const slotWeeklyObligations = getSlotWeeklyObligations({
      plan: weeklyObligationPlan,
      slotId: slot.slotId,
    });
    const projectionRepairMuscles = Array.from(
      new Set([
        ...compatibleRepairMuscles,
        ...slotWeeklyObligations.map((obligation) => obligation.muscle),
      ]),
    ).filter((muscle) =>
      getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]).includes(
        muscle,
      ),
    );
    const obligationTargetMuscles = slotWeeklyObligations.map(
      (obligation) => obligation.muscle,
    );
    const slotPreselectionDemands = buildSlotPreselectionDemands({
      slotId: slot.slotId,
      slotPolicy,
      slotWeeklyObligations,
    });
    const prioritizedPreselectionMuscles = Array.from(
      new Set([
        ...projectionRepairMuscles,
        ...slotPreselectionDemands.map((demand) => demand.muscle),
      ]),
    ) as ProtectedWeekOneCoverageMuscle[];
    const preferredSupportTargetMuscles =
      getProjectionPreferredSupportMuscles(slotPolicy);
    const softPreferredSupportTargetMuscles =
      getProjectionSoftPreferredSupportMuscles({
        slot: slotPolicy,
        protectedMuscles: slotProtectedCoverageMuscles,
      });
    const primaryPreferredTargetMuscles =
      slotPolicy?.sessionShape?.id === "lower_hinge_dominant"
        ? (slotPolicy.compoundBias?.preferredPrimaryMuscles ?? [])
        : [];
    const useStructuralUpperTargeting = slotPolicy?.sessionIntent === "upper";
    const composed = composeIntentSessionFromMappedContext(
      projectionContext.mapped,
      {
        intent: toSessionIntent(slot.intent),
        slotId: slot.slotId,
        roleListIncomplete: true,
        ...(projectionRepairMuscles.length > 0
          ? { projectionRepairMuscles }
          : {}),
        ...(slotPreselectionDemands.length > 0
          ? { slotPreselectionDemands }
          : {}),
      },
    );
    if ("error" in composed) {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:${slot.slotId}:${composed.error}`,
      };
    }
    const candidateWorkouts: Array<{
      workout: WorkoutPlan;
      protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
    }> = [
      {
        workout: composed.generation.workout,
        protectedMuscles: projectionRepairMuscles,
      },
    ];
    if (preferredSupportTargetMuscles.length > 0) {
      const preferredSupportComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: preferredSupportTargetMuscles,
        },
      );
      if (!("error" in preferredSupportComposed)) {
        candidateWorkouts.push({
          workout: preferredSupportComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (obligationTargetMuscles.length > 0) {
      const obligationComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          projectionRepairMuscles,
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: obligationTargetMuscles,
        },
      );
      if (!("error" in obligationComposed)) {
        candidateWorkouts.push({
          workout: obligationComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (softPreferredSupportTargetMuscles.length > 0) {
      const softPreferredSupportComposed =
        composeIntentSessionFromMappedContext(projectionContext.mapped, {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: softPreferredSupportTargetMuscles,
        });
      if (!("error" in softPreferredSupportComposed)) {
        candidateWorkouts.push({
          workout: softPreferredSupportComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (primaryPreferredTargetMuscles.length > 0) {
      const primaryPreferredComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: primaryPreferredTargetMuscles,
        },
      );
      if (!("error" in primaryPreferredComposed)) {
        candidateWorkouts.push({
          workout: primaryPreferredComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    for (const demand of slotPreselectionDemands) {
      const preselectionComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          projectionRepairMuscles: [demand.muscle],
          slotPreselectionDemands,
          targetMuscles: [demand.muscle],
        },
      );
      if (!("error" in preselectionComposed)) {
        candidateWorkouts.push({
          workout: preselectionComposed.generation.workout,
          protectedMuscles: [demand.muscle as ProtectedWeekOneCoverageMuscle],
        });
      }
    }
    if (projectionRepairMuscles.length > 1 && !useStructuralUpperTargeting) {
      const focusedComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          projectionRepairMuscles,
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: projectionRepairMuscles,
        },
      );
      if (!("error" in focusedComposed)) {
        candidateWorkouts.push({
          workout: focusedComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    for (const muscle of projectionRepairMuscles) {
      const focusedSingleMuscle = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          projectionRepairMuscles: [muscle],
          ...(slotPreselectionDemands.length > 0
            ? { slotPreselectionDemands }
            : {}),
          targetMuscles: [muscle],
        },
      );
      if (!("error" in focusedSingleMuscle)) {
        candidateWorkouts.push({
          workout: focusedSingleMuscle.generation.workout,
          protectedMuscles: [muscle],
        });
      }
    }
    let selectedWorkout = rebalanceUpperSupportProjection({
      workout: selectBestProjectedSlotComposition({
        candidateWorkouts,
        prioritizedProtectedMuscles: prioritizedPreselectionMuscles,
        slotPolicy,
        projectedSlots,
        activeMesocycle,
        slotSequence,
        slotId: slot.slotId,
        intent: slot.intent,
        weeklyObligationPlan,
        exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      }),
      slotPolicy,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      protectedMuscles: Array.from(
        new Set([
          ...slotProtectedCoverageMuscles,
          ...prioritizedPreselectionMuscles,
        ]),
      ),
    });
    selectedWorkout = trimRedundantUpperPullSupportProjection({
      workout: selectedWorkout,
      slotPolicy,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    selectedWorkout = preserveLowerPatternPrimacy({
      workout: selectedWorkout,
      slotPolicy,
    });
    const supportFloorBumpResult = applyExistingAccessorySupportFloorBumps({
      workout: selectedWorkout,
      slotPolicy,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      projectedSlots,
      activeMesocycle,
      slotSequence,
    });
    selectedWorkout = supportFloorBumpResult.workout;
    selectedWorkout = applySlotPreselectionDemandSetBumps({
      workout: selectedWorkout,
      demands: slotPreselectionDemands,
    });
    mergeSupportFloorRepairReasons(
      supportFloorRepairReasons,
      supportFloorBumpResult.reasons,
    );
    distributionGuardActions.push(
      ...supportFloorBumpResult.distributionGuardActions,
    );
    const selectedContribution =
      computeWorkoutContributionByMuscle(selectedWorkout);
    const slotProtectedCoverageSatisfied = projectionRepairMuscles.every(
      (muscle) => (selectedContribution.get(muscle) ?? 0) > 0,
    );
    const meaningfulUpperProtectedSupport =
      evaluateUpperProtectedSupportQuality({
        slotPolicy,
        contributionByMuscle: selectedContribution,
        protectedMuscles: slotProtectedCoverageMuscles,
      });
    const accessoryLaneDecision = selectAccessoryLaneInsertion({
      slotIntent: toSessionIntent(slot.intent),
      workout: selectedWorkout,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      weeklyTargetByMuscle: accessoryLaneWeeklyTargets,
      projectedEffectiveSetsByMuscle:
        computeProjectedWeeklyContributionByMuscle({
          projectedSlots,
          currentSlotContribution: selectedContribution,
        }),
      maxExercises: SESSION_CAPS.maxExercises,
      weeklyInsertionCount: accessoryLaneInsertionCount,
      slotInsertionCount: 0,
      slotQualityPreserved:
        (meaningfulUpperProtectedSupport.isRelevant
          ? meaningfulUpperProtectedSupport.satisfied
          : slotProtectedCoverageSatisfied) &&
        preservesSlotIdentity({ slotPolicy, workout: selectedWorkout }),
    });
    if (accessoryLaneDecision.insert) {
      const candidateWorkout = appendAccessory(
        selectedWorkout,
        buildSupportAccessoryExercise({
          exercise: accessoryLaneDecision.insertion.exercise,
          template: selectedWorkout.accessories.at(-1),
          orderIndex:
            selectedWorkout.mainLifts.length +
            selectedWorkout.accessories.length,
        }),
      );
      if (preservesSlotIdentity({ slotPolicy, workout: candidateWorkout })) {
        selectedWorkout = candidateWorkout;
        accessoryLaneInsertionCount += 1;
      }
    }

    const candidateProjectedSlot: ProjectedSlotWorkout = {
      slotPlan: mapProjectedWorkoutToSlotPlan({
        slotId: slot.slotId,
        intent: slot.intent,
        workout: selectedWorkout,
      }),
      workout: selectedWorkout,
      projectedContributionByMuscle:
        computeWorkoutContributionByMuscle(selectedWorkout),
      repairMuscles: projectionRepairMuscles,
    };
    preselectionDemandDiagnostics.push(
      ...buildSlotPreselectionDemandDiagnostics({
        demands: slotPreselectionDemands,
        contributionByMuscle:
          candidateProjectedSlot.projectedContributionByMuscle,
      }),
    );
    projectedSlots.push(candidateProjectedSlot);
    if (slotProtectedCoverageMuscles.length > 0) {
      slotRepairMuscles[slot.slotId] = slotProtectedCoverageMuscles;
    }
    applyProjectedSlotToMappedContext({
      context: projectionContext,
      workout: candidateProjectedSlot.workout,
      slotPlan: candidateProjectedSlot.slotPlan,
      sessionNumber: index + 1,
      projectedAt: new Date(input.projectionNow.getTime() + index * 60_000),
    });
  }

  const initialProjectedSlots =
    cloneProjectedSlotsForDiagnostics(projectedSlots);

  const initialProgramQualityPass = applyProgramQualityConstraints({
    projectedSlots,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    weeklyObligationPlan,
    slotSequenceEntries,
  });
  projectedSlots = initialProgramQualityPass.projectedSlots;
  programQualityAppliedDiagnostics.push(
    ...initialProgramQualityPass.appliedDiagnostics,
  );

  const initialForbiddenSlotRepairCleanup =
    removeForbiddenSlotPrimaryRepairExercises({
      projectedSlots,
      slotSequenceEntries,
    });
  projectedSlots = initialForbiddenSlotRepairCleanup.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    initialForbiddenSlotRepairCleanup.reasons,
  );

  projectedSlots = applyFinalSetDistributionCaps({
    projectedSlots,
    slotSequenceEntries,
  });
  if (initialForbiddenSlotRepairCleanup.removedExercises.length > 0) {
    const initialForbiddenCleanupReroute = applyPostForbiddenCleanupReroute({
      projectedSlots,
      weeklyObligationPlan,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      slotSequenceEntries,
      removedExercises: initialForbiddenSlotRepairCleanup.removedExercises,
    });
    projectedSlots = initialForbiddenCleanupReroute.projectedSlots;
    forbiddenCleanupReroute = mergeForbiddenCleanupRerouteDiagnostics(
      forbiddenCleanupReroute,
      initialForbiddenCleanupReroute.diagnostic,
    );
  } else {
    projectedSlots = applyFinalWeeklyObligationClosure({
      projectedSlots,
      weeklyObligationPlan,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      slotSequenceEntries,
      distributionGuardActions,
    });
  }
  projectedSlots = applyFinalSetDistributionCaps({
    projectedSlots,
    slotSequenceEntries,
  });
  const satisfiedPreselectionMuscles = getSatisfiedPreselectionMuscles(
    preselectionDemandDiagnostics,
  );
  const finalSupportFloorClosure = applyFinalSupportFloorClosure({
    projectedSlots,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
    satisfiedPreselectionMuscles,
  });
  projectedSlots = finalSupportFloorClosure.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    finalSupportFloorClosure.reasons,
  );
  distributionGuardActions.push(
    ...finalSupportFloorClosure.distributionGuardActions,
  );
  projectedSlots = applyFinalMinimumViableSetRedistribution({
    projectedSlots,
    slotSequenceEntries,
  });
  projectedSlots = applyFinalWeeklyObligationClosure({
    projectedSlots,
    weeklyObligationPlan,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    slotSequenceEntries,
    distributionGuardActions,
  });
  projectedSlots = applyFinalSetDistributionCaps({
    projectedSlots,
    slotSequenceEntries,
  });
  const postObligationSupportFloorClosure = applyFinalSupportFloorClosure({
    projectedSlots,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
    satisfiedPreselectionMuscles,
  });
  projectedSlots = postObligationSupportFloorClosure.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    postObligationSupportFloorClosure.reasons,
  );
  distributionGuardActions.push(
    ...postObligationSupportFloorClosure.distributionGuardActions,
  );
  const finalProgramQualityPass = applyProgramQualityConstraints({
    projectedSlots,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    weeklyObligationPlan,
    slotSequenceEntries,
  });
  projectedSlots = finalProgramQualityPass.projectedSlots;
  programQualityAppliedDiagnostics.push(
    ...finalProgramQualityPass.appliedDiagnostics,
  );
  projectedSlots = applyFinalMavTrim({
    projectedSlots,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
  });
  const forbiddenSlotRepairCleanup = removeForbiddenSlotPrimaryRepairExercises({
    projectedSlots,
    slotSequenceEntries,
  });
  projectedSlots = forbiddenSlotRepairCleanup.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    forbiddenSlotRepairCleanup.reasons,
  );
  if (forbiddenSlotRepairCleanup.removedExercises.length > 0) {
    const postForbiddenCleanupReroute = applyPostForbiddenCleanupReroute({
      projectedSlots,
      weeklyObligationPlan,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      slotSequenceEntries,
      removedExercises: forbiddenSlotRepairCleanup.removedExercises,
    });
    projectedSlots = postForbiddenCleanupReroute.projectedSlots;
    forbiddenCleanupReroute = mergeForbiddenCleanupRerouteDiagnostics(
      forbiddenCleanupReroute,
      postForbiddenCleanupReroute.diagnostic,
    );
  } else {
    projectedSlots = applyFinalWeeklyObligationClosure({
      projectedSlots,
      weeklyObligationPlan,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      slotSequenceEntries,
      distributionGuardActions,
    });
  }
  const postForbiddenObligationCleanup =
    removeForbiddenSlotPrimaryRepairExercises({
      projectedSlots,
      slotSequenceEntries,
    });
  projectedSlots = postForbiddenObligationCleanup.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    postForbiddenObligationCleanup.reasons,
  );
  forbiddenCleanupReroute = mergeForbiddenCleanupRerouteDiagnostics(
    forbiddenCleanupReroute,
    {
      removedExercises: postForbiddenObligationCleanup.removedExercises,
      reroutedDemand: [],
      unresolvedDemand: [],
    },
  );

  return {
    projectedSlots,
    slotRepairMuscles,
    supportFloorRepairReasons,
    activeMesocycle,
    weeklyObligationPlan,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    programQualityAppliedDiagnostics,
    initialProjectedSlots,
    preselectionDemandDiagnostics,
    distributionGuardActions,
    ...(forbiddenCleanupReroute ? { forbiddenCleanupReroute } : {}),
  };
}

const PRESELECTION_ACCESSORY_SET_CAP = 4;
const SOFT_SUPPORT_PRESELECTION_EFFECTIVE_SET_FLOOR = 2;

function appendWorkingSet(
  exercise: ProjectedSlotWorkout["workout"]["accessories"][number],
): ProjectedSlotWorkout["workout"]["accessories"][number] {
  const lastSet = exercise.sets.at(-1);
  return {
    ...exercise,
    sets: [
      ...exercise.sets,
      {
        ...(lastSet ?? { targetReps: 10, role: "accessory" as const }),
        setIndex: exercise.sets.length + 1,
      },
    ],
  };
}

function applySlotPreselectionDemandSetBumps(input: {
  workout: WorkoutPlan;
  demands: ReadonlyArray<SlotPreselectionDemand>;
}): WorkoutPlan {
  if (input.demands.length === 0) {
    return input.workout;
  }

  let workout = input.workout;
  for (const demand of input.demands) {
    if (
      demand.role !== "primary" &&
      !(
        (demand.muscle === "Side Delts" || demand.muscle === "Rear Delts") &&
        demand.targetStatus === "soft"
      )
    ) {
      continue;
    }
    const target =
      demand.preferredEffectiveSets ?? demand.minEffectiveSets ?? 0;
    if (target <= 0) {
      continue;
    }
    let contribution =
      computeWorkoutContributionByMuscle(workout).get(demand.muscle) ?? 0;
    if (contribution >= target) {
      continue;
    }

    const accessoryIndex = workout.accessories.findIndex(
      (exercise) =>
        (exercise.exercise.primaryMuscles ?? []).includes(demand.muscle) &&
        exercise.sets.length < PRESELECTION_ACCESSORY_SET_CAP,
    );
    if (accessoryIndex < 0) {
      continue;
    }

    const accessories = workout.accessories.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set })),
    }));
    const exercise = accessories[accessoryIndex];
    const effectivePerSet =
      getEffectiveStimulusByMuscle(exercise.exercise, 1).get(demand.muscle) ??
      0;
    if (effectivePerSet <= 0) {
      continue;
    }

    while (
      contribution < target &&
      accessories[accessoryIndex].sets.length < PRESELECTION_ACCESSORY_SET_CAP
    ) {
      accessories[accessoryIndex] = appendWorkingSet(
        accessories[accessoryIndex],
      );
      contribution += effectivePerSet;
    }

    workout = {
      ...workout,
      accessories,
    };
  }

  return workout;
}

function upsertSlotPreselectionDemand(
  demands: SlotPreselectionDemand[],
  demand: SlotPreselectionDemand,
): void {
  const existing = demands.find(
    (row) => row.slotId === demand.slotId && row.muscle === demand.muscle,
  );
  if (!existing) {
    demands.push(demand);
    return;
  }

  const existingRank = existing.role === "primary" ? 0 : 1;
  const incomingRank = demand.role === "primary" ? 0 : 1;
  if (incomingRank < existingRank) {
    existing.role = demand.role;
  }
  if (demand.targetStatus === "hard") {
    existing.targetStatus = "hard";
  }
  existing.minEffectiveSets =
    existing.minEffectiveSets == null
      ? demand.minEffectiveSets
      : demand.minEffectiveSets == null
        ? existing.minEffectiveSets
        : Math.max(existing.minEffectiveSets, demand.minEffectiveSets);
  existing.preferredEffectiveSets =
    existing.preferredEffectiveSets == null
      ? demand.preferredEffectiveSets
      : demand.preferredEffectiveSets == null
        ? existing.preferredEffectiveSets
        : Math.max(
            existing.preferredEffectiveSets,
            demand.preferredEffectiveSets,
          );
  if (
    existing.source !== "weekly_obligation" &&
    demand.source === "weekly_obligation"
  ) {
    existing.source = demand.source;
  }
}

function buildSlotPreselectionDemands(input: {
  slotId: string;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  slotWeeklyObligations: ReturnType<typeof getSlotWeeklyObligations>;
}): SlotPreselectionDemand[] {
  const demands: SlotPreselectionDemand[] = [];
  const appendIfCompatible = (demand: SlotPreselectionDemand) => {
    if (
      !getProjectionRepairCompatibleMuscles(input.slotPolicy, [
        demand.muscle,
      ]).includes(demand.muscle as ProtectedWeekOneCoverageMuscle)
    ) {
      return;
    }
    upsertSlotPreselectionDemand(demands, demand);
  };
  const weeklyObligationMuscles = new Set<string>(
    input.slotWeeklyObligations.map((obligation) => obligation.muscle),
  );

  if (!input.slotPolicy?.slotArchetype?.startsWith("upper_")) {
    return demands.sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.muscle.localeCompare(right.muscle),
    );
  }

  for (const muscle of getProtectedWeekOneCoverageObligations(
    input.slotPolicy,
  )) {
    if (muscle !== "Side Delts") {
      continue;
    }
    if (weeklyObligationMuscles.has(muscle)) {
      continue;
    }
    const supportFloor = getWeekOneSupportFloor(muscle);
    if (supportFloor == null) {
      continue;
    }
    appendIfCompatible({
      slotId: input.slotId,
      muscle,
      role: "support",
      targetStatus: "soft",
      minEffectiveSets: Math.min(
        supportFloor,
        SOFT_SUPPORT_PRESELECTION_EFFECTIVE_SET_FLOOR,
      ),
      preferredEffectiveSets: Math.min(
        supportFloor,
        SOFT_SUPPORT_PRESELECTION_EFFECTIVE_SET_FLOOR,
      ),
      source: "authored_slot_support",
    });
  }

  return demands.sort(
    (left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle),
  );
}

function getSatisfiedPreselectionMuscles(
  diagnostics: ReadonlyArray<SlotPreselectionDemandDiagnostic>,
): ProtectedWeekOneCoverageMuscle[] {
  return Array.from(
    new Set(
      diagnostics
        .filter(
          (demand) =>
            demand.source === "authored_slot_support" &&
            demand.targetStatus === "soft" &&
            demand.targetMet,
        )
        .map((demand) => demand.muscle as ProtectedWeekOneCoverageMuscle),
    ),
  );
}

function buildSlotPreselectionDemandDiagnostics(input: {
  demands: ReadonlyArray<SlotPreselectionDemand>;
  contributionByMuscle: ReadonlyMap<string, number>;
}): SlotPreselectionDemandDiagnostic[] {
  return input.demands.map((demand) => {
    const selectedEffectiveSets = roundToTenth(
      input.contributionByMuscle.get(demand.muscle) ?? 0,
    );
    const target =
      demand.minEffectiveSets ?? demand.preferredEffectiveSets ?? 0;
    return {
      ...demand,
      selectedEffectiveSets,
      consumedBySelection: selectedEffectiveSets > 0,
      targetMet:
        target > 0
          ? selectedEffectiveSets >= target
          : selectedEffectiveSets > 0,
    };
  });
}

function cloneProjectedSlotsForDiagnostics(
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>,
): ProjectedSlotWorkout[] {
  return projectedSlots.map((projectedSlot) => ({
    ...projectedSlot,
    slotPlan: {
      ...projectedSlot.slotPlan,
      exercises: projectedSlot.slotPlan.exercises.map((exercise) => ({
        ...exercise,
      })),
    },
    workout: {
      ...projectedSlot.workout,
      warmup: projectedSlot.workout.warmup.map(
        cloneWorkoutExerciseForDiagnostics,
      ),
      mainLifts: projectedSlot.workout.mainLifts.map(
        cloneWorkoutExerciseForDiagnostics,
      ),
      accessories: projectedSlot.workout.accessories.map(
        cloneWorkoutExerciseForDiagnostics,
      ),
    },
    projectedContributionByMuscle: new Map(
      projectedSlot.projectedContributionByMuscle,
    ),
    repairMuscles: [...projectedSlot.repairMuscles],
  }));
}

function cloneWorkoutExerciseForDiagnostics(
  exercise: ProjectedSlotWorkout["workout"]["mainLifts"][number],
): ProjectedSlotWorkout["workout"]["mainLifts"][number] {
  return {
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set })),
    ...(exercise.warmupSets
      ? { warmupSets: exercise.warmupSets.map((set) => ({ ...set })) }
      : {}),
  };
}

function collectDuplicateExerciseReuseDiagnostics(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
}): DuplicateExerciseReuseDiagnostic[] {
  const diagnostics: DuplicateExerciseReuseDiagnostic[] = [];
  const previousSlots: ProjectedSlotWorkout[] = [];

  for (const projectedSlot of input.projectedSlots) {
    diagnostics.push(
      ...evaluateDuplicateExerciseReuse({
        projectedSlots: previousSlots,
        workout: projectedSlot.workout,
        slotId: projectedSlot.slotPlan.slotId,
        exerciseLibrary: input.exerciseLibrary,
      }).diagnostics,
    );
    previousSlots.push(projectedSlot);
  }

  return diagnostics;
}

function getProgramQualityDiagnosticKey(
  diagnostic: ProgramQualityDiagnostic,
): string {
  return [
    diagnostic.constraint,
    diagnostic.slotId ?? "",
    diagnostic.exerciseId ?? "",
    diagnostic.muscle ?? "",
  ].join(":");
}

function filterStaleBlockedProgramQualityDiagnostics(input: {
  appliedDiagnostics: ProgramQualityDiagnostic[];
  evaluation: ProgramQualityEvaluation;
}): ProgramQualityDiagnostic[] {
  const unresolvedKeys = new Set(
    input.evaluation.diagnostics.map((diagnostic) =>
      getProgramQualityDiagnosticKey(diagnostic),
    ),
  );
  const seenBlockedKeys = new Set<string>();
  return input.appliedDiagnostics.filter((diagnostic) => {
    if (diagnostic.reason !== "redistribution_blocked_stacking_allowed") {
      return true;
    }
    const key = [
      getProgramQualityDiagnosticKey(diagnostic),
      diagnostic.reason,
      diagnostic.blockReason ?? "",
    ].join(":");
    if (
      !unresolvedKeys.has(getProgramQualityDiagnosticKey(diagnostic)) ||
      seenBlockedKeys.has(key)
    ) {
      return false;
    }
    seenBlockedKeys.add(key);
    return true;
  });
}

export function projectSuccessorSlotPlansFromSnapshot(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  snapshot: PreloadedGenerationSnapshot;
  now?: Date;
}): SuccessorSlotPlanProjection | FailedSuccessorSlotPlanProjection {
  const projectionNow = input.now ?? new Date();
  const pass = projectSlotPlansPass({
    userId: input.userId,
    source: input.source,
    design: input.design,
    snapshot: input.snapshot,
    projectionNow,
  });
  if ("error" in pass) {
    return pass;
  }

  const finalEvaluation = evaluateProtectedWeekOneCoverage({
    projectedSlots: pass.projectedSlots,
    activeMesocycle: pass.activeMesocycle,
    slotSequence: input.design.structure.slots,
  });
  const weeklyObligationEvaluations = evaluateWeeklyObligationPlan({
    plan: pass.weeklyObligationPlan,
    projectedSlots: pass.projectedSlots,
  });
  const weeklyObligationDiagnostics = {
    plan: pass.weeklyObligationPlan,
    slotEvaluations: weeklyObligationEvaluations,
    zeroContributionSlots: weeklyObligationEvaluations.filter(
      (row) => row.zeroContribution,
    ),
    weeklyHardMuscleTotals: sumWeeklyHardMuscleTotals({
      projectedSlots: pass.projectedSlots,
    }),
  };
  const duplicateExerciseReuse = collectDuplicateExerciseReuseDiagnostics({
    projectedSlots: pass.projectedSlots,
    exerciseLibrary: pass.exerciseLibrary,
  });
  const programQualityEvaluation = evaluateProgramQualityConstraints({
    projectedSlots: pass.projectedSlots,
    exerciseLibrary: pass.exerciseLibrary,
  });
  const programQuality = {
    constraintPriority: PROGRAM_QUALITY_CONSTRAINT_PRIORITY,
    penaltyModel: PROGRAM_QUALITY_PENALTY_MODEL,
    appliedDiagnostics: filterStaleBlockedProgramQualityDiagnostics({
      appliedDiagnostics: pass.programQualityAppliedDiagnostics,
      evaluation: programQualityEvaluation,
    }),
    evaluation: programQualityEvaluation,
  };
  const supportFloorRepairReasons = { ...pass.supportFloorRepairReasons };
  for (const row of finalEvaluation.deficitsBelowPracticalFloor) {
    const existingReasons = supportFloorRepairReasons[row.muscle] ?? [];
    if (
      existingReasons.length > 0 &&
      existingReasons.every(
        (reason) => reason === "existing_accessory_set_bump",
      )
    ) {
      addSupportFloorRepairReason(
        supportFloorRepairReasons,
        row.muscle,
        "effective_weight_shortfall",
      );
      continue;
    }
    if (
      getWeekOneSupportFloor(row.muscle) == null ||
      existingReasons.length > 0
    ) {
      continue;
    }
    addSupportFloorRepairReason(
      supportFloorRepairReasons,
      row.muscle,
      row.compatibleSlotIds.length > 0
        ? "capacity_blocked"
        : "slot_identity_blocked",
    );
  }
  const blockingDeficits = finalEvaluation.deficitsBelowPracticalFloor.filter(
    (row) => (supportFloorRepairReasons[row.muscle] ?? []).length === 0,
  );
  const planningReality = buildWeeklyDemandSlotAllocationDiagnostic({
    activeMesocycle: pass.activeMesocycle,
    slotSequence: input.design.structure.slots,
    initialProjectedSlots: pass.initialProjectedSlots,
    finalProjectedSlots: pass.projectedSlots,
    weeklyObligationPlan: pass.weeklyObligationPlan,
    weeklyObligationEvaluations,
    protectedCoverage: finalEvaluation,
    supportFloorRepairReasons,
    programQualityAppliedDiagnostics: programQuality.appliedDiagnostics,
    programQualityEvaluation,
    preselectionDemands: pass.preselectionDemandDiagnostics,
    distributionGuardActions: pass.distributionGuardActions,
    forbiddenCleanupReroute: pass.forbiddenCleanupReroute,
  });
  if (blockingDeficits.length > 0) {
    return {
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:" +
        blockingDeficits.map((row) => row.muscle).join(","),
      slotPlans: pass.projectedSlots.map(
        (projectedSlot) => projectedSlot.slotPlan,
      ),
      diagnostics: {
        protectedCoverage: {
          beforeRepair: finalEvaluation,
          afterRepair: finalEvaluation,
          attemptedRepair: false,
          repairedSlotIds: [],
          slotRepairMuscles: pass.slotRepairMuscles,
          supportFloorRepairReasons,
          unresolvedProtectedMuscles: blockingDeficits.map((row) => row.muscle),
        },
        weeklyObligations: weeklyObligationDiagnostics,
        preselectionDemands: pass.preselectionDemandDiagnostics,
        duplicateExerciseReuse,
        programQuality,
        planningReality,
      },
    };
  }

  return {
    slotPlans: pass.projectedSlots.map(
      (projectedSlot) => projectedSlot.slotPlan,
    ),
    diagnostics: {
      protectedCoverage: {
        beforeRepair: finalEvaluation,
        afterRepair: finalEvaluation,
        attemptedRepair: false,
        repairedSlotIds: [],
        slotRepairMuscles: pass.slotRepairMuscles,
        supportFloorRepairReasons,
        unresolvedProtectedMuscles: finalEvaluation.unresolvedProtectedMuscles,
      },
      weeklyObligations: weeklyObligationDiagnostics,
      preselectionDemands: pass.preselectionDemandDiagnostics,
      duplicateExerciseReuse,
      programQuality,
      planningReality,
    },
  };
}
