/** PostgreSQL-only concurrency coverage. Run through test:db:workout-mutations. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { executeWorkoutMutation } from "./workout-mutation";
import { persistWorkoutRow } from "./save-workout/persistence";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("runtime workout mutation CAS (PostgreSQL)", () => {
  let pool: Pool;
  let db: PrismaClient;
  let ownerId: string;
  let foreignOwnerId: string;
  let exerciseAId: string;
  let exerciseBId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const suffix = crypto.randomUUID();
    const [owner, foreignOwner, exerciseA, exerciseB] = await Promise.all([
      db.user.create({ data: { email: `mutation-owner-${suffix}@test.local` } }),
      db.user.create({ data: { email: `mutation-foreign-${suffix}@test.local` } }),
      db.exercise.create({ data: { name: `Mutation A ${suffix}`, jointStress: "LOW" } }),
      db.exercise.create({ data: { name: `Mutation B ${suffix}`, jointStress: "LOW" } }),
    ]);
    ownerId = owner.id;
    foreignOwnerId = foreignOwner.id;
    exerciseAId = exerciseA.id;
    exerciseBId = exerciseB.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pool?.end();
  });

  async function createWorkout() {
    return db.workout.create({
      data: {
        userId: ownerId,
        scheduledDate: new Date("2026-07-14T12:00:00.000Z"),
        exercises: {
          create: {
            exerciseId: exerciseAId,
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            sets: { create: { setIndex: 1, targetReps: 8 } },
          },
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
  }

  it("allows exactly one concurrent structural mutation for one revision", async () => {
    const workout = await createWorkout();
    const original = workout.exercises[0];
    const addExercise = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: exerciseBId,
          orderIndex: 1,
          section: "ACCESSORY",
          isMainLift: false,
          sets: { create: { setIndex: 1, targetReps: 12 } },
        },
      }),
    );
    const swapExercise = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutExercise.update({
        where: { id: original.id },
        data: { exerciseId: exerciseBId },
      }),
    );

    const results = await Promise.allSettled([addExercise, swapExercise]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const stored = await db.workout.findUniqueOrThrow({
      where: { id: workout.id },
      include: { exercises: { orderBy: { orderIndex: "asc" }, include: { sets: true } } },
    });
    expect(stored.revision).toBe(workout.revision + 1);
    expect(stored.exercises.length === 1 || stored.exercises.length === 2).toBe(true);
    if (stored.exercises.length === 2) {
      expect(stored.exercises[0].exerciseId).toBe(exerciseAId);
      expect(stored.exercises[1].sets).toHaveLength(1);
    } else {
      expect(stored.exercises[0].exerciseId).toBe(exerciseBId);
    }
  });

  it("serializes log-versus-structure races without a partial loser", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.setLog.create({
        data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
      }),
    );
    const addSet = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutSet.create({
        data: { workoutExerciseId: workoutExercise.id, setIndex: 2, targetReps: 8 },
      }),
    );

    const results = await Promise.allSettled([log, addSet]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [stored, logCount, setCount] = await Promise.all([
      db.workout.findUniqueOrThrow({ where: { id: workout.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
      db.workoutSet.count({ where: { workoutExerciseId: workoutExercise.id } }),
    ]);
    expect(stored.revision).toBe(workout.revision + 1);
    expect([logCount, setCount]).toEqual(
      logCount === 1 ? [1, 1] : [0, 2],
    );
  });

  it("serializes log-versus-swap races without misattributing performed work", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.setLog.create({
          data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
        }),
    );
    const swap = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.workoutExercise.updateMany({
          where: {
            id: workoutExercise.id,
            exerciseId: exerciseAId,
            sets: { none: { logs: { some: {} } } },
          },
          data: { exerciseId: exerciseBId },
        }),
    );

    const results = await Promise.allSettled([log, swap]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedExercise, logCount] = await Promise.all([
      db.workoutExercise.findUniqueOrThrow({ where: { id: workoutExercise.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
    ]);
    expect(
      logCount === 1
        ? storedExercise.exerciseId === exerciseAId
        : storedExercise.exerciseId === exerciseBId,
    ).toBe(true);
  });

  it("serializes remove-versus-log races without deleting performed work", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.setLog.create({
          data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
        }),
    );
    const remove = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      async (tx) => {
        await tx.workoutSet.deleteMany({
          where: {
            workoutExerciseId: workoutExercise.id,
            logs: { none: {} },
          },
        });
        const removed = await tx.workoutExercise.deleteMany({
          where: {
            id: workoutExercise.id,
            sets: { none: {} },
          },
        });
        if (removed.count !== 1) {
          throw new Error("REMOVE_STATE_CHANGED");
        }
      },
    );

    const results = await Promise.allSettled([log, remove]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedExercise, logCount] = await Promise.all([
      db.workoutExercise.findUnique({ where: { id: workoutExercise.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
    ]);
    expect(logCount === 1 ? storedExercise !== null : storedExercise === null).toBe(true);
  });

  it("serializes completion versus a stale runtime edit", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const completion = db.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: workout,
        userId: ownerId,
        expectedRevision: workout.revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: {
          status: "COMPLETED",
          completedAt: new Date("2026-07-14T13:00:00.000Z"),
        },
        workoutCreateData: {},
      }),
    );
    const staleEdit = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.workoutSet.create({
          data: { workoutExerciseId: workoutExercise.id, setIndex: 2, targetReps: 8 },
        }),
    );

    const results = await Promise.allSettled([completion, staleEdit]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [stored, setCount] = await Promise.all([
      db.workout.findUniqueOrThrow({ where: { id: workout.id } }),
      db.workoutSet.count({ where: { workoutExerciseId: workoutExercise.id } }),
    ]);
    expect(stored.revision).toBe(workout.revision + 1);
    expect(
      stored.status === "COMPLETED"
        ? setCount === 1
        : stored.status === "PLANNED" && setCount === 2,
    ).toBe(true);
  });

  it("advances one revision per integrated runtime and save mutation", async () => {
    const workout = await createWorkout();
    const originalSeedProvenance = {
      seedRevisionId: workout.seedRevisionId,
      seedRevisionNumber: workout.seedRevisionNumber,
      seedPayloadHash: workout.seedPayloadHash,
    };
    let revision = workout.revision;

    const addedExerciseMutation = await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: revision },
      (tx) =>
        tx.workoutExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exerciseBId,
            orderIndex: 1,
            section: "ACCESSORY",
            isMainLift: false,
            stimulusAccountingSnapshot: {
              contractVersion: 1,
              source: "exact",
              exerciseId: exerciseBId,
              stimulusVector: { chest: 1 },
            },
          },
        }),
    );
    const addedExercise = addedExerciseMutation.result;
    revision += 1;

    await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: revision },
      (tx) =>
        tx.workoutSet.create({
          data: { workoutExerciseId: addedExercise.id, setIndex: 1, targetReps: 12 },
        }),
    );
    revision += 1;

    await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: revision },
      (tx) =>
        tx.setLog.create({
          data: { workoutSetId: workout.exercises[0].sets[0].id, actualReps: 8, actualRpe: 8 },
        }),
    );
    revision += 1;

    await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: revision },
      async (tx) => {
        const swapped = await tx.workoutExercise.updateMany({
          where: { id: addedExercise.id, sets: { none: { logs: { some: {} } } } },
          data: { exerciseId: exerciseAId },
        });
        if (swapped.count !== 1) throw new Error("SWAP_STATE_CHANGED");
      },
    );
    revision += 1;

    await db.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: { id: workout.id, revision },
        userId: ownerId,
        expectedRevision: revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: { status: "PARTIAL" },
        workoutCreateData: {},
      }),
    );
    revision += 1;

    await db.$transaction(async (tx) => {
      const completed = await persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: { id: workout.id, revision },
        userId: ownerId,
        expectedRevision: revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: {
          status: "COMPLETED",
          completedAt: new Date("2026-07-14T14:00:00.000Z"),
        },
        workoutCreateData: {},
      });
      await tx.postSessionReviewSnapshot.create({
        data: {
          workoutId: workout.id,
          contractVersion: 1,
          computationPolicyVersion: 1,
          payload: { status: "completed" },
          payloadHash: "integrated-payload-hash",
          evidenceFingerprint: "integrated-evidence-fingerprint",
          provenance: "exact",
          finalizedAt: new Date("2026-07-14T14:00:00.000Z"),
        },
      });
      return completed;
    });
    revision += 1;

    const stored = await db.workout.findUniqueOrThrow({
      where: { id: workout.id },
      include: { exercises: true, postSessionReviewSnapshot: true },
    });
    expect(revision).toBe(7);
    expect(stored).toMatchObject({
      revision: 7,
      status: "COMPLETED",
      ...originalSeedProvenance,
    });
    expect(stored.exercises[1]?.stimulusAccountingSnapshot).toMatchObject({
      contractVersion: 1,
      source: "exact",
    });
    expect(stored.postSessionReviewSnapshot).toMatchObject({
      contractVersion: 1,
      computationPolicyVersion: 1,
      provenance: "exact",
    });
  });

  it("rolls back the claim and child mutation when post-claim work fails", async () => {
    const workout = await createWorkout();
    await expect(executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      async (tx) => {
        await tx.workoutSet.create({
          data: {
            workoutExerciseId: workout.exercises[0].id,
            setIndex: 2,
            targetReps: 20,
          },
        });
        throw new Error("FORCED_POST_CLAIM_FAILURE");
      },
    )).rejects.toThrow("FORCED_POST_CLAIM_FAILURE");
    expect(await db.workout.findUniqueOrThrow({ where: { id: workout.id } })).toMatchObject({
      revision: workout.revision,
    });
    expect(await db.workoutSet.count({
      where: { workoutExerciseId: workout.exercises[0].id },
    })).toBe(1);
  });

  it("preserves owner isolation without leaking a revision conflict", async () => {
    const workout = await createWorkout();
    await expect(executeWorkoutMutation(
      { workoutId: workout.id, userId: foreignOwnerId, expectedRevision: workout.revision },
      async () => undefined,
    )).rejects.toMatchObject({
      code: "WORKOUT_NOT_FOUND",
      status: 404,
    });
  });
});
