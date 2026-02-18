/**
 * Script to set exercise baselines.
 * Run with: npx tsx scripts/set-baselines.ts
 * Looks exercises up by name so IDs don't need to be hardcoded.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Mirror the SSL workaround from src/lib/db/prisma.ts:
// strip sslmode from URL and pass rejectUnauthorized:false explicitly
const rawUrl = process.env.DATABASE_URL!;
const url = new URL(rawUrl);
url.searchParams.delete("sslmode");
url.searchParams.delete("sslrootcert");
const connectionString = url.toString();
const ssl = { rejectUnauthorized: false };
const pool = new Pool({ connectionString, ssl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type BaselineEntry = {
  exerciseName: string;
  // topSetWeight: stored as total lbs. For dumbbell exercises enter per-DB × 2.
  // Use null for bodyweight-only (no added weight, anchors load estimate at 0).
  topSetWeight: number | null;
  isDumbbell?: boolean;
};

const BASELINES: BaselineEntry[] = [
  // --- from previous session ---
  { exerciseName: "Incline Dumbbell Bench Press", topSetWeight: 110, isDumbbell: true }, // 55 ea
  { exerciseName: "Dumbbell Overhead Press", topSetWeight: 80, isDumbbell: true }, // 40 ea
  // --- new ---
  { exerciseName: "Dip (Chest Emphasis)", topSetWeight: 0 }, // BW — 0 stops estimator guessing
  { exerciseName: "Lying Triceps Extension (Skull Crusher)", topSetWeight: 20, isDumbbell: true }, // 10 ea
  { exerciseName: "Machine Lateral Raise", topSetWeight: 40 }, // 40 lbs
];

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("OWNER_EMAIL env var not set");
  const user = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!user) throw new Error(`Owner user not found: ${ownerEmail}`);
  console.log(`Setting baselines for user: ${user.id}\n`);

  for (const b of BASELINES) {
    const exercise = await prisma.exercise.findFirst({
      where: { name: { equals: b.exerciseName, mode: "insensitive" } },
    });
    if (!exercise) {
      console.error(`✗ Exercise not found: ${b.exerciseName}`);
      continue;
    }

    await prisma.baseline.upsert({
      where: {
        userId_exerciseId_context: {
          userId: user.id,
          exerciseId: exercise.id,
          context: "default",
        },
      },
      update: { topSetWeight: b.topSetWeight },
      create: {
        userId: user.id,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        context: "default",
        category: exercise.isMainLiftEligible ? "MAIN_LIFT" : "OTHER",
        topSetWeight: b.topSetWeight,
      },
    });

    const label =
      b.topSetWeight === null
        ? "BW (null)"
        : b.topSetWeight === 0
          ? "BW (0 lbs)"
          : b.isDumbbell
            ? `${b.topSetWeight} lbs total (${b.topSetWeight / 2} lbs each)`
            : `${b.topSetWeight} lbs`;
    console.log(`✓ ${b.exerciseName}: ${label}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
