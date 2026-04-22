import type { Prisma } from "@prisma/client";
import type { ActiveMesocycleSlotReseedRecommendation } from "@/lib/audit/workout-audit/types";
import { prisma } from "@/lib/db/prisma";
import {
  parseSlotPlanSeedJson,
  type ParsedSlotPlanSeed,
  type ParsedSlotPlanSeedExercise,
} from "./slot-plan-seed-parser";

const TARGET_SLOT_IDS = ["upper_a", "upper_b"] as const;

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

function cloneExercises(exercises: SeedSlotExercise[]): SeedSlotExercise[] {
  return exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    role: exercise.role,
  }));
}

function exercisesEqual(left: SeedSlotExercise[], right: SeedSlotExercise[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (exercise, index) =>
        exercise.exerciseId === right[index]?.exerciseId && exercise.role === right[index]?.role
    )
  );
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
        slotPlanSeedJson: true,
      },
    });

    if (!activeMesocycle) {
      throw new Error("ACTIVE_MESOCYCLE_RESEED_TARGET_NOT_FOUND");
    }

    const persistedSeedRecord = parseSeedRecord(activeMesocycle.slotPlanSeedJson);
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
      return {
        mesocycleId: activeMesocycle.id,
        targetSlotIds,
        changedSlotIds,
        applied: false,
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

    await tx.mesocycle.update({
      where: { id: activeMesocycle.id },
      data: {
        slotPlanSeedJson: patchedSeed,
      },
    });

    return {
      mesocycleId: activeMesocycle.id,
      targetSlotIds,
      changedSlotIds,
      applied: true,
    };
  });
}
