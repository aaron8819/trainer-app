import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  SplitType,
  VolumeTarget,
  WorkoutStatus,
  WorkoutSessionIntent,
} from "@prisma/client";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  buildOrderedFlexibleSlots,
  getAllowedIntentsForSplit,
  remapCompatibleCarryForwardIntent,
  type GenesisPolicyContext,
  type HandoffCarryForwardRecommendation,
  type MesocycleHandoffSummary,
  type NextCycleCarryForwardSelection,
  type NextCycleSeedDraft,
  type NextMesocycleDesign,
} from "./mesocycle-handoff-contract";
import { buildRecommendedDraftFromDesign, designNextMesocycle } from "./mesocycle-genesis-policy";
import { resolveMesocycleSlotContract } from "./mesocycle-slot-contract";
import { getLatestReadinessSignalForReader, getSignalAgeHours } from "./readiness";

export type HandoffArtifactSource = {
  id: string;
  macroCycleId: string;
  mesoNumber: number;
  startWeek: number;
  durationWeeks: number;
  focus: string;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  sessionsPerWeek: number;
  daysPerWeek: number;
  splitType: SplitType;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  slotSequenceJson: unknown;
  blocks: Array<{
    blockNumber: number;
    blockType: BlockType;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    adaptationType: AdaptationType;
  }>;
};

export type HandoffArtifactRoleRow = {
  exerciseId: string;
  sessionIntent: WorkoutSessionIntent;
  role: MesocycleExerciseRoleType;
  exercise: {
    name: string;
  };
};

export type HandoffArtifactWorkoutRow = {
  scheduledDate: Date;
  completedAt: Date | null;
  status: WorkoutStatus;
  sessionIntent: WorkoutSessionIntent | null;
  selectionMode: string | null;
  selectionMetadata: unknown;
  advancesSplit: boolean;
  mesocyclePhaseSnapshot: string | null;
  exercises: Array<{
    exerciseId: string;
  }>;
};

export type HandoffArtifactConstraintsRow = {
  weeklySchedule: WorkoutSessionIntent[];
  daysPerWeek: number;
  splitType: SplitType;
};

type HandoffArtifactLatestReadiness = Awaited<ReturnType<typeof getLatestReadinessSignalForReader>>;

type RecommendedArtifacts = {
  recommendedDesign: NextMesocycleDesign;
  recommendedNextSeed: NextCycleSeedDraft;
  carryForwardRecommendations: HandoffCarryForwardRecommendation[];
};

export type MaterializedHandoffArtifacts = RecommendedArtifacts & {
  summary: MesocycleHandoffSummary;
};

export function canonicalCarryForwardSelectionKey(selection: {
  exerciseId: string;
  sessionIntent: WorkoutSessionIntent;
  role: MesocycleExerciseRoleType;
}): string {
  return `${selection.exerciseId}:${selection.sessionIntent}:${selection.role}`;
}

function normalizeCarryForwardSelectionsForDraft(input: {
  splitType: SplitType;
  carryForwardSelections: NextCycleCarryForwardSelection[];
}): NextCycleCarryForwardSelection[] {
  const proposedKeyCounts = new Map<string, number>();
  for (const selection of input.carryForwardSelections) {
    const remappedIntent =
      selection.action === "keep"
        ? remapCompatibleCarryForwardIntent({
            splitType: input.splitType,
            sessionIntent: selection.sessionIntent,
          })
        : undefined;
    const proposedKey = canonicalCarryForwardSelectionKey({
      exerciseId: selection.exerciseId,
      sessionIntent: remappedIntent ?? selection.sessionIntent,
      role: selection.role,
    });
    proposedKeyCounts.set(proposedKey, (proposedKeyCounts.get(proposedKey) ?? 0) + 1);
  }

  return input.carryForwardSelections.map((selection) => {
    if (selection.action !== "keep") {
      return selection;
    }

    const remappedIntent = remapCompatibleCarryForwardIntent({
      splitType: input.splitType,
      sessionIntent: selection.sessionIntent,
    });
    if (remappedIntent === selection.sessionIntent) {
      return selection;
    }

    const proposedKey = canonicalCarryForwardSelectionKey({
      exerciseId: selection.exerciseId,
      sessionIntent: remappedIntent,
      role: selection.role,
    });
    if ((proposedKeyCounts.get(proposedKey) ?? 0) > 1) {
      return selection;
    }

    return {
      ...selection,
      sessionIntent: remappedIntent,
    };
  });
}

export function normalizeNextCycleSeedDraft(draft: NextCycleSeedDraft): NextCycleSeedDraft {
  return {
    ...draft,
    carryForwardSelections: normalizeCarryForwardSelectionsForDraft({
      splitType: draft.structure.splitType,
      carryForwardSelections: draft.carryForwardSelections,
    }),
  };
}

export function normalizeRecommendedDesign(design: NextMesocycleDesign): NextMesocycleDesign {
  return {
    ...design,
    carryForward: {
      decisions: design.carryForward.decisions.map((decision) => ({
        ...decision,
        signalQuality: decision.signalQuality ?? "medium",
      })),
    },
    explainability: {
      ...design.explainability,
      profileSignalQuality: design.explainability.profileSignalQuality ?? "medium",
      structureSignalQuality: design.explainability.structureSignalQuality ?? "medium",
      startingPointSignalQuality: design.explainability.startingPointSignalQuality ?? "medium",
    },
  };
}

function isPerformedWorkoutStatus(status: WorkoutStatus): boolean {
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);
}

function shouldIgnoreWorkoutForCarryForwardEvidence(selectionMetadata: unknown): boolean {
  return (
    readRuntimeEditReconciliation(selectionMetadata)?.directives.futureSeedCarryForward ===
    "ignore"
  );
}

function inferPreferredSplitTypeFromWeeklySchedule(
  weeklySchedule: WorkoutSessionIntent[]
): SplitType | undefined {
  if (weeklySchedule.length === 0) {
    return undefined;
  }

  if (weeklySchedule.every((intent) => intent === "UPPER" || intent === "LOWER")) {
    return "UPPER_LOWER";
  }

  if (weeklySchedule.every((intent) => intent === "PUSH" || intent === "PULL" || intent === "LEGS")) {
    return "PPL";
  }

  if (weeklySchedule.every((intent) => intent === "FULL_BODY")) {
    return "FULL_BODY";
  }

  return undefined;
}

function buildSourceTopology(input: {
  source: HandoffArtifactSource;
  weeklySchedule: WorkoutSessionIntent[];
}): GenesisPolicyContext["sourceTopology"] {
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.source.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const repeatedIntentCounts = new Map<WorkoutSessionIntent, number>();
  for (const slot of slotContract.slots) {
    const intent = slot.intent.toUpperCase() as WorkoutSessionIntent;
    repeatedIntentCounts.set(intent, (repeatedIntentCounts.get(intent) ?? 0) + 1);
  }

  return {
    splitType: input.source.splitType,
    sessionsPerWeek: input.source.sessionsPerWeek,
    daysPerWeek: input.source.daysPerWeek,
    weeklySequence:
      input.weeklySchedule.length > 0
        ? input.weeklySchedule
        : slotContract.slots.map((slot) => slot.intent.toUpperCase() as WorkoutSessionIntent),
    slotSource:
      slotContract.source === "mesocycle_slot_sequence"
        ? "persisted_slot_sequence"
        : "legacy_weekly_schedule",
    hasPersistedSlotSequence: slotContract.hasPersistedSequence,
    slots: slotContract.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent.toUpperCase() as WorkoutSessionIntent,
      sequenceIndex: slot.sequenceIndex,
    })),
    repeatedIntents: Array.from(repeatedIntentCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([intent]) => intent),
  };
}

function buildCloseoutEvidence(input: {
  workouts: HandoffArtifactWorkoutRow[];
  latestReadiness: HandoffArtifactLatestReadiness;
}): GenesisPolicyContext["closeoutEvidence"] {
  const performedWorkouts = input.workouts
    .filter((workout) => isPerformedWorkoutStatus(workout.status))
    .map((workout) => ({
      workout,
      semantics: deriveSessionSemantics({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
        mesocyclePhase: workout.mesocyclePhaseSnapshot,
      }),
    }));
  const completedSessions = performedWorkouts.filter(
    ({ workout }) => workout.status === "COMPLETED"
  ).length;
  const advancingSessions = performedWorkouts.filter(
    ({ semantics }) => semantics.advancesLifecycle
  ).length;

  return {
    scheduledSessions: input.workouts.length,
    performedSessions: performedWorkouts.length,
    completedSessions,
    advancingSessions,
    nonAdvancingPerformedSessions: Math.max(0, performedWorkouts.length - advancingSessions),
    adherenceRate: input.workouts.length > 0 ? performedWorkouts.length / input.workouts.length : null,
    completionRate: input.workouts.length > 0 ? completedSessions / input.workouts.length : null,
    terminalDeloadPerformed: performedWorkouts.some(({ semantics }) => semantics.isDeload),
    latestReadiness: input.latestReadiness
      ? {
          readiness: input.latestReadiness.subjective.readiness,
          signalAgeHours: getSignalAgeHours(input.latestReadiness),
        }
      : null,
  };
}

function buildCarryForwardCandidateEvidence(input: {
  roles: HandoffArtifactRoleRow[];
  workouts: HandoffArtifactWorkoutRow[];
}): GenesisPolicyContext["carryForwardCandidateEvidence"] {
  const evidenceByKey = new Map<
    string,
    {
      exposureCount: number;
      advancingExposureCount: number;
      latestPerformedAt: string | null;
      latestSourceIntent?: WorkoutSessionIntent;
      latestSourceSlotId?: string;
      latestSemanticsKind?:
        | "advancing"
        | "gap_fill"
        | "supplemental"
        | "non_advancing_generic";
      latestTimestamp: number;
    }
  >();

  for (const workout of input.workouts) {
    if (!isPerformedWorkoutStatus(workout.status)) {
      continue;
    }
    if (shouldIgnoreWorkoutForCarryForwardEvidence(workout.selectionMetadata)) {
      continue;
    }

    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });
    const sessionSlot = readSessionSlotSnapshot(workout.selectionMetadata);
    const performedAt = (workout.completedAt ?? workout.scheduledDate).toISOString();
    const performedTimestamp = new Date(performedAt).getTime();

    for (const workoutExercise of workout.exercises) {
      const intent = (sessionSlot?.intent ?? workout.sessionIntent ?? null) as WorkoutSessionIntent | null;
      if (!intent) {
        continue;
      }

      const roleMatches = input.roles.filter(
        (role) => role.exerciseId === workoutExercise.exerciseId && role.sessionIntent === intent
      );

      for (const role of roleMatches) {
        const key = `${role.exerciseId}:${role.sessionIntent}:${role.role}`;
        const existing = evidenceByKey.get(key);
        const nextExposureCount = (existing?.exposureCount ?? 0) + 1;
        const nextAdvancingExposureCount =
          (existing?.advancingExposureCount ?? 0) + (semantics.advancesLifecycle ? 1 : 0);
        const isNewer = !existing || performedTimestamp >= existing.latestTimestamp;
        evidenceByKey.set(key, {
          exposureCount: nextExposureCount,
          advancingExposureCount: nextAdvancingExposureCount,
          latestPerformedAt: isNewer ? performedAt : existing.latestPerformedAt,
          latestSourceIntent: isNewer ? intent : existing.latestSourceIntent,
          latestSourceSlotId: isNewer ? sessionSlot?.slotId : existing.latestSourceSlotId,
          latestSemanticsKind: isNewer ? semantics.kind : existing.latestSemanticsKind,
          latestTimestamp: isNewer ? performedTimestamp : existing.latestTimestamp,
        });
      }
    }
  }

  return input.roles.map((row) => {
    const evidence =
      evidenceByKey.get(`${row.exerciseId}:${row.sessionIntent}:${row.role}`) ?? {
        exposureCount: 0,
        advancingExposureCount: 0,
        latestPerformedAt: null,
        latestSourceIntent: undefined,
        latestSourceSlotId: undefined,
        latestSemanticsKind: undefined,
        latestTimestamp: 0,
      };

    return {
      exerciseId: row.exerciseId,
      exerciseName: row.exercise.name,
      role: row.role,
      priorIntent: row.sessionIntent,
      priorSlotId: evidence.latestSourceSlotId,
      anchorLevel: row.role === "CORE_COMPOUND" ? "required" : "none",
      evidence: {
        exposureCount: evidence.exposureCount,
        advancingExposureCount: evidence.advancingExposureCount,
        latestPerformedAt: evidence.latestPerformedAt,
        latestSourceIntent: evidence.latestSourceIntent,
        latestSourceSlotId: evidence.latestSourceSlotId,
        latestSemanticsKind: evidence.latestSemanticsKind,
      },
    };
  });
}

function buildCarryForwardRecommendations(input: {
  design: NextMesocycleDesign;
  roles: HandoffArtifactRoleRow[];
}): HandoffCarryForwardRecommendation[] {
  const decisionByKey = new Map(
    input.design.carryForward.decisions.map((decision) => [
      `${decision.exerciseId}:${decision.priorIntent}:${decision.role}`,
      decision,
    ])
  );

  return input.roles.map((row) => {
    const decision = decisionByKey.get(`${row.exerciseId}:${row.sessionIntent}:${row.role}`);
    const recommendation = decision?.action ?? "rotate";

    return {
      exerciseId: row.exerciseId,
      exerciseName: row.exercise.name,
      sessionIntent: row.sessionIntent,
      role: row.role,
      recommendation,
      signalQuality: decision?.signalQuality ?? "medium",
      reasonCodes: decision?.reasonCodes ?? [],
    };
  });
}

function buildGenesisPolicyContext(input: {
  source: HandoffArtifactSource;
  constraints: HandoffArtifactConstraintsRow | null;
  roles: HandoffArtifactRoleRow[];
  workouts: HandoffArtifactWorkoutRow[];
  latestReadiness: HandoffArtifactLatestReadiness;
}): GenesisPolicyContext {
  const weeklySchedule = input.constraints?.weeklySchedule ?? [];
  const sourceTopology = buildSourceTopology({
    source: input.source,
    weeklySchedule,
  });
  const preferredSessionsPerWeek =
    weeklySchedule.length > 0 ? weeklySchedule.length : input.constraints?.daysPerWeek;
  const preferredSplitType =
    input.constraints?.splitType && input.constraints.splitType !== "CUSTOM"
      ? input.constraints.splitType
      : inferPreferredSplitTypeFromWeeklySchedule(weeklySchedule);

  return {
    sourceProfile: {
      sourceMesocycleId: input.source.id,
      focus: input.source.focus,
      durationWeeks: input.source.durationWeeks,
      volumeTarget: input.source.volumeTarget,
      intensityBias: input.source.intensityBias,
      blocks: input.source.blocks.map((block) => ({
        blockNumber: block.blockNumber,
        blockType: block.blockType,
        durationWeeks: block.durationWeeks,
        volumeTarget: block.volumeTarget,
        intensityBias: block.intensityBias,
        adaptationType: block.adaptationType,
      })),
    },
    constraints: {
      availableDaysPerWeek: input.constraints?.daysPerWeek ?? input.source.daysPerWeek,
    },
    preferences: {
      ...(preferredSplitType ? { preferredSplitType } : {}),
      ...(preferredSplitType
        ? {
            preferredSplitTypeSource:
              input.constraints?.splitType && input.constraints.splitType !== "CUSTOM"
                ? ("constraints_split_type" as const)
                : ("weekly_schedule_topology" as const),
          }
        : {}),
      ...(typeof preferredSessionsPerWeek === "number" ? { preferredSessionsPerWeek } : {}),
      ...(typeof preferredSessionsPerWeek === "number"
        ? {
            preferredSessionsPerWeekSource:
              weeklySchedule.length > 0
                ? ("weekly_schedule_length" as const)
                : ("constraints_days_per_week" as const),
          }
        : {}),
    },
    sourceTopology,
    closeoutEvidence: buildCloseoutEvidence({
      workouts: input.workouts,
      latestReadiness: input.latestReadiness,
    }),
    carryForwardCandidateEvidence: buildCarryForwardCandidateEvidence({
      roles: input.roles,
      workouts: input.workouts,
    }),
  };
}

function buildRecommendedArtifacts(input: {
  source: HandoffArtifactSource;
  constraints: HandoffArtifactConstraintsRow | null;
  roles: HandoffArtifactRoleRow[];
  workouts: HandoffArtifactWorkoutRow[];
  latestReadiness: HandoffArtifactLatestReadiness;
}): RecommendedArtifacts {
  const policyContext = buildGenesisPolicyContext(input);
  const recommendedDesign = designNextMesocycle(policyContext);
  const recommendedNextSeed = normalizeNextCycleSeedDraft(
    buildRecommendedDraftFromDesign({
      design: recommendedDesign,
      carryForwardCandidateEvidence: policyContext.carryForwardCandidateEvidence,
    })
  );

  return {
    recommendedDesign,
    recommendedNextSeed,
    carryForwardRecommendations: buildCarryForwardRecommendations({
      design: recommendedDesign,
      roles: input.roles,
    }),
  };
}

function buildHandoffSummary(input: {
  mesocycle: HandoffArtifactSource;
  closedAt: Date;
  weeklySequence: WorkoutSessionIntent[];
  carryForwardRecommendations: HandoffCarryForwardRecommendation[];
  recommendedDesign: NextMesocycleDesign;
  recommendedNextSeed: NextCycleSeedDraft;
}): MesocycleHandoffSummary {
  return {
    version: 1,
    mesocycleId: input.mesocycle.id,
    macroCycleId: input.mesocycle.macroCycleId,
    mesoNumber: input.mesocycle.mesoNumber,
    closedAt: input.closedAt.toISOString(),
    lifecycle: {
      terminalState: "AWAITING_HANDOFF",
      durationWeeks: input.mesocycle.durationWeeks,
      accumulationSessionsCompleted: input.mesocycle.accumulationSessionsCompleted,
      deloadSessionsCompleted: input.mesocycle.deloadSessionsCompleted,
      deloadExcludedFromNextBaseline: true,
    },
    training: {
      focus: input.mesocycle.focus,
      splitType: input.mesocycle.splitType,
      sessionsPerWeek: input.mesocycle.sessionsPerWeek,
      daysPerWeek: input.mesocycle.daysPerWeek,
      weeklySequence: input.weeklySequence,
    },
    carryForwardRecommendations: input.carryForwardRecommendations,
    recommendedNextSeed: input.recommendedNextSeed,
    recommendedDesign: input.recommendedDesign,
  };
}

function resolveRecommendedArtifactsForPendingHandoff(input: {
  existingSummary: MesocycleHandoffSummary | null;
  source: HandoffArtifactSource;
  constraints: HandoffArtifactConstraintsRow | null;
  roles: HandoffArtifactRoleRow[];
  workouts: HandoffArtifactWorkoutRow[];
  latestReadiness: HandoffArtifactLatestReadiness;
}): RecommendedArtifacts {
  if (input.existingSummary?.recommendedDesign && input.existingSummary.recommendedNextSeed) {
    return {
      recommendedDesign: input.existingSummary.recommendedDesign,
      recommendedNextSeed: input.existingSummary.recommendedNextSeed,
      carryForwardRecommendations:
        input.existingSummary.carryForwardRecommendations.length > 0
          ? input.existingSummary.carryForwardRecommendations
          : buildRecommendedArtifacts({
              source: input.source,
              constraints: input.constraints,
              roles: input.roles,
              workouts: input.workouts,
              latestReadiness: input.latestReadiness,
            }).carryForwardRecommendations,
    };
  }

  return buildRecommendedArtifacts({
    source: input.source,
    constraints: input.constraints,
    roles: input.roles,
    workouts: input.workouts,
    latestReadiness: input.latestReadiness,
  });
}

export function materializeHandoffArtifacts(input: {
  source: HandoffArtifactSource;
  constraints: HandoffArtifactConstraintsRow | null;
  roles: HandoffArtifactRoleRow[];
  workouts: HandoffArtifactWorkoutRow[];
  latestReadiness: HandoffArtifactLatestReadiness;
  closedAt: Date;
  existingSummary: MesocycleHandoffSummary | null;
}): MaterializedHandoffArtifacts {
  const recommended = resolveRecommendedArtifactsForPendingHandoff({
    existingSummary: input.existingSummary,
    source: input.source,
    constraints: input.constraints,
    roles: input.roles,
    workouts: input.workouts,
    latestReadiness: input.latestReadiness,
  });

  return {
    ...recommended,
    summary: buildHandoffSummary({
      mesocycle: input.source,
      closedAt: input.closedAt,
      weeklySequence: input.constraints?.weeklySchedule ?? [],
      carryForwardRecommendations: recommended.carryForwardRecommendations,
      recommendedDesign: recommended.recommendedDesign,
      recommendedNextSeed: recommended.recommendedNextSeed,
    }),
  };
}

export function validateSlotIntentsForSplit(
  splitType: SplitType,
  intents: WorkoutSessionIntent[]
): boolean {
  const allowed = new Set(getAllowedIntentsForSplit(splitType));
  return intents.every((intent) => allowed.has(intent));
}

export function rebuildCanonicalDraftSlots(input: {
  splitType: SplitType;
  sessionsPerWeek: number;
  intents: WorkoutSessionIntent[];
}) {
  return buildOrderedFlexibleSlots({
    splitType: input.splitType,
    sessionsPerWeek: input.sessionsPerWeek,
    intents: input.intents,
  });
}
