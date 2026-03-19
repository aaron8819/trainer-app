import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  Mesocycle,
  MesocycleExerciseRoleType,
  Prisma,
  SplitType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
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
  type NextCycleSeedSlot,
  type NextCycleSlotId,
} from "./mesocycle-handoff-contract";
import { buildMesocycleSlotSequence, type MesocycleSlotSequence } from "./mesocycle-slot-contract";

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
  NextCycleSeedDraft,
  NextCycleSeedSlot,
  NextCycleSlotId,
};

type Tx = Prisma.TransactionClient;
type ClosedMesocycleArchiveReader =
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

const nextCycleSeedDraftJsonSchema = nextCycleSeedDraftUpdateSchema.extend({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  startingPoint: z.object({
    volumePreset: z.literal("conservative_productive"),
    baselineRule: z.literal("peak_accumulation_else_highest_accumulation_else_non_deload"),
    excludeDeload: z.literal(true),
  }),
});

const handoffCarryForwardRecommendationSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string().min(1),
  sessionIntent: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"]),
  role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
  recommendation: z.enum(["keep", "rotate"]),
  signalQuality: z.enum(["high", "medium"]),
  reasonCodes: z.array(z.string()),
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
  recommendedNextSeed: nextCycleSeedDraftJsonSchema,
});

function buildRecommendedSlots(): NextCycleSeedSlot[] {
  return buildOrderedFlexibleSlots({
    splitType: "UPPER_LOWER",
    sessionsPerWeek: 4,
  });
}

const COMPATIBLE_KEEP_INTENT_REMAPS: Partial<
  Record<SplitType, Partial<Record<WorkoutSessionIntent, WorkoutSessionIntent>>>
> = {
  UPPER_LOWER: {
    PUSH: "UPPER",
    PULL: "UPPER",
    LEGS: "LOWER",
  },
};

function buildSlotSequence(draft: NextCycleSeedDraft): MesocycleSlotSequence {
  return buildMesocycleSlotSequence(draft.structure.slots);
}

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
  const compatibleRemaps = COMPATIBLE_KEEP_INTENT_REMAPS[input.splitType];
  if (!compatibleRemaps) {
    return input.carryForwardSelections;
  }

  const proposedKeyCounts = new Map<string, number>();
  for (const selection of input.carryForwardSelections) {
    const remappedIntent =
      selection.action === "keep" ? compatibleRemaps[selection.sessionIntent] : undefined;
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

    const remappedIntent = compatibleRemaps[selection.sessionIntent];
    if (!remappedIntent) {
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

function toCarryForwardSelection(row: HandoffRoleRow): NextCycleCarryForwardSelection {
  return {
    exerciseId: row.exerciseId,
    exerciseName: row.exercise.name,
    sessionIntent: row.sessionIntent,
    role: row.role,
    action: row.role === "CORE_COMPOUND" ? "keep" : "rotate",
  };
}

function toCarryForwardRecommendation(row: HandoffRoleRow): HandoffCarryForwardRecommendation {
  const recommendation = row.role === "CORE_COMPOUND" ? "keep" : "rotate";
  return {
    exerciseId: row.exerciseId,
    exerciseName: row.exercise.name,
    sessionIntent: row.sessionIntent,
    role: row.role,
    recommendation,
    signalQuality: row.role === "CORE_COMPOUND" ? "high" : "medium",
    reasonCodes:
      row.role === "CORE_COMPOUND"
        ? ["core_compound_continuity"]
        : ["accessory_rotation_default"],
  };
}

function buildRecommendedNextSeed(input: {
  sourceMesocycleId: string;
  createdAt: Date;
  roles: HandoffRoleRow[];
}): NextCycleSeedDraft {
  return normalizeNextCycleSeedDraft({
    version: 1,
    sourceMesocycleId: input.sourceMesocycleId,
    createdAt: input.createdAt.toISOString(),
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible",
      slots: buildRecommendedSlots(),
    },
    startingPoint: {
      volumePreset: "conservative_productive",
      baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload",
      excludeDeload: true,
    },
    carryForwardSelections: input.roles.map(toCarryForwardSelection),
  });
}

function buildHandoffSummary(input: {
  mesocycle: HandoffSourceMesocycle;
  closedAt: Date;
  weeklySequence: WorkoutSessionIntent[];
  roles: HandoffRoleRow[];
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
    carryForwardRecommendations: input.roles.map(toCarryForwardRecommendation),
    recommendedNextSeed: input.recommendedNextSeed,
  };
}

export function readNextCycleSeedDraft(value: unknown): NextCycleSeedDraft | null {
  const parsed = nextCycleSeedDraftJsonSchema.safeParse(value);
  return parsed.success ? normalizeNextCycleSeedDraft(parsed.data) : null;
}

export function readMesocycleHandoffSummary(value: unknown): MesocycleHandoffSummary | null {
  const parsed = mesocycleHandoffSummaryJsonSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return {
    ...parsed.data,
    recommendedNextSeed: normalizeNextCycleSeedDraft(parsed.data.recommendedNextSeed),
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

async function loadHandoffSourceMesocycle(tx: Tx, mesocycleId: string): Promise<HandoffSourceMesocycle> {
  const source = await tx.mesocycle.findUnique({
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
  const [constraints, roles] = await Promise.all([
    tx.constraints.findUnique({
      where: { userId: source.macroCycle.userId },
      select: { weeklySchedule: true },
    }),
    loadHandoffRoleRows(tx, mesocycleId),
  ]);

  const closedAt = new Date();
  const recommendedNextSeed = buildRecommendedNextSeed({
    sourceMesocycleId: source.id,
    createdAt: closedAt,
    roles,
  });
  const handoffSummary = buildHandoffSummary({
    mesocycle: source,
    closedAt,
    weeklySequence: constraints?.weeklySchedule ?? [],
    roles,
    recommendedNextSeed,
  });

  return tx.mesocycle.update({
    where: { id: source.id },
    data: {
      state: "AWAITING_HANDOFF",
      isActive: false,
      closedAt,
      handoffSummaryJson: handoffSummary as Prisma.InputJsonValue,
      nextSeedDraftJson: recommendedNextSeed as Prisma.InputJsonValue,
    },
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
  const draft = sanitizeNextCycleSeedDraft({
    draft: storedDraft,
    sourceMesocycleId: source.id,
    fallbackDraft: summary.recommendedNextSeed,
  });

  const next = await tx.mesocycle.create({
    data: {
      macroCycleId: source.macroCycleId,
      mesoNumber: source.mesoNumber + 1,
      startWeek: source.startWeek + source.durationWeeks,
      durationWeeks: source.durationWeeks,
      focus: source.focus,
      volumeTarget: source.volumeTarget,
      intensityBias: source.intensityBias,
      isActive: true,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: draft.structure.sessionsPerWeek,
      daysPerWeek: draft.structure.daysPerWeek,
      splitType: draft.structure.splitType,
      slotSequenceJson: buildSlotSequence(draft) as Prisma.InputJsonValue,
    },
  });

  if (source.blocks.length > 0) {
    await tx.trainingBlock.createMany({
      data: source.blocks.map((block) => ({
        mesocycleId: next.id,
        blockNumber: block.blockNumber,
        blockType: block.blockType,
        startWeek: block.startWeek + source.durationWeeks,
        durationWeeks: block.durationWeeks,
        volumeTarget: block.volumeTarget,
        intensityBias: block.intensityBias,
        adaptationType: block.adaptationType,
      })),
    });
  }

  const keptSelections = draft.carryForwardSelections.filter((selection) => selection.action === "keep");
  if (keptSelections.length > 0) {
    await tx.mesocycleExerciseRole.createMany({
      data: keptSelections.map((selection) => ({
        mesocycleId: next.id,
        exerciseId: selection.exerciseId,
        sessionIntent: selection.sessionIntent,
        role: selection.role,
        addedInWeek: 1,
      })),
      skipDuplicates: true,
    });
  }

  await tx.constraints.upsert({
    where: { userId: source.macroCycle.userId },
    update: {
      daysPerWeek: draft.structure.daysPerWeek,
      splitType: draft.structure.splitType,
      weeklySchedule: draft.structure.slots.map((slot) => slot.intent),
    },
    create: {
      userId: source.macroCycle.userId,
      daysPerWeek: draft.structure.daysPerWeek,
      splitType: draft.structure.splitType,
      weeklySchedule: draft.structure.slots.map((slot) => slot.intent),
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
    fallbackDraft: summary.recommendedNextSeed,
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
