import type { Prisma } from "@prisma/client";
import type { ActiveMesocycleSlotReseedRecommendation } from "@/lib/audit/workout-audit/types";
import { prisma } from "@/lib/db/prisma";
import {
  parseSlotPlanSeedJson,
  type ParsedSlotPlanSeed,
  type ParsedSlotPlanSeedExercise,
} from "./slot-plan-seed-parser";
import {
  createCorrectiveSeedRevisionInTransaction,
  mapSeedRevisionWriteError,
  normalizeAcceptedSeedPayload,
} from "./mesocycle-seed-revision";

const TARGET_SLOT_IDS = ["upper_a", "upper_b"] as const;
const SAFE_FULL_UPGRADE_VERDICT = "safe_to_accept_upgrade";

type TargetSlotId = (typeof TARGET_SLOT_IDS)[number];
type SeedSlotExercise = ParsedSlotPlanSeedExercise;
type ParsedSeedRecord = ParsedSlotPlanSeed & { source: string };

export type ApplyActiveMesocycleBoundedUpperSlotReseedInput = {
  userId: string;
  activeMesocycleId: string;
  candidateSlotPlanSeedJson: unknown;
  targetSlotIds: string[];
  dryRunVerdict: ActiveMesocycleSlotReseedRecommendation;
};

export type ApplyActiveMesocycleBoundedUpperSlotReseedResult = {
  mesocycleId: string;
  targetSlotIds: TargetSlotId[];
  changedSlotIds: TargetSlotId[];
  applied: boolean;
  previousRevision: number;
  revision: number;
  previousHash: string;
  hash: string;
};

export type AcceptActiveMesocycleSlotPlanSeedUpgradeInput = {
  userId: string;
  activeMesocycleId: string;
  candidateSlotPlanSeedJson: unknown;
  dryRunVerdict: ActiveMesocycleSlotReseedRecommendation;
};

export type AcceptActiveMesocycleSlotPlanSeedUpgradeResult = {
  mesocycleId: string;
  targetSlotIds: string[];
  changedSlotIds: string[];
  applied: boolean;
  previousRevision: number;
  revision: number;
  previousHash: string;
  hash: string;
};

function parseSeedRecord(slotPlanSeedJson: unknown): ParsedSeedRecord | null {
  const parsed = parseSlotPlanSeedJson(slotPlanSeedJson);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    source: parsed.source ?? "handoff_slot_plan_projection",
  };
}

function normalizeTargetSlotIds(targetSlotIds: string[]): TargetSlotId[] {
  const normalized = Array.from(
    new Set(
      targetSlotIds
        .map((slotId) => slotId.trim())
        .filter((slotId): slotId is TargetSlotId =>
          TARGET_SLOT_IDS.includes(slotId as TargetSlotId)
        )
    )
  );

  if (
    normalized.length !== TARGET_SLOT_IDS.length ||
    TARGET_SLOT_IDS.some((slotId) => !normalized.includes(slotId))
  ) {
    throw new Error("ACTIVE_MESOCYCLE_RESEED_BOUNDED_TARGET_INVALID");
  }

  return [...TARGET_SLOT_IDS];
}

function cloneExercises(
  exercises: SeedSlotExercise[]
): Array<{ exerciseId: string; name?: string; role: SeedSlotExercise["role"]; setCount?: number }> {
  return exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    ...(exercise.name ? { name: exercise.name } : {}),
    role: exercise.role,
    ...(exercise.setCount != null ? { setCount: exercise.setCount } : {}),
  }));
}

function exercisesEqual(left: SeedSlotExercise[], right: SeedSlotExercise[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (exercise, index) =>
        exercise.exerciseId === right[index]?.exerciseId &&
        exercise.name === right[index]?.name &&
        exercise.role === right[index]?.role &&
        exercise.setCount === right[index]?.setCount
    )
  );
}

function assertUniqueSlotIds(seed: ParsedSeedRecord, errorCode: string): void {
  const seen = new Set<string>();
  for (const slot of seed.slots) {
    if (seen.has(slot.slotId)) {
      throw new Error(`${errorCode}:${slot.slotId}`);
    }
    seen.add(slot.slotId);
  }
}

function assertCandidateSeedRuntimeReplayable(candidate: ParsedSeedRecord): void {
  for (const slot of candidate.slots) {
    if (slot.exercises.length === 0) {
      throw new Error(`ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SLOT_EMPTY:${slot.slotId}`);
    }
    for (const exercise of slot.exercises) {
      if (!exercise.hasExplicitSetCount) {
        throw new Error(
          `ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SET_COUNT_MISSING:${slot.slotId}:${exercise.exerciseId}`
        );
      }
    }
  }
}

function assertSlotSequenceCompatible(input: {
  persisted: ParsedSeedRecord;
  candidate: ParsedSeedRecord;
}): void {
  const persistedSlotIds = input.persisted.slots.map((slot) => slot.slotId);
  const candidateSlotIds = input.candidate.slots.map((slot) => slot.slotId);
  const compatible =
    persistedSlotIds.length === candidateSlotIds.length &&
    persistedSlotIds.every((slotId, index) => candidateSlotIds[index] === slotId);

  if (!compatible) {
    throw new Error("ACTIVE_MESOCYCLE_RESEED_SLOT_SEQUENCE_CHANGED");
  }
}

function collectExerciseIds(seed: ParsedSeedRecord): string[] {
  return Array.from(
    new Set(
      seed.slots.flatMap((slot) => slot.exercises.map((exercise) => exercise.exerciseId))
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function buildSlotPlanSeedUpgradeReplacement(input: {
  persistedSeedRecord: ParsedSeedRecord;
  candidateSeedRecord: ParsedSeedRecord;
}): {
  targetSlotIds: string[];
  changedSlotIds: string[];
  replacementSeed: Prisma.InputJsonValue;
} {
  assertUniqueSlotIds(
    input.persistedSeedRecord,
    "ACTIVE_MESOCYCLE_RESEED_PERSISTED_SLOT_DUPLICATE"
  );
  assertUniqueSlotIds(
    input.candidateSeedRecord,
    "ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SLOT_DUPLICATE"
  );
  assertSlotSequenceCompatible({
    persisted: input.persistedSeedRecord,
    candidate: input.candidateSeedRecord,
  });
  assertCandidateSeedRuntimeReplayable(input.candidateSeedRecord);

  const changedSlotIds = input.persistedSeedRecord.slots
    .filter((persistedSlot, index) => {
      const candidateSlot = input.candidateSeedRecord.slots[index];
      return (
        Boolean(candidateSlot) &&
        !exercisesEqual(persistedSlot.exercises, candidateSlot.exercises)
      );
    })
    .map((slot) => slot.slotId);

  return {
    targetSlotIds: input.persistedSeedRecord.slots.map((slot) => slot.slotId),
    changedSlotIds,
    replacementSeed: {
      version: 1,
      source: input.candidateSeedRecord.source,
      slots: input.candidateSeedRecord.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: cloneExercises(slot.exercises),
      })),
    } satisfies Prisma.InputJsonValue,
  };
}

export async function applyActiveMesocycleBoundedUpperSlotReseed(
  input: ApplyActiveMesocycleBoundedUpperSlotReseedInput
): Promise<ApplyActiveMesocycleBoundedUpperSlotReseedResult> {
  if (input.dryRunVerdict !== "safe_to_apply_bounded_reseed") {
    throw new Error(
      `ACTIVE_MESOCYCLE_RESEED_APPLY_REQUIRES_SAFE_VERDICT:${input.dryRunVerdict}`
    );
  }

  const targetSlotIds = normalizeTargetSlotIds(input.targetSlotIds);
  const candidateSeedRecord = parseSeedRecord(input.candidateSlotPlanSeedJson);
  if (!candidateSeedRecord) {
    throw new Error("ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SEED_INVALID");
  }

  const candidateBySlotId = new Map(candidateSeedRecord.slots.map((slot) => [slot.slotId, slot]));
  for (const slotId of targetSlotIds) {
    if (!candidateBySlotId.has(slotId)) {
      throw new Error(`ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SLOT_MISSING:${slotId}`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const activeMesocycle = await tx.mesocycle.findFirst({
      where: {
        id: input.activeMesocycleId,
        isActive: true,
        state: "ACTIVE_ACCUMULATION",
        macroCycle: { userId: input.userId },
      },
      select: {
        id: true,
        currentSeedRevisionId: true,
        currentSeedRevision: {
          select: { revision: true, seedPayload: true },
        },
      },
    });

    if (!activeMesocycle) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_TARGET_NOT_FOUND");
    }

    if (!activeMesocycle.currentSeedRevisionId || !activeMesocycle.currentSeedRevision) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_CURRENT_REVISION_MISSING");
    }
    const persistedSeedRecord = parseSeedRecord(
      activeMesocycle.currentSeedRevision.seedPayload,
    );
    if (!persistedSeedRecord) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_PERSISTED_SEED_INVALID");
    }

    const changedSlotIds = targetSlotIds.filter((slotId) => {
      const persistedSlot = persistedSeedRecord.slots.find((slot) => slot.slotId === slotId);
      const candidateSlot = candidateBySlotId.get(slotId);
      if (!persistedSlot || !candidateSlot) {
        throw new Error(`ACTIVE_MESOCYCLE_RESEED_SLOT_MISSING:${slotId}`);
      }
      return !exercisesEqual(persistedSlot.exercises, candidateSlot.exercises);
    });

    if (changedSlotIds.length === 0) {
      const hash = normalizeAcceptedSeedPayload(
        activeMesocycle.currentSeedRevision.seedPayload,
      ).hash;
      return {
        mesocycleId: activeMesocycle.id,
        targetSlotIds,
        changedSlotIds,
        applied: false,
        previousRevision: activeMesocycle.currentSeedRevision.revision,
        revision: activeMesocycle.currentSeedRevision.revision,
        previousHash: hash,
        hash,
      };
    }

    const patchedSeed = {
      version: 1,
      source: persistedSeedRecord.source,
      slots: persistedSeedRecord.slots.map((slot) => {
        if (!targetSlotIds.includes(slot.slotId as TargetSlotId)) {
          return {
            slotId: slot.slotId,
            exercises: cloneExercises(slot.exercises),
          };
        }

        const candidateSlot = candidateBySlotId.get(slot.slotId);
        if (!candidateSlot) {
          throw new Error(`ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SLOT_MISSING:${slot.slotId}`);
        }

        return {
          slotId: slot.slotId,
          exercises: cloneExercises(candidateSlot.exercises),
        };
      }),
    } satisfies Prisma.InputJsonValue;

    const previousHash = normalizeAcceptedSeedPayload(
      activeMesocycle.currentSeedRevision.seedPayload,
    ).hash;
    const correction = await createCorrectiveSeedRevisionInTransaction(tx, {
      mesocycleId: activeMesocycle.id,
      expectedCurrentRevisionId: activeMesocycle.currentSeedRevisionId,
      seedPayload: patchedSeed,
      creationReason: "bounded_upper_slot_correction",
      actorSource: "workout_audit_apply_bounded_reseed",
    });

    return {
      mesocycleId: activeMesocycle.id,
      targetSlotIds,
      changedSlotIds,
      applied: true,
      previousRevision: activeMesocycle.currentSeedRevision.revision,
      revision: correction.revision.revision,
      previousHash,
      hash: normalizeAcceptedSeedPayload(correction.revision.seedPayload).hash,
    };
  }).catch(mapSeedRevisionWriteError);
}

export async function acceptActiveMesocycleSlotPlanSeedUpgrade(
  input: AcceptActiveMesocycleSlotPlanSeedUpgradeInput
): Promise<AcceptActiveMesocycleSlotPlanSeedUpgradeResult> {
  if (input.dryRunVerdict !== SAFE_FULL_UPGRADE_VERDICT) {
    throw new Error(
      `ACTIVE_MESOCYCLE_RESEED_ACCEPT_REQUIRES_SAFE_VERDICT:${input.dryRunVerdict}`
    );
  }

  const candidateSeedRecord = parseSeedRecord(input.candidateSlotPlanSeedJson);
  if (!candidateSeedRecord) {
    throw new Error("ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SEED_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const activeMesocycle = await tx.mesocycle.findFirst({
      where: {
        id: input.activeMesocycleId,
        isActive: true,
        state: "ACTIVE_ACCUMULATION",
        macroCycle: { userId: input.userId },
      },
      select: {
        id: true,
        currentSeedRevisionId: true,
        currentSeedRevision: {
          select: { revision: true, seedPayload: true },
        },
      },
    });

    if (!activeMesocycle) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_TARGET_NOT_FOUND");
    }

    if (!activeMesocycle.currentSeedRevisionId || !activeMesocycle.currentSeedRevision) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_CURRENT_REVISION_MISSING");
    }
    const persistedSeedRecord = parseSeedRecord(
      activeMesocycle.currentSeedRevision.seedPayload,
    );
    if (!persistedSeedRecord) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_PERSISTED_SEED_INVALID");
    }

    const replacement = buildSlotPlanSeedUpgradeReplacement({
      persistedSeedRecord,
      candidateSeedRecord,
    });

    const candidateExerciseIds = collectExerciseIds(candidateSeedRecord);
    const foundExercises = await tx.exercise.findMany({
      where: { id: { in: candidateExerciseIds } },
      select: { id: true },
    });
    const foundExerciseIds = new Set(foundExercises.map((exercise) => exercise.id));
    const missingExerciseIds = candidateExerciseIds.filter(
      (exerciseId) => !foundExerciseIds.has(exerciseId)
    );
    if (missingExerciseIds.length > 0) {
      throw new Error(
        `ACTIVE_MESOCYCLE_RESEED_CANDIDATE_EXERCISE_MISSING:${missingExerciseIds.join(",")}`
      );
    }

    if (replacement.changedSlotIds.length === 0) {
      const hash = normalizeAcceptedSeedPayload(
        activeMesocycle.currentSeedRevision.seedPayload,
      ).hash;
      return {
        mesocycleId: activeMesocycle.id,
        targetSlotIds: replacement.targetSlotIds,
        changedSlotIds: replacement.changedSlotIds,
        applied: false,
        previousRevision: activeMesocycle.currentSeedRevision.revision,
        revision: activeMesocycle.currentSeedRevision.revision,
        previousHash: hash,
        hash,
      };
    }

    const previousHash = normalizeAcceptedSeedPayload(
      activeMesocycle.currentSeedRevision.seedPayload,
    ).hash;
    const correction = await createCorrectiveSeedRevisionInTransaction(tx, {
      mesocycleId: activeMesocycle.id,
      expectedCurrentRevisionId: activeMesocycle.currentSeedRevisionId,
      seedPayload: replacement.replacementSeed,
      creationReason: "accepted_slot_plan_upgrade",
      actorSource: "workout_audit_accept_slot_plan_upgrade",
    });

    return {
      mesocycleId: activeMesocycle.id,
      targetSlotIds: replacement.targetSlotIds,
      changedSlotIds: replacement.changedSlotIds,
      applied: true,
      previousRevision: activeMesocycle.currentSeedRevision.revision,
      revision: correction.revision.revision,
      previousHash,
      hash: normalizeAcceptedSeedPayload(correction.revision.seedPayload).hash,
    };
  }).catch(mapSeedRevisionWriteError);
}
