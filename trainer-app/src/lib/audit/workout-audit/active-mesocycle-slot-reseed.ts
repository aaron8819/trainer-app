import type { WorkoutSessionIntent } from "@prisma/client";
import { deriveCurrentMesocycleSession } from "@/lib/api/mesocycle-lifecycle";
import {
  buildMesocycleSlotPlanSeed,
  type MesocycleSlotPlanSeed,
  preservesSlotIdentity,
  projectSuccessorSlotPlansFromSnapshot,
} from "@/lib/api/mesocycle-handoff-slot-plan-projection";
import type { NextMesocycleDesign } from "@/lib/api/mesocycle-handoff-contract";
import type { SuccessorMesocycleProjectionSource } from "@/lib/api/mesocycle-handoff-projection";
import { buildMesocycleSlotSequence, resolveMesocycleSlotContract } from "@/lib/api/mesocycle-slot-contract";
import {
  buildMappedGenerationContextFromSnapshot,
  computeWorkoutContributionByMuscle,
  generateProjectedSession,
  loadPreloadedGenerationSnapshot,
} from "@/lib/api/projected-week-volume-shared";
import {
  readPersistedSeedSlots,
  type NormalizedSeededSlot,
} from "@/lib/api/template-session/slot-plan-seed";
import type { PreloadedGenerationSnapshot } from "@/lib/api/template-session/context-loader";
import type { MovementPatternV2, WorkoutPlan } from "@/lib/engine/types";
import {
  getProtectedWeekOneCoverageObligations,
  getProjectionPreferredSupportMuscles,
  resolveSessionSlotPolicy,
} from "@/lib/planning/session-slot-profile";
import { ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION } from "./constants";
import type {
  ActiveMesocycleSlotReseedAuditPayload,
  ActiveMesocycleSlotReseedExerciseSeedRow,
  ActiveMesocycleSlotReseedIdentityCharacterization,
  ActiveMesocycleSlotReseedMuscleDiffRow,
  ActiveMesocycleSlotReseedRecommendation,
  ActiveMesocycleSlotReseedSessionExerciseRow,
  ActiveMesocycleSlotReseedSetDiffRow,
  ActiveMesocycleSlotReseedSlotDiff,
} from "./types";

const TARGET_SLOT_IDS = ["upper_a", "upper_b"] as const;
const PUSH_SUPPORT_MUSCLES = ["Chest", "Triceps", "Side Delts"] as const;
const PULL_SUPPORT_MUSCLES = ["Lats", "Upper Back", "Rear Delts", "Biceps"] as const;

export type ActiveMesocycleSlotReseedEvaluation = {
  auditPayload: ActiveMesocycleSlotReseedAuditPayload;
  activeMesocycleId: string;
  candidateSlotPlanSeed: MesocycleSlotPlanSeed | null;
  targetSlotIds: string[];
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function toWorkoutSessionIntent(intent: string): WorkoutSessionIntent {
  return intent.toUpperCase() as WorkoutSessionIntent;
}

function buildProjectionSource(
  activeMesocycle: NonNullable<PreloadedGenerationSnapshot["activeMesocycle"]>
): SuccessorMesocycleProjectionSource {
  return {
    macroCycleId: activeMesocycle.macroCycleId,
    mesoNumber: activeMesocycle.mesoNumber,
    startWeek: activeMesocycle.startWeek,
    durationWeeks: activeMesocycle.durationWeeks,
    focus: activeMesocycle.focus,
    volumeTarget: activeMesocycle.volumeTarget,
    intensityBias: activeMesocycle.intensityBias,
    blocks: activeMesocycle.blocks.map((block) => ({
      blockNumber: block.blockNumber,
      blockType: block.blockType,
      startWeek: block.startWeek,
      durationWeeks: block.durationWeeks,
      volumeTarget: block.volumeTarget,
      intensityBias: block.intensityBias,
      adaptationType: block.adaptationType,
    })),
  };
}

function buildProjectionDesign(
  snapshot: PreloadedGenerationSnapshot,
  activeMesocycle: NonNullable<PreloadedGenerationSnapshot["activeMesocycle"]>
): NextMesocycleDesign {
  const resolvedSlots = resolveMesocycleSlotContract({
    slotSequenceJson: activeMesocycle.slotSequenceJson,
    weeklySchedule: snapshot.context.constraints?.weeklySchedule ?? [],
  }).slots;

  const slotSequence = buildMesocycleSlotSequence(
    resolvedSlots.map((slot) => ({
      slotId: slot.slotId,
      intent: toWorkoutSessionIntent(slot.intent),
      authoredSemantics: slot.authoredSemantics,
    }))
  );

  const structureSlots = slotSequence.slots.map((slot) => {
    if (!slot.authoredSemantics) {
      throw new Error(`Missing authored semantics for slot ${slot.slotId} during reseed audit.`);
    }

    return {
      slotId: slot.slotId,
      intent: slot.intent,
      authoredSemantics: slot.authoredSemantics,
    };
  });

  return {
    version: 1,
    designedAt: new Date().toISOString(),
    sourceMesocycleId: activeMesocycle.id,
    profile: {
      focus: activeMesocycle.focus,
      durationWeeks: activeMesocycle.durationWeeks,
      volumeTarget: activeMesocycle.volumeTarget,
      intensityBias: activeMesocycle.intensityBias,
      blocks: activeMesocycle.blocks.map((block) => ({
        blockNumber: block.blockNumber,
        blockType: block.blockType,
        durationWeeks: block.durationWeeks,
        volumeTarget: block.volumeTarget,
        intensityBias: block.intensityBias,
        adaptationType: block.adaptationType,
      })),
    },
    structure: {
      splitType: activeMesocycle.splitType,
      sessionsPerWeek: activeMesocycle.sessionsPerWeek,
      daysPerWeek: activeMesocycle.daysPerWeek,
      sequenceMode: "ordered_flexible",
      slots: structureSlots,
    },
    carryForward: {
      decisions: snapshot.mesocycleRoleRows.map((row) => ({
        exerciseId: row.exerciseId,
        role: row.role,
        priorIntent: row.sessionIntent as WorkoutSessionIntent,
        action: "keep" as const,
        targetIntent: row.sessionIntent as WorkoutSessionIntent,
        signalQuality: "medium" as const,
        reasonCodes: ["active_mesocycle_role_continuity_seeded_reprojection"],
      })),
    },
    startingPoint: {
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
    },
    explainability: {
      profileReasonCodes: ["active_mesocycle_profile_reused_for_dry_run"],
      profileSignalQuality: "medium",
      structureReasonCodes: ["active_mesocycle_slot_sequence_reused_for_dry_run"],
      structureSignalQuality: "medium",
      startingPointReasonCodes: ["audit_only_seed_reprojection"],
      startingPointSignalQuality: "medium",
    },
  };
}

function cloneSnapshotWithSeed(input: {
  snapshot: PreloadedGenerationSnapshot;
  slotPlanSeedJson: unknown;
}): PreloadedGenerationSnapshot {
  const activeMesocycle = input.snapshot.activeMesocycle;
  if (!activeMesocycle) {
    throw new Error("Active mesocycle required for slot reseed audit.");
  }

  return {
    ...input.snapshot,
    activeMesocycle: {
      ...activeMesocycle,
      slotPlanSeedJson: input.slotPlanSeedJson as typeof activeMesocycle.slotPlanSeedJson,
    },
    rotationContext: new Map(input.snapshot.rotationContext),
  };
}

function buildSeedExerciseRows(
  slot: Pick<NormalizedSeededSlot, "exercises">,
  exerciseNameById: Map<string, string>
): ActiveMesocycleSlotReseedExerciseSeedRow[] {
  return slot.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    exerciseName: exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
    role: exercise.role,
  }));
}

function buildSessionExerciseRows(workout: WorkoutPlan): ActiveMesocycleSlotReseedSessionExerciseRow[] {
  return [...workout.mainLifts, ...workout.accessories].map((exercise) => ({
    exerciseId: exercise.exercise.id,
    exerciseName: exercise.exercise.name,
    role: workout.mainLifts.includes(exercise) ? "CORE_COMPOUND" : "ACCESSORY",
    setCount: exercise.sets.length,
    movementPatterns: [...(exercise.exercise.movementPatterns ?? [])],
    primaryMuscles: [...(exercise.exercise.primaryMuscles ?? [])],
  }));
}

function countWorkoutSets(workout: WorkoutPlan): number {
  return [...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

function hasCompoundMovementPattern(workout: WorkoutPlan, pattern: MovementPatternV2): boolean {
  return [...workout.mainLifts, ...workout.accessories].some(
    (exercise) =>
      (exercise.exercise.isCompound ?? false) &&
      (exercise.exercise.movementPatterns ?? []).includes(pattern)
  );
}

function buildIdentityCharacterization(input: {
  workout: WorkoutPlan;
  slot: NormalizedSeededSlot;
  design: NextMesocycleDesign;
}): ActiveMesocycleSlotReseedIdentityCharacterization {
  const slotPolicy = resolveSessionSlotPolicy({
    sessionIntent: input.slot.intent,
    slotId: input.slot.slotId,
    slotSequence: {
      slots: input.design.structure.slots.map((slot, sequenceIndex) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        sequenceIndex,
        authoredSemantics: slot.authoredSemantics,
      })),
    },
  }).currentSession;

  return {
    slotArchetype: slotPolicy?.slotArchetype ?? null,
    continuityScope: slotPolicy?.continuityScope ?? null,
    requiredMovementPatterns: [...(slotPolicy?.sessionShape?.requiredMovementPatterns ?? [])],
    preferredAccessoryPrimaryMuscles: getProjectionPreferredSupportMuscles(slotPolicy),
    protectedCoverageMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
    preservesSlotIdentity: preservesSlotIdentity({
      slotPolicy,
      workout: input.workout,
    }),
    hasCompoundRow: hasCompoundMovementPattern(input.workout, "horizontal_pull"),
    hasCompoundVerticalPull: hasCompoundMovementPattern(input.workout, "vertical_pull"),
  };
}

function buildSetDiffRows(input: {
  before: WorkoutPlan;
  after: WorkoutPlan;
}): ActiveMesocycleSlotReseedSetDiffRow[] {
  const beforeByExerciseId = new Map(
    buildSessionExerciseRows(input.before).map((exercise) => [exercise.exerciseId, exercise])
  );
  const afterByExerciseId = new Map(
    buildSessionExerciseRows(input.after).map((exercise) => [exercise.exerciseId, exercise])
  );
  const allExerciseIds = Array.from(
    new Set([...beforeByExerciseId.keys(), ...afterByExerciseId.keys()])
  );

  return allExerciseIds
    .map((exerciseId) => {
      const before = beforeByExerciseId.get(exerciseId);
      const after = afterByExerciseId.get(exerciseId);
      return {
        exerciseId,
        exerciseName: after?.exerciseName ?? before?.exerciseName ?? exerciseId,
        beforeSetCount: before?.setCount ?? 0,
        afterSetCount: after?.setCount ?? 0,
        delta: (after?.setCount ?? 0) - (before?.setCount ?? 0),
      };
    })
    .sort((left, right) => right.delta - left.delta || left.exerciseName.localeCompare(right.exerciseName));
}

function buildMuscleDiffRows(input: {
  before: Record<string, number>;
  after: Record<string, number>;
}): ActiveMesocycleSlotReseedMuscleDiffRow[] {
  const muscles = Array.from(new Set([...Object.keys(input.before), ...Object.keys(input.after)]));

  return muscles
    .map((muscle) => ({
      muscle,
      before: roundToTenth(input.before[muscle] ?? 0),
      after: roundToTenth(input.after[muscle] ?? 0),
      delta: roundToTenth((input.after[muscle] ?? 0) - (input.before[muscle] ?? 0)),
    }))
    .filter((row) => row.before > 0 || row.after > 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.muscle.localeCompare(right.muscle));
}

function buildExerciseDiff(input: {
  before: ActiveMesocycleSlotReseedExerciseSeedRow[];
  after: ActiveMesocycleSlotReseedExerciseSeedRow[];
}) {
  const beforeById = new Map(input.before.map((exercise) => [exercise.exerciseId, exercise]));
  const afterById = new Map(input.after.map((exercise) => [exercise.exerciseId, exercise]));

  return {
    added: input.after.filter((exercise) => !beforeById.has(exercise.exerciseId)),
    removed: input.before.filter((exercise) => !afterById.has(exercise.exerciseId)),
    retained: input.after.filter((exercise) => beforeById.has(exercise.exerciseId)),
  };
}

function mergeContributionRecords(records: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};

  for (const record of records) {
    for (const [muscle, value] of Object.entries(record)) {
      merged[muscle] = roundToTenth((merged[muscle] ?? 0) + value);
    }
  }

  return merged;
}

function sumMuscles(rows: ActiveMesocycleSlotReseedMuscleDiffRow[], muscles: readonly string[]): number {
  const allowed = new Set(muscles);
  return roundToTenth(
    rows.reduce((sum, row) => (allowed.has(row.muscle) ? sum + row.after : sum), 0)
  );
}

function sumMuscleDelta(rows: ActiveMesocycleSlotReseedMuscleDiffRow[], muscles: readonly string[]): number {
  const allowed = new Set(muscles);
  return roundToTenth(
    rows.reduce((sum, row) => (allowed.has(row.muscle) ? sum + row.delta : sum), 0)
  );
}

function buildOvershootWarnings(input: {
  before: ActiveMesocycleSlotReseedIdentityCharacterization;
  after: ActiveMesocycleSlotReseedIdentityCharacterization;
  beforeWorkout: WorkoutPlan;
  afterWorkout: WorkoutPlan;
  aggregateMuscleDiff: ActiveMesocycleSlotReseedMuscleDiffRow[];
}): string[] {
  const warnings: string[] = [];

  if (!input.after.preservesSlotIdentity) {
    warnings.push("candidate breaks the slot-policy identity checks");
  }

  const setDelta = countWorkoutSets(input.afterWorkout) - countWorkoutSets(input.beforeWorkout);
  if (setDelta > 4) {
    warnings.push(`candidate adds ${setDelta} working sets versus the persisted seeded session`);
  }

  const estimatedMinutesDelta =
    (input.afterWorkout.estimatedMinutes ?? 0) - (input.beforeWorkout.estimatedMinutes ?? 0);
  if (estimatedMinutesDelta > 10) {
    warnings.push(`candidate adds ${estimatedMinutesDelta} estimated minutes`);
  }

  const pushGain = sumMuscleDelta(input.aggregateMuscleDiff, PUSH_SUPPORT_MUSCLES);
  const pullGain = sumMuscleDelta(input.aggregateMuscleDiff, PULL_SUPPORT_MUSCLES);
  if (pullGain > 0.5 && pullGain > pushGain) {
    warnings.push("candidate increases pull-support contribution more than push-support repair");
  }

  if (input.before.hasCompoundRow && !input.after.hasCompoundRow) {
    warnings.push("candidate loses compound row coverage");
  }
  if (input.before.hasCompoundVerticalPull && !input.after.hasCompoundVerticalPull) {
    warnings.push("candidate loses compound vertical-pull coverage");
  }

  return warnings;
}

function buildAggregateFlags(slotDiffs: ActiveMesocycleSlotReseedSlotDiff[]) {
  return {
    improvesChestSupport: slotDiffs.some((slot) => slot.flags.improvesChestSupport),
    improvesTricepsSupport: slotDiffs.some((slot) => slot.flags.improvesTricepsSupport),
    improvesSideDeltSupport: slotDiffs.some((slot) =>
      slot.muscleContributionDiff.some((row) => row.muscle === "Side Delts" && row.delta > 0)
    ),
    improvesRearDeltSupport: slotDiffs.some((slot) =>
      slot.muscleContributionDiff.some((row) => row.muscle === "Rear Delts" && row.delta > 0)
    ),
    reducesUpperSessionDuration: slotDiffs.some((slot) => (slot.estimatedMinutesDiff.delta ?? 0) < 0),
    preservesRowAndVerticalPullWhereAppropriate: slotDiffs.every(
      (slot) => slot.flags.preservesRowAndVerticalPullWhereAppropriate
    ),
    avoidsNewObviousOvershoot: slotDiffs.every((slot) => slot.flags.avoidsNewObviousOvershoot),
    preservesSlotIdentity: slotDiffs.every(
      (slot) =>
        slot.candidateSession.characterization.preservesSlotIdentity &&
        slot.persistedSession.characterization.preservesSlotIdentity
    ),
    materiallyChangesExerciseSelection: slotDiffs.some(
      (slot) => slot.exerciseDiff.added.length > 0 || slot.exerciseDiff.removed.length > 0
    ),
  };
}

function buildRecommendation(input: {
  projectionError: string | null;
  aggregateFlags: ReturnType<typeof buildAggregateFlags>;
  aggregateMuscleDiff: ActiveMesocycleSlotReseedMuscleDiffRow[];
}): {
  verdict: ActiveMesocycleSlotReseedRecommendation;
  reasons: string[];
} {
  const reasons: string[] = [];
  const improvesUpperDeltSupport =
    input.aggregateFlags.improvesSideDeltSupport &&
    input.aggregateFlags.improvesRearDeltSupport;
  const improvesUpperSessionDuration = input.aggregateFlags.reducesUpperSessionDuration;

  if (input.projectionError && !improvesUpperDeltSupport && !improvesUpperSessionDuration) {
    return {
      verdict: "needs_projection_fix_first",
      reasons: [input.projectionError],
    };
  }

  if (!input.aggregateFlags.preservesSlotIdentity) {
    reasons.push("candidate did not preserve slot identity");
  }
  if (!input.aggregateFlags.preservesRowAndVerticalPullWhereAppropriate) {
    reasons.push("candidate did not preserve required row/vertical-pull support");
  }
  if (!input.aggregateFlags.avoidsNewObviousOvershoot) {
    reasons.push("candidate introduced obvious overshoot warnings");
  }
  if (
    !input.aggregateFlags.improvesChestSupport &&
    !input.aggregateFlags.improvesTricepsSupport &&
    !improvesUpperDeltSupport &&
    !improvesUpperSessionDuration
  ) {
    reasons.push("candidate did not materially improve upper support coverage");
  }

  if (reasons.length > 0) {
    return {
      verdict: "not_safe_to_apply",
      reasons,
    };
  }

  const pushGain = sumMuscleDelta(input.aggregateMuscleDiff, PUSH_SUPPORT_MUSCLES);
  const pullTotal = sumMuscles(input.aggregateMuscleDiff, PULL_SUPPORT_MUSCLES);

  return {
    verdict: "safe_to_apply_bounded_reseed",
    reasons: [
      `push-support muscles improved by ${pushGain} projected effective sets`,
      `pull-support coverage remained present with ${pullTotal} projected effective sets across the upper-slot pair`,
      ...(input.projectionError
        ? [`upper-slot runtime diff cleared the bounded repair target despite projection warning: ${input.projectionError}`]
        : []),
    ],
  };
}

function buildExecutiveSummary(input: {
  recommendation: ActiveMesocycleSlotReseedAuditPayload["recommendation"];
  aggregateMuscleDiff: ActiveMesocycleSlotReseedMuscleDiffRow[];
  slotDiffs: ActiveMesocycleSlotReseedSlotDiff[];
}): string[] {
  const chestDelta =
    input.aggregateMuscleDiff.find((row) => row.muscle === "Chest")?.delta ?? 0;
  const tricepsDelta =
    input.aggregateMuscleDiff.find((row) => row.muscle === "Triceps")?.delta ?? 0;
  const sideDeltDelta =
    input.aggregateMuscleDiff.find((row) => row.muscle === "Side Delts")?.delta ?? 0;

  return [
    `Verdict: ${input.recommendation.verdict}.`,
    `Upper-slot pair delta: Chest ${chestDelta >= 0 ? "+" : ""}${chestDelta}, Triceps ${tricepsDelta >= 0 ? "+" : ""}${tricepsDelta}, Side Delts ${sideDeltDelta >= 0 ? "+" : ""}${sideDeltDelta}.`,
    `Slots reviewed: ${input.slotDiffs.length > 0 ? input.slotDiffs.map((slot) => slot.slotId).join(", ") : "none"}.`,
    ...input.recommendation.reasons.map((reason) => `${reason}.`),
  ];
}

function buildSlotDiff(input: {
  slot: NormalizedSeededSlot;
  candidateSlot: NormalizedSeededSlot;
  design: NextMesocycleDesign;
  exerciseNameById: Map<string, string>;
  beforeWorkout: WorkoutPlan;
  afterWorkout: WorkoutPlan;
}): ActiveMesocycleSlotReseedSlotDiff {
  const persistedSeedExercises = buildSeedExerciseRows(input.slot, input.exerciseNameById);
  const candidateSeedExercises = buildSeedExerciseRows(input.candidateSlot, input.exerciseNameById);
  const persistedContribution = computeWorkoutContributionByMuscle(input.beforeWorkout);
  const candidateContribution = computeWorkoutContributionByMuscle(input.afterWorkout);
  const persistedCharacterization = buildIdentityCharacterization({
    workout: input.beforeWorkout,
    slot: input.slot,
    design: input.design,
  });
  const candidateCharacterization = buildIdentityCharacterization({
    workout: input.afterWorkout,
    slot: input.candidateSlot,
    design: input.design,
  });
  const warnings = buildOvershootWarnings({
    before: persistedCharacterization,
    after: candidateCharacterization,
    beforeWorkout: input.beforeWorkout,
    afterWorkout: input.afterWorkout,
    aggregateMuscleDiff: buildMuscleDiffRows({
      before: persistedContribution,
      after: candidateContribution,
    }),
  });

  return {
    slotId: input.slot.slotId,
    intent: input.slot.intent,
    sequenceIndex: input.slot.sequenceIndex,
    persistedSeedExercises,
    candidateSeedExercises,
    exerciseDiff: buildExerciseDiff({
      before: persistedSeedExercises,
      after: candidateSeedExercises,
    }),
    persistedSession: {
      exerciseCount: input.beforeWorkout.mainLifts.length + input.beforeWorkout.accessories.length,
      totalSets: countWorkoutSets(input.beforeWorkout),
      estimatedMinutes: input.beforeWorkout.estimatedMinutes ?? null,
      exercises: buildSessionExerciseRows(input.beforeWorkout),
      muscleContributionByMuscle: persistedContribution,
      characterization: persistedCharacterization,
    },
    candidateSession: {
      exerciseCount: input.afterWorkout.mainLifts.length + input.afterWorkout.accessories.length,
      totalSets: countWorkoutSets(input.afterWorkout),
      estimatedMinutes: input.afterWorkout.estimatedMinutes ?? null,
      exercises: buildSessionExerciseRows(input.afterWorkout),
      muscleContributionByMuscle: candidateContribution,
      characterization: candidateCharacterization,
    },
    setDiffByExercise: buildSetDiffRows({
      before: input.beforeWorkout,
      after: input.afterWorkout,
    }),
    muscleContributionDiff: buildMuscleDiffRows({
      before: persistedContribution,
      after: candidateContribution,
    }),
    estimatedMinutesDiff: {
      before: input.beforeWorkout.estimatedMinutes ?? null,
      after: input.afterWorkout.estimatedMinutes ?? null,
      delta:
        input.beforeWorkout.estimatedMinutes == null || input.afterWorkout.estimatedMinutes == null
          ? null
          : input.afterWorkout.estimatedMinutes - input.beforeWorkout.estimatedMinutes,
    },
    flags: {
      improvesChestSupport:
        (candidateContribution.Chest ?? 0) > (persistedContribution.Chest ?? 0),
      improvesTricepsSupport:
        (candidateContribution.Triceps ?? 0) > (persistedContribution.Triceps ?? 0),
      preservesRowAndVerticalPullWhereAppropriate:
        (!persistedCharacterization.hasCompoundRow || candidateCharacterization.hasCompoundRow) &&
        (!persistedCharacterization.hasCompoundVerticalPull ||
          candidateCharacterization.hasCompoundVerticalPull),
      avoidsNewObviousOvershoot: warnings.length === 0,
    },
    warnings,
  };
}

export async function evaluateActiveMesocycleSlotReseed(input: {
  userId: string;
  plannerDiagnosticsMode?: "standard" | "debug";
}): Promise<ActiveMesocycleSlotReseedEvaluation> {
  const plannerDiagnosticsMode = input.plannerDiagnosticsMode ?? "standard";
  const snapshot = await loadPreloadedGenerationSnapshot(input.userId);
  const activeMesocycle = snapshot.activeMesocycle;
  if (!activeMesocycle) {
    throw new Error("No active mesocycle found for active-mesocycle-slot-reseed audit.");
  }
  if (!activeMesocycle.slotPlanSeedJson) {
    throw new Error("Active mesocycle has no persisted slotPlanSeedJson for reseed audit.");
  }

  const persistedMapped = buildMappedGenerationContextFromSnapshot(input.userId, {
    ...snapshot,
    rotationContext: new Map(snapshot.rotationContext),
  });
  const persistedSeedSlots = readPersistedSeedSlots({
    slotPlanSeedJson: activeMesocycle.slotPlanSeedJson,
    mapped: persistedMapped,
  });
  if (!persistedSeedSlots) {
    throw new Error("Active mesocycle slotPlanSeedJson could not be normalized for reseed audit.");
  }

  const targetPersistedSlots = TARGET_SLOT_IDS.map((slotId) => {
    const slot = persistedSeedSlots.find((entry) => entry.slotId === slotId);
    if (!slot) {
      throw new Error(`Active mesocycle reseed audit requires persisted slot ${slotId}.`);
    }
    return slot;
  });

  const exerciseNameById = new Map(
    persistedMapped.exerciseLibrary.map((exercise) => [exercise.id, exercise.name])
  );
  const projectionSource = buildProjectionSource(activeMesocycle);
  const projectionDesign = buildProjectionDesign(snapshot, activeMesocycle);
  const projection = projectSuccessorSlotPlansFromSnapshot({
    userId: input.userId,
    source: projectionSource,
    design: projectionDesign,
    snapshot,
  });
  const projectionError = "error" in projection ? projection.error : null;
  const projectedSlotPlans = "error" in projection ? projection.slotPlans ?? null : projection.slotPlans;
  if (!projectedSlotPlans || projectedSlotPlans.length === 0) {
    const recommendation = {
      verdict: "needs_projection_fix_first" as const,
      reasons: [projectionError ?? "Candidate projection did not return any slot plans."],
    };
    const auditPayload = {
      version: ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION,
      activeMesocycle: {
        mesocycleId: activeMesocycle.id,
        mesoNumber: activeMesocycle.mesoNumber,
        state: activeMesocycle.state,
        week: deriveCurrentMesocycleSession(activeMesocycle).week,
        splitType: activeMesocycle.splitType,
        targetSlotIds: [...TARGET_SLOT_IDS],
      },
      executiveSummary: buildExecutiveSummary({
        recommendation,
        aggregateMuscleDiff: [],
        slotDiffs: [],
      }),
      persistedSeedResolution: {
        sourceModule: "src/lib/api/template-session/slot-plan-seed.ts",
        sourceFunction: "readPersistedSeedSlots",
        runtimeRule: "Normalize persisted slotPlanSeedJson against the active runtime slot sequence before diffing.",
      },
      freshReprojection: {
        sourceModule: "src/lib/api/mesocycle-handoff-slot-plan-projection.ts",
        sourceFunction: "projectSuccessorSlotPlansFromSnapshot",
        runtimeRule: "Reproject a fresh candidate seed through the canonical handoff slot-plan projection path using the current generation snapshot.",
      },
      candidateSessionEvaluation: {
        sourceModule: "src/lib/api/projected-week-volume-shared.ts",
        sourceFunction: "generateProjectedSession",
        runtimeRule: "Re-run the candidate seed through the existing seeded runtime generation path for sets, muscle contribution, and session-length comparison.",
      },
      diffArtifactDescription:
        "Projection failed before a candidate seed could be evaluated through current seeded runtime generation.",
      slotDiffs: [],
      aggregateMuscleDiff: [],
      flags: {
        improvesChestSupport: false,
        improvesTricepsSupport: false,
        preservesRowAndVerticalPullWhereAppropriate: false,
        avoidsNewObviousOvershoot: false,
        improvesSideDeltSupport: false,
        improvesRearDeltSupport: false,
        reducesUpperSessionDuration: false,
        preservesSlotIdentity: false,
        materiallyChangesExerciseSelection: false,
      },
      recommendation,
    };
    return {
      auditPayload,
      activeMesocycleId: activeMesocycle.id,
      candidateSlotPlanSeed: null,
      targetSlotIds: [...TARGET_SLOT_IDS],
    };
  }

  const candidateSlotSequence = buildMesocycleSlotSequence(projectionDesign.structure.slots);
  const candidateSeed = buildMesocycleSlotPlanSeed({
    slotSequence: candidateSlotSequence,
    slotPlans: projectedSlotPlans,
  });
  const candidateMapped = buildMappedGenerationContextFromSnapshot(
    input.userId,
    cloneSnapshotWithSeed({
      snapshot,
      slotPlanSeedJson: candidateSeed,
    })
  );
  const candidateSeedSlots = readPersistedSeedSlots({
    slotPlanSeedJson: candidateSeed,
    mapped: candidateMapped,
  });
  if (!candidateSeedSlots) {
    throw new Error("Candidate slot-plan seed could not be normalized for reseed audit.");
  }

  const targetCandidateSlots = TARGET_SLOT_IDS.map((slotId) => {
    const slot = candidateSeedSlots.find((entry) => entry.slotId === slotId);
    if (!slot) {
      throw new Error(`Candidate slot-plan seed is missing slot ${slotId}.`);
    }
    return slot;
  });

  const slotDiffs: ActiveMesocycleSlotReseedSlotDiff[] = [];
  for (const persistedSlot of targetPersistedSlots) {
    const candidateSlot = targetCandidateSlots.find((slot) => slot.slotId === persistedSlot.slotId);
    if (!candidateSlot) {
      throw new Error(`Candidate slot-plan seed is missing slot ${persistedSlot.slotId}.`);
    }

    const beforeGeneration = await generateProjectedSession({
      userId: input.userId,
      mapped: persistedMapped,
      intent: persistedSlot.intent,
      slotId: persistedSlot.slotId,
      plannerDiagnosticsMode,
    });
    if ("error" in beforeGeneration) {
      throw new Error(
        `Persisted seeded runtime generation failed for ${persistedSlot.slotId}: ${beforeGeneration.error}`
      );
    }

    const candidateGeneration = await generateProjectedSession({
      userId: input.userId,
      mapped: candidateMapped,
      intent: candidateSlot.intent,
      slotId: candidateSlot.slotId,
      plannerDiagnosticsMode,
    });
    if ("error" in candidateGeneration) {
      throw new Error(
        `Candidate seeded runtime generation failed for ${candidateSlot.slotId}: ${candidateGeneration.error}`
      );
    }

    slotDiffs.push(
      buildSlotDiff({
        slot: persistedSlot,
        candidateSlot,
        design: projectionDesign,
        exerciseNameById,
        beforeWorkout: beforeGeneration.workout,
        afterWorkout: candidateGeneration.workout,
      })
    );
  }

  const aggregateMuscleDiff = buildMuscleDiffRows({
    before: mergeContributionRecords(
      slotDiffs.map((slot) => slot.persistedSession.muscleContributionByMuscle)
    ),
    after: mergeContributionRecords(
      slotDiffs.map((slot) => slot.candidateSession.muscleContributionByMuscle)
    ),
  });
  const aggregateFlags = buildAggregateFlags(slotDiffs);
  const recommendation = buildRecommendation({
    projectionError,
    aggregateFlags,
    aggregateMuscleDiff,
  });

  const auditPayload = {
    version: ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION,
    activeMesocycle: {
      mesocycleId: activeMesocycle.id,
      mesoNumber: activeMesocycle.mesoNumber,
      state: activeMesocycle.state,
      week: deriveCurrentMesocycleSession(activeMesocycle).week,
      splitType: activeMesocycle.splitType,
      targetSlotIds: [...TARGET_SLOT_IDS],
    },
    executiveSummary: buildExecutiveSummary({
      recommendation,
      aggregateMuscleDiff,
      slotDiffs,
    }),
    persistedSeedResolution: {
      sourceModule: "src/lib/api/template-session/slot-plan-seed.ts",
      sourceFunction: "readPersistedSeedSlots",
      runtimeRule: "Normalize persisted slotPlanSeedJson against the active runtime slot sequence before diffing.",
    },
    freshReprojection: {
      sourceModule: "src/lib/api/mesocycle-handoff-slot-plan-projection.ts",
      sourceFunction: "projectSuccessorSlotPlansFromSnapshot",
      runtimeRule: "Reproject a fresh candidate seed through the canonical handoff slot-plan projection path using the current generation snapshot.",
    },
    candidateSessionEvaluation: {
      sourceModule: "src/lib/api/projected-week-volume-shared.ts",
      sourceFunction: "generateProjectedSession",
      runtimeRule: "Re-run the candidate seed through the existing seeded runtime generation path for sets, muscle contribution, and session-length comparison.",
    },
    diffArtifactDescription:
      "Each upper slot compares persisted seed exercises plus current seeded-runtime session output against a candidate seed produced by the handoff projection seam and then re-evaluated through seeded runtime generation.",
    slotDiffs,
    aggregateMuscleDiff,
    flags: aggregateFlags,
    recommendation,
  };
  return {
    auditPayload,
    activeMesocycleId: activeMesocycle.id,
    candidateSlotPlanSeed: candidateSeed,
    targetSlotIds: [...TARGET_SLOT_IDS],
  };
}

export async function buildActiveMesocycleSlotReseedAuditPayload(input: {
  userId: string;
  plannerDiagnosticsMode?: "standard" | "debug";
}): Promise<ActiveMesocycleSlotReseedAuditPayload> {
  const evaluation = await evaluateActiveMesocycleSlotReseed(input);
  return evaluation.auditPayload;
}
