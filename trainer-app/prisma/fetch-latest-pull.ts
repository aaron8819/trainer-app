import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const workout = await prisma.workout.findFirst({
    where: {
      sessionIntent: "PULL",
      status: "PLANNED",
    },
    orderBy: { scheduledDate: "desc" },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: { exerciseMuscles: { include: { muscle: true } } },
          },
          sets: { orderBy: { setIndex: "asc" } },
        },
      },
    },
  });

  if (!workout) {
    console.log("No planned Pull workout found");
    return;
  }

  console.log(`Workout: ${workout.id}`);
  console.log(`Total exercises: ${workout.exercises.length}`);
  let totalSets = 0;

  for (const we of workout.exercises) {
    const muscles = we.exercise.exerciseMuscles
      .map((m) => `${m.muscle.name}(${m.role})`)
      .join(", ");
    console.log(`\n  ${we.orderIndex}. ${we.exercise.name} (${we.isMainLift ? "MAIN" : "ACCESSORY"})`);
    console.log(`     Muscles: ${muscles}`);
    console.log(`     Sets: ${we.sets.length}`);
    for (const s of we.sets) {
      console.log(
        `       Set ${s.setIndex}: ${s.targetReps} reps | ${s.targetLoad ?? "BW"} lbs | RPE ${s.targetRpe ?? "N/A"}`
      );
    }
    totalSets += we.sets.length;
  }

  console.log(`\nTotal sets: ${totalSets}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
