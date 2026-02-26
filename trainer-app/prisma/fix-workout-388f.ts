import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const WORKOUT_ID = "388f1e4c-b8a7-4944-91c4-c573f66214e5";
const MESOCYCLE_ID = "85ecd62b-788e-4a51-96c1-e38862996377";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction(async (tx) => {
    const workout = await tx.workout.findUnique({
      where: { id: WORKOUT_ID },
      select: {
        id: true,
        userId: true,
        status: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        mesocyclePhaseSnapshot: true,
        mesoSessionSnapshot: true,
      },
    });
    if (!workout) {
      throw new Error(`Workout not found: ${WORKOUT_ID}`);
    }

    const mesocycle = await tx.mesocycle.findUnique({
      where: { id: MESOCYCLE_ID },
      select: {
        id: true,
        state: true,
        accumulationSessionsCompleted: true,
      },
    });
    if (!mesocycle) {
      throw new Error(`Mesocycle not found: ${MESOCYCLE_ID}`);
    }

    await tx.workout.update({
      where: { id: WORKOUT_ID },
      data: {
        mesocycleId: MESOCYCLE_ID,
        mesocycleWeekSnapshot: 2,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 2,
      },
    });

    await tx.mesocycle.update({
      where: { id: MESOCYCLE_ID },
      data: {
        accumulationSessionsCompleted: 5,
      },
    });

    const updated = await tx.workout.findUnique({
      where: { id: WORKOUT_ID },
      select: {
        id: true,
        status: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        mesocyclePhaseSnapshot: true,
        mesoSessionSnapshot: true,
      },
    });
    const mesoAfter = await tx.mesocycle.findUnique({
      where: { id: MESOCYCLE_ID },
      select: {
        id: true,
        accumulationSessionsCompleted: true,
      },
    });

    console.log("Workout before patch:");
    console.log(JSON.stringify(workout, null, 2));
    console.log("\nMesocycle before patch:");
    console.log(JSON.stringify(mesocycle, null, 2));
    console.log("\nWorkout after patch:");
    console.log(JSON.stringify(updated, null, 2));
    console.log("\nMesocycle after patch:");
    console.log(JSON.stringify(mesoAfter, null, 2));
  });
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
