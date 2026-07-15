import type { Prisma } from "@prisma/client";

export type SaveRouteMesocycleState =
  | "ACTIVE_ACCUMULATION"
  | "ACTIVE_DELOAD"
  | "AWAITING_HANDOFF"
  | "COMPLETED";

export function getClosedMesocycleSaveFenceReason(
  state: SaveRouteMesocycleState,
): string | null {
  switch (state) {
    case "AWAITING_HANDOFF":
      return "Mesocycle handoff is pending; workout saves are closed until the next cycle is accepted.";
    case "COMPLETED":
      return "Mesocycle is archived as completed; workout saves are closed.";
    default:
      return null;
  }
}

export function assertMesocycleAllowsWorkoutSave(
  state: SaveRouteMesocycleState,
): void {
  const reason = getClosedMesocycleSaveFenceReason(state);
  if (reason) {
    throw new Error(`MESOCYCLE_WORKOUT_SAVE_BLOCKED:${state}`);
  }
}

export function assertExistingWorkoutSaveAllowed(input: {
  existingWorkout: {
    status: string;
  } | null;
  hasExerciseRewrite: boolean;
  expectedRevision?: number | null;
}): void {
  const { existingWorkout } = input;
  if (!existingWorkout) {
    return;
  }
  if (input.hasExerciseRewrite && existingWorkout.status !== "PLANNED") {
    throw new Error("WORKOUT_IMMUTABLE");
  }
  if (input.expectedRevision == null) {
    throw new Error("EXPECTED_REVISION_REQUIRED");
  }
}

export async function assertTemplateBelongsToUser(
  tx: Prisma.TransactionClient,
  input: {
    templateId?: string | null;
    userId: string;
  },
): Promise<void> {
  if (!input.templateId) {
    return;
  }

  const template = await tx.workoutTemplate.findFirst({
    where: { id: input.templateId, userId: input.userId },
    select: { id: true },
  });
  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }
}

export async function assertValidCloseoutWeekCloseContext(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    weekCloseId?: string;
    mesocycleId: string | null;
    mesocycleWeekSnapshot?: number | null;
    receiptWeekInMeso?: number | null;
  },
): Promise<void> {
  if (!input.weekCloseId) {
    throw new Error("CLOSEOUT_WEEK_CLOSE_REQUIRED");
  }
  if (!input.mesocycleId) {
    throw new Error("CLOSEOUT_WEEK_CLOSE_INVALID");
  }

  const snapshotWeek = input.mesocycleWeekSnapshot ?? null;
  const receiptWeek = input.receiptWeekInMeso ?? null;
  if (
    snapshotWeek != null &&
    receiptWeek != null &&
    snapshotWeek !== receiptWeek
  ) {
    throw new Error("CLOSEOUT_WEEK_CLOSE_INVALID");
  }

  const targetWeek = snapshotWeek ?? receiptWeek;
  if (targetWeek == null) {
    throw new Error("CLOSEOUT_WEEK_CLOSE_INVALID");
  }

  const linkedWeekClose = await tx.mesocycleWeekClose.findFirst({
    where: {
      id: input.weekCloseId,
      mesocycleId: input.mesocycleId,
      targetWeek,
      mesocycle: {
        macroCycle: {
          userId: input.userId,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!linkedWeekClose) {
    throw new Error("CLOSEOUT_WEEK_CLOSE_INVALID");
  }
}
