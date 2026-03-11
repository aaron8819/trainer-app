import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import {
  buildExerciseExposureRows,
  performedExposureLogWhere,
} from "../src/lib/api/exercise-exposure-backfill";

const WORKOUT_ID = "cf1f4b62-308e-4ce6-a0f6-1ba71200871d";
const REPAIR_NOTE =
  "[repair cf1f4b62] added Machine Lateral Raise replacement for skipped Cable Lateral Raise sets 5-6; corrected Incline DB Bench 50 -> 52.5.";
const TARGET_LOAD_FIXES = [
  "95652f03-cad1-42d7-b437-7a10e97e7b9f",
  "caf0a3c2-b86a-4946-9fe6-82727ac59ef0",
] as const;
const TARGET_SKIPPED_LOGS = [
  "721e01da-9fb3-4325-8a03-cac708de7c9d",
  "9005adba-9f69-4f89-abee-b24fd955bfa2",
] as const;
const REPLACEMENT_EXERCISE_ID = "55685ec5-139a-4466-9921-da4bc7a37970";
const REPLACEMENT_SETS = [
  { setIndex: 1, targetReps: 12, actualReps: 12, actualLoad: 40, actualRpe: 9 },
  { setIndex: 2, targetReps: 10, actualReps: 10, actualLoad: 40, actualRpe: 9 },
] as const;
const EXPECTED_PRE_REPAIR_LOAD = 50;
const EXPECTED_POST_REPAIR_LOAD = 52.5;

type CliOptions = {
  apply: boolean;
};

type WorkoutReader = Pick<typeof prisma, "workout">;
type ExposureReader = Pick<typeof prisma, "exerciseExposure" | "workout">;

type RepairSnapshot = {
  id: string;
  userId: string;
  status: string;
  completedAt: Date | null;
  exercises: Array<{
    id: string;
    exerciseId: string;
    orderIndex: number;
    notes: string | null;
    exercise: {
      name: string;
      repRangeMin: number;
      repRangeMax: number;
    };
    sets: Array<{
      id: string;
      setIndex: number;
      logs: Array<{
        id: string;
        actualReps: number | null;
        actualLoad: number | null;
        actualRpe: number | null;
        wasSkipped: boolean;
      }>;
    }>;
  }>;
};

function parseArgs(argv: string[]): CliOptions {
  return {
    apply: argv.includes("--apply"),
  };
}

function flattenLogs(snapshot: RepairSnapshot) {
  return snapshot.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      set.logs.map((log) => ({
        exercise,
        set,
        log,
      }))
    )
  );
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateSnapshot(snapshot: RepairSnapshot) {
  assertCondition(snapshot.status === "COMPLETED", `Workout ${WORKOUT_ID} must be COMPLETED before repair.`);

  const logRows = flattenLogs(snapshot);
  const loadFixRows = TARGET_LOAD_FIXES.map((logId) => {
    const row = logRows.find((entry) => entry.log.id === logId);
    assertCondition(row, `Expected target SetLog ${logId} to exist on workout ${WORKOUT_ID}.`);
    assertCondition(
      row.log.wasSkipped === false,
      `Expected target SetLog ${logId} to be performed, not skipped.`
    );
    assertCondition(
      row.log.actualLoad === EXPECTED_PRE_REPAIR_LOAD || row.log.actualLoad === EXPECTED_POST_REPAIR_LOAD,
      `Expected SetLog ${logId} actualLoad to be ${EXPECTED_PRE_REPAIR_LOAD} or ${EXPECTED_POST_REPAIR_LOAD}; found ${String(row.log.actualLoad)}.`
    );
    return row;
  });

  for (const logId of TARGET_SKIPPED_LOGS) {
    const row = logRows.find((entry) => entry.log.id === logId);
    assertCondition(row, `Expected skipped SetLog ${logId} to exist on workout ${WORKOUT_ID}.`);
    assertCondition(row.log.wasSkipped === true, `Expected SetLog ${logId} to remain skipped.`);
    assertCondition(
      row.log.actualLoad == null && row.log.actualReps == null && row.log.actualRpe == null,
      `Expected skipped SetLog ${logId} to have null performed values.`
    );
  }

  const replacementExercises = snapshot.exercises.filter(
    (exercise) => exercise.exerciseId === REPLACEMENT_EXERCISE_ID
  );
  assertCondition(
    replacementExercises.length <= 1,
    `Workout ${WORKOUT_ID} already contains multiple Machine Lateral Raise rows; aborting for manual review.`
  );

  const replacementExercise = replacementExercises[0] ?? null;
  if (replacementExercise) {
    assertCondition(
      replacementExercise.notes === REPAIR_NOTE,
      "Workout already contains a Machine Lateral Raise row without the repair marker; aborting for manual review."
    );
    assertCondition(
      replacementExercise.sets.length === REPLACEMENT_SETS.length,
      "Existing repair row has unexpected set count; aborting for manual review."
    );

    for (const expectedSet of REPLACEMENT_SETS) {
      const actualSet = replacementExercise.sets.find((set) => set.setIndex === expectedSet.setIndex);
      assertCondition(actualSet, `Existing repair row is missing set ${expectedSet.setIndex}.`);
      assertCondition(actualSet.logs.length === 1, `Repair set ${expectedSet.setIndex} must have exactly one SetLog.`);
      const actualLog = actualSet.logs[0];
      assertCondition(actualLog.wasSkipped === false, `Repair set ${expectedSet.setIndex} cannot be skipped.`);
      assertCondition(
        actualLog.actualReps === expectedSet.actualReps &&
          actualLog.actualLoad === expectedSet.actualLoad &&
          actualLog.actualRpe === expectedSet.actualRpe,
        `Repair set ${expectedSet.setIndex} does not match the approved performed data.`
      );
    }
  }

  return {
    loadFixRows,
    replacementExercise,
  };
}

async function loadWorkoutSnapshot(prismaClient: WorkoutReader): Promise<RepairSnapshot> {
  const snapshot = (await prismaClient.workout.findUnique({
    where: { id: WORKOUT_ID },
    select: {
      id: true,
      userId: true,
      status: true,
      completedAt: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          notes: true,
          exercise: {
            select: {
              name: true,
              repRangeMin: true,
              repRangeMax: true,
            },
          },
          sets: {
            orderBy: [{ setIndex: "asc" }],
            select: {
              id: true,
              setIndex: true,
              logs: {
                orderBy: [{ completedAt: "asc" }],
                select: {
                  id: true,
                  actualReps: true,
                  actualLoad: true,
                  actualRpe: true,
                  wasSkipped: true,
                },
              },
            },
          },
        },
      },
    },
  })) as RepairSnapshot | null;

  assertCondition(snapshot, `Workout ${WORKOUT_ID} was not found.`);
  return snapshot;
}

async function previewExposureRebuild(prismaClient: ExposureReader, userId: string) {
  const [existingRowCount, workouts] = await Promise.all([
    prismaClient.exerciseExposure.count({ where: { userId } }),
    prismaClient.workout.findMany({
      where: {
        userId,
        status: "COMPLETED",
        exercises: {
          some: {
            sets: {
              some: {
                logs: {
                  some: performedExposureLogWhere,
                },
              },
            },
          },
        },
      },
      select: {
        completedAt: true,
        scheduledDate: true,
        exercises: {
          select: {
            exercise: {
              select: {
                name: true,
              },
            },
            sets: {
              select: {
                logs: {
                  orderBy: { completedAt: "desc" },
                  take: 1,
                  select: {
                    actualLoad: true,
                    actualReps: true,
                    actualRpe: true,
                    wasSkipped: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const rebuiltRows = buildExerciseExposureRows(userId, workouts, new Date());
  return {
    existingRowCount,
    rebuiltRowCount: rebuiltRows.length,
    rebuiltRows,
  };
}

async function rebuildExerciseExposure(prismaClient: typeof prisma, userId: string) {
  const preview = await previewExposureRebuild(prismaClient, userId);

  await prismaClient.$transaction(async (tx) => {
    await tx.exerciseExposure.deleteMany({
      where: { userId },
    });

    if (preview.rebuiltRows.length > 0) {
      await tx.exerciseExposure.createMany({
        data: preview.rebuiltRows,
      });
    }
  });

  return {
    existingRowCount: preview.existingRowCount,
    rebuiltRowCount: preview.rebuiltRowCount,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const snapshot = await loadWorkoutSnapshot(prisma);
    const validation = validateSnapshot(snapshot);
    const replacementExerciseMeta = await prisma.exercise.findUnique({
      where: { id: REPLACEMENT_EXERCISE_ID },
      select: {
        id: true,
        name: true,
        repRangeMin: true,
        repRangeMax: true,
      },
    });

    assertCondition(replacementExerciseMeta, `Expected exercise ${REPLACEMENT_EXERCISE_ID} to exist.`);
    assertCondition(
      replacementExerciseMeta.name === "Machine Lateral Raise",
      `Expected ${REPLACEMENT_EXERCISE_ID} to resolve to Machine Lateral Raise.`
    );

    const pendingLoadFixes = validation.loadFixRows
      .filter((row) => row.log.actualLoad !== EXPECTED_POST_REPAIR_LOAD)
      .map((row) => row.log.id);
    const pendingReplacementInsert = validation.replacementExercise == null;
    const exposurePreview = await previewExposureRebuild(prisma, snapshot.userId);

    if (!options.apply) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            workoutId: snapshot.id,
            userId: snapshot.userId,
            status: snapshot.status,
            pendingLoadFixes,
            pendingReplacementInsert,
            exposureRebuild: {
              existingRowCount: exposurePreview.existingRowCount,
              rebuiltRowCount: exposurePreview.rebuiltRowCount,
            },
          },
          null,
          2
        )
      );
      return;
    }

    const applied = await prisma.$transaction(async (tx) => {
      const currentSnapshot = await loadWorkoutSnapshot(tx);
      const currentValidation = validateSnapshot(currentSnapshot);
      const currentPendingLoadFixes = currentValidation.loadFixRows
        .filter((row) => row.log.actualLoad !== EXPECTED_POST_REPAIR_LOAD)
        .map((row) => row.log.id);
      const needsReplacementInsert = currentValidation.replacementExercise == null;
      const nextOrderIndex =
        currentSnapshot.exercises.reduce((maxOrderIndex, exercise) => Math.max(maxOrderIndex, exercise.orderIndex), -1) + 1;

      for (const logId of currentPendingLoadFixes) {
        await tx.setLog.update({
          where: { id: logId },
          data: {
            actualLoad: EXPECTED_POST_REPAIR_LOAD,
          },
        });
      }

      let createdWorkoutExerciseId: string | null = null;
      if (needsReplacementInsert) {
        const createdExercise = await tx.workoutExercise.create({
          data: {
            workoutId: WORKOUT_ID,
            exerciseId: REPLACEMENT_EXERCISE_ID,
            orderIndex: nextOrderIndex,
            section: "ACCESSORY",
            isMainLift: false,
            notes: REPAIR_NOTE,
            sets: {
              create: REPLACEMENT_SETS.map((set) => ({
                setIndex: set.setIndex,
                targetReps: set.targetReps,
                targetRepMin: replacementExerciseMeta.repRangeMin,
                targetRepMax: replacementExerciseMeta.repRangeMax,
                targetLoad: set.actualLoad,
                targetRpe: set.actualRpe,
                logs: {
                  create: {
                    actualReps: set.actualReps,
                    actualLoad: set.actualLoad,
                    actualRpe: set.actualRpe,
                    wasSkipped: false,
                    completedAt: currentSnapshot.completedAt ?? new Date(),
                    notes: REPAIR_NOTE,
                  },
                },
              })),
            },
          },
          select: {
            id: true,
          },
        });
        createdWorkoutExerciseId = createdExercise.id;
      }

      return {
        updatedLoadLogIds: currentPendingLoadFixes,
        createdWorkoutExerciseId,
      };
    });

    const exposureRebuild = await rebuildExerciseExposure(prisma, snapshot.userId);

    console.log(
      JSON.stringify(
        {
          mode: "apply",
          workoutId: snapshot.id,
          userId: snapshot.userId,
          updatedLoadLogIds: applied.updatedLoadLogIds,
          createdWorkoutExerciseId: applied.createdWorkoutExerciseId,
          exposureRebuild,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[repair-workout-cf1f4b62] ${message}`);
  process.exitCode = 1;
});
