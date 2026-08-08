import { randomUUID } from "node:crypto";
import {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleState,
  Prisma,
  SplitType,
  VolumeTarget,
  type TrainingAge,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  adaptV2MaterializedPlanToDraft,
  assertAcceptedCompatibilityAlignment,
  buildAcceptedCompatibilityProjections,
  buildManualHypertrophyDraft,
  compileAcceptedHypertrophySeed,
  compileAcceptedHypertrophySeedV3,
  equipmentForCustomHypertrophyProfile,
  evaluateHypertrophyPlanHealth,
  getHypertrophyAuthoringStimulus,
  parseHypertrophyPlanDraft,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanDraftV1,
  type HypertrophyPlanHealth,
  type ManualHypertrophyPreset,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { parseMeasurementColumns } from "@/lib/exercise-measurement/semantics";
import { isExerciseMeasurementRolloutEnabled } from "@/lib/operations/exercise-measurement-rollout";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
} from "@/lib/engine/planning/v2";
import { resolveCanonicalLimitations } from "@/lib/engine/limitation-policy";
import { CANONICAL_MUSCLE_IDS, getMusclePolicyByDisplayName } from "@/lib/engine/muscle-policy";
import { normalizeLiveInventoryForV2Materialization } from "./v2-materialization-live-inventory";
import { createInitialAcceptedSeedRevisionInTransaction } from "./mesocycle-seed-revision";
import { parseAcceptedSeedPayload } from "./slot-plan-seed-parser";
import { PlanManagementError } from "./plan-management-errors";

const FIVE_WEEKS_MS = 35 * 24 * 60 * 60 * 1000;

type DraftReader = Pick<
  Prisma.TransactionClient,
  "exercise" | "injury" | "userPreference"
>;

type ExerciseRow = Awaited<ReturnType<typeof loadExerciseRows>>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function activeContraindicationKeys(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, enabled]) =>
    enabled === true ? [key] : [],
  );
}

async function loadExerciseRows(reader: DraftReader) {
  return reader.exercise.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      movementPatterns: true,
      contraindications: true,
      isCompound: true,
      isMainLiftEligible: true,
      fatigueCost: true,
      timePerSetSec: true,
      measurementProfile: true,
      loadConvention: true,
      repBasis: true,
      aliases: { select: { alias: true } },
      exerciseEquipment: { select: { equipment: { select: { type: true } } } },
      exerciseMuscles: {
        select: {
          role: true,
          muscle: { select: { id: true, name: true } },
        },
      },
    },
  });
}

function canonicalMuscleId(id: string, name: string) {
  if (CANONICAL_MUSCLE_IDS.includes(id as (typeof CANONICAL_MUSCLE_IDS)[number])) {
    return id as (typeof CANONICAL_MUSCLE_IDS)[number];
  }
  return getMusclePolicyByDisplayName(name)?.id ?? null;
}

function toAuthoringExercise(
  row: ExerciseRow,
  favoriteExerciseIds: ReadonlySet<string> = new Set(),
): HypertrophyAuthoringExercise {
  const primaryMuscleIds = row.exerciseMuscles.flatMap((entry) => {
    const id = canonicalMuscleId(entry.muscle.id, entry.muscle.name);
    return entry.role === "PRIMARY" && id ? [id] : [];
  });
  const secondaryMuscleIds = row.exerciseMuscles.flatMap((entry) => {
    const id = canonicalMuscleId(entry.muscle.id, entry.muscle.name);
    return entry.role === "SECONDARY" && id ? [id] : [];
  });
  const exercise = {
    id: row.id,
    name: row.name,
    aliases: row.aliases.map((entry) => entry.alias),
    movementPatterns: row.movementPatterns.map((value) => value.toLowerCase()) as HypertrophyAuthoringExercise["movementPatterns"],
    primaryMuscleIds,
    secondaryMuscleIds,
    equipment: row.exerciseEquipment.map((entry) =>
      entry.equipment.type.toLowerCase(),
    ),
    contraindicationKeys: activeContraindicationKeys(row.contraindications),
    isCompound: row.isCompound,
    isMainLiftEligible: row.isMainLiftEligible,
    timePerSetSec: row.timePerSetSec,
    isFavorite: favoriteExerciseIds.has(row.id),
  };
  return {
    ...exercise,
    stimulusByMuscleId: Object.fromEntries(
      getHypertrophyAuthoringStimulus(exercise, 1),
    ),
  };
}

async function loadLimitations(reader: DraftReader, userId: string) {
  const injuries = await reader.injury.findMany({
    where: { userId, isActive: true },
    select: { bodyPart: true },
  });
  return resolveCanonicalLimitations(injuries.map((injury) => injury.bodyPart))
    .recognizedTags;
}

async function generateV2Draft(input: {
  reader: DraftReader;
  userId: string;
  settings: HypertrophyPlanDraftV1["settings"];
}): Promise<HypertrophyPlanDraftV1> {
  const [rows, preferences, limitationKeys] = await Promise.all([
    loadExerciseRows(input.reader),
    input.reader.userPreference.findUnique({
      where: { userId: input.userId },
      select: { avoidExerciseIds: true, favoriteExerciseIds: true },
    }),
    loadLimitations(input.reader, input.userId),
  ]);
  const policy = buildV2PlannerMesocyclePolicy();
  const inventory = normalizeLiveInventoryForV2Materialization(rows);
  const availableEquipment = equipmentForCustomHypertrophyProfile(
    input.settings.equipmentProfile,
  );
  const painConflictExerciseIds = rows
    .filter((row) =>
      activeContraindicationKeys(row.contraindications).some((key) =>
        limitationKeys.includes(key as (typeof limitationKeys)[number]),
      ),
    )
    .map((row) => row.id);
  const materializedPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: policy.exerciseSelectionPlan,
    inventory,
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    constraints: {
      avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
      favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
      painConflictExerciseIds,
      availableEquipment: availableEquipment
        ? [...availableEquipment]
        : undefined,
    },
  });
  return adaptV2MaterializedPlanToDraft({
    settings: input.settings,
    plannerPolicy: policy,
    materializedPlan,
  });
}

function placeholderSchedule() {
  const startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);
  return {
    startDate,
    endDate: new Date(startDate.getTime() + FIVE_WEEKS_MS),
  };
}

export type CreateCustomHypertrophyPlanInput = {
  userId: string;
  name: string;
  sessionsPerWeek: number;
  equipmentProfile: HypertrophyPlanDraftV1["settings"]["equipmentProfile"];
  sessionDurationMinutes: HypertrophyPlanDraftV1["settings"]["sessionDurationMinutes"];
  authorMethod: "MANUAL" | "V2";
  preset?: ManualHypertrophyPreset;
};

export async function createCustomHypertrophyPlan(
  input: CreateCustomHypertrophyPlanInput,
): Promise<{ planId: string; draftRevision: number }> {
  const owner = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { profile: { select: { trainingAge: true } } },
  });
  if (!owner?.profile) throw new PlanManagementError("PLAN_OWNER_NOT_READY");
  if (input.sessionsPerWeek < 2 || input.sessionsPerWeek > 6) {
    throw new PlanManagementError("PLAN_INVALID");
  }
  if (input.authorMethod === "V2" && input.sessionsPerWeek !== 4) {
    throw new PlanManagementError("PLAN_INVALID");
  }

  const settings = {
    equipmentProfile: input.equipmentProfile,
    sessionDurationMinutes: input.sessionDurationMinutes,
  } as const;
  let draft: HypertrophyPlanDraftV1;
  try {
    draft =
      input.authorMethod === "V2"
        ? await generateV2Draft({ reader: prisma, userId: input.userId, settings })
        : buildManualHypertrophyDraft({
            settings,
            sessionsPerWeek: input.sessionsPerWeek,
            preset: input.preset ?? "BLANK",
            createSlotId: randomUUID,
          });
  } catch (error) {
    if (error instanceof PlanManagementError) throw error;
    throw new PlanManagementError("PLAN_GENERATION_FAILED");
  }
  const schedule = placeholderSchedule();
  const planId = randomUUID();
  await prisma.macroCycle.create({
    data: {
      id: planId,
      userId: input.userId,
      name: input.name,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      durationWeeks: 5,
      scheduleAnchoredAt: null,
      trainingAge: owner.profile.trainingAge,
      primaryGoal: "HYPERTROPHY",
      hypertrophyDraft: {
        create: {
          payload: draft as unknown as Prisma.InputJsonValue,
          revision: 1,
        },
      },
    },
  });
  return { planId, draftRevision: 1 };
}

export type HypertrophyPlanEditorData = {
  planId: string;
  name: string;
  revision: number;
  updatedAt: string;
  draft: HypertrophyPlanDraftV1;
  health: HypertrophyPlanHealth;
  exercises: HypertrophyAuthoringExercise[];
  limitationKeys: string[];
};

export async function loadHypertrophyPlanEditorData(
  userId: string,
  planId: string,
): Promise<HypertrophyPlanEditorData | null> {
  const [plan, rows, preferences, limitationKeys] = await Promise.all([
    prisma.macroCycle.findFirst({
      where: {
        id: planId,
        userId,
        archivedAt: null,
        primaryGoal: "HYPERTROPHY",
      },
      select: {
        id: true,
        name: true,
        hypertrophyDraft: {
          select: { payload: true, revision: true, updatedAt: true },
        },
      },
    }),
    loadExerciseRows(prisma),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { favoriteExerciseIds: true },
    }),
    loadLimitations(prisma, userId),
  ]);
  if (!plan?.hypertrophyDraft) return null;
  const draft = parseHypertrophyPlanDraft(plan.hypertrophyDraft.payload);
  const favorites = new Set(preferences?.favoriteExerciseIds ?? []);
  const exercises = rows.map((row) => toAuthoringExercise(row, favorites));
  return {
    planId: plan.id,
    name: plan.name,
    revision: plan.hypertrophyDraft.revision,
    updatedAt: plan.hypertrophyDraft.updatedAt.toISOString(),
    draft,
    health: evaluateHypertrophyPlanHealth({
      draft,
      exercises,
      limitationKeys,
    }),
    exercises,
    limitationKeys,
  };
}

export async function saveHypertrophyPlanDraft(input: {
  userId: string;
  planId: string;
  expectedRevision: number;
  name: string;
  draft: HypertrophyPlanDraftV1;
}): Promise<{ revision: number; updatedAt: string }> {
  const draft = parseHypertrophyPlanDraft(input.draft);
  return prisma.$transaction(
    async (tx) => {
      const plan = await tx.macroCycle.findFirst({
        where: {
          id: input.planId,
          userId: input.userId,
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
          mesocycles: { none: {} },
        },
        select: { id: true, hypertrophyDraft: { select: { revision: true } } },
      });
      if (!plan?.hypertrophyDraft) {
        throw new PlanManagementError("PLAN_DRAFT_NOT_FOUND");
      }
      const updated = await tx.hypertrophyPlanDraft.updateMany({
        where: {
          macroCycleId: plan.id,
          revision: input.expectedRevision,
        },
        data: {
          payload: draft as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
          currentRevision: String(plan.hypertrophyDraft.revision),
        });
      }
      await tx.macroCycle.update({
        where: { id: plan.id },
        data: { name: input.name },
      });
      const saved = await tx.hypertrophyPlanDraft.findUniqueOrThrow({
        where: { macroCycleId: plan.id },
        select: { revision: true, updatedAt: true },
      });
      return {
        revision: saved.revision,
        updatedAt: saved.updatedAt.toISOString(),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function regenerateHypertrophyPlanDraft(input: {
  userId: string;
  planId: string;
  expectedRevision: number;
  replaceConfirmed: true;
}): Promise<{ revision: number; draft: HypertrophyPlanDraftV1 }> {
  const current = await prisma.macroCycle.findFirst({
    where: {
      id: input.planId,
      userId: input.userId,
      archivedAt: null,
      primaryGoal: "HYPERTROPHY",
      mesocycles: { none: {} },
    },
    select: { hypertrophyDraft: { select: { payload: true, revision: true } } },
  });
  if (!current?.hypertrophyDraft) {
    throw new PlanManagementError("PLAN_DRAFT_NOT_FOUND");
  }
  if (current.hypertrophyDraft.revision !== input.expectedRevision) {
    throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
      currentRevision: String(current.hypertrophyDraft.revision),
    });
  }
  const existing = parseHypertrophyPlanDraft(current.hypertrophyDraft.payload);
  if (existing.sessions.length !== 4) throw new PlanManagementError("PLAN_INVALID");
  let generated: HypertrophyPlanDraftV1;
  try {
    generated = await generateV2Draft({
      reader: prisma,
      userId: input.userId,
      settings: existing.settings,
    });
  } catch {
    throw new PlanManagementError("PLAN_GENERATION_FAILED");
  }
  const saved = await prisma.hypertrophyPlanDraft.updateMany({
    where: { macroCycleId: input.planId, revision: input.expectedRevision },
    data: {
      payload: generated as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
    },
  });
  if (saved.count !== 1) throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
  return { revision: input.expectedRevision + 1, draft: generated };
}

function splitTypeFromProjection(value: unknown): SplitType {
  if (!isRecord(value)) return SplitType.CUSTOM;
  const splitType = value.splitType;
  return typeof splitType === "string" && splitType in SplitType
    ? (splitType as SplitType)
    : SplitType.CUSTOM;
}

export async function makeHypertrophyPlanReady(input: {
  userId: string;
  planId: string;
  expectedDraftRevision: number;
  warningsConfirmed: boolean;
}): Promise<{ planId: string; mesocycleId: string; revisionId: string }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const plan = await tx.macroCycle.findFirst({
          where: {
            id: input.planId,
            userId: input.userId,
            archivedAt: null,
            primaryGoal: "HYPERTROPHY",
          },
          select: {
            id: true,
            trainingAge: true,
            hypertrophyDraft: {
              select: { payload: true, revision: true },
            },
            mesocycles: { select: { id: true } },
          },
        });
        if (!plan) throw new PlanManagementError("PLAN_NOT_FOUND");
        if (!plan.hypertrophyDraft) {
          throw new PlanManagementError("PLAN_DRAFT_NOT_FOUND");
        }
        if (
          plan.hypertrophyDraft.revision !== input.expectedDraftRevision
        ) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
            currentRevision: String(plan.hypertrophyDraft.revision),
          });
        }
        if (plan.mesocycles.length !== 0) {
          throw new PlanManagementError("PLAN_NOT_PREPARING");
        }

        const [rows, limitationKeys] = await Promise.all([
          loadExerciseRows(tx),
          loadLimitations(tx, input.userId),
        ]);
        const draft = parseHypertrophyPlanDraft(plan.hypertrophyDraft.payload);
        const health = evaluateHypertrophyPlanHealth({
          draft,
          exercises: rows.map((row) => toAuthoringExercise(row)),
          limitationKeys,
        });
        if (health.blockers.length > 0) {
          throw new PlanManagementError("PLAN_DRAFT_BLOCKED", {
            blockerCount: String(health.blockers.length),
            firstBlocker: health.blockers[0]?.message ?? null,
          });
        }
        if (health.warnings.length > 0 && !input.warningsConfirmed) {
          throw new PlanManagementError("PLAN_WARNING_CONFIRMATION_REQUIRED", {
            warningCount: String(health.warnings.length),
          });
        }

        const measurementByExerciseId = new Map(
          rows.flatMap((row) => {
            const measurement = parseMeasurementColumns(row);
            return measurement ? [[row.id, measurement] as const] : [];
          }),
        );
        const allSelectedExercisesClassified = draft.sessions.every((session) =>
          session.exercises.every((exercise) =>
            measurementByExerciseId.has(exercise.exerciseId),
          ),
        );
        const acceptedSeed =
          isExerciseMeasurementRolloutEnabled() && allSelectedExercisesClassified
            ? compileAcceptedHypertrophySeedV3({ draft, measurementByExerciseId })
            : compileAcceptedHypertrophySeed(draft);
        const projections = buildAcceptedCompatibilityProjections(acceptedSeed);
        assertAcceptedCompatibilityAlignment({
          acceptedSeed,
          ...projections,
        });
        const mesocycleId = randomUUID();
        await tx.mesocycle.create({
          data: {
            id: mesocycleId,
            macroCycleId: plan.id,
            mesoNumber: 1,
            startWeek: 0,
            durationWeeks: 5,
            focus: "Custom Hypertrophy",
            volumeTarget: VolumeTarget.MODERATE,
            intensityBias: IntensityBias.HYPERTROPHY,
            sessionsPerWeek: acceptedSeed.slots.length,
            daysPerWeek: acceptedSeed.slots.length,
            splitType: splitTypeFromProjection(projections.slotSequenceJson),
            slotSequenceJson:
              projections.slotSequenceJson as Prisma.InputJsonValue,
            slotPlanSeedJson:
              projections.slotPlanSeedJson as Prisma.InputJsonValue,
            state: MesocycleState.ACTIVE_ACCUMULATION,
            isActive: true,
            blocks: {
              create: [
                {
                  blockNumber: 1,
                  blockType: BlockType.ACCUMULATION,
                  startWeek: 0,
                  durationWeeks: 4,
                  volumeTarget: VolumeTarget.MODERATE,
                  intensityBias: IntensityBias.HYPERTROPHY,
                  adaptationType: AdaptationType.SARCOPLASMIC_HYPERTROPHY,
                },
                {
                  blockNumber: 2,
                  blockType: BlockType.DELOAD,
                  startWeek: 4,
                  durationWeeks: 1,
                  volumeTarget: VolumeTarget.LOW,
                  intensityBias: IntensityBias.HYPERTROPHY,
                  adaptationType: AdaptationType.RECOVERY,
                },
              ],
            },
          },
        });
        const revision = await createInitialAcceptedSeedRevisionInTransaction(
          tx,
          {
            mesocycleId,
            seedPayload: acceptedSeed,
            creationReason: "custom_hypertrophy_plan_make_ready",
            actorSource: "plan_management",
          },
        );
        const deleted = await tx.hypertrophyPlanDraft.deleteMany({
          where: {
            macroCycleId: plan.id,
            revision: input.expectedDraftRevision,
          },
        });
        if (deleted.count !== 1) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
        }
        await tx.macroCycle.update({
          where: { id: plan.id },
          data: { durationWeeks: 5 },
        });
        return { planId: plan.id, mesocycleId, revisionId: revision.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
    }
    throw error;
  }
}

export async function createEditableHypertrophyPlanCopy(input: {
  userId: string;
  sourcePlanId: string;
  name: string;
}): Promise<{ planId: string; draftRevision: number }> {
  const source = await prisma.macroCycle.findFirst({
    where: {
      id: input.sourcePlanId,
      userId: input.userId,
      archivedAt: null,
      primaryGoal: "HYPERTROPHY",
      hypertrophyDraft: null,
    },
    select: {
      trainingAge: true,
      mesocycles: {
        where: { isActive: true },
        take: 1,
        select: { currentSeedRevision: { select: { seedPayload: true } } },
      },
    },
  });
  const payload = source?.mesocycles[0]?.currentSeedRevision?.seedPayload;
  if (!source || !payload) throw new PlanManagementError("PLAN_COPY_UNAVAILABLE");
  let accepted;
  try {
    accepted = parseAcceptedSeedPayload(payload).acceptedSeed;
  } catch {
    throw new PlanManagementError("PLAN_COPY_UNAVAILABLE");
  }
  if (!accepted) throw new PlanManagementError("PLAN_COPY_UNAVAILABLE");
  const draft = parseHypertrophyPlanDraft({
    version: 1,
    settings: accepted.settings,
    sessions: accepted.slots.map((slot) => ({
      slotId: slot.slotId,
      name: slot.name,
      focus: slot.focus,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        workingSets: exercise.setCount,
        intent: exercise.intent,
      })),
    })),
  });
  const schedule = placeholderSchedule();
  const planId = randomUUID();
  await prisma.macroCycle.create({
    data: {
      id: planId,
      userId: input.userId,
      name: input.name,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      durationWeeks: 5,
      scheduleAnchoredAt: null,
      trainingAge: source.trainingAge as TrainingAge,
      primaryGoal: "HYPERTROPHY",
      hypertrophyDraft: {
        create: {
          payload: draft as unknown as Prisma.InputJsonValue,
          revision: 1,
        },
      },
    },
  });
  return { planId, draftRevision: 1 };
}
