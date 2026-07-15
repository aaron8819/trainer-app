/**
 * Real PostgreSQL coverage for the save-workout compare-and-swap boundary.
 * Run with TEST_DATABASE_URL pointing at a disposable database whose schema
 * has been created from prisma/schema.prisma.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  persistWorkoutRow,
  replaceFilteredExercises,
  rewriteWorkoutExercises,
} from "./persistence";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("save-workout persistence CAS (PostgreSQL)", () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let ownerId: string;
  let foreignOwnerId: string;
  let exerciseAId: string;
  let exerciseBId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const suffix = crypto.randomUUID();
    const [owner, foreignOwner, exerciseA, exerciseB] = await Promise.all([
      prisma.user.create({ data: { email: `occ-owner-${suffix}@test.local` } }),
      prisma.user.create({ data: { email: `occ-foreign-${suffix}@test.local` } }),
      prisma.exercise.create({
        data: {
          name: `OCC Exercise A ${suffix}`,
          jointStress: "LOW",
        },
      }),
      prisma.exercise.create({
        data: {
          name: `OCC Exercise B ${suffix}`,
          jointStress: "LOW",
        },
      }),
    ]);
    ownerId = owner.id;
    foreignOwnerId = foreignOwner.id;
    exerciseAId = exerciseA.id;
    exerciseBId = exerciseB.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  async function createWorkout(input?: { notes?: string; exerciseId?: string }) {
    return prisma.workout.create({
      data: {
        userId: ownerId,
        scheduledDate: new Date("2026-07-13T12:00:00.000Z"),
        notes: input?.notes,
        exercises: input?.exerciseId
          ? {
              create: {
                exerciseId: input.exerciseId,
                orderIndex: 0,
                section: "MAIN",
                isMainLift: true,
                sets: {
                  create: { setIndex: 1, targetReps: 8 },
                },
              },
            }
          : undefined,
      },
    });
  }

  const rewrite = (exerciseId: string, targetReps: number) => [
    {
      exerciseId,
      section: "MAIN" as const,
      sets: [{ setIndex: 1, targetReps }],
    },
  ];

  it("atomically updates the workout, increments revision, and persists child changes", async () => {
    const existing = await createWorkout({ notes: "before", exerciseId: exerciseAId });

    const result = await prisma.$transaction(async (tx) => {
      const persisted = await persistWorkoutRow(tx, {
        workoutId: existing.id,
        existingWorkout: { id: existing.id, revision: existing.revision },
        userId: ownerId,
        expectedRevision: existing.revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: { notes: "after" },
        workoutCreateData: {},
      });
      await rewriteWorkoutExercises(tx, {
        workoutId: existing.id,
        exercises: rewrite(exerciseBId, 12),
      });
      await replaceFilteredExercises(tx, {
        workoutId: existing.id,
        filteredExercises: [
          {
            exerciseName: "Filtered candidate",
            reason: "test",
            userFriendlyMessage: "Filtered for OCC test",
          },
        ],
      });
      return persisted;
    });

    const stored = await prisma.workout.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        exercises: { include: { sets: true } },
        filteredExercises: true,
      },
    });
    expect(result.workout.revision).toBe(existing.revision + 1);
    expect(stored.revision).toBe(existing.revision + 1);
    expect(stored.notes).toBe("after");
    expect(stored.exercises).toHaveLength(1);
    expect(stored.exercises[0].exerciseId).toBe(exerciseBId);
    expect(stored.exercises[0].sets[0].targetReps).toBe(12);
    expect(stored.filteredExercises).toHaveLength(1);
  });

  it("rejects a stale revision before any workout or child mutation", async () => {
    const existing = await createWorkout({ notes: "current", exerciseId: exerciseAId });
    await prisma.workout.update({
      where: { id: existing.id },
      data: { revision: { increment: 1 } },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await persistWorkoutRow(tx, {
          workoutId: existing.id,
          existingWorkout: { id: existing.id, revision: existing.revision + 1 },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: "stale overwrite" },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: rewrite(exerciseBId, 15),
        });
      }),
    ).rejects.toThrow("REVISION_CONFLICT");

    const stored = await prisma.workout.findUniqueOrThrow({
      where: { id: existing.id },
      include: { exercises: { include: { sets: true } } },
    });
    expect(stored.revision).toBe(existing.revision + 1);
    expect(stored.notes).toBe("current");
    expect(stored.exercises[0].exerciseId).toBe(exerciseAId);
    expect(stored.exercises[0].sets[0].targetReps).toBe(8);
  });

  it("allows exactly one concurrent save for a shared revision without mixed children", async () => {
    const existing = await createWorkout({ notes: "before", exerciseId: exerciseAId });

    const save = (label: "A" | "B", exerciseId: string, targetReps: number) =>
      prisma.$transaction(async (tx) => {
        const persisted = await persistWorkoutRow(tx, {
          workoutId: existing.id,
          existingWorkout: { id: existing.id, revision: existing.revision },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: label },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: rewrite(exerciseId, targetReps),
        });
        return persisted;
      });

    const results = await Promise.allSettled([
      save("A", exerciseAId, 10),
      save("B", exerciseBId, 14),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ message: "REVISION_CONFLICT" });

    const stored = await prisma.workout.findUniqueOrThrow({
      where: { id: existing.id },
      include: { exercises: { include: { sets: true } } },
    });
    expect(stored.revision).toBe(existing.revision + 1);
    expect(stored.exercises).toHaveLength(1);
    const expectedWinner =
      stored.notes === "A"
        ? { exerciseId: exerciseAId, targetReps: 10 }
        : { exerciseId: exerciseBId, targetReps: 14 };
    expect(stored.exercises[0].exerciseId).toBe(expectedWinner.exerciseId);
    expect(stored.exercises[0].sets).toHaveLength(1);
    expect(stored.exercises[0].sets[0].targetReps).toBe(expectedWinner.targetReps);
  });

  it("rolls back the revision and all child changes when a later operation fails", async () => {
    const existing = await createWorkout({ notes: "before", exerciseId: exerciseAId });

    await expect(
      prisma.$transaction(async (tx) => {
        await persistWorkoutRow(tx, {
          workoutId: existing.id,
          existingWorkout: { id: existing.id, revision: existing.revision },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: "should roll back" },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: rewrite(exerciseBId, 20),
        });
        throw new Error("FORCED_POST_CAS_FAILURE");
      }),
    ).rejects.toThrow("FORCED_POST_CAS_FAILURE");

    const stored = await prisma.workout.findUniqueOrThrow({
      where: { id: existing.id },
      include: { exercises: { include: { sets: true } } },
    });
    expect(stored.revision).toBe(existing.revision);
    expect(stored.notes).toBe("before");
    expect(stored.exercises[0].exerciseId).toBe(exerciseAId);
    expect(stored.exercises[0].sets[0].targetReps).toBe(8);
  });

  it("does not classify a foreign-owned workout as a revision conflict", async () => {
    const existing = await createWorkout({ notes: "owner only", exerciseId: exerciseAId });

    await expect(
      prisma.$transaction((tx) =>
        persistWorkoutRow(tx, {
          workoutId: existing.id,
          existingWorkout: { id: existing.id, revision: existing.revision },
          userId: foreignOwnerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: "foreign overwrite" },
          workoutCreateData: {},
        }),
      ),
    ).rejects.toThrow("WORKOUT_NOT_FOUND");

    const stored = await prisma.workout.findUniqueOrThrow({ where: { id: existing.id } });
    expect(stored.revision).toBe(existing.revision);
    expect(stored.notes).toBe("owner only");
  });

  it("creates a new workout at revision 1", async () => {
    const workoutId = crypto.randomUUID();
    const result = await prisma.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId,
        existingWorkout: null,
        userId: ownerId,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: {},
        workoutCreateData: {
          id: workoutId,
          userId: ownerId,
          scheduledDate: new Date("2026-07-13T12:00:00.000Z"),
        },
      }),
    );

    expect(result.workout.revision).toBe(1);
    await expect(
      prisma.workout.findUniqueOrThrow({ where: { id: workoutId } }),
    ).resolves.toMatchObject({ revision: 1, userId: ownerId });
  });
});
