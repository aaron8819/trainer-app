import type { Mesocycle, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { nextCycleSeedDraftUpdateSchema } from "@/lib/validation";
import {
  buildOrderedFlexibleSlots,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  getAllowedIntentsForSplit,
  type HandoffCarryForwardRecommendation,
  type MesocycleHandoffSummary,
  type NextCycleCarryForwardConflict,
  type NextCycleCarryForwardSelection,
  type NextCycleSeedDraft,
  type NextMesocycleDesign,
  type NextCycleSeedSlot,
  type NextCycleSlotId,
} from "./mesocycle-handoff-contract";
import { applyDraftOverridesToDesign } from "./mesocycle-genesis-policy";
import {
  canonicalCarryForwardSelectionKey,
  materializeHandoffArtifacts,
  normalizeNextCycleSeedDraft,
  normalizeRecommendedDesign,
  rebuildCanonicalDraftSlots,
  validateSlotIntentsForSplit,
  type HandoffArtifactRoleRow,
  type HandoffArtifactSource,
  type HandoffArtifactWorkoutRow,
} from "./mesocycle-handoff-artifacts";
import {
  projectSuccessorMesocycle,
  type SuccessorMesocycleProjectionSource,
} from "./mesocycle-handoff-projection";
import {
  buildMesocycleSlotPlanSeed,
  projectSuccessorSlotPlansFromSnapshot,
} from "./mesocycle-handoff-slot-plan-projection";
import { getLatestReadinessSignalForReader } from "./readiness";
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
type PendingHandoffArtifactReader =
  | Pick<
      Prisma.TransactionClient,
      "mesocycle" | "mesocycleExerciseRole" | "constraints" | "workout" | "readinessSignal"
    >
  | Pick<
      typeof prisma,
      "mesocycle" | "mesocycleExerciseRole" | "constraints" | "workout" | "readinessSignal"
    >;

type HandoffSourceMesocycle = HandoffArtifactSource & {
  macroCycle: {
    userId: string;
  };
};

type HandoffRoleRow = HandoffArtifactRoleRow;
type HandoffWorkoutRow = HandoffArtifactWorkoutRow;

type PendingHandoffRow = {
  id: string;
  state: Mesocycle["state"];
  mesoNumber: number;
  focus: string;
  closedAt: Date | null;
  handoffSummaryJson: unknown;
  nextSeedDraftJson: unknown;
};

const pendingHandoffRowSelect = {
  id: true,
  state: true,
  mesoNumber: true,
  focus: true,
  closedAt: true,
  handoffSummaryJson: true,
  nextSeedDraftJson: true,
} satisfies Prisma.MesocycleSelect;

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

  const canonicalSlots = rebuildCanonicalDraftSlots({
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

async function loadMaterializedHandoffArtifactsForPendingHandoff(input: {
  reader: PendingHandoffArtifactReader;
  source: HandoffSourceMesocycle;
  summary: MesocycleHandoffSummary | null;
  closedAt: Date;
}) {
  const roles = await loadHandoffRoleRows(input.reader as Tx, input.source.id);
  const candidateExerciseIds = Array.from(new Set(roles.map((role) => role.exerciseId)));
  const [constraints, workouts, latestReadiness] = await Promise.all([
    input.reader.constraints.findUnique({
      where: { userId: input.source.macroCycle.userId },
      select: { weeklySchedule: true, daysPerWeek: true, splitType: true },
    }),
    loadHandoffWorkoutRows(input.reader as Tx, {
      mesocycleId: input.source.id,
      candidateExerciseIds,
    }),
    getLatestReadinessSignalForReader(input.reader as Tx, input.source.macroCycle.userId),
  ]);

  return materializeHandoffArtifacts({
    source: input.source,
    constraints,
    roles,
    workouts,
    latestReadiness,
    closedAt: input.closedAt,
    existingSummary: input.summary,
  });
}

function shouldRefreshPendingHandoffArtifacts(input: {
  row: PendingHandoffRow;
  summary: MesocycleHandoffSummary | null;
  draft: NextCycleSeedDraft | null;
}): boolean {
  if (input.row.state !== "AWAITING_HANDOFF") {
    return false;
  }
  if (!input.summary || !input.draft) {
    return true;
  }
  if (!input.summary.recommendedDesign) {
    return true;
  }
  if (input.summary.carryForwardRecommendations.length === 0) {
    return true;
  }
  return false;
}

async function refreshPendingHandoffArtifactsIfNeeded(
  reader: PendingHandoffArtifactReader,
  row: PendingHandoffRow | null
): Promise<PendingHandoffRow | null> {
  if (!row || row.state !== "AWAITING_HANDOFF") {
    return row;
  }

  const summary = readMesocycleHandoffSummary(row.handoffSummaryJson);
  const storedDraft = readNextCycleSeedDraft(row.nextSeedDraftJson);
  if (!shouldRefreshPendingHandoffArtifacts({ row, summary, draft: storedDraft })) {
    return row;
  }

  const source = await loadHandoffSourceMesocycle(reader, row.id);
  const materialized = await loadMaterializedHandoffArtifactsForPendingHandoff({
    reader,
    source,
    summary,
    closedAt: row.closedAt ?? new Date(),
  });
  const refreshedDraft =
    storedDraft != null
      ? (() => {
          try {
            return sanitizeNextCycleSeedDraft({
              draft: storedDraft,
              sourceMesocycleId: source.id,
              fallbackDraft: materialized.recommendedNextSeed,
            });
          } catch {
            return materialized.recommendedNextSeed;
          }
        })()
      : materialized.recommendedNextSeed;

  return reader.mesocycle.update({
    where: { id: row.id },
    data: {
      handoffSummaryJson: materialized.summary as Prisma.InputJsonValue,
      nextSeedDraftJson: refreshedDraft as Prisma.InputJsonValue,
    },
    select: pendingHandoffRowSelect,
  }) as Promise<PendingHandoffRow>;
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
    select: pendingHandoffRowSelect,
  });
  const refreshed = await refreshPendingHandoffArtifactsIfNeeded(prisma, row);

  return mapPendingHandoffRow(refreshed);
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
    select: pendingHandoffRowSelect,
  });
  const refreshed = await refreshPendingHandoffArtifactsIfNeeded(prisma, row);

  return mapPendingHandoffRow(refreshed);
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
  const closedAt = new Date();
  const materialized = await loadMaterializedHandoffArtifactsForPendingHandoff({
    reader: tx,
    source,
    summary: null,
    closedAt,
  });

  return tx.mesocycle.update({
    where: { id: source.id },
    data: {
      state: "AWAITING_HANDOFF",
      isActive: false,
      closedAt,
      handoffSummaryJson: materialized.summary as Prisma.InputJsonValue,
      nextSeedDraftJson: materialized.recommendedNextSeed as Prisma.InputJsonValue,
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
    select: pendingHandoffRowSelect,
  });
  const refreshedPendingRow = await refreshPendingHandoffArtifactsIfNeeded(tx, pendingRow);

  if (!refreshedPendingRow || refreshedPendingRow.state !== "AWAITING_HANDOFF") {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }

  const summary = readMesocycleHandoffSummary(refreshedPendingRow.handoffSummaryJson);
  const storedDraft = readNextCycleSeedDraft(refreshedPendingRow.nextSeedDraftJson);
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
      : await loadMaterializedHandoffArtifactsForPendingHandoff({
          reader: tx,
          source,
          summary,
          closedAt: refreshedPendingRow.closedAt ?? new Date(),
        });
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
    select: pendingHandoffRowSelect,
  });
  const refreshedPendingRow = await refreshPendingHandoffArtifactsIfNeeded(tx, pendingRow);

  if (!refreshedPendingRow || refreshedPendingRow.state !== "AWAITING_HANDOFF") {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }

  const summary = readMesocycleHandoffSummary(refreshedPendingRow.handoffSummaryJson);
  if (!summary) {
    throw new Error("MESOCYCLE_HANDOFF_SUMMARY_MISSING");
  }

  const sanitizedDraft = sanitizeNextCycleSeedDraft({
    draft: input.draft,
    sourceMesocycleId: refreshedPendingRow.id,
    fallbackDraft:
      summary.recommendedNextSeed ??
      (() => {
        throw new Error("MESOCYCLE_HANDOFF_SUMMARY_MISSING");
      })(),
  });

  const updated = await tx.mesocycle.update({
    where: { id: refreshedPendingRow.id },
    data: {
      nextSeedDraftJson: sanitizedDraft as Prisma.InputJsonValue,
    },
    select: pendingHandoffRowSelect,
  });

  const mapped = mapPendingHandoffRow(updated);
  if (!mapped) {
    throw new Error("MESOCYCLE_HANDOFF_NOT_PENDING");
  }
  return mapped;
}
