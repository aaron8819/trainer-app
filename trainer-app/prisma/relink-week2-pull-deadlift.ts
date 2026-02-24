import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MESOCYCLE_ID = "85ecd62b-788e-4a51-96c1-e38862996377";
const WORKOUT_ID = "3c616fa4-9f40-403b-816f-8a2345be8e30";
const TARGET_EXERCISE_NAME = "Conventional Deadlift";

async function main() {
  const targetExercise = await prisma.exercise.findUnique({
    where: { name: TARGET_EXERCISE_NAME },
    select: { id: true, name: true, movementPatterns: true },
  });
  if (!targetExercise) {
    throw new Error(`Target exercise not found: ${TARGET_EXERCISE_NAME}`);
  }

  const deadliftSlot = await prisma.workoutExercise.findFirst({
    where: {
      workoutId: WORKOUT_ID,
      orderIndex: 0,
    },
    include: {
      exercise: { select: { id: true, name: true } },
      workout: { select: { id: true, sessionIntent: true } },
    },
  });
  if (!deadliftSlot) {
    throw new Error(`Deadlift slot (orderIndex=0) not found in workout ${WORKOUT_ID}`);
  }

  const oldExerciseId = deadliftSlot.exercise.id;
  const oldExerciseName = deadliftSlot.exercise.name;

  if (oldExerciseId === targetExercise.id) {
    console.log(`No-op: workout already linked to ${TARGET_EXERCISE_NAME}.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workoutExercise.update({
      where: { id: deadliftSlot.id },
      data: {
        exerciseId: targetExercise.id,
        movementPatterns: targetExercise.movementPatterns,
      },
    });

    const sessionIntent = deadliftSlot.workout.sessionIntent;
    if (sessionIntent) {
      const oldRole = await tx.mesocycleExerciseRole.findUnique({
        where: {
          mesocycleId_exerciseId_sessionIntent: {
            mesocycleId: MESOCYCLE_ID,
            exerciseId: oldExerciseId,
            sessionIntent,
          },
        },
      });
      if (oldRole) {
        const targetRole = await tx.mesocycleExerciseRole.findUnique({
          where: {
            mesocycleId_exerciseId_sessionIntent: {
              mesocycleId: MESOCYCLE_ID,
              exerciseId: targetExercise.id,
              sessionIntent,
            },
          },
        });

        if (targetRole) {
          await tx.mesocycleExerciseRole.delete({
            where: { id: oldRole.id },
          });
        } else {
          await tx.mesocycleExerciseRole.update({
            where: { id: oldRole.id },
            data: { exerciseId: targetExercise.id },
          });
        }
      }
    }
  });

  console.log(`Workout relinked: ${WORKOUT_ID}`);
  console.log(`  Old: ${oldExerciseName} (${oldExerciseId})`);
  console.log(`  New: ${targetExercise.name} (${targetExercise.id})`);

  const verify = await prisma.workoutExercise.findUnique({
    where: { id: deadliftSlot.id },
    include: { exercise: { select: { id: true, name: true } } },
  });
  console.log(`Verified slot now points to: ${verify?.exercise.name} (${verify?.exercise.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

