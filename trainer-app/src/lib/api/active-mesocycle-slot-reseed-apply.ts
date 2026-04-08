import type { Prisma } from "@prisma/client";
import type { ActiveMesocycleSlotReseedRecommendation } from "@/lib/audit/workout-audit/types";
import { prisma } from "@/lib/db/prisma";

const TARGET_SLOT_IDS = ["upper_a", "upper_b"] as const;

type TargetSlotId = (typeof TARGET_SLOT_IDS)[number];
type SeedRole = "CORE_COMPOUND" | "ACCESSORY";
type SeedSlotExercise = {
  exerciseId: string;
  role: SeedRole;
};
type SeedSlotEntry = {
  slotId: string;
  exercises: SeedSlotExercise[];
};
type ParsedSeedRecord = {
  source: string;
  slots: SeedSlotEntry[];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSeedRole(value: unknown): value is SeedRole {
  return value === "CORE_COMPOUND" || value === "ACCESSORY";
}

function parseSeedRecord(slotPlanSeedJson: unknown): ParsedSeedRecord | null {
  const record = isRecord(slotPlanSeedJson) ? slotPlanSeedJson : null;
  const slotsValue = Array.isArray(record?.slots) ? record.slots : null;
  if (record?.version !== 1 || !slotsValue) {
    return null;
  }

  const slots: SeedSlotEntry[] = [];
  for (const entry of slotsValue) {
    const slot = isRecord(entry) ? entry : null;
    const slotId = typeof slot?.slotId === "string" ? slot.slotId.trim() : "";
    const exercisesValue = Array.isArray(slot?.exercises) ? slot.exercises : null;
    if (!slotId || !exercisesValue) {
      return null;
    }

    const exercises = exercisesValue.map((exercise) => {
      const seededExercise = isRecord(exercise) ? exercise : null;
      const exerciseId =
        typeof seededExercise?.exerciseId === "string"
          ? seededExercise.exerciseId.trim()
          : "";
      const role = seededExercise?.role;
      if (!exerciseId || !isSeedRole(role)) {
        return null;
      }
      return {
        exerciseId,
        role,
      } satisfies SeedSlotExercise;
    });

    if (exercises.some((exercise) => exercise == null)) {
      return null;
    }

    slots.push({
      slotId,
      exercises: exercises as SeedSlotExercise[],
    });
  }

  return {
    source:
      typeof record?.source === "string" && record.source.trim().length > 0
        ? record.source
        : "handoff_slot_plan_projection",
    slots,
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
