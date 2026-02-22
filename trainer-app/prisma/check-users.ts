import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = await Promise.all(
    users.map(async (user) => {
      const [workoutCount, constraintsCount] = await Promise.all([
        prisma.workout.count({ where: { userId: user.id } }),
        prisma.constraints.count({ where: { userId: user.id } }),
      ]);

      return {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        workoutCount,
        hasConstraints: constraintsCount > 0,
      };
    })
  );

  console.table(rows);
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
