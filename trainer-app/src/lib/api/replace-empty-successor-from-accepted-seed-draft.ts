import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  parseSlotPlanSeedJson,
  type ParsedSlotPlanSeed,
} from "./slot-plan-seed-parser";
import { createCorrectiveSeedRevisionInTransaction } from "./mesocycle-seed-revision";

const RECOVERY_SOURCE = "persisted_accepted_seed_draft_successor_recovery";
const REPLACEMENT_SOURCE_PATH =
  "source.nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson";
const EXPECTED_SOURCE = "v2_materialized_seed";

type RecoveryVerdict = "safe_to_accept_upgrade" | "not_safe_to_apply";

type RecoveryBlocker =
  | "explicit_owner_email_required"
  | "explicit_source_mesocycle_id_required"
  | "explicit_successor_mesocycle_id_required"
  | "explicit_recovery_flag_required"
  | "explicit_write_confirmation_required"
  | "source_mesocycle_not_found"
  | "source_owner_mismatch"
  | "source_not_completed"
  | "source_still_active"
  | "accepted_seed_draft_missing"
  | "accepted_seed_draft_malformed"
  | "accepted_seed_draft_source_not_v2_materialized_seed"
  | "target_successor_not_found"
  | "target_owner_mismatch"
  | "target_not_active"
  | "target_not_active_accumulation"
  | "target_not_expected_successor"
  | "target_not_empty"
  | "target_workouts_exist"
  | "target_completed_or_partial_sessions_exist"
  | "target_workout_exercise_rows_exist"
  | "target_workout_set_rows_exist"
  | "target_set_logs_exist"
  | "target_performed_set_logs_exist"
  | "target_session_check_ins_exist"
  | "target_slot_sequence_missing"
  | "target_slot_plan_seed_missing"
  | "target_slot_order_incompatible"
  | "target_seed_already_matches"
  | "replacement_seed_malformed"
  | "replacement_seed_not_minimal"
  | "replacement_seed_set_count_missing"
  | "replacement_seed_exercise_missing"
  | "replacement_seed_anchor_missing";

type RecoveryMesocycleRow = {
  id: string;
  state: string;
  isActive: boolean;
  macroCycleId: string;
  mesoNumber: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  slotSequenceJson?: unknown;
  slotPlanSeedJson?: unknown;
  currentSeedRevision?: { seedPayload: unknown } | null;
  nextSeedDraftJson?: unknown;
  macroCycle: {
    userId: string;
    user: {
      email: string | null;
    };
  };
};

type RecoveryTx = {
  mesocycle: {
    findFirst(args: unknown): Promise<RecoveryMesocycleRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  workout: {
    count(args: unknown): Promise<number>;
  };
  workoutExercise: {
    count(args: unknown): Promise<number>;
  };
  workoutSet: {
    count(args: unknown): Promise<number>;
  };
  setLog: {
    count(args: unknown): Promise<number>;
  };
  sessionCheckIn: {
    count(args: unknown): Promise<number>;
  };
  exercise: {
    findMany(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
};

export type AcceptedSeedDraftSuccessorRecoveryResult = {
  version: 1;
  source: typeof RECOVERY_SOURCE;
  dryRun: boolean;
  writeRequested: boolean;
  verdict: RecoveryVerdict;
  reasons: string[];
  owner: {
    email: string;
    userId: string;
  };
  sourceMesocycle: {
    id: string;
    found: boolean;
    state?: string;
    isActive?: boolean;
    macroCycleId?: string;
    mesoNumber?: number;
  };
  targetSuccessor: {
    id: string;
    found: boolean;
    state?: string;
    isActive?: boolean;
    macroCycleId?: string;
    mesoNumber?: number;
    expectedMesoNumber?: number;
  };
  recoverySource: {
    replacementSource: typeof REPLACEMENT_SOURCE_PATH;
    freshV2Generated: false;
    persistedAcceptedSeedDraft: true;
    acceptedSeedDraftSource: string | null;
    candidateSeedSource: string | null;
  };
  guardSummary: {
    blockers: RecoveryBlocker[];
    sourceCompleted: boolean;
    targetActive: boolean;
    targetExpectedSuccessor: boolean;
    targetEmpty: boolean;
    currentSeedDiffers: boolean;
    replacementSeedMinimal: boolean;
    allExerciseIdsExist: boolean;
    allSetCountsExplicit: boolean;
    slotOrderCompatible: boolean;
    expectedAnchorsPresent: boolean;
    runtimeReplayCodeChangesRequired: false;
  };
  emptyTargetEvidence: {
    workoutCount: number;
    completedOrPartialSessionCount: number;
    workoutExerciseRowCount: number;
    workoutSetRowCount: number;
    setLogCount: number;
    performedSetLogCount: number;
    sessionCheckInCount: number;
  };
  seedComparison: {
    currentSource: string | null;
    candidateSource: string | null;
    currentSeedHash: string | null;
    candidateSeedHash: string | null;
    differs: boolean;
    changedSlotIds: string[];
    slotOrder: {
      targetSequence: string[];
      current: string[];
      candidate: string[];
      compatible: boolean;
    };
    anchors: {
      upperA: {
        old: SeedAnchorSummary | null;
        candidate: SeedAnchorSummary | null;
        expected: { exerciseName: "Barbell Bench Press"; setCount: 4 };
        matches: boolean;
      };
      lowerA: {
        old: SeedAnchorSummary | null;
        candidate: SeedAnchorSummary | null;
        expected: { exerciseName: "Barbell Back Squat"; setCount: 4 };
        matches: boolean;
      };
    };
  };
  seedRuntimeBoundary: {
    executableRowFields: ["exerciseId", "role", "setCount"];
    replacementSourceIsPersistedDraft: true;
    freshV2GenerationUsed: false;
    runtimeReplayUnchanged: true;
    runtimeConsumesPlannerMetadata: false;
    acceptedSeedShapeChanged: false;
  };
  write: {
    requested: boolean;
    confirmationProvided: boolean;
    eligible: boolean;
    dbWriteOccurred: boolean;
    transactionStatus: "not_requested" | "no_write" | "success";
    updatedFields: ["currentSeedRevisionId"] | [];
  };
  safety: {
    liveDbMutated: boolean;
    newSuccessorCreated: false;
    workoutsLogsSessionsCreated: false;
    directSqlUsed: false;
    runtimeReplayChanged: false;
    seedShapeChangedBeyondAcceptedSeed: false;
  };
};

export type ReplaceEmptySuccessorFromAcceptedSeedDraftInput = {
  userId: string;
  ownerEmail: string;
  sourceMesocycleId: string;
  successorMesocycleId: string;
  replaceEmptySuccessorFromAcceptedSeedDraft?: boolean;
  write?: boolean;
  confirmAcceptedSeedDraftSuccessorRecovery?: boolean;
  dependencies?: {
    prismaClient?: typeof prisma;
  };
};

type SeedAnchorSummary = {
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  setCount: number | null;
};

type RecoveryInspection = {
  sourceMesocycle: RecoveryMesocycleRow | null;
  targetSuccessor: RecoveryMesocycleRow | null;
  acceptedSeedDraftSource: string | null;
  candidateSeedJson: unknown;
  candidateSeed: ParsedSlotPlanSeed | null;
  currentSeed: ParsedSlotPlanSeed | null;
  exerciseNameById: Map<string, string>;
  emptyTargetEvidence: AcceptedSeedDraftSuccessorRecoveryResult["emptyTargetEvidence"];
  blockers: RecoveryBlocker[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function readRawSlots(seedJson: unknown): unknown[] {
  const seed = isRecord(seedJson) ? seedJson : null;
  return Array.isArray(seed?.slots) ? seed.slots : [];
}

function seedHasOnlyMinimalExecutableRows(seedJson: unknown): boolean {
  for (const rawSlot of readRawSlots(seedJson)) {
    const slot = isRecord(rawSlot) ? rawSlot : null;
    const exercises = Array.isArray(slot?.exercises) ? slot.exercises : null;
    if (!exercises) {
      return false;
    }
    for (const rawExercise of exercises) {
      if (!isRecord(rawExercise)) {
        return false;
      }
      const keys = Object.keys(rawExercise).sort();
      if (stableStringify(keys) !== stableStringify(["exerciseId", "role", "setCount"])) {
        return false;
      }
    }
  }
  return true;
}

function allSetCountsExplicit(seed: ParsedSlotPlanSeed | null): boolean {
  return Boolean(
    seed &&
      seed.slots.every((slot) =>
        slot.exercises.every((exercise) => exercise.hasExplicitSetCount),
      ),
  );
}

function collectExerciseIds(seed: ParsedSlotPlanSeed | null): string[] {
  return Array.from(
    new Set(
      seed?.slots.flatMap((slot) =>
        slot.exercises.map((exercise) => exercise.exerciseId),
      ) ?? [],
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function readAcceptedSeedDraft(nextSeedDraftJson: unknown): {
  draftMissing: boolean;
  draftMalformed: boolean;
  acceptedSeedDraftSource: string | null;
  candidateSeedJson: unknown;
} {
  const draft = isRecord(nextSeedDraftJson) ? nextSeedDraftJson : null;
  if (!draft || !Object.prototype.hasOwnProperty.call(draft, "acceptedSeedDraft")) {
    return {
      draftMissing: true,
      draftMalformed: false,
      acceptedSeedDraftSource: null,
      candidateSeedJson: undefined,
    };
  }

  const acceptedSeedDraft = isRecord(draft.acceptedSeedDraft)
    ? draft.acceptedSeedDraft
    : null;
  if (!acceptedSeedDraft || !("slotPlanSeedJson" in acceptedSeedDraft)) {
    return {
      draftMissing: false,
      draftMalformed: true,
      acceptedSeedDraftSource:
        typeof acceptedSeedDraft?.source === "string"
          ? acceptedSeedDraft.source
          : null,
      candidateSeedJson: undefined,
    };
  }

  return {
    draftMissing: false,
    draftMalformed: false,
    acceptedSeedDraftSource:
      typeof acceptedSeedDraft.source === "string"
        ? acceptedSeedDraft.source
        : null,
    candidateSeedJson: acceptedSeedDraft.slotPlanSeedJson,
  };
}

function slotIdsFromSeed(seed: ParsedSlotPlanSeed | null): string[] {
  return seed?.slots.map((slot) => slot.slotId) ?? [];
}

function slotIdsFromSequence(slotSequenceJson: unknown): string[] {
  const sequence = isRecord(slotSequenceJson) ? slotSequenceJson : null;
  const slots = Array.isArray(sequence?.slots) ? sequence.slots : [];
  return slots.flatMap((entry) => {
    const slot = isRecord(entry) ? entry : null;
    return typeof slot?.slotId === "string" && slot.slotId.trim().length > 0
      ? [slot.slotId.trim()]
      : [];
  });
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => right[index] === value);
}

function summarizeAnchor(input: {
  seed: ParsedSlotPlanSeed | null;
  slotId: string;
  exerciseNameById: Map<string, string>;
}): SeedAnchorSummary | null {
  const anchor = input.seed?.slots.find((slot) => slot.slotId === input.slotId)
    ?.exercises[0];
  if (!anchor) {
    return null;
  }
  return {
    slotId: input.slotId,
    exerciseId: anchor.exerciseId,
    exerciseName: input.exerciseNameById.get(anchor.exerciseId) ?? anchor.exerciseId,
    setCount: anchor.setCount ?? null,
  };
}

function anchorMatches(
  anchor: SeedAnchorSummary | null,
  expected: { exerciseName: string; setCount: number },
): boolean {
  return (
    anchor?.exerciseName === expected.exerciseName &&
    anchor.setCount === expected.setCount
  );
}

function sourceMatchesV2(input: {
  acceptedSeedDraftSource: string | null;
  candidateSeed: ParsedSlotPlanSeed | null;
}): boolean {
  if (input.candidateSeed?.source !== EXPECTED_SOURCE) {
    return false;
  }
  return (
    input.acceptedSeedDraftSource == null ||
    input.acceptedSeedDraftSource === EXPECTED_SOURCE
  );
}

async function loadMesocyclePair(
  tx: RecoveryTx,
  input: ReplaceEmptySuccessorFromAcceptedSeedDraftInput,
): Promise<{
  sourceMesocycle: RecoveryMesocycleRow | null;
  targetSuccessor: RecoveryMesocycleRow | null;
}> {
  const select = {
    id: true,
    state: true,
    isActive: true,
    macroCycleId: true,
    mesoNumber: true,
    accumulationSessionsCompleted: true,
    deloadSessionsCompleted: true,
    slotSequenceJson: true,
    slotPlanSeedJson: true,
    currentSeedRevision: { select: { seedPayload: true } },
    nextSeedDraftJson: true,
    macroCycle: {
      select: {
        userId: true,
        user: { select: { email: true } },
      },
    },
  };

  const [sourceMesocycle, targetSuccessor] = await Promise.all([
    tx.mesocycle.findFirst({
      where: {
        id: input.sourceMesocycleId,
        macroCycle: { userId: input.userId },
      },
      select,
    }),
    tx.mesocycle.findFirst({
      where: {
        id: input.successorMesocycleId,
        macroCycle: { userId: input.userId },
      },
      select,
    }),
  ]);

  if (sourceMesocycle?.currentSeedRevision?.seedPayload) {
    sourceMesocycle.slotPlanSeedJson = sourceMesocycle.currentSeedRevision.seedPayload;
  }
  if (targetSuccessor?.currentSeedRevision?.seedPayload) {
    targetSuccessor.slotPlanSeedJson = targetSuccessor.currentSeedRevision.seedPayload;
  }

  return { sourceMesocycle, targetSuccessor };
}

async function inspectRecovery(
  tx: RecoveryTx,
  input: ReplaceEmptySuccessorFromAcceptedSeedDraftInput,
): Promise<RecoveryInspection> {
  const { sourceMesocycle, targetSuccessor } = await loadMesocyclePair(tx, input);
  const acceptedDraft = readAcceptedSeedDraft(sourceMesocycle?.nextSeedDraftJson);
  const candidateSeed = parseSlotPlanSeedJson(acceptedDraft.candidateSeedJson);
  const currentSeed = parseSlotPlanSeedJson(targetSuccessor?.slotPlanSeedJson);
  const candidateExerciseIds = collectExerciseIds(candidateSeed);
  const currentExerciseIds = collectExerciseIds(currentSeed);
  const exerciseRows =
    candidateExerciseIds.length > 0 || currentExerciseIds.length > 0
      ? await tx.exercise.findMany({
          where: { id: { in: Array.from(new Set([...candidateExerciseIds, ...currentExerciseIds])) } },
          select: { id: true, name: true },
        })
      : [];
  const exerciseNameById = new Map(exerciseRows.map((row) => [row.id, row.name]));

  const emptyTargetEvidence = targetSuccessor
    ? {
        workoutCount: await tx.workout.count({
          where: { mesocycleId: targetSuccessor.id },
        }),
        completedOrPartialSessionCount: await tx.workout.count({
          where: {
            mesocycleId: targetSuccessor.id,
            status: { in: ["COMPLETED", "PARTIAL"] },
          },
        }),
        workoutExerciseRowCount: await tx.workoutExercise.count({
          where: { workout: { mesocycleId: targetSuccessor.id } },
        }),
        workoutSetRowCount: await tx.workoutSet.count({
          where: { workoutExercise: { workout: { mesocycleId: targetSuccessor.id } } },
        }),
        setLogCount: await tx.setLog.count({
          where: {
            workoutSet: {
              workoutExercise: { workout: { mesocycleId: targetSuccessor.id } },
            },
          },
        }),
        performedSetLogCount: await tx.setLog.count({
          where: {
            wasSkipped: false,
            workoutSet: {
              workoutExercise: { workout: { mesocycleId: targetSuccessor.id } },
            },
          },
        }),
        sessionCheckInCount: await tx.sessionCheckIn.count({
          where: { workout: { mesocycleId: targetSuccessor.id } },
        }),
      }
    : {
        workoutCount: 0,
        completedOrPartialSessionCount: 0,
        workoutExerciseRowCount: 0,
        workoutSetRowCount: 0,
        setLogCount: 0,
        performedSetLogCount: 0,
        sessionCheckInCount: 0,
      };

  const normalizedOwner = normalizeEmail(input.ownerEmail);
  const sourceOwnerMatches =
    normalizeEmail(sourceMesocycle?.macroCycle.user.email ?? "") === normalizedOwner;
  const targetOwnerMatches =
    normalizeEmail(targetSuccessor?.macroCycle.user.email ?? "") === normalizedOwner;
  const targetExpectedSuccessor = Boolean(
    sourceMesocycle &&
      targetSuccessor &&
      targetSuccessor.macroCycleId === sourceMesocycle.macroCycleId &&
      targetSuccessor.mesoNumber === sourceMesocycle.mesoNumber + 1,
  );
  const targetEmpty = Object.values(emptyTargetEvidence).every((value) => value === 0);
  const targetSequenceSlotIds = slotIdsFromSequence(targetSuccessor?.slotSequenceJson);
  const currentSlotIds = slotIdsFromSeed(currentSeed);
  const candidateSlotIds = slotIdsFromSeed(candidateSeed);
  const slotOrderCompatible =
    targetSequenceSlotIds.length > 0 &&
    arraysEqual(targetSequenceSlotIds, candidateSlotIds) &&
    arraysEqual(currentSlotIds, candidateSlotIds);
  const currentSeedDiffers =
    Boolean(targetSuccessor?.slotPlanSeedJson) &&
    stableStringify(targetSuccessor?.slotPlanSeedJson) !==
      stableStringify(acceptedDraft.candidateSeedJson);
  const replacementSeedMinimal =
    candidateSeed != null && seedHasOnlyMinimalExecutableRows(acceptedDraft.candidateSeedJson);
  const explicitSetCounts = allSetCountsExplicit(candidateSeed);
  const missingExerciseIds = candidateExerciseIds.filter(
    (exerciseId) => !exerciseNameById.has(exerciseId),
  );
  const upperA = summarizeAnchor({
    seed: candidateSeed,
    slotId: "upper_a",
    exerciseNameById,
  });
  const lowerA = summarizeAnchor({
    seed: candidateSeed,
    slotId: "lower_a",
    exerciseNameById,
  });
  const expectedAnchorsPresent =
    anchorMatches(upperA, { exerciseName: "Barbell Bench Press", setCount: 4 }) &&
    anchorMatches(lowerA, { exerciseName: "Barbell Back Squat", setCount: 4 });

  const blockers: RecoveryBlocker[] = [
    ...(sourceMesocycle ? [] : (["source_mesocycle_not_found"] as const)),
    ...(sourceMesocycle && sourceOwnerMatches ? [] : (["source_owner_mismatch"] as const)),
    ...(sourceMesocycle?.state === "COMPLETED" ? [] : (["source_not_completed"] as const)),
    ...(sourceMesocycle?.isActive === false ? [] : (["source_still_active"] as const)),
    ...(acceptedDraft.draftMissing ? (["accepted_seed_draft_missing"] as const) : []),
    ...(acceptedDraft.draftMalformed ? (["accepted_seed_draft_malformed"] as const) : []),
    ...(sourceMatchesV2({
      acceptedSeedDraftSource: acceptedDraft.acceptedSeedDraftSource,
      candidateSeed,
    })
      ? []
      : (["accepted_seed_draft_source_not_v2_materialized_seed"] as const)),
    ...(targetSuccessor ? [] : (["target_successor_not_found"] as const)),
    ...(targetSuccessor && targetOwnerMatches ? [] : (["target_owner_mismatch"] as const)),
    ...(targetSuccessor?.isActive === true ? [] : (["target_not_active"] as const)),
    ...(targetSuccessor?.state === "ACTIVE_ACCUMULATION"
      ? []
      : (["target_not_active_accumulation"] as const)),
    ...(targetExpectedSuccessor ? [] : (["target_not_expected_successor"] as const)),
    ...(targetSequenceSlotIds.length > 0 ? [] : (["target_slot_sequence_missing"] as const)),
    ...(targetSuccessor?.slotPlanSeedJson ? [] : (["target_slot_plan_seed_missing"] as const)),
    ...(emptyTargetEvidence.workoutCount === 0 ? [] : (["target_workouts_exist"] as const)),
    ...(emptyTargetEvidence.completedOrPartialSessionCount === 0
      ? []
      : (["target_completed_or_partial_sessions_exist"] as const)),
    ...(emptyTargetEvidence.workoutExerciseRowCount === 0
      ? []
      : (["target_workout_exercise_rows_exist"] as const)),
    ...(emptyTargetEvidence.workoutSetRowCount === 0
      ? []
      : (["target_workout_set_rows_exist"] as const)),
    ...(emptyTargetEvidence.setLogCount === 0 ? [] : (["target_set_logs_exist"] as const)),
    ...(emptyTargetEvidence.performedSetLogCount === 0
      ? []
      : (["target_performed_set_logs_exist"] as const)),
    ...(emptyTargetEvidence.sessionCheckInCount === 0
      ? []
      : (["target_session_check_ins_exist"] as const)),
    ...(targetEmpty ? [] : (["target_not_empty"] as const)),
    ...(candidateSeed ? [] : (["replacement_seed_malformed"] as const)),
    ...(replacementSeedMinimal ? [] : (["replacement_seed_not_minimal"] as const)),
    ...(explicitSetCounts ? [] : (["replacement_seed_set_count_missing"] as const)),
    ...(missingExerciseIds.length === 0 ? [] : (["replacement_seed_exercise_missing"] as const)),
    ...(slotOrderCompatible ? [] : (["target_slot_order_incompatible"] as const)),
    ...(currentSeedDiffers ? [] : (["target_seed_already_matches"] as const)),
    ...(expectedAnchorsPresent ? [] : (["replacement_seed_anchor_missing"] as const)),
  ];

  return {
    sourceMesocycle,
    targetSuccessor,
    acceptedSeedDraftSource: acceptedDraft.acceptedSeedDraftSource,
    candidateSeedJson: acceptedDraft.candidateSeedJson,
    candidateSeed,
    currentSeed,
    exerciseNameById,
    emptyTargetEvidence,
    blockers: Array.from(new Set(blockers)),
  };
}

function buildResult(input: {
  request: ReplaceEmptySuccessorFromAcceptedSeedDraftInput;
  inspection: RecoveryInspection;
  writeRequested: boolean;
  confirmationProvided: boolean;
  dbWriteOccurred: boolean;
  transactionStatus: AcceptedSeedDraftSuccessorRecoveryResult["write"]["transactionStatus"];
}): AcceptedSeedDraftSuccessorRecoveryResult {
  const { inspection } = input;
  const source = inspection.sourceMesocycle;
  const target = inspection.targetSuccessor;
  const verdict: RecoveryVerdict =
    inspection.blockers.length === 0 ? "safe_to_accept_upgrade" : "not_safe_to_apply";
  const targetSequence = slotIdsFromSequence(target?.slotSequenceJson);
  const currentSlotIds = slotIdsFromSeed(inspection.currentSeed);
  const candidateSlotIds = slotIdsFromSeed(inspection.candidateSeed);
  const slotOrderCompatible =
    targetSequence.length > 0 &&
    arraysEqual(targetSequence, candidateSlotIds) &&
    arraysEqual(currentSlotIds, candidateSlotIds);
  const currentSeedHash = stableHash(target?.slotPlanSeedJson);
  const candidateSeedHash = stableHash(inspection.candidateSeedJson);
  const changedSlotIds =
    inspection.currentSeed && inspection.candidateSeed
      ? inspection.currentSeed.slots
          .filter((slot, index) => {
            const candidateSlot = inspection.candidateSeed?.slots[index];
            return Boolean(candidateSlot) && stableStringify(slot) !== stableStringify(candidateSlot);
          })
          .map((slot) => slot.slotId)
      : [];
  const upperOld = summarizeAnchor({
    seed: inspection.currentSeed,
    slotId: "upper_a",
    exerciseNameById: inspection.exerciseNameById,
  });
  const lowerOld = summarizeAnchor({
    seed: inspection.currentSeed,
    slotId: "lower_a",
    exerciseNameById: inspection.exerciseNameById,
  });
  const upperCandidate = summarizeAnchor({
    seed: inspection.candidateSeed,
    slotId: "upper_a",
    exerciseNameById: inspection.exerciseNameById,
  });
  const lowerCandidate = summarizeAnchor({
    seed: inspection.candidateSeed,
    slotId: "lower_a",
    exerciseNameById: inspection.exerciseNameById,
  });
  const expectedAnchorsPresent =
    anchorMatches(upperCandidate, {
      exerciseName: "Barbell Bench Press",
      setCount: 4,
    }) &&
    anchorMatches(lowerCandidate, {
      exerciseName: "Barbell Back Squat",
      setCount: 4,
    });

  return {
    version: 1,
    source: RECOVERY_SOURCE,
    dryRun: !input.writeRequested,
    writeRequested: input.writeRequested,
    verdict,
    reasons:
      verdict === "safe_to_accept_upgrade"
        ? [
            "all guards passed",
            "candidate source is persisted acceptedSeedDraft slotPlanSeedJson",
            "target successor has no performed/runtime state",
          ]
        : inspection.blockers,
    owner: {
      email: input.request.ownerEmail,
      userId: input.request.userId,
    },
    sourceMesocycle: {
      id: input.request.sourceMesocycleId,
      found: Boolean(source),
      ...(source
        ? {
            state: source.state,
            isActive: source.isActive,
            macroCycleId: source.macroCycleId,
            mesoNumber: source.mesoNumber,
          }
        : {}),
    },
    targetSuccessor: {
      id: input.request.successorMesocycleId,
      found: Boolean(target),
      ...(target
        ? {
            state: target.state,
            isActive: target.isActive,
            macroCycleId: target.macroCycleId,
            mesoNumber: target.mesoNumber,
            expectedMesoNumber: source ? source.mesoNumber + 1 : undefined,
          }
        : {}),
    },
    recoverySource: {
      replacementSource: REPLACEMENT_SOURCE_PATH,
      freshV2Generated: false,
      persistedAcceptedSeedDraft: true,
      acceptedSeedDraftSource: inspection.acceptedSeedDraftSource,
      candidateSeedSource: inspection.candidateSeed?.source ?? null,
    },
    guardSummary: {
      blockers: inspection.blockers,
      sourceCompleted: source?.state === "COMPLETED" && source.isActive === false,
      targetActive:
        target?.state === "ACTIVE_ACCUMULATION" && target.isActive === true,
      targetExpectedSuccessor: Boolean(
        source &&
          target &&
          target.macroCycleId === source.macroCycleId &&
          target.mesoNumber === source.mesoNumber + 1,
      ),
      targetEmpty: Object.values(inspection.emptyTargetEvidence).every(
        (value) => value === 0,
      ),
      currentSeedDiffers: currentSeedHash != null && currentSeedHash !== candidateSeedHash,
      replacementSeedMinimal:
        inspection.candidateSeed != null &&
        seedHasOnlyMinimalExecutableRows(inspection.candidateSeedJson),
      allExerciseIdsExist: collectExerciseIds(inspection.candidateSeed).every(
        (exerciseId) => inspection.exerciseNameById.has(exerciseId),
      ),
      allSetCountsExplicit: allSetCountsExplicit(inspection.candidateSeed),
      slotOrderCompatible,
      expectedAnchorsPresent,
      runtimeReplayCodeChangesRequired: false,
    },
    emptyTargetEvidence: inspection.emptyTargetEvidence,
    seedComparison: {
      currentSource: inspection.currentSeed?.source ?? null,
      candidateSource: inspection.candidateSeed?.source ?? null,
      currentSeedHash,
      candidateSeedHash,
      differs: currentSeedHash != null && currentSeedHash !== candidateSeedHash,
      changedSlotIds,
      slotOrder: {
        targetSequence,
        current: currentSlotIds,
        candidate: candidateSlotIds,
        compatible: slotOrderCompatible,
      },
      anchors: {
        upperA: {
          old: upperOld,
          candidate: upperCandidate,
          expected: { exerciseName: "Barbell Bench Press", setCount: 4 },
          matches: anchorMatches(upperCandidate, {
            exerciseName: "Barbell Bench Press",
            setCount: 4,
          }),
        },
        lowerA: {
          old: lowerOld,
          candidate: lowerCandidate,
          expected: { exerciseName: "Barbell Back Squat", setCount: 4 },
          matches: anchorMatches(lowerCandidate, {
            exerciseName: "Barbell Back Squat",
            setCount: 4,
          }),
        },
      },
    },
    seedRuntimeBoundary: {
      executableRowFields: ["exerciseId", "role", "setCount"],
      replacementSourceIsPersistedDraft: true,
      freshV2GenerationUsed: false,
      runtimeReplayUnchanged: true,
      runtimeConsumesPlannerMetadata: false,
      acceptedSeedShapeChanged: false,
    },
    write: {
      requested: input.writeRequested,
      confirmationProvided: input.confirmationProvided,
      eligible: verdict === "safe_to_accept_upgrade",
      dbWriteOccurred: input.dbWriteOccurred,
      transactionStatus: input.transactionStatus,
      updatedFields: input.dbWriteOccurred ? ["currentSeedRevisionId"] : [],
    },
    safety: {
      liveDbMutated: input.dbWriteOccurred,
      newSuccessorCreated: false,
      workoutsLogsSessionsCreated: false,
      directSqlUsed: false,
      runtimeReplayChanged: false,
      seedShapeChangedBeyondAcceptedSeed: false,
    },
  };
}

function assertRequiredInput(
  input: ReplaceEmptySuccessorFromAcceptedSeedDraftInput,
): void {
  if (!input.ownerEmail || input.ownerEmail.trim().length === 0) {
    throw new Error("ACCEPTED_SEED_DRAFT_RECOVERY_OWNER_EMAIL_REQUIRED");
  }
  if (!input.sourceMesocycleId || input.sourceMesocycleId.trim().length === 0) {
    throw new Error("ACCEPTED_SEED_DRAFT_RECOVERY_SOURCE_MESOCYCLE_ID_REQUIRED");
  }
  if (
    !input.successorMesocycleId ||
    input.successorMesocycleId.trim().length === 0
  ) {
    throw new Error("ACCEPTED_SEED_DRAFT_RECOVERY_SUCCESSOR_MESOCYCLE_ID_REQUIRED");
  }
  if (input.replaceEmptySuccessorFromAcceptedSeedDraft !== true) {
    throw new Error("ACCEPTED_SEED_DRAFT_RECOVERY_EXPLICIT_FLAG_REQUIRED");
  }
  if (input.write && input.confirmAcceptedSeedDraftSuccessorRecovery !== true) {
    throw new Error("ACCEPTED_SEED_DRAFT_RECOVERY_CONFIRMATION_REQUIRED");
  }
}

export async function replaceEmptySuccessorFromAcceptedSeedDraft(
  input: ReplaceEmptySuccessorFromAcceptedSeedDraftInput,
): Promise<AcceptedSeedDraftSuccessorRecoveryResult> {
  assertRequiredInput(input);

  const client = input.dependencies?.prismaClient ?? prisma;
  const writeRequested = input.write === true;
  const confirmationProvided =
    input.confirmAcceptedSeedDraftSuccessorRecovery === true;
  const initialInspection = await client.$transaction((tx) =>
    inspectRecovery(tx as unknown as RecoveryTx, input),
  );

  if (!writeRequested) {
    return buildResult({
      request: input,
      inspection: initialInspection,
      writeRequested,
      confirmationProvided,
      dbWriteOccurred: false,
      transactionStatus: "not_requested",
    });
  }

  if (initialInspection.blockers.length > 0) {
    return buildResult({
      request: input,
      inspection: initialInspection,
      writeRequested,
      confirmationProvided,
      dbWriteOccurred: false,
      transactionStatus: "no_write",
    });
  }

  const writeInspection = await client.$transaction(async (tx) => {
    const currentInspection = await inspectRecovery(tx as unknown as RecoveryTx, input);
    if (currentInspection.blockers.length > 0 || !currentInspection.targetSuccessor) {
      return {
        inspection: currentInspection,
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
      };
    }

    await createCorrectiveSeedRevisionInTransaction(
      tx as Prisma.TransactionClient,
      {
        mesocycleId: currentInspection.targetSuccessor.id,
        seedPayload: currentInspection.candidateSeedJson,
        creationReason: "accepted_seed_draft_successor_correction",
        actorSource: "replace_empty_successor_from_accepted_seed_draft",
      },
    );

    return {
      inspection: currentInspection,
      dbWriteOccurred: true,
      transactionStatus: "success" as const,
    };
  });

  return buildResult({
    request: input,
    inspection: writeInspection.inspection,
    writeRequested,
    confirmationProvided,
    dbWriteOccurred: writeInspection.dbWriteOccurred,
    transactionStatus: writeInspection.transactionStatus,
  });
}
