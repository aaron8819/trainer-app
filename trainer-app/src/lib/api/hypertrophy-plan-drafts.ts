import { createHash, randomUUID } from "node:crypto";
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
  buildWeeklyHypertrophyDraft,
  compileAcceptedHypertrophySeed,
  compileAcceptedHypertrophySeedV3,
  compileAcceptedHypertrophySeedV4,
  copyAcceptedHypertrophySeedV4ToDraft,
  equipmentForCustomHypertrophyProfile,
  evaluatePersistedHypertrophyPlanHealth,
  getHypertrophyAuthoringStimulus,
  parseHypertrophyPlanDraft,
  parsePersistedHypertrophyPlanDraft,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanDraft,
  type HypertrophyPlanDraftV1,
  type HypertrophyPlanDraftV2,
  type ManualHypertrophyPreset,
  type ExecutableSeedProjectionV3,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  HYPERTROPHY_PLAN_HEALTH_CONFIRMATION_SCOPE_VERSION,
  HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
  buildHypertrophyPlanHealthAssessment,
  comparePlanHealthCodeUnits,
  healthRequiresWarningConfirmation,
  type ClassifiedHypertrophyPlanHealthIssue,
  type HypertrophyPlanHealth,
  type HypertrophyPlanHealthAssessment,
  type HypertrophyPlanHealthResult,
} from "@/lib/engine/hypertrophy-plan-health";
import {
  parseMeasurementColumns,
  type MeasurementSemantics,
} from "@/lib/exercise-measurement/semantics";
import { isExerciseMeasurementRolloutEnabled } from "@/lib/operations/exercise-measurement-rollout";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
} from "@/lib/engine/planning/v2";
import {
  resolveCanonicalLimitations,
  type ResolvedLimitations,
} from "@/lib/engine/limitation-policy";
import { CANONICAL_MUSCLE_IDS, getMusclePolicyByDisplayName } from "@/lib/engine/muscle-policy";
import { normalizeLiveInventoryForV2Materialization } from "./v2-materialization-live-inventory";
import {
  createInitialAcceptedSeedRevisionInTransaction,
  normalizeAcceptedHypertrophySeedV4,
} from "./mesocycle-seed-revision";
import { parseAcceptedSeedPayload } from "./slot-plan-seed-parser";
import { PlanManagementError } from "./plan-management-errors";

const FIVE_WEEKS_MS = 35 * 24 * 60 * 60 * 1000;

type DraftReader = Pick<
  Prisma.TransactionClient,
  "exercise" | "injury" | "userPreference"
>;

export type HypertrophyPlanDraftExerciseRow = Awaited<
  ReturnType<typeof loadExerciseRows>
>[number];

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

export function toAuthoringExercise(
  row: HypertrophyPlanDraftExerciseRow,
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
    measurement: parseMeasurementColumns(row),
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

async function loadLimitations(
  reader: DraftReader,
  userId: string,
): Promise<ResolvedLimitations> {
  const injuries = await reader.injury.findMany({
    where: { userId, isActive: true },
    select: { bodyPart: true },
  });
  return resolveCanonicalLimitations(injuries.map((injury) => injury.bodyPart));
}

function sameMeasurement(
  left: MeasurementSemantics,
  right: MeasurementSemantics,
): boolean {
  return (
    left.profile === right.profile &&
    left.repBasis === right.repBasis &&
    ("loadConvention" in left ? left.loadConvention : undefined) ===
      ("loadConvention" in right ? right.loadConvention : undefined)
  );
}

function assertPreservedMeasurementProvenance(input: {
  current: HypertrophyPlanDraft;
  submitted: HypertrophyPlanDraft;
}): void {
  const currentByPlacement = new Map<
    string,
    HypertrophyPlanDraftV2["sessions"][number]["exercises"][number]
  >();
  if (input.current.version === 2) {
    for (const session of input.current.sessions) {
      for (const exercise of session.exercises) {
        currentByPlacement.set(exercise.placementId, exercise);
      }
    }
  }

  if (input.submitted.version !== 2) {
    if (
      [...currentByPlacement.values()].some(
        (exercise) => exercise.preservedMeasurement != null,
      )
    ) {
      throw new PlanManagementError(
        "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
      );
    }
    return;
  }

  for (const session of input.submitted.sessions) {
    for (const submitted of session.exercises) {
      const current = currentByPlacement.get(submitted.placementId);
      const trusted = current?.preservedMeasurement;
      const candidate = submitted.preservedMeasurement;

      if (!trusted) {
        if (candidate) {
          throw new PlanManagementError(
            "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
          );
        }
        continue;
      }

      if (submitted.exerciseId !== current.exerciseId) {
        if (candidate) {
          throw new PlanManagementError(
            "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
          );
        }
        continue;
      }

      if (
        !candidate ||
        candidate.exerciseId !== submitted.exerciseId ||
        !sameMeasurement(candidate.measurement, trusted.measurement)
      ) {
        throw new PlanManagementError(
          "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
        );
      }
    }
  }
}

async function generateV2Draft(input: {
  reader: DraftReader;
  userId: string;
  settings: HypertrophyPlanDraftV1["settings"];
}): Promise<HypertrophyPlanDraftV1> {
  const [rows, preferences, limitations] = await Promise.all([
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
        limitations.recognizedTags.includes(
          key as (typeof limitations.recognizedTags)[number],
        ),
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
  authorMethod: "MANUAL" | "V2" | "WEEKLY";
  preset?: ManualHypertrophyPreset;
  creationId?: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(comparePlanHealthCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deterministicUuid(value: string): string {
  const characters = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = "8";
  const hex = characters.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  const planId = input.creationId
    ? deterministicUuid(`${input.userId}:plan:${input.creationId}`)
    : randomUUID();
  let slotIndex = 0;
  const createSlotId = input.creationId
    ? () => deterministicUuid(`${planId}:slot:${slotIndex++}`)
    : randomUUID;
  let draft: HypertrophyPlanDraft;
  try {
    draft =
      input.authorMethod === "V2"
        ? await generateV2Draft({ reader: prisma, userId: input.userId, settings })
        : input.authorMethod === "WEEKLY"
          ? buildWeeklyHypertrophyDraft({
              settings,
              sessionsPerWeek: input.sessionsPerWeek,
              preset: input.preset ?? "BLANK",
              createSlotId,
            })
          : buildManualHypertrophyDraft({
            settings,
            sessionsPerWeek: input.sessionsPerWeek,
            preset: input.preset ?? "BLANK",
            createSlotId,
          });
  } catch (error) {
    if (error instanceof PlanManagementError) throw error;
    throw new PlanManagementError("PLAN_GENERATION_FAILED");
  }
  const schedule = placeholderSchedule();
  try {
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
  } catch (error) {
    if (
      !input.creationId ||
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const existing = await prisma.macroCycle.findFirst({
      where: { id: planId, userId: input.userId },
      select: {
        name: true,
        hypertrophyDraft: { select: { payload: true, revision: true } },
      },
    });
    if (
      !existing?.hypertrophyDraft ||
      existing.name !== input.name ||
      stableStringify(existing.hypertrophyDraft.payload) !== stableStringify(draft)
    ) {
      throw new PlanManagementError("PLAN_CREATION_ID_CONFLICT");
    }
    return {
      planId,
      draftRevision: existing.hypertrophyDraft.revision,
    };
  }
  return { planId, draftRevision: 1 };
}

type HypertrophyPlanEditorDataBase = {
  planId: string;
  name: string;
  revision: number;
  updatedAt: string;
  exercises: HypertrophyAuthoringExercise[];
  limitationKeys: string[];
};

export type HypertrophyPlanV4PreviewReason = {
  code: "EMPTY_SESSION" | "EXERCISE_NOT_FOUND" | "MEASUREMENT_UNRESOLVED";
  message: string;
  slotId: string;
  placementId?: string;
};

export type HypertrophyPlanV4Preview =
  | { status: "INELIGIBLE"; reasons: HypertrophyPlanV4PreviewReason[] }
  | {
      status: "ELIGIBLE";
      reasons: [];
      hash: string;
      hashAlgorithm: "sha256";
      normalizedPlan: ReturnType<typeof compileAcceptedHypertrophySeedV4>;
      executablePlan: ExecutableSeedProjectionV3;
    };

export type HypertrophyPlanEditorDataV1 = HypertrophyPlanEditorDataBase & {
  draft: HypertrophyPlanDraftV1;
  health: HypertrophyPlanHealthResult;
  preview?: null;
};

export type HypertrophyPlanEditorDataV2 = HypertrophyPlanEditorDataBase & {
  draft: HypertrophyPlanDraftV2;
  health: HypertrophyPlanHealthResult;
  preview: HypertrophyPlanV4Preview;
};

export type HypertrophyPlanEditorData =
  | HypertrophyPlanEditorDataV1
  | HypertrophyPlanEditorDataV2;

export function deriveHypertrophyPlanV4Preview(input: {
  draft: HypertrophyPlanDraftV2;
  knownExerciseIds: ReadonlySet<string>;
  measurementByExerciseId: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof parseMeasurementColumns>>
  >;
}): HypertrophyPlanV4Preview {
  const reasons: HypertrophyPlanV4PreviewReason[] = [];
  input.draft.sessions.forEach((session) => {
    if (session.exercises.length === 0) {
      reasons.push({
        code: "EMPTY_SESSION",
        message: `${session.name} needs at least one exercise before preview.`,
        slotId: session.slotId,
      });
    }
    session.exercises.forEach((exercise) => {
      if (!input.knownExerciseIds.has(exercise.exerciseId)) {
        reasons.push({
          code: "EXERCISE_NOT_FOUND",
          message: `${session.name} contains an exercise that is no longer available.`,
          slotId: session.slotId,
          placementId: exercise.placementId,
        });
        return;
      }
      const hasPreservedMeasurement =
        exercise.preservedMeasurement?.exerciseId === exercise.exerciseId;
      if (
        !hasPreservedMeasurement &&
        !input.measurementByExerciseId.has(exercise.exerciseId)
      ) {
        reasons.push({
          code: "MEASUREMENT_UNRESOLVED",
          message: `${session.name} has an exercise without a supported measurement identity.`,
          slotId: session.slotId,
          placementId: exercise.placementId,
        });
      }
    });
  });
  if (reasons.length > 0) return { status: "INELIGIBLE", reasons };

  const accepted = compileAcceptedHypertrophySeedV4({
    draft: input.draft,
    measurementByExerciseId: input.measurementByExerciseId,
  });
  const normalized = normalizeAcceptedHypertrophySeedV4(accepted);
  return {
    status: "ELIGIBLE",
    reasons: [],
    hash: normalized.hash,
    hashAlgorithm: normalized.hashAlgorithm,
    normalizedPlan: accepted,
    executablePlan:
      normalized.executablePayload as unknown as ExecutableSeedProjectionV3,
  };
}

function v4PreviewFromRows(
  draft: HypertrophyPlanDraftV2,
  rows: HypertrophyPlanDraftExerciseRow[],
): HypertrophyPlanV4Preview {
  return deriveHypertrophyPlanV4Preview({
    draft,
    knownExerciseIds: new Set(rows.map((row) => row.id)),
    measurementByExerciseId: new Map(
      rows.flatMap((row) => {
        const measurement = parseMeasurementColumns(row);
        return measurement ? [[row.id, measurement] as const] : [];
      }),
    ),
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function projectSelectedPlanHealthCatalog(
  draft: HypertrophyPlanDraft,
  exercises: readonly HypertrophyAuthoringExercise[],
): unknown[] {
  const sorted = (values: readonly string[] | undefined) =>
    [...(values ?? [])].sort(comparePlanHealthCodeUnits);
  const catalogById = new Map(
    exercises.map((exercise) => [exercise.id, exercise]),
  );
  const selectedExerciseIds = [
    ...new Set(
      draft.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.exerciseId),
      ),
    ),
  ].sort(comparePlanHealthCodeUnits);

  return selectedExerciseIds.map((exerciseId) => {
    const exercise = catalogById.get(exerciseId);
    if (!exercise) return { exerciseId, availability: "MISSING" };
    return {
      exerciseId,
      availability: "PRESENT",
      facts: {
        name: exercise.name,
        aliases: sorted(exercise.aliases),
        movementPatterns: sorted(exercise.movementPatterns),
        primaryMuscleIds: sorted(exercise.primaryMuscleIds),
        secondaryMuscleIds: sorted(exercise.secondaryMuscleIds),
        stimulusByMuscleId: exercise.stimulusByMuscleId ?? null,
        equipment: sorted(exercise.equipment),
        contraindicationKeys: sorted(exercise.contraindicationKeys),
        isCompound: exercise.isCompound,
        isMainLiftEligible: exercise.isMainLiftEligible,
        measurement: exercise.measurement ?? null,
        timePerSetSec: exercise.timePerSetSec,
      },
    };
  });
}

export function buildHypertrophyPlanHealthConfirmationScope(input: {
  policyVersion: string;
  draftId: string;
  draftRevision: number;
  draft: HypertrophyPlanDraft;
  preview: HypertrophyPlanV4Preview | null;
  importantWarnings: readonly ClassifiedHypertrophyPlanHealthIssue[];
  exercises: readonly HypertrophyAuthoringExercise[];
  limitations: ResolvedLimitations;
}): string {
  const payload = {
    scopeVersion: HYPERTROPHY_PLAN_HEALTH_CONFIRMATION_SCOPE_VERSION,
    healthPolicyVersion: input.policyVersion,
    draft: {
      id: input.draftId,
      revision: input.draftRevision,
      prescriptionHash: sha256(input.draft),
      settings: input.draft.settings,
    },
    preview:
      input.preview?.status === "ELIGIBLE"
        ? {
            status: input.preview.status,
            hashAlgorithm: input.preview.hashAlgorithm,
            hash: input.preview.hash,
          }
        : input.preview == null
          ? { status: "NOT_APPLICABLE" }
          : {
              status: input.preview.status,
              reasons: [...input.preview.reasons].sort(
                (left, right) =>
                  comparePlanHealthCodeUnits(left.code, right.code) ||
                  comparePlanHealthCodeUnits(left.slotId, right.slotId) ||
                  comparePlanHealthCodeUnits(
                    left.placementId ?? "",
                    right.placementId ?? "",
                  ) ||
                  comparePlanHealthCodeUnits(left.message, right.message),
              ),
            },
    importantWarnings: input.importantWarnings
      .map((warning) => ({
        code: warning.code,
        tier: warning.tier,
        title: warning.title,
        explanation: warning.explanation,
        suggestedAction: warning.suggestedAction,
        affected: warning.affected ?? null,
        blocksFinalization: warning.blocksFinalization,
        requiresAcknowledgment: warning.requiresAcknowledgment,
      }))
      .sort((left, right) =>
        comparePlanHealthCodeUnits(stableStringify(left), stableStringify(right)),
      ),
    authoritativeContext: {
      selectedCatalog: projectSelectedPlanHealthCatalog(
        input.draft,
        input.exercises,
      ),
      equipmentProfile: input.draft.settings.equipmentProfile,
      limitations: {
        recognizedTags: [...input.limitations.recognizedTags].sort(
          comparePlanHealthCodeUnits,
        ),
        unrecognizedTexts: [...input.limitations.unrecognizedTexts].sort(
          comparePlanHealthCodeUnits,
        ),
      },
    },
  };
  return `${HYPERTROPHY_PLAN_HEALTH_CONFIRMATION_SCOPE_VERSION}.${sha256(payload)}`;
}

class InvalidPlanHealthResultError extends Error {}

function assertValidHealthResult(health: HypertrophyPlanHealth): void {
  if (
    !Array.isArray(health.blockers) ||
    !Array.isArray(health.warnings) ||
    !Array.isArray(health.muscles) ||
    !Array.isArray(health.sessions) ||
    [...health.blockers, ...health.warnings].some(
      (finding) =>
        !finding ||
        typeof finding.code !== "string" ||
        finding.code.length === 0 ||
        typeof finding.message !== "string" ||
        finding.message.length === 0,
    ) ||
    health.muscles.some(
      (muscle) =>
        !muscle ||
        typeof muscle.muscleId !== "string" ||
        !Number.isFinite(muscle.directSets) ||
        muscle.directSets < 0 ||
        !Number.isFinite(muscle.effectiveSets) ||
        muscle.effectiveSets < 0 ||
        !Number.isFinite(muscle.frequency) ||
        muscle.frequency < 0,
    ) ||
    health.sessions.some(
      (session) =>
        !session ||
        typeof session.slotId !== "string" ||
        session.slotId.length === 0 ||
        !Number.isFinite(session.estimatedMinutes) ||
        session.estimatedMinutes < 0,
    )
  ) {
    throw new InvalidPlanHealthResultError("PLAN_HEALTH_RESULT_INVALID");
  }
}

export function deriveDraftHealthAssessment(input: {
  draftId: string;
  draftRevision: number;
  draft: HypertrophyPlanDraft;
  rows: HypertrophyPlanDraftExerciseRow[];
  exercises: HypertrophyAuthoringExercise[];
  limitations: ResolvedLimitations;
  preview: HypertrophyPlanV4Preview | null;
  evaluateHealth?: typeof evaluatePersistedHypertrophyPlanHealth;
}): HypertrophyPlanHealthAssessment {
  const evaluated = (input.evaluateHealth ?? evaluatePersistedHypertrophyPlanHealth)({
    draft: input.draft,
    exercises: input.exercises,
    limitationKeys: input.limitations.recognizedTags,
  });
  assertValidHealthResult(evaluated);
  const health: HypertrophyPlanHealth = {
    blockers: [...evaluated.blockers],
    warnings: [...evaluated.warnings],
    muscles: [...evaluated.muscles],
    sessions: [...evaluated.sessions],
  };

  if (input.draft.version === 2) {
    if (input.limitations.unrecognizedTexts.length > 0) {
      health.blockers.push({
        code: "LIMITATION_UNRECOGNIZED",
        message:
          "An active exercise limitation is not recognized and must be reviewed before finalizing.",
      });
    }
    if (!isSupportedV4Topology(input.draft)) {
      health.blockers.push({
        code: "UNSUPPORTED_TOPOLOGY",
        message:
          "Finalization currently requires four non-empty sessions, four accumulation weeks, and a final deload week.",
      });
    }
    for (const reason of input.preview?.status === "INELIGIBLE"
      ? input.preview.reasons
      : []) {
      if (reason.code !== "MEASUREMENT_UNRESOLVED") continue;
      const exerciseId = input.draft.sessions
        .find((session) => session.slotId === reason.slotId)
        ?.exercises.find(
          (exercise) => exercise.placementId === reason.placementId,
        )?.exerciseId;
      health.blockers.push({
        code: "MEASUREMENT_UNRESOLVED",
        message:
          "An exercise does not have a supported measurement identity for exact execution.",
        slotId: reason.slotId,
        ...(exerciseId ? { exerciseId } : {}),
      });
    }
  }

  const assessment = buildHypertrophyPlanHealthAssessment({
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    evaluatedWeek: input.draft.version === 2 ? input.draft.weeks[0]?.week ?? null : 1,
    health,
    catalogExerciseCount: input.rows.length,
    equipmentProfile: input.draft.settings.equipmentProfile,
    recognizedLimitationCount: input.limitations.recognizedTags.length,
    unrecognizedLimitationsPresent:
      input.limitations.unrecognizedTexts.length > 0,
    sessionNameBySlotId: new Map(
      input.draft.sessions.map((session) => [session.slotId, session.name]),
    ),
    exerciseNameById: new Map(
      input.exercises.map((exercise) => [exercise.id, exercise.name]),
    ),
  });
  return {
    ...assessment,
    confirmationScope: buildHypertrophyPlanHealthConfirmationScope({
      policyVersion: assessment.policyVersion,
      draftId: input.draftId,
      draftRevision: input.draftRevision,
      draft: input.draft,
      preview: input.preview,
      importantWarnings: assessment.issues.filter(
        (issue) => issue.tier === "IMPORTANT_WARNING",
      ),
      exercises: input.exercises,
      limitations: input.limitations,
    }),
  };
}

export function safeDraftHealthAssessment(
  input: Parameters<typeof deriveDraftHealthAssessment>[0],
): HypertrophyPlanHealthResult {
  try {
    return deriveDraftHealthAssessment(input);
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
      draftId: input.draftId,
      draftRevision: input.draftRevision,
      reason:
        error instanceof InvalidPlanHealthResultError
          ? "RESULT_INVALID"
          : "EVALUATION_FAILED",
    };
  }
}

export async function loadHypertrophyPlanEditorData(
  userId: string,
  planId: string,
): Promise<HypertrophyPlanEditorData | null> {
  const [plan, rows, preferences, limitations] = await Promise.all([
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
  const draft = parsePersistedHypertrophyPlanDraft(
    plan.hypertrophyDraft.payload,
  );
  const favorites = new Set(preferences?.favoriteExerciseIds ?? []);
  const exercises = rows.map((row) => toAuthoringExercise(row, favorites));
  const preview = draft.version === 2 ? v4PreviewFromRows(draft, rows) : null;
  const health = safeDraftHealthAssessment({
    draftId: plan.id,
    draftRevision: plan.hypertrophyDraft.revision,
    draft,
    rows,
    exercises,
    limitations,
    preview,
  });
  return {
    planId: plan.id,
    name: plan.name,
    revision: plan.hypertrophyDraft.revision,
    updatedAt: plan.hypertrophyDraft.updatedAt.toISOString(),
    exercises,
    limitationKeys: limitations.recognizedTags,
    ...(draft.version === 2
      ? {
          draft,
          health,
          preview: preview!,
        }
      : {
          draft,
          health,
          preview: null,
        }),
  };
}

export async function saveHypertrophyPlanDraft(input: {
  userId: string;
  planId: string;
  expectedRevision: number;
  name: string;
  draft: HypertrophyPlanDraft;
}): Promise<{
  revision: number;
  updatedAt: string;
  health: HypertrophyPlanHealthResult;
  preview?: HypertrophyPlanV4Preview;
}> {
  const draft = parsePersistedHypertrophyPlanDraft(input.draft);
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
        select: {
          id: true,
          hypertrophyDraft: { select: { payload: true, revision: true } },
        },
      });
      if (!plan?.hypertrophyDraft) {
        throw new PlanManagementError("PLAN_DRAFT_NOT_FOUND");
      }
      if (plan.hypertrophyDraft.revision !== input.expectedRevision) {
        throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
          currentRevision: String(plan.hypertrophyDraft.revision),
        });
      }
      const current = parsePersistedHypertrophyPlanDraft(
        plan.hypertrophyDraft.payload,
      );
      assertPreservedMeasurementProvenance({ current, submitted: draft });
      const [rows, limitations] = await Promise.all([
        loadExerciseRows(tx),
        loadLimitations(tx, input.userId),
      ]);
      const exercises = rows.map((row) => toAuthoringExercise(row));
      const preview = draft.version === 2 ? v4PreviewFromRows(draft, rows) : null;
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
      const health = safeDraftHealthAssessment({
        draftId: plan.id,
        draftRevision: saved.revision,
        draft,
        rows,
        exercises,
        limitations,
        preview,
      });
      return {
        revision: saved.revision,
        updatedAt: saved.updatedAt.toISOString(),
        health,
        ...(preview ? { preview } : {}),
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
}): Promise<{
  revision: number;
  draft: HypertrophyPlanDraftV1;
  health: HypertrophyPlanHealthResult;
}> {
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
  const existing = parsePersistedHypertrophyPlanDraft(
    current.hypertrophyDraft.payload,
  );
  if (existing.version === 2) {
    throw new PlanManagementError("PLAN_VERSION_NOT_EXECUTABLE");
  }
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
  const revision = input.expectedRevision + 1;
  const reloaded = await loadHypertrophyPlanEditorData(input.userId, input.planId);
  const health =
    reloaded?.revision === revision
      ? reloaded.health
      : {
          status: "UNAVAILABLE" as const,
          policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
          draftId: input.planId,
          draftRevision: revision,
          reason: "RESULT_INVALID" as const,
        };
  return { revision, draft: generated, health };
}

function splitTypeFromProjection(value: unknown): SplitType {
  if (!isRecord(value)) return SplitType.CUSTOM;
  const splitType = value.splitType;
  return typeof splitType === "string" && splitType in SplitType
    ? (splitType as SplitType)
    : SplitType.CUSTOM;
}

function isSupportedV4Topology(draft: HypertrophyPlanDraftV2): boolean {
  const supportedWeeks = [
    "1:ACCUMULATION",
    "2:ACCUMULATION",
    "3:ACCUMULATION",
    "4:ACCUMULATION",
    "5:DELOAD",
  ];
  const actualWeeks = draft.weeks.map((week) => `${week.week}:${week.phase}`);
  return !(
    draft.sessions.length !== 4 ||
    draft.sessions.some((session) => session.exercises.length === 0) ||
    draft.weeks.some((week) =>
      draft.sessions.some((session) =>
        session.exercises.every((exercise) =>
          exercise.prescriptions.find((entry) => entry.week === week.week)
            ?.status === "OMIT",
        ),
      ),
    ) ||
    actualWeeks.length !== supportedWeeks.length ||
    actualWeeks.some((week, index) => week !== supportedWeeks[index])
  );
}

function assertSupportedV4Topology(draft: HypertrophyPlanDraftV2): void {
  if (!isSupportedV4Topology(draft)) {
    throw new PlanManagementError("PLAN_UNSUPPORTED_TOPOLOGY");
  }
}

export async function makeHypertrophyPlanReady(input: {
  userId: string;
  planId: string;
  expectedDraftRevision: number;
  warningConfirmationScope?: string;
  confirmedPreviewHash?: string;
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
        const [rows, limitations] = await Promise.all([
          loadExerciseRows(tx),
          loadLimitations(tx, input.userId),
        ]);
        const draft = parsePersistedHypertrophyPlanDraft(
          plan.hypertrophyDraft.payload,
        );
        const exercises = rows.map((row) => toAuthoringExercise(row));
        const preview = draft.version === 2 ? v4PreviewFromRows(draft, rows) : null;
        let health: HypertrophyPlanHealthAssessment;
        try {
          health = deriveDraftHealthAssessment({
            draftId: plan.id,
            draftRevision: plan.hypertrophyDraft.revision,
            draft,
            rows,
            exercises,
            limitations,
            preview,
          });
        } catch {
          throw new PlanManagementError("PLAN_HEALTH_EVALUATION_FAILED");
        }
        if (draft.version === 2) assertSupportedV4Topology(draft);
        if (
          draft.version === 2 &&
          limitations.unrecognizedTexts.length > 0
        ) {
          throw new PlanManagementError("PLAN_LIMITATION_UNRECOGNIZED", {
            scope: "custom_hypertrophy",
          });
        }
        if (health.summary.blockingSafety > 0) {
          const firstBlocker = health.issues.find(
            (issue) => issue.tier === "BLOCKING_SAFETY",
          );
          throw new PlanManagementError("PLAN_DRAFT_BLOCKED", {
            blockerCount: String(health.summary.blockingSafety),
            firstBlocker: firstBlocker?.explanation ?? null,
          });
        }
        if (
          healthRequiresWarningConfirmation(health) &&
          input.warningConfirmationScope !== health.confirmationScope
        ) {
          throw new PlanManagementError(
            "PLAN_WARNING_CONFIRMATION_REQUIRED",
            {
              warningCount: String(health.summary.importantWarnings),
              confirmationStatus: input.warningConfirmationScope
                ? "MISMATCH"
                : "MISSING",
            },
            { health },
          );
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
        let acceptedSeed;
        if (draft.version === 2) {
          if (!preview || preview.status !== "ELIGIBLE") {
            throw new PlanManagementError("PLAN_DRAFT_BLOCKED", {
              blockerCount: String(preview?.reasons.length ?? 1),
              firstBlocker: preview?.reasons[0]?.message ?? null,
            });
          }
          if (!input.confirmedPreviewHash || input.confirmedPreviewHash !== preview.hash) {
            throw new PlanManagementError("PLAN_PREVIEW_HASH_MISMATCH");
          }
          acceptedSeed = preview.normalizedPlan;
        } else {
          acceptedSeed =
            isExerciseMeasurementRolloutEnabled() && allSelectedExercisesClassified
              ? compileAcceptedHypertrophySeedV3({ draft, measurementByExerciseId })
              : compileAcceptedHypertrophySeed(draft);
        }
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
  const draft = accepted.version === 4
    ? copyAcceptedHypertrophySeedV4ToDraft(accepted)
    : parseHypertrophyPlanDraft({
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
