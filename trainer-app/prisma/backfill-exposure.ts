import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { updateExerciseExposure } from "../src/lib/api/exercise-exposure";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const LEGS_WORKOUT_ID = "818123c5-00ab-457f-854d-27e4100851cd";
const REQUIRED_EXERCISES = [
  "Barbell Back Squat",
  "Leg Press",
  "Romanian Deadlift",
  "Seated Leg Curl",
  "Standing Calf Raise",
  "Seated Calf Raise",
];

async function main() {
  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { email: { not: { endsWith: "@test.com" } } },
  });
  if (!firstUser) {
    throw new Error("No user found via prisma.user.findFirst().");
  }

  const fixedLegsWorkout = await prisma.workout.findFirst({
    where: {
      id: LEGS_WORKOUT_ID,
      status: "COMPLETED",
    },
    select: { id: true, userId: true },
  });
  if (!fixedLegsWorkout) {
    throw new Error(`Legs workout ${LEGS_WORKOUT_ID} not found/completed.`);
  }

  let userId = firstUser.id;
  console.log(`Initial user from findFirst(): ${userId}`);
  if (fixedLegsWorkout.userId !== userId) {
    console.log(`Switching to owner of fixed legs workout: ${fixedLegsWorkout.userId}`);
    userId = fixedLegsWorkout.userId;
  }

  const pullWorkout = await prisma.workout.findFirst({
    where: {
      userId,
      sessionIntent: "PULL",
      status: "COMPLETED",
    },
    orderBy: { scheduledDate: "asc" },
    select: { id: true },
  });
  if (!pullWorkout) {
    throw new Error("No completed PULL workout found for user.");
  }

  const pushWorkout = await prisma.workout.findFirst({
    where: {
      userId,
      sessionIntent: "PUSH",
      status: "COMPLETED",
    },
    orderBy: { scheduledDate: "asc" },
    select: { id: true },
  });
  if (!pushWorkout) {
    throw new Error("No completed PUSH workout found for user.");
  }

  const workoutIds = [pullWorkout.id, pushWorkout.id, fixedLegsWorkout.id];
  console.log("Backfilling ExerciseExposure for workouts:", workoutIds);

  for (const workoutId of workoutIds) {
    await updateExerciseExposure(userId, workoutId);
    console.log(`  Updated exposure from workout ${workoutId}`);
  }

  const exposureRows = await prisma.exerciseExposure.findMany({
    where: { userId },
    orderBy: { exerciseName: "asc" },
  });

  console.log("\nExerciseExposure records for user:");
  console.log(JSON.stringify(exposureRows, null, 2));

  const present = new Set(exposureRows.map((row) => row.exerciseName));
  const missing = REQUIRED_EXERCISES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected exposure rows: ${missing.join(", ")}`);
  }

  console.log("\nVerified required exercises present:");
  console.log(REQUIRED_EXERCISES.join(", "));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
