import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STALE_USER_ID = "f2ec053c-94b9-42fc-af07-d199eb2763ef";

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.setLog.deleteMany({
      where: { workoutSet: { workoutExercise: { workout: { userId: STALE_USER_ID } } } },
    });
    await tx.workoutSet.deleteMany({
      where: { workoutExercise: { workout: { userId: STALE_USER_ID } } },
    });
    await tx.workoutExercise.deleteMany({
      where: { workout: { userId: STALE_USER_ID } },
    });
    await tx.filteredExercise.deleteMany({
      where: { workout: { userId: STALE_USER_ID } },
    });
    await tx.workout.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.workoutTemplateExercise.deleteMany({
      where: { template: { userId: STALE_USER_ID } },
    });
    await tx.workoutTemplate.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.sessionCheckIn.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.injury.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.userPreference.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.profile.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.constraints.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.goals.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.macroCycle.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.exerciseExposure.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.readinessSignal.deleteMany({
      where: { userId: STALE_USER_ID },
    });
    await tx.userIntegration.deleteMany({
      where: { userId: STALE_USER_ID },
    });
  });

  const deleted = await prisma.user.delete({
    where: { id: STALE_USER_ID },
  });

  console.log(`Deleted user ${deleted.id} (${deleted.email})`);
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
