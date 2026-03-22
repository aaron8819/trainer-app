import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  Mesocycle,
  MesocycleExerciseRoleType,
  Prisma,
  SplitType,
  VolumeTarget,
  WorkoutStatus,
  WorkoutSessionIntent,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { nextCycleSeedDraftUpdateSchema } from "@/lib/validation";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  buildOrderedFlexibleSlots,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  getAllowedIntentsForSplit,
  remapCompatibleCarryForwardIntent,
  type GenesisPolicyContext,
  type HandoffCarryForwardRecommendation,
  type MesocycleHandoffSummary,
  type NextCycleCarryForwardConflict,
  type NextCycleCarryForwardSelection,
  type NextCycleSeedDraft,
  type NextMesocycleDesign,
  type NextCycleSeedSlot,
  type NextCycleSlotId,
} from "./mesocycle-handoff-contract";
import {
  applyDraftOverridesToDesign,
  buildRecommendedDraftFromDesign,
  designNextMesocycle,
} from "./mesocycle-genesis-policy";
import {
  projectSuccessorMesocycle,
  type SuccessorMesocycleProjectionSource,
} from "./mesocycle-handoff-projection";
import {
  buildMesocycleSlotPlanSeed,
  projectSuccessorSlotPlansFromSnapshot,
} from "./mesocycle-handoff-slot-plan-projection";
import { resolveMesocycleSlotContract } from "./mesocycle-slot-contract";
import { getLatestReadinessSignalForReader, getSignalAgeHours } from "./readiness";
import { loadPreloadedGenerationSnapshot } from "./template-session/context-loader";

export {
  buildOrderedFlexibleSlots,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  getAllowedIntentsForSplit,
};
export type {
  HandoffCarryForwardRecommendation,
  MesocycleHandoffSummary,
  NextCycleCarryForwardConflict,
  NextCycleCarryForwardSelection,
  NextMesocycleDesign,
  NextCycleSeedDraft,
  NextCycleSeedSlot,
  NextCycleSlotId,
};

type Tx = Prisma.TransactionClient;
type ClosedMesocycleArchiveReader =
  | Pick<Prisma.TransactionClient, "mesocycle">
  | Pick<typeof prisma, "mesocycle">;
type HandoffSourceMesocycleReader =
  | Pick<Prisma.TransactionClient, "mesocycle">
  | Pick<typeof prisma, "mesocycle">;

type HandoffSourceMesocycle = {
  id: string;
  macroCycleId: string;
  mesoNumber: number;
  startWeek: number;
  durationWeeks: number;
  focus: string;
  volumeTarget: Mesocycle["volumeTarget"];
  intensityBias: Mesocycle["intensityBias"];
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
  macroCycle: {
    userId: string;
  };
};

type HandoffRoleRow = {
  exerciseId: string;
  sessionIntent: WorkoutSessionIntent;
  role: MesocycleExerciseRoleType;
  exercise: {
    name: string;
  };
};

type HandoffWorkoutRow = {
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

type HandoffConstraintsRow = {
  weeklySchedule: WorkoutSessionIntent[];
  daysPerWeek: number;
  splitType: SplitType;
};

type PendingHandoffRow = {
  id: string;
  state: Mesocycle["state"];
  mesoNumber: number;
  focus: string;
  closedAt: Date | null;
  handoffSummaryJson: unknown;
  nextSeedDraftJson: unknown;
};

export type PendingMesocycleHandoff = {
  mesocycleId: string;
  mesoNumber: number;
  focus: string;
  closedAt: string | null;
  summary: MesocycleHandoffSummary | null;
  draft: NextCycleSeedDraft | null;
};

export type ClosedMesocycleArchive = {
  mesocycleId: string;
  mesoNumber: number;
  focus: string;
  closedAt: string | null;
  currentState: "AWAITING_HANDOFF" | "COMPLETED";
  reviewState: "pending_handoff" | "historical_closeout";
  isEditableHandoff: boolean;
  summary: MesocycleHandoffSummary | null;
  draft: NextCycleSeedDraft | null;
};

const nextMesocycleStartingPointJsonSchema = z.object({
  volumeEntry: z.literal("conservative"),
  baselineSource: z.literal("accumulation_preferred"),
  allowNonDeloadFallback: z.literal(true),
});

const legacyNextMesocycleStartingPointJsonSchema = z.object({
  volumePreset: z.literal("conservative_productive"),
  baselineRule: z.literal("peak_accumulation_else_highest_accumulation_else_non_deload"),
  excludeDeload: z.literal(true),
});

const nextCycleSeedDraftJsonSchema = nextCycleSeedDraftUpdateSchema.extend({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  startingPoint: z.union([
    nextMesocycleStartingPointJsonSchema,
    legacyNextMesocycleStartingPointJsonSchema,
  ]),
});

const handoffCarryForwardRecommendationSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string().min(1),
  sessionIntent: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"]),
  role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
  recommendation: z.enum(["keep", "rotate", "drop"]),
  signalQuality: z.enum(["high", "medium"]),
  reasonCodes: z.array(z.string()),
});

const nextMesocycleDesignJsonSchema = z.object({
  version: z.literal(1),
  designedAt: z.string().datetime(),
  sourceMesocycleId: z.string(),
  profile: z.object({
    focus: z.string().min(1),
    durationWeeks: z.number().int().min(1),
    volumeTarget: z.string(),
    intensityBias: z.string(),
    blocks: z.array(
      z.object({
        blockNumber: z.number().int().min(1),
        blockType: z.string(),
        durationWeeks: z.number().int().min(1),
        volumeTarget: z.string(),
        intensityBias: z.string(),
        adaptationType: z.string(),
      })
    ),
  }),
  structure: z.object({
    splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]),
    sessionsPerWeek: z.number().int().min(1).max(7),
    daysPerWeek: z.number().int().min(1).max(7),
    sequenceMode: z.literal("ordered_flexible"),
    slots: z.array(
      z.object({
        slotId: z.string().min(1),
        intent: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"]),
        authoredSemantics: z.object({
          slotArchetype: z.string(),
          continuityScope: z.enum(["slot", "intent"]),
          primaryLaneContract: z.unknown().nullable(),
          supportCoverageContract: z.unknown().nullable(),
        }),
      })
    ),
  }),
  carryForward: z.object({
    decisions: z.array(
      z.object({
        exerciseId: z.string(),
        role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
        priorIntent: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"]),
        priorSlotId: z.string().optional(),
        action: z.enum(["keep", "rotate", "drop"]),
        targetIntent: z
          .enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"])
          .optional(),
        targetSlotId: z.string().optional(),
        signalQuality: z.enum(["high", "medium"]).optional(),
        reasonCodes: z.array(z.string()),
      })
    ),
  }),
  startingPoint: nextMesocycleStartingPointJsonSchema,
  explainability: z.object({
    profileReasonCodes: z.array(z.string()),
    profileSignalQuality: z.enum(["high", "medium"]).optional(),
    structureReasonCodes: z.array(z.string()),
    structureSignalQuality: z.enum(["high", "medium"]).optional(),
    startingPointReasonCodes: z.array(z.string()),
    startingPointSignalQuality: z.enum(["high", "medium"]).optional(),
  }),
});

const mesocycleHandoffSummaryJsonSchema = z.object({
  version: z.literal(1),
  mesocycleId: z.string(),
  macroCycleId: z.string(),
  mesoNumber: z.number().int().min(1),
  closedAt: z.string().datetime(),
  lifecycle: z.object({
    terminalState: z.literal("AWAITING_HANDOFF"),
    durationWeeks: z.number().int().min(1),
    accumulationSessionsCompleted: z.number().int().min(0),
    deloadSessionsCompleted: z.number().int().min(0),
    deloadExcludedFromNextBaseline: z.literal(true),
  }),
  training: z.object({
    focus: z.string().min(1),
    splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]),
    sessionsPerWeek: z.number().int().min(1).max(7),
    daysPerWeek: z.number().int().min(1).max(7),
    weeklySequence: z.array(
      z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"])
    ),
  }),
  carryForwardRecommendations: z.array(handoffCarryForwardRecommendationSchema),
  recommendedNextSeed: nextCycleSeedDraftJsonSchema.optional(),
  recommendedDesign: nextMesocycleDesignJsonSchema.optional(),
});

function canonicalCarryForwardSelectionKey(selection: {
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

function normalizeNextCycleSeedDraft(draft: NextCycleSeedDraft): NextCycleSeedDraft {
  return {
    ...draft,
    carryForwardSelections: normalizeCarryForwardSelectionsForDraft({
      splitType: draft.structure.splitType,
      carryForwardSelections: draft.carryForwardSelections,
    }),
  };
}

function validateSlotIntentsForSplit(splitType: SplitType, intents: WorkoutSessionIntent[]): boolean {
  const allowed = new Set(getAllowedIntentsForSplit(splitType));
  return intents.every((intent) => allowed.has(intent));
}

export function sanitizeNextCycleSeedDraft(input: {
  draft: unknown;
  sourceMesocycleId: string;
  fallbackDraft: NextCycleSeedDraft;
}): NextCycleSeedDraft {
  const parsed = nextCycleSeedDraftUpdateSchema.safeParse(input.draft);
  if (!parsed.success) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }

  const fallbackSelectionMap = new Map(
    input.fallbackDraft.carryForwardSelections.map((selection) => [
      canonicalCarryForwardSelectionKey(selection),
      selection,
    ])
  );

  const requested = parsed.data;
  if (requested.sourceMesocycleId !== input.sourceMesocycleId) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }
  if (requested.structure.daysPerWeek !== requested.structure.sessionsPerWeek) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }
  if (requested.structure.slots.length !== requested.structure.sessionsPerWeek) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }

  const requestedIntents = requested.structure.slots.map((slot) => slot.intent);
  if (!validateSlotIntentsForSplit(requested.structure.splitType, requestedIntents)) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }

  const canonicalSlots = buildOrderedFlexibleSlots({
    splitType: requested.structure.splitType,
    sessionsPerWeek: requested.structure.sessionsPerWeek,
    intents: requestedIntents,
  });

  const seenSelectionKeys = new Set<string>();
  const canonicalSelections = requested.carryForwardSelections.map((selection) => {
    const key = canonicalCarryForwardSelectionKey(selection);
    const fallbackSelection = fallbackSelectionMap.get(key);
    if (!fallbackSelection || seenSelectionKeys.has(key)) {
      throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
    }
    seenSelectionKeys.add(key);
    return {
      exerciseId: fallbackSelection.exerciseId,
      exerciseName: fallbackSelection.exerciseName,
      sessionIntent: fallbackSelection.sessionIntent,
      role: fallbackSelection.role,
      action: selection.action,
    } satisfies NextCycleCarryForwardSelection;
  });

  if (seenSelectionKeys.size !== fallbackSelectionMap.size) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID");
  }

  const incompatibleKeeps = findIncompatibleCarryForwardKeeps({
    slots: canonicalSlots,
    carryForwardSelections: canonicalSelections,
  });
  if (incompatibleKeeps.length > 0) {
    throw new Error(
      `MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:${formatCarryForwardConflictMessage(
        incompatibleKeeps
      )}`
    );
  }

  return {
    ...input.fallbackDraft,
    sourceMesocycleId: input.sourceMesocycleId,
    updatedAt: new Date().toISOString(),
    structure: {
      splitType: requested.structure.splitType,
      sessionsPerWeek: requested.structure.sessionsPerWeek,
      daysPerWeek: requested.structure.sessionsPerWeek,
      sequenceMode: "ordered_flexible",
      slots: canonicalSlots,
    },
    carryForwardSelections: canonicalSelections,
  };
}

function isPerformedWorkoutStatus(status: WorkoutStatus): boolean {
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);
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
  source: HandoffSourceMesocycle;
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
  workouts: HandoffWorkoutRow[];
  latestReadiness: Awaited<ReturnType<typeof getLatestReadinessSignalForReader>>;
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
    adherenceRate:
      input.workouts.length > 0 ? performedWorkouts.length / input.workouts.length : null,
    completionRate:
      input.workouts.length > 0 ? completedSessions / input.workouts.length : null,
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
  roles: HandoffRoleRow[];
  workouts: HandoffWorkoutRow[];
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
        (role) =>
          role.exerciseId === workoutExercise.exerciseId && role.sessionIntent === intent
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
  roles: HandoffRoleRow[];
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
  source: HandoffSourceMesocycle;
  constraints: HandoffConstraintsRow | null;
  roles: HandoffRoleRow[];
  workouts: HandoffWorkoutRow[];
  latestReadiness: Awaited<ReturnType<typeof getLatestReadinessSignalForReader>>;
}): GenesisPolicyContext {
  const weeklySchedule = input.constraints?.weeklySchedule ?? [];
  const sourceTopology = buildSourceTopology({
    source: input.source,
    weeklySchedule,
  });
  const preferredSessionsPerWeek =
    weeklySchedule.length > 0
      ? weeklySchedule.length
      : input.constraints?.daysPerWeek;
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
  source: HandoffSourceMesocycle;
  constraints: HandoffConstraintsRow | null;
  roles: HandoffRoleRow[];
  workouts: HandoffWorkoutRow[];
  latestReadiness: Awaited<ReturnType<typeof getLatestReadinessSignalForReader>>;
}): {
  policyContext: GenesisPolicyContext;
  recommendedDesign: NextMesocycleDesign;
  recommendedNextSeed: NextCycleSeedDraft;
  carryForwardRecommendations: HandoffCarryForwardRecommendation[];
} {
  const policyContext = buildGenesisPolicyContext(input);
  const recommendedDesign = designNextMesocycle(policyContext);
  const recommendedNextSeed = normalizeNextCycleSeedDraft(
    buildRecommendedDraftFromDesign({
      design: recommendedDesign,
      carryForwardCandidateEvidence: policyContext.carryForwardCandidateEvidence,
    })
  );

  return {
    policyContext,
    recommendedDesign,
    recommendedNextSeed,
    carryForwardRecommendations: buildCarryForwardRecommendations({
      design: recommendedDesign,
      roles: input.roles,
    }),
  };
}

function buildHandoffSummary(input: {
  mesocycle: HandoffSourceMesocycle;
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

function normalizeStartingPoint(
  value:
    | NextCycleSeedDraft["startingPoint"]
    | {
        volumePreset: "conservative_productive";
        baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload";
        excludeDeload: true;
      }
): NextCycleSeedDraft["startingPoint"] {
  if ("volumeEntry" in value) {
    return value;
  }

  return {
    volumeEntry: "conservative",
    baselineSource: "accumulation_preferred",
    allowNonDeloadFallback: true,
  };
}

function normalizeRecommendedDesign(design: NextMesocycleDesign): NextMesocycleDesign {
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

function resolveRecommendedArtifactsForPendingHandoff(input: {
  summary: MesocycleHandoffSummary;
  source: HandoffSourceMesocycle;
  constraints: HandoffConstraintsRow | null;
  roles: HandoffRoleRow[];
  workouts: HandoffWorkoutRow[];
  latestReadiness: Awaited<ReturnType<typeof getLatestReadinessSignalForReader>>;
}): {
  recommendedDesign: NextMesocycleDesign;
  recommendedNextSeed: NextCycleSeedDraft;
  carryForwardRecommendations: HandoffCarryForwardRecommendation[];
} {
  if (input.summary.recommendedDesign && input.summary.recommendedNextSeed) {
    return {
      recommendedDesign: input.summary.recommendedDesign,
        recommendedNextSeed: input.summary.recommendedNextSeed,
        carryForwardRecommendations:
        input.summary.carryForwardRecommendations.length > 0
          ? input.summary.carryForwardRecommendations
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

export function readNextCycleSeedDraft(value: unknown): NextCycleSeedDraft | null {
  const parsed = nextCycleSeedDraftJsonSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return normalizeNextCycleSeedDraft({
    ...parsed.data,
    startingPoint: normalizeStartingPoint(parsed.data.startingPoint),
  });
}

export function readMesocycleHandoffSummary(value: unknown): MesocycleHandoffSummary | null {
  const parsed = mesocycleHandoffSummaryJsonSchema.safeParse(value);
  if (!parsed.success || !parsed.data.recommendedNextSeed) {
    return null;
  }

  return {
    ...parsed.data,
    recommendedNextSeed: normalizeNextCycleSeedDraft({
      ...parsed.data.recommendedNextSeed,
      startingPoint: normalizeStartingPoint(parsed.data.recommendedNextSeed.startingPoint),
    }),
    recommendedDesign: parsed.data.recommendedDesign
      ? normalizeRecommendedDesign(parsed.data.recommendedDesign as NextMesocycleDesign)
      : undefined,
  };
}

export async function loadPendingMesocycleHandoff(userId: string): Promise<PendingMesocycleHandoff | null> {
  const row = await prisma.mesocycle.findFirst({
    where: {
      state: "AWAITING_HANDOFF",
      macroCycle: { userId },
    },
    orderBy: [{ closedAt: "desc" }, { mesoNumber: "desc" }],
    select: {
      id: true,
      state: true,
      mesoNumber: true,
      focus: true,
      closedAt: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
    },
  });

  return mapPendingHandoffRow(row);
}

export async function loadPendingMesocycleHandoffById(
  userId: string,
  mesocycleId: string
): Promise<PendingMesocycleHandoff | null> {
  const row = await prisma.mesocycle.findFirst({
    where: {
      id: mesocycleId,
      state: "AWAITING_HANDOFF",
      macroCycle: { userId },
    },
    select: {
      id: true,
      state: true,
      mesoNumber: true,
      focus: true,
      closedAt: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
    },
  });

  return mapPendingHandoffRow(row);
}

export async function loadClosedMesocycleArchive(
  client: ClosedMesocycleArchiveReader,
  input: { userId: string; mesocycleId: string }
): Promise<ClosedMesocycleArchive | null> {
  const row = await client.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      state: { in: ["AWAITING_HANDOFF", "COMPLETED"] },
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      mesoNumber: true,
      focus: true,
      closedAt: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
    },
  });

  return mapClosedArchiveRow(row);
}

export async function loadClosedMesocycleArchiveById(
  userId: string,
  mesocycleId: string
): Promise<ClosedMesocycleArchive | null> {
  return loadClosedMesocycleArchive(prisma, { userId, mesocycleId });
}

function mapPendingHandoffRow(row: PendingHandoffRow | null): PendingMesocycleHandoff | null {
  const archive = mapClosedArchiveRow(row);
  if (!archive || !archive.isEditableHandoff) {
    return null;
  }
  return {
    mesocycleId: archive.mesocycleId,
    mesoNumber: archive.mesoNumber,
    focus: archive.focus,
    closedAt: archive.closedAt,
    summary: archive.summary,
    draft: archive.draft,
  };
}

function mapClosedArchiveRow(row: PendingHandoffRow | null): ClosedMesocycleArchive | null {
  if (!row || (row.state !== "AWAITING_HANDOFF" && row.state !== "COMPLETED")) {
    return null;
  }

  const isEditableHandoff = row.state === "AWAITING_HANDOFF";
  return {
    mesocycleId: row.id,
    mesoNumber: row.mesoNumber,
    focus: row.focus,
    closedAt: row.closedAt?.toISOString() ?? null,
    currentState: row.state,
    reviewState: isEditableHandoff ? "pending_handoff" : "historical_closeout",
    isEditableHandoff,
    summary: readMesocycleHandoffSummary(row.handoffSummaryJson),
    draft: isEditableHandoff ? readNextCycleSeedDraft(row.nextSeedDraftJson) : null,
  };
}

export function toHandoffProjectionSource(
  source: Pick<
    HandoffSourceMesocycle,
    | "macroCycleId"
    | "mesoNumber"
    | "startWeek"
    | "durationWeeks"
    | "focus"
    | "volumeTarget"
    | "intensityBias"
    | "blocks"
  >
): SuccessorMesocycleProjectionSource {
  return {
    macroCycleId: source.macroCycleId,
    mesoNumber: source.mesoNumber,
    startWeek: source.startWeek,
    durationWeeks: source.durationWeeks,
    focus: source.focus,
    volumeTarget: source.volumeTarget,
    intensityBias: source.intensityBias,
    blocks: source.blocks,
  };
}

export async function loadHandoffSourceMesocycle(
  reader: HandoffSourceMesocycleReader,
  mesocycleId: string
): Promise<HandoffSourceMesocycle> {
  const source = await reader.mesocycle.findUnique({
    where: { id: mesocycleId },
    select: {
      id: true,
      macroCycleId: true,
      mesoNumber: true,
      startWeek: true,
      durationWeeks: true,
      focus: true,
      volumeTarget: true,
      intensityBias: true,
      sessionsPerWeek: true,
      daysPerWeek: true,
      splitType: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      slotSequenceJson: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockNumber: true,
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
          adaptationType: true,
        },
      },
      macroCycle: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!source) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }

  return source;
}

async function loadHandoffRoleRows(tx: Tx, mesocycleId: string): Promise<HandoffRoleRow[]> {
  return tx.mesocycleExerciseRole.findMany({
    where: { mesocycleId },
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
  });
}

export async function enterMesocycleHandoffInTransaction(
  tx: Tx,
  mesocycleId: string
): Promise<Mesocycle> {
  const source = await loadHandoffSourceMesocycle(tx, mesocycleId);
  const roles = await loadHandoffRoleRows(tx, mesocycleId);
  const candidateExerciseIds = Array.from(new Set(roles.map((role) => role.exerciseId)));
  const [constraints, workouts, latestReadiness] = await Promise.all([
    tx.constraints.findUnique({
      where: { userId: source.macroCycle.userId },
      select: { weeklySchedule: true, daysPerWeek: true, splitType: true },
    }),
    loadHandoffWorkoutRows(tx, {
      mesocycleId,
      candidateExerciseIds,
    }),
    getLatestReadinessSignalForReader(tx, source.macroCycle.userId),
  ]);

  const closedAt = new Date();
  const recommended = buildRecommendedArtifacts({
    source,
    constraints,
    roles,
    workouts,
    latestReadiness,
  });
  const handoffSummary = buildHandoffSummary({
    mesocycle: source,
    closedAt,
    weeklySequence: constraints?.weeklySchedule ?? [],
    carryForwardRecommendations: recommended.carryForwardRecommendations,
    recommendedDesign: recommended.recommendedDesign,
    recommendedNextSeed: recommended.recommendedNextSeed,
  });

  return tx.mesocycle.update({
    where: { id: source.id },
    data: {
      state: "AWAITING_HANDOFF",
      isActive: false,
      closedAt,
      handoffSummaryJson: handoffSummary as Prisma.InputJsonValue,
      nextSeedDraftJson: recommended.recommendedNextSeed as Prisma.InputJsonValue,
    },
  });
}

async function loadHandoffWorkoutRows(
  tx: Tx,
  input: { mesocycleId: string; candidateExerciseIds: string[] }
): Promise<HandoffWorkoutRow[]> {
  return tx.workout.findMany({
    where: { mesocycleId: input.mesocycleId },
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
          input.candidateExerciseIds.length > 0
            ? { exerciseId: { in: input.candidateExerciseIds } }
            : undefined,
        select: {
          exerciseId: true,
        },
      },
    },
  });
}

async function buildAcceptedMesocycleSlotPlanSeed(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  slotSequence: ReturnType<typeof projectSuccessorMesocycle>["mesocycle"]["slotSequence"];
}) {
  const snapshot = await loadPreloadedGenerationSnapshot(input.userId);
  const slotPlanProjection = projectSuccessorSlotPlansFromSnapshot({
    userId: input.userId,
    source: input.source,
    design: input.design,
    snapshot,
  });

  if ("error" in slotPlanProjection) {
    return null;
  }

  return buildMesocycleSlotPlanSeed({
    slotSequence: input.slotSequence,
    slotPlans: slotPlanProjection.slotPlans,
  });
}

export async function acceptMesocycleHandoffInTransaction(
  tx: Tx,
  mesocycleId: string
): Promise<Mesocycle> {
  const source = await loadHandoffSourceMesocycle(tx, mesocycleId);
  const pendingRow = await tx.mesocycle.findUnique({
    where: { id: mesocycleId },
    select: {
      id: true,
      state: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
      closedAt: true,
    },
  });

  if (!pendingRow || pendingRow.state !== "AWAITING_HANDOFF") {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }

  const summary = readMesocycleHandoffSummary(pendingRow.handoffSummaryJson);
  const storedDraft = readNextCycleSeedDraft(pendingRow.nextSeedDraftJson);
  if (!summary || !storedDraft) {
    throw new Error("MESOCYCLE_HANDOFF_DRAFT_MISSING");
  }
  const recommended =
    summary.recommendedDesign && summary.recommendedNextSeed
      ? {
          recommendedDesign: summary.recommendedDesign,
          recommendedNextSeed: summary.recommendedNextSeed,
          carryForwardRecommendations: summary.carryForwardRecommendations,
        }
      : await (async () => {
          const roles = await loadHandoffRoleRows(tx, mesocycleId);
          const candidateExerciseIds = Array.from(new Set(roles.map((role) => role.exerciseId)));
          const [constraints, workouts, latestReadiness] = await Promise.all([
            tx.constraints.findUnique({
              where: { userId: source.macroCycle.userId },
              select: { weeklySchedule: true, daysPerWeek: true, splitType: true },
            }),
            loadHandoffWorkoutRows(tx, {
              mesocycleId,
              candidateExerciseIds,
            }),
            getLatestReadinessSignalForReader(tx, source.macroCycle.userId),
          ]);

          return resolveRecommendedArtifactsForPendingHandoff({
            summary,
            source,
            constraints,
            roles,
            workouts,
            latestReadiness,
          });
        })();
  const draft = sanitizeNextCycleSeedDraft({
    draft: storedDraft,
    sourceMesocycleId: source.id,
    fallbackDraft: recommended.recommendedNextSeed,
  });
  const design = applyDraftOverridesToDesign({
    design: recommended.recommendedDesign,
    draft,
  });
  const projectionSource = toHandoffProjectionSource(source);
  const projection = projectSuccessorMesocycle({
    source: projectionSource,
    design,
  });
  const slotPlanSeed = await buildAcceptedMesocycleSlotPlanSeed({
    userId: source.macroCycle.userId,
    source: projectionSource,
    design,
    slotSequence: projection.mesocycle.slotSequence,
  });

  const next = await tx.mesocycle.create({
    data: {
      macroCycleId: projection.mesocycle.macroCycleId,
      mesoNumber: projection.mesocycle.mesoNumber,
      startWeek: projection.mesocycle.startWeek,
      durationWeeks: projection.mesocycle.durationWeeks,
      focus: projection.mesocycle.focus,
      volumeTarget: projection.mesocycle.volumeTarget,
      intensityBias: projection.mesocycle.intensityBias,
      isActive: true,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: projection.mesocycle.sessionsPerWeek,
      daysPerWeek: projection.mesocycle.daysPerWeek,
      splitType: projection.mesocycle.splitType,
      slotSequenceJson: projection.mesocycle.slotSequence as Prisma.InputJsonValue,
      ...(slotPlanSeed
        ? { slotPlanSeedJson: slotPlanSeed as Prisma.InputJsonValue }
        : {}),
    },
  });

  if (projection.trainingBlocks.length > 0) {
    await tx.trainingBlock.createMany({
      data: projection.trainingBlocks.map((block) => ({
        mesocycleId: next.id,
        blockNumber: block.blockNumber,
        blockType: block.blockType,
        startWeek: block.startWeek,
        durationWeeks: block.durationWeeks,
        volumeTarget: block.volumeTarget,
        intensityBias: block.intensityBias,
        adaptationType: block.adaptationType,
      })),
    });
  }

  if (projection.carriedForwardRoles.length > 0) {
    await tx.mesocycleExerciseRole.createMany({
      data: projection.carriedForwardRoles.map((selection) => ({
        mesocycleId: next.id,
        exerciseId: selection.exerciseId,
        sessionIntent: selection.sessionIntent,
        role: selection.role,
        addedInWeek: selection.addedInWeek,
      })),
      skipDuplicates: true,
    });
  }

  await tx.constraints.upsert({
    where: { userId: source.macroCycle.userId },
    update: {
      daysPerWeek: projection.mesocycle.daysPerWeek,
      splitType: projection.mesocycle.splitType,
      weeklySchedule: projection.mesocycle.weeklySchedule,
    },
    create: {
      userId: source.macroCycle.userId,
      daysPerWeek: projection.mesocycle.daysPerWeek,
      splitType: projection.mesocycle.splitType,
      weeklySchedule: projection.mesocycle.weeklySchedule,
    },
  });

  await tx.mesocycle.update({
    where: { id: source.id },
    data: {
      state: "COMPLETED",
      isActive: false,
    },
  });

  return next;
}

export async function updateMesocycleHandoffDraftInTransaction(
  tx: Tx,
  input: {
    mesocycleId: string;
    draft: unknown;
  }
): Promise<PendingMesocycleHandoff> {
  const pendingRow = await tx.mesocycle.findUnique({
    where: { id: input.mesocycleId },
    select: {
      id: true,
      state: true,
      mesoNumber: true,
      focus: true,
      closedAt: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
    },
  });

  if (!pendingRow || pendingRow.state !== "AWAITING_HANDOFF") {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }

  const summary = readMesocycleHandoffSummary(pendingRow.handoffSummaryJson);
  if (!summary) {
    throw new Error("MESOCYCLE_HANDOFF_SUMMARY_MISSING");
  }

  const sanitizedDraft = sanitizeNextCycleSeedDraft({
    draft: input.draft,
    sourceMesocycleId: pendingRow.id,
    fallbackDraft:
      summary.recommendedNextSeed ??
      (() => {
        throw new Error("MESOCYCLE_HANDOFF_SUMMARY_MISSING");
      })(),
  });

  const updated = await tx.mesocycle.update({
    where: { id: pendingRow.id },
    data: {
      nextSeedDraftJson: sanitizedDraft as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      state: true,
      mesoNumber: true,
      focus: true,
      closedAt: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
    },
  });

  const mapped = mapPendingHandoffRow(updated);
  if (!mapped) {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }
  return mapped;
}
