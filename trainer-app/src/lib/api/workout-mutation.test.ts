import { describe, expect, it, vi } from "vitest";
import { WorkoutStatus, type Prisma } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));

import {
  executeWorkoutMutationInTransaction,
} from "./workout-mutation";

function makeTx(input?: {
  claimCount?: number;
  ownedWorkout?: { revision: number; status: WorkoutStatus } | null;
  mesocycleId?: string | null;
  selectedPlanClaimCount?: number;
}) {
  const claimedWorkout = {
    id: "workout-1",
    revision: 6,
    status: WorkoutStatus.IN_PROGRESS,
    mesocycleId: input?.mesocycleId ?? null,
  };
  return {
    workout: {
      updateMany: vi.fn().mockResolvedValue({ count: input?.claimCount ?? 1 }),
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(
          input?.claimCount === 0
            ? (input.ownedWorkout ?? null)
            : claimedWorkout,
        )
        .mockResolvedValue(claimedWorkout),
    },
    mesocycle: {
      findUnique: vi.fn().mockResolvedValue({ macroCycleId: "plan-a" }),
    },
    user: {
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: input?.selectedPlanClaimCount ?? 1 }),
      findUnique: vi.fn().mockResolvedValue({
        activeMacroCycleId:
          input?.selectedPlanClaimCount === 0 ? "plan-b" : "plan-a",
      }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("executeWorkoutMutationInTransaction", () => {
  it("claims the expected owner-scoped revision before running the mutation", async () => {
    const tx = makeTx();
    const mutate = vi.fn().mockResolvedValue("ok");

    await expect(
      executeWorkoutMutationInTransaction(
        tx,
        { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
        mutate,
      ),
    ).resolves.toEqual({ result: "ok", revision: 6 });

    expect(tx.workout.updateMany).toHaveBeenCalledWith({
      where: {
        id: "workout-1",
        userId: "user-1",
        revision: 5,
        status: { in: ["PLANNED", "IN_PROGRESS", "PARTIAL"] },
      },
      data: { revision: { increment: 1 } },
    });
    expect(mutate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: "workout-1", revision: 6 }),
    );
  });

  it("classifies missing and foreign workouts identically", async () => {
    const tx = makeTx({ claimCount: 0, ownedWorkout: null });

    await expect(
      executeWorkoutMutationInTransaction(
        tx,
        { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      code: "WORKOUT_NOT_FOUND",
      status: 404,
    });
  });

  it("classifies an owned stale revision as conflict", async () => {
    const tx = makeTx({
      claimCount: 0,
      ownedWorkout: { revision: 6, status: WorkoutStatus.IN_PROGRESS },
    });

    await expect(
      executeWorkoutMutationInTransaction(
        tx,
        { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      code: "WORKOUT_REVISION_CONFLICT",
      status: 409,
    });
  });

  it("classifies a current non-editable workout without running child writes", async () => {
    const tx = makeTx({
      claimCount: 0,
      ownedWorkout: { revision: 5, status: WorkoutStatus.COMPLETED },
    });
    const mutate = vi.fn();

    await expect(
      executeWorkoutMutationInTransaction(
        tx,
        { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
        mutate,
      ),
    ).rejects.toMatchObject({
      code: "WORKOUT_NOT_EDITABLE",
      status: 409,
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("claims the selected plan before mutating a mesocycle-linked workout", async () => {
    const tx = makeTx({ mesocycleId: "meso-a" });
    const mutate = vi.fn().mockResolvedValue("ok");

    await executeWorkoutMutationInTransaction(
      tx,
      { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
      mutate,
    );

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", activeMacroCycleId: "plan-a" },
      data: { activeMacroCycleId: "plan-a" },
    });
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("rolls back child mutation when the workout belongs to an inactive plan", async () => {
    const tx = makeTx({
      mesocycleId: "meso-a",
      selectedPlanClaimCount: 0,
    });
    const mutate = vi.fn();

    await expect(
      executeWorkoutMutationInTransaction(
        tx,
        { workoutId: "workout-1", userId: "user-1", expectedRevision: 5 },
        mutate,
      ),
    ).rejects.toMatchObject({
      code: "WORKOUT_NOT_EDITABLE",
      status: 409,
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
