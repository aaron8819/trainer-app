// Standard adapter header
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const workout = await prisma.workout.findUnique({
    where: { id: "f58334e2-86fb-438b-ace2-a676759ef001" },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: true,
          sets: {
            orderBy: { setIndex: "asc" },
          },
        },
      },
    },
  });

  if (!workout) {
    console.log("Workout not found");
    return;
  }

  console.log(`Workout: ${workout.id}`);
  console.log(`Date: ${workout.scheduledDate.toISOString()}`);
  console.log(`Intent: ${workout.sessionIntent}`);
  console.log(`Status: ${workout.status}`);
  console.log(`\nExercises:`);

  for (const we of workout.exercises) {
    console.log(`\n  ${we.orderIndex + 1}. ${we.exercise.name} (${we.isMainLift ? "MAIN LIFT" : "ACCESSORY"})`);
    for (const set of we.sets) {
      const reps =
        set.targetRepMin != null && set.targetRepMax != null
          ? `${set.targetRepMin}-${set.targetRepMax}`
          : `${set.targetReps}`;
      console.log(
        `     Set ${set.setIndex + 1}: ${reps} reps | ${set.targetLoad ?? "BW"} lbs | RPE ${set.targetRpe ?? "?"}`
      );
    }
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
