import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const meso = await prisma.mesocycle.findUnique({
    where: { id: "85ecd62b-788e-4a51-96c1-e38862996377" },
    select: { volumeRampConfig: true, rirBandConfig: true },
  });
  console.log(JSON.stringify(meso, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
