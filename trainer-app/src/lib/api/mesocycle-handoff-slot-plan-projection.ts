import type { WorkoutPlan } from "@/lib/engine/types";
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
  SupportFloorRepairReason,
  toSessionIntent,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import {
  appendAccessory,
  applyExistingAccessorySupportFloorBumps,
  applyFinalMavTrim,
  applyFinalSupportFloorClosure,
  buildSupportAccessoryExercise,
  preserveLowerPatternPrimacy,
  rebalanceUpperSupportProjection,
  trimRedundantUpperPullSupportProjection,
} from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import {
  mapProjectedWorkoutToSlotPlan,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";

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
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
      unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
    };
  };
};

type FailedSuccessorSlotPlanProjection = {
  error: string;
  slotPlans?: ProjectedSuccessorSlotPlan[];
  diagnostics?: SuccessorSlotPlanProjection["diagnostics"];
};

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
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
      activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
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
    return { error: "MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:missing_active_mesocycle" };
  }

  const slotSequence = input.design.structure.slots;
  let projectedSlots: ProjectedSlotWorkout[] = [];
  const slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]> = {};
  const supportFloorRepairReasons: Partial<
    Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
  > = {};
  const slotSequenceEntries = buildSlotSequenceEntries(slotSequence);
  const accessoryLaneWeeklyTargets = buildAccessoryLaneWeeklyTargets(activeMesocycle);
  let accessoryLaneInsertionCount = 0;

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
    const slotProtectedCoverageMuscles = getProtectedWeekOneCoverageObligations(slotPolicy);
    const futurePrimaryProtectedMuscles = new Set(
      slotSequence.slice(index + 1).flatMap((futureSlot) =>
        getProtectedWeekOneCoverageObligations(
          resolveSessionSlotPolicy({
            sessionIntent: toSessionIntent(futureSlot.intent),
            slotId: futureSlot.slotId,
            slotSequence: {
              slots: slotSequenceEntries,
            },
          }).currentSession
        )
      )
    );
    const compatibleRepairMuscles = getProjectionRepairCompatibleMuscles(
      slotPolicy,
      currentEvaluation.unresolvedProtectedMuscles
    ).filter(
      (muscle) =>
        slotProtectedCoverageMuscles.includes(muscle) ||
        !futurePrimaryProtectedMuscles.has(muscle)
    );
    const projectionRepairMuscles = compatibleRepairMuscles;
    const preferredSupportTargetMuscles = getProjectionPreferredSupportMuscles(slotPolicy);
    const softPreferredSupportTargetMuscles = getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    const primaryPreferredTargetMuscles =
      slotPolicy?.sessionShape?.id === "lower_hinge_dominant"
        ? slotPolicy.compoundBias?.preferredPrimaryMuscles ?? []
        : [];
    const useStructuralUpperTargeting = slotPolicy?.sessionIntent === "upper";
    const composed = composeIntentSessionFromMappedContext(projectionContext.mapped, {
      intent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      roleListIncomplete: true,
      ...(projectionRepairMuscles.length > 0 ? { projectionRepairMuscles } : {}),
    });
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
          targetMuscles: preferredSupportTargetMuscles,
        }
      );
      if (!("error" in preferredSupportComposed)) {
        candidateWorkouts.push({
          workout: preferredSupportComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (softPreferredSupportTargetMuscles.length > 0) {
      const softPreferredSupportComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          targetMuscles: softPreferredSupportTargetMuscles,
        }
      );
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
          targetMuscles: primaryPreferredTargetMuscles,
        }
      );
      if (!("error" in primaryPreferredComposed)) {
        candidateWorkouts.push({
          workout: primaryPreferredComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (projectionRepairMuscles.length > 1 && !useStructuralUpperTargeting) {
      const focusedComposed = composeIntentSessionFromMappedContext(projectionContext.mapped, {
        intent: toSessionIntent(slot.intent),
        slotId: slot.slotId,
        roleListIncomplete: true,
        projectionRepairMuscles,
        targetMuscles: projectionRepairMuscles,
      });
      if (!("error" in focusedComposed)) {
        candidateWorkouts.push({
          workout: focusedComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    for (const muscle of projectionRepairMuscles) {
      const focusedSingleMuscle = composeIntentSessionFromMappedContext(projectionContext.mapped, {
        intent: toSessionIntent(slot.intent),
        slotId: slot.slotId,
        roleListIncomplete: true,
        projectionRepairMuscles: [muscle],
        targetMuscles: [muscle],
      });
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
        prioritizedProtectedMuscles: projectionRepairMuscles,
        slotPolicy,
        projectedSlots,
        activeMesocycle,
        slotSequence,
        slotId: slot.slotId,
        intent: slot.intent,
      }),
      slotPolicy,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      protectedMuscles: Array.from(
        new Set([...slotProtectedCoverageMuscles, ...projectionRepairMuscles])
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
    mergeSupportFloorRepairReasons(
      supportFloorRepairReasons,
      supportFloorBumpResult.reasons
    );
    const selectedContribution = computeWorkoutContributionByMuscle(selectedWorkout);
    const slotProtectedCoverageSatisfied = projectionRepairMuscles.every(
      (muscle) => (selectedContribution.get(muscle) ?? 0) > 0
    );
    const meaningfulUpperProtectedSupport = evaluateUpperProtectedSupportQuality({
      slotPolicy,
      contributionByMuscle: selectedContribution,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    const accessoryLaneDecision = selectAccessoryLaneInsertion({
      slotIntent: toSessionIntent(slot.intent),
      workout: selectedWorkout,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      weeklyTargetByMuscle: accessoryLaneWeeklyTargets,
      projectedEffectiveSetsByMuscle: computeProjectedWeeklyContributionByMuscle({
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
          orderIndex: selectedWorkout.mainLifts.length + selectedWorkout.accessories.length,
        })
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
      projectedContributionByMuscle: computeWorkoutContributionByMuscle(selectedWorkout),
      repairMuscles: projectionRepairMuscles,
    };
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

  const finalSupportFloorClosure = applyFinalSupportFloorClosure({
    projectedSlots,
    exerciseLibrary: projectionContext.mapped.exerciseLibrary,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
  });
  projectedSlots = finalSupportFloorClosure.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    finalSupportFloorClosure.reasons
  );
  projectedSlots = applyFinalMavTrim({
    projectedSlots,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
  });

  return {
    projectedSlots,
    slotRepairMuscles,
    supportFloorRepairReasons,
    activeMesocycle,
  };
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
  const supportFloorRepairReasons = { ...pass.supportFloorRepairReasons };
  for (const row of finalEvaluation.deficitsBelowPracticalFloor) {
    const existingReasons = supportFloorRepairReasons[row.muscle] ?? [];
    if (
      existingReasons.length > 0 &&
      existingReasons.every((reason) => reason === "existing_accessory_set_bump")
    ) {
      addSupportFloorRepairReason(
        supportFloorRepairReasons,
        row.muscle,
        "effective_weight_shortfall"
      );
      continue;
    }
    if (getWeekOneSupportFloor(row.muscle) == null || existingReasons.length > 0) {
      continue;
    }
    addSupportFloorRepairReason(
      supportFloorRepairReasons,
      row.muscle,
      row.compatibleSlotIds.length > 0 ? "capacity_blocked" : "slot_identity_blocked"
    );
  }
  const blockingDeficits = finalEvaluation.deficitsBelowPracticalFloor.filter(
    (row) => (supportFloorRepairReasons[row.muscle] ?? []).length === 0
  );
  if (blockingDeficits.length > 0) {
    return {
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:" +
        blockingDeficits.map((row) => row.muscle).join(","),
      slotPlans: pass.projectedSlots.map((projectedSlot) => projectedSlot.slotPlan),
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
      },
    };
  }

  return {
    slotPlans: pass.projectedSlots.map((projectedSlot) => projectedSlot.slotPlan),
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
    },
  };
}
