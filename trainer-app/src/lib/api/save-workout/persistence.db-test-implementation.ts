import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  persistWorkoutRow,
  prepareWorkoutExercisesForPersistence,
  replaceFilteredExercises,
  rewriteWorkoutExercises,
} from "./persistence";
import { applyLegacyTerminalLifecycleSideEffects } from "./lifecycle";
import { deriveReconciledMesocycleLifecycle } from "../mesocycle-lifecycle-reconciliation";
import { deleteOwnedWorkout } from "../workout-deletion";

export function registerPersistenceDatabaseTests(databaseUrl: string): void {
describe("save-workout persistence CAS (PostgreSQL)", () => {
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
    const chest = await prisma.muscle.create({ data: { name: "Chest" } });
    const [owner, foreignOwner, exerciseA, exerciseB] = await Promise.all([
      prisma.user.create({ data: { email: `occ-owner-${suffix}@test.local` } }),
      prisma.user.create({ data: { email: `occ-foreign-${suffix}@test.local` } }),
      prisma.exercise.create({
        data: {
          name: `OCC Exercise A ${suffix}`,
          jointStress: "LOW",
          exerciseMuscles: {
            create: { muscleId: chest.id, role: "PRIMARY" },
          },
        },
      }),
      prisma.exercise.create({
        data: {
          name: `OCC Exercise B ${suffix}`,
          jointStress: "LOW",
          exerciseMuscles: {
            create: { muscleId: chest.id, role: "PRIMARY" },
          },
        },
      }),
    ]);
    ownerId = owner.id;
    foreignOwnerId = foreignOwner.id;
    exerciseAId = exerciseA.id;
    exerciseBId = exerciseB.id;
    await prisma.constraints.create({
      data: {
        userId: ownerId,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      },
    });
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

  async function createLegacyLifecycleFixture(
    label: string,
    earlierSkip?: { week: number; session: number },
  ) {
    const earlierSkipIsAccumulation =
      earlierSkip != null && earlierSkip.week < 5;
    const macroCycle = await prisma.macroCycle.create({
      data: {
        userId: ownerId,
        name: `Legacy lifecycle ${label}`,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-08-05T00:00:00.000Z"),
        durationWeeks: 5,
        trainingAge: "INTERMEDIATE",
        primaryGoal: "HYPERTROPHY",
      },
    });
    const slotSequenceJson = {
      version: 1,
      source: "handoff_draft",
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    };
    const mesocycle = await prisma.mesocycle.create({
      data: {
        macroCycleId: macroCycle.id,
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Legacy hypertrophy",
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        completedSessions: earlierSkip ? 18 : 19,
        accumulationSessionsCompleted: earlierSkipIsAccumulation ? 15 : 16,
        deloadSessionsCompleted:
          earlierSkip != null && !earlierSkipIsAccumulation ? 2 : 3,
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        state: "ACTIVE_DELOAD",
        isActive: true,
        slotSequenceJson,
      },
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { activeMacroCycleId: macroCycle.id },
    });

    const workouts: Prisma.WorkoutCreateManyInput[] = [];
    for (let week = 1; week <= 5; week += 1) {
      for (let session = 1; session <= 4; session += 1) {
        const phase = week === 5 ? "DELOAD" : "ACCUMULATION";
        const intent = session === 1 || session === 3 ? "UPPER" : "LOWER";
        const slotId = ["upper_a", "lower_a", "upper_b", "lower_b"][
          session - 1
        ];
        workouts.push({
          userId: ownerId,
          mesocycleId: mesocycle.id,
          scheduledDate: new Date(Date.UTC(2026, 6, week * 4 + session)),
          status:
            week === 5 && session === 4
              ? ("PLANNED" as const)
              : week === earlierSkip?.week && session === earlierSkip.session
                ? ("SKIPPED" as const)
                : ("COMPLETED" as const),
          completedAt:
            (week === 5 && session === 4) ||
            (week === earlierSkip?.week && session === earlierSkip.session)
              ? null
              : new Date(Date.UTC(2026, 6, week * 4 + session, 1)),
          selectionMode: "INTENT" as const,
          sessionIntent: intent as "UPPER" | "LOWER",
          advancesSplit: true,
          mesocycleWeekSnapshot: week,
          mesocyclePhaseSnapshot: phase as "DELOAD" | "ACCUMULATION",
          mesoSessionSnapshot: session,
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 2,
              cycleContext: {
                weekInMeso: week,
                weekInBlock: week,
                mesocycleLength: 5,
                phase: phase.toLowerCase(),
                blockType: phase.toLowerCase(),
                isDeload: phase === "DELOAD",
                source: "computed",
              },
              sessionProvenance: {
                mesocycleId: mesocycle.id,
                compositionSource: "runtime_selection",
              },
              sessionSlot: {
                slotId,
                intent: intent.toLowerCase(),
                sequenceIndex: session - 1,
                sequenceLength: 4,
                source: "mesocycle_slot_sequence",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: phase === "DELOAD" ? "scheduled" : "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          },
        });
      }
    }
    await prisma.workout.createMany({ data: workouts });
    const finalWorkout = await prisma.workout.findFirstOrThrow({
      where: {
        mesocycleId: mesocycle.id,
        mesocycleWeekSnapshot: 5,
        mesoSessionSnapshot: 4,
      },
    });
    const priorWorkoutEvidence = await prisma.workout.findMany({
      where: {
        mesocycleId: mesocycle.id,
        id: { not: finalWorkout.id },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        revision: true,
        completedAt: true,
        seedRevisionId: true,
        seedRevisionNumber: true,
        selectionMetadata: true,
      },
    });
    return { macroCycle, mesocycle, finalWorkout, priorWorkoutEvidence };
  }

  async function saveLegacyTerminalStatus(input: {
    mesocycleId: string;
    workoutId: string;
    expectedRevision: number;
    finalStatus: "COMPLETED" | "SKIPPED";
  }) {
    return prisma.$transaction(async (tx) => {
      const mesocycle = await tx.mesocycle.findUniqueOrThrow({
        where: { id: input.mesocycleId },
        include: {
          macroCycle: { select: { startDate: true, primaryGoal: true } },
          currentSeedRevision: true,
        },
      });
      const persisted = await persistWorkoutRow(tx, {
        workoutId: input.workoutId,
        existingWorkout: {
          id: input.workoutId,
          revision: input.expectedRevision,
          status: "PLANNED",
        },
        userId: ownerId,
        expectedRevision: input.expectedRevision,
        shouldAdvanceLifecycleTransition: input.finalStatus === "COMPLETED",
        resolvedMesocycleId: mesocycle.id,
        workoutUpdateData: {
          status: input.finalStatus,
          completedAt:
            input.finalStatus === "COMPLETED" ? new Date() : undefined,
        },
        workoutCreateData: {},
      });
      await applyLegacyTerminalLifecycleSideEffects(tx, {
        userId: ownerId,
        workoutId: input.workoutId,
        scheduledDate: new Date("2026-07-25T12:00:00.000Z"),
        resolvedMesocycleId: mesocycle.id,
        resolvedMesocycle: mesocycle,
        mesoSnapshot: { week: 5, phase: "DELOAD", session: 4 },
        isOptionalGapFill: false,
        advancesSplit: true,
        previousStatus: "PLANNED",
        finalStatus: input.finalStatus,
        wonCompletedTransition: persisted.wonLifecycleTransition,
      });
      return persisted;
    });
  }

  const rewrite = (
    tx: Parameters<typeof prepareWorkoutExercisesForPersistence>[0],
    exerciseId: string,
    targetReps: number
  ) =>
    prepareWorkoutExercisesForPersistence(tx, [
      {
        exerciseId,
        section: "MAIN" as const,
        sets: [{ setIndex: 1, targetReps }],
      },
    ]);

  it("closes a resolved legacy mesocycle on the final skip without incrementing performed counters", async () => {
    const fixture = await createLegacyLifecycleFixture("final-skip");

    await saveLegacyTerminalStatus({
      mesocycleId: fixture.mesocycle.id,
      workoutId: fixture.finalWorkout.id,
      expectedRevision: fixture.finalWorkout.revision,
      finalStatus: "SKIPPED",
    });

    const [
      storedWorkout,
      storedMesocycle,
      mesocycleCount,
      priorWorkoutEvidence,
      seedRevisionCount,
    ] = await Promise.all([
      prisma.workout.findUniqueOrThrow({
        where: { id: fixture.finalWorkout.id },
      }),
      prisma.mesocycle.findUniqueOrThrow({
        where: { id: fixture.mesocycle.id },
      }),
      prisma.mesocycle.count({
        where: { macroCycleId: fixture.macroCycle.id },
      }),
      prisma.workout.findMany({
        where: {
          mesocycleId: fixture.mesocycle.id,
          id: { not: fixture.finalWorkout.id },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          status: true,
          revision: true,
          completedAt: true,
          seedRevisionId: true,
          seedRevisionNumber: true,
          selectionMetadata: true,
        },
      }),
      prisma.mesocycleSeedRevision.count({
        where: { mesocycleId: fixture.mesocycle.id },
      }),
    ]);
    expect(storedWorkout).toMatchObject({
      status: "SKIPPED",
      revision: 2,
      completedAt: null,
    });
    expect(storedMesocycle).toMatchObject({
      state: "AWAITING_HANDOFF",
      isActive: false,
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      closedAt: expect.any(Date),
      handoffSummaryJson: expect.any(Object),
      nextSeedDraftJson: expect.any(Object),
    });
    expect(mesocycleCount).toBe(1);
    expect(priorWorkoutEvidence).toEqual(fixture.priorWorkoutEvidence);
    expect(seedRevisionCount).toBe(0);

    const frozenArtifacts = {
      closedAt: storedMesocycle.closedAt,
      handoffSummaryJson: storedMesocycle.handoffSummaryJson,
      nextSeedDraftJson: storedMesocycle.nextSeedDraftJson,
    };
    await expect(
      saveLegacyTerminalStatus({
        mesocycleId: fixture.mesocycle.id,
        workoutId: fixture.finalWorkout.id,
        expectedRevision: fixture.finalWorkout.revision,
        finalStatus: "SKIPPED",
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mesocycle.findUniqueOrThrow({ where: { id: fixture.mesocycle.id } }),
    ).resolves.toMatchObject(frozenArtifacts);
  });

  it("rolls back deletion that would regress a closed legacy handoff", async () => {
    const fixture = await createLegacyLifecycleFixture("closed-delete-rollback");
    await saveLegacyTerminalStatus({
      mesocycleId: fixture.mesocycle.id,
      workoutId: fixture.finalWorkout.id,
      expectedRevision: fixture.finalWorkout.revision,
      finalStatus: "SKIPPED",
    });
    const before = await prisma.mesocycle.findUniqueOrThrow({
      where: { id: fixture.mesocycle.id },
    });
    const finalWorkout = await prisma.workout.findUniqueOrThrow({
      where: { id: fixture.finalWorkout.id },
    });

    await expect(
      deleteOwnedWorkout({
        workoutId: finalWorkout.id,
        userId: ownerId,
        expectedRevision: finalWorkout.revision,
      }),
    ).rejects.toMatchObject({
      code: "WORKOUT_DELETE_CLOSED_LIFECYCLE_REGRESSION",
    });

    await expect(
      prisma.workout.findUnique({ where: { id: finalWorkout.id } }),
    ).resolves.toMatchObject({
      id: finalWorkout.id,
      status: "SKIPPED",
      revision: finalWorkout.revision,
    });
    await expect(
      prisma.mesocycle.findUniqueOrThrow({ where: { id: fixture.mesocycle.id } }),
    ).resolves.toMatchObject({
      state: "AWAITING_HANDOFF",
      isActive: before.isActive,
      closedAt: before.closedAt,
      handoffSummaryJson: before.handoffSummaryJson,
      nextSeedDraftJson: before.nextSeedDraftJson,
      completedSessions: before.completedSessions,
      accumulationSessionsCompleted: before.accumulationSessionsCompleted,
      deloadSessionsCompleted: before.deloadSessionsCompleted,
    });
  });

  it("allows closed-handoff deletion that does not regress lifecycle truth", async () => {
    const fixture = await createLegacyLifecycleFixture("closed-delete-safe");
    await saveLegacyTerminalStatus({
      mesocycleId: fixture.mesocycle.id,
      workoutId: fixture.finalWorkout.id,
      expectedRevision: fixture.finalWorkout.revision,
      finalStatus: "SKIPPED",
    });
    const before = await prisma.mesocycle.findUniqueOrThrow({
      where: { id: fixture.mesocycle.id },
    });
    const stale = await prisma.workout.create({
      data: {
        userId: ownerId,
        mesocycleId: fixture.mesocycle.id,
        scheduledDate: new Date("2026-08-20T12:00:00.000Z"),
        status: "COMPLETED",
        completedAt: new Date("2026-08-20T13:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        advancesSplit: true,
        mesocycleWeekSnapshot: 6,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 1,
      },
    });

    await expect(
      deleteOwnedWorkout({
        workoutId: stale.id,
        userId: ownerId,
        expectedRevision: stale.revision,
      }),
    ).resolves.toMatchObject({ result: { status: "deleted" } });

    await expect(
      prisma.workout.findUnique({ where: { id: stale.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.mesocycle.findUniqueOrThrow({ where: { id: fixture.mesocycle.id } }),
    ).resolves.toMatchObject({
      state: "AWAITING_HANDOFF",
      isActive: before.isActive,
      closedAt: before.closedAt,
      handoffSummaryJson: before.handoffSummaryJson,
      nextSeedDraftJson: before.nextSeedDraftJson,
      completedSessions: before.completedSessions,
      accumulationSessionsCompleted: before.accumulationSessionsCompleted,
      deloadSessionsCompleted: before.deloadSessionsCompleted,
    });
  });

  it("keeps strict forward and reconciliation counters equivalent for stale evidence", async () => {
    const fixture = await createLegacyLifecycleFixture("strict-counter-equivalence");
    const stale = await prisma.workout.create({
      data: {
        userId: ownerId,
        mesocycleId: fixture.mesocycle.id,
        scheduledDate: new Date("2026-08-20T12:00:00.000Z"),
        status: "PLANNED",
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        advancesSplit: true,
        mesocycleWeekSnapshot: 6,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 1,
      },
    });

    await saveLegacyTerminalStatus({
      mesocycleId: fixture.mesocycle.id,
      workoutId: stale.id,
      expectedRevision: stale.revision,
      finalStatus: "COMPLETED",
    });
    const stored = await prisma.mesocycle.findUniqueOrThrow({
      where: { id: fixture.mesocycle.id },
      include: { currentSeedRevision: true },
    });
    const reconciled = await prisma.$transaction((tx) =>
      deriveReconciledMesocycleLifecycle(tx, stored),
    );

    expect(stored).toMatchObject({
      state: "ACTIVE_DELOAD",
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
    });
    expect(reconciled).toEqual({
      state: stored.state,
      completedSessions: stored.completedSessions,
      accumulationSessionsCompleted: stored.accumulationSessionsCompleted,
      deloadSessionsCompleted: stored.deloadSessionsCompleted,
    });
  });

  it("closes when a later completion resolves the final obligation after an earlier authored skip", async () => {
    const fixture = await createLegacyLifecycleFixture("earlier-skip", {
      week: 2,
      session: 2,
    });

    await saveLegacyTerminalStatus({
      mesocycleId: fixture.mesocycle.id,
      workoutId: fixture.finalWorkout.id,
      expectedRevision: fixture.finalWorkout.revision,
      finalStatus: "COMPLETED",
    });

    await expect(
      prisma.mesocycle.findUniqueOrThrow({ where: { id: fixture.mesocycle.id } }),
    ).resolves.toMatchObject({
      state: "AWAITING_HANDOFF",
      isActive: false,
      completedSessions: 19,
      accumulationSessionsCompleted: 15,
      deloadSessionsCompleted: 4,
      closedAt: expect.any(Date),
      handoffSummaryJson: expect.any(Object),
      nextSeedDraftJson: expect.any(Object),
    });
  });

  it("allows one same-revision complete/skip winner and creates one legacy handoff", async () => {
    const fixture = await createLegacyLifecycleFixture("terminal-contention");
    const results = await Promise.allSettled([
      saveLegacyTerminalStatus({
        mesocycleId: fixture.mesocycle.id,
        workoutId: fixture.finalWorkout.id,
        expectedRevision: fixture.finalWorkout.revision,
        finalStatus: "COMPLETED",
      }),
      saveLegacyTerminalStatus({
        mesocycleId: fixture.mesocycle.id,
        workoutId: fixture.finalWorkout.id,
        expectedRevision: fixture.finalWorkout.revision,
        finalStatus: "SKIPPED",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [storedWorkout, storedMesocycle, mesocycleCount] = await Promise.all([
      prisma.workout.findUniqueOrThrow({ where: { id: fixture.finalWorkout.id } }),
      prisma.mesocycle.findUniqueOrThrow({ where: { id: fixture.mesocycle.id } }),
      prisma.mesocycle.count({ where: { macroCycleId: fixture.macroCycle.id } }),
    ]);
    expect(storedWorkout.revision).toBe(2);
    expect(["COMPLETED", "SKIPPED"]).toContain(storedWorkout.status);
    expect(storedMesocycle).toMatchObject({
      state: "AWAITING_HANDOFF",
      isActive: false,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: storedWorkout.status === "COMPLETED" ? 4 : 3,
      completedSessions: storedWorkout.status === "COMPLETED" ? 20 : 19,
      closedAt: expect.any(Date),
      handoffSummaryJson: expect.any(Object),
      nextSeedDraftJson: expect.any(Object),
    });
    expect(mesocycleCount).toBe(1);
  });

  it("atomically updates the workout, increments revision, and persists child changes", async () => {
    const existing = await createWorkout({ notes: "before", exerciseId: exerciseAId });

    const result = await prisma.$transaction(async (tx) => {
      const persisted = await persistWorkoutRow(tx, {
        workoutId: existing.id,
        existingWorkout: {
          id: existing.id,
          revision: existing.revision,
          status: existing.status,
        },
        userId: ownerId,
        expectedRevision: existing.revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: { notes: "after" },
        workoutCreateData: {},
      });
      await rewriteWorkoutExercises(tx, {
        workoutId: existing.id,
        exercises: await rewrite(tx, exerciseBId, 12),
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
          existingWorkout: {
            id: existing.id,
            revision: existing.revision + 1,
            status: existing.status,
          },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: "stale overwrite" },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: await rewrite(tx, exerciseBId, 15),
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
          existingWorkout: {
            id: existing.id,
            revision: existing.revision,
            status: existing.status,
          },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: label },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: await rewrite(tx, exerciseId, targetReps),
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
          existingWorkout: {
            id: existing.id,
            revision: existing.revision,
            status: existing.status,
          },
          userId: ownerId,
          expectedRevision: existing.revision,
          shouldAdvanceLifecycleTransition: false,
          resolvedMesocycleId: null,
          workoutUpdateData: { notes: "should roll back" },
          workoutCreateData: {},
        });
        await rewriteWorkoutExercises(tx, {
          workoutId: existing.id,
          exercises: await rewrite(tx, exerciseBId, 20),
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
          existingWorkout: {
            id: existing.id,
            revision: existing.revision,
            status: existing.status,
          },
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

  it("enforces immutable one-to-one post-session review snapshot storage", async () => {
    const workout = await createWorkout();
    const snapshot = await prisma.postSessionReviewSnapshot.create({
      data: {
        workoutId: workout.id,
        contractVersion: 1,
        computationPolicyVersion: 1,
        payload: { contractVersion: 1, conclusion: "verified" },
        payloadHash: "payload-hash",
        evidenceFingerprint: "evidence-fingerprint",
        provenance: "exact",
        finalizedAt: new Date("2026-07-14T12:30:00.000Z"),
      },
    });

    await expect(
      prisma.postSessionReviewSnapshot.create({
        data: {
          workoutId: workout.id,
          contractVersion: 1,
          computationPolicyVersion: 1,
          payload: { contractVersion: 1, conclusion: "duplicate" },
          payloadHash: "duplicate-hash",
          evidenceFingerprint: "duplicate-fingerprint",
          provenance: "exact",
          finalizedAt: new Date("2026-07-14T12:31:00.000Z"),
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.postSessionReviewSnapshot.update({
        where: { id: snapshot.id },
        data: { payloadHash: "mutated" },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.postSessionReviewSnapshot.delete({ where: { id: snapshot.id } }),
    ).rejects.toBeDefined();
  });
});
}
