import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workoutFindFirst: vi.fn(),
  finisherOfferFindUnique: vi.fn(),
  workoutExerciseFindMany: vi.fn(),
  workoutDelete: vi.fn(),
  reconcileMesocycleLifecycle: vi.fn(),
  assessClosedHandoffDeletionInTransaction: vi.fn(),
}));

vi.mock("./workout-mutation", () => ({
  executeWorkoutMutation: async (
    _input: unknown,
    mutate: (transaction: unknown) => Promise<unknown>,
  ) => ({
    result: await mutate({
      workout: {
        findFirst: mocks.workoutFindFirst,
        delete: mocks.workoutDelete,
      },
      finisherOffer: {
        findUnique: mocks.finisherOfferFindUnique,
      },
      workoutExercise: {
        findMany: mocks.workoutExerciseFindMany,
        deleteMany: vi.fn(),
      },
      setLog: { deleteMany: vi.fn() },
      workoutSet: { deleteMany: vi.fn() },
    }),
    revision: 2,
  }),
}));

vi.mock("./mesocycle-lifecycle-reconciliation", () => ({
  reconcileMesocycleLifecycle: (...args: unknown[]) =>
    mocks.reconcileMesocycleLifecycle(...args),
  assessClosedHandoffDeletionInTransaction: (...args: unknown[]) =>
    mocks.assessClosedHandoffDeletionInTransaction(...args),
}));

import { deleteOwnedWorkout } from "./workout-deletion";

describe("workout deletion with Finisher rollout disabled", () => {
  const originalRollout = process.env.TRAINER_FINISHERS_ROLLOUT;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_FINISHERS_ROLLOUT;
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: null,
      mesocycle: null,
    });
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.workoutDelete.mockResolvedValue({ id: "workout-1" });
    mocks.finisherOfferFindUnique.mockRejectedValue(
      new Error('relation "FinisherOffer" does not exist'),
    );
  });

  afterEach(() => {
    if (originalRollout == null) {
      delete process.env.TRAINER_FINISHERS_ROLLOUT;
    } else {
      process.env.TRAINER_FINISHERS_ROLLOUT = originalRollout;
    }
  });

  it("preserves pre-migration deletion without touching the missing table", async () => {
    await expect(
      deleteOwnedWorkout({
        workoutId: "workout-1",
        userId: "owner-1",
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ result: { status: "deleted" } });

    expect(mocks.workoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ finisherOffer: expect.anything() }),
      }),
    );
    expect(mocks.finisherOfferFindUnique).not.toHaveBeenCalled();
    expect(mocks.workoutDelete).toHaveBeenCalledWith({
      where: { id: "workout-1" },
    });
  });

  it("retains the history conflict check when rollout is explicitly enabled", async () => {
    process.env.TRAINER_FINISHERS_ROLLOUT = "enabled";
    mocks.finisherOfferFindUnique.mockResolvedValue({ id: "offer-1" });

    await expect(
      deleteOwnedWorkout({
        workoutId: "workout-1",
        userId: "owner-1",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: "WORKOUT_FINISHER_HISTORY_CONFLICT",
      status: 409,
    });

    expect(mocks.finisherOfferFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
  });
});
