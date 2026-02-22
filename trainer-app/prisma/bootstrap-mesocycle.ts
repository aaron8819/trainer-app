/**
 * One-off bootstrap script: Create MacroCycle + Mesocycle + TrainingBlock
 * and back-link 3 existing workouts as Week 1 of Meso 1.
 *
 * Run: npx tsx prisma/bootstrap-mesocycle.ts
 *
 * Workout IDs:
 *   Pull  2026-02-16  f58334e2-86fb-438b-ace2-a676759ef001
 *   Push  2026-02-18  b91fdcc9-3ab1-4b16-9ff4-fcb571d1c6d8
 *   Legs  2026-02-20  818123c5-00ab-457f-854d-27e4100851cd
 *
 * Mesocycle: 4 working weeks + 1 deload = 5 weeks total
 * Focus: Strength-Hypertrophy
 * Sessions per meso: ~15 (PPL x5 weeks, deload week counts as 3 lighter sessions)
 * Working sessions target: ~12 (PPL x4 weeks)
 */

import { PrismaClient, BlockType, VolumeTarget, IntensityBias, AdaptationType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const WORKOUT_IDS = {
  pull: "f58334e2-86fb-438b-ace2-a676759ef001",
  push: "b91fdcc9-3ab1-4b16-9ff4-fcb571d1c6d8",
  legs: "818123c5-00ab-457f-854d-27e4100851cd",
};

// Meso structure
// Week 0 (offset): starts 2026-02-16 (pull day)
// 4 working weeks + 1 deload = 5 total weeks = 35 days
// MacroCycle spans the full meso for now (1 meso = 1 macro to start)
const MACRO_START = new Date("2026-02-16T00:00:00.000Z");
const MACRO_END   = new Date("2026-03-22T23:59:59.000Z"); // 5 weeks later
const MACRO_DURATION_WEEKS = 5;
const MESO_DURATION_WEEKS  = 5; // 4 working + 1 deload
const BLOCK_DURATION_WEEKS = 4; // accumulation block = working weeks only

async function main() {
  const owner = await prisma.user.findFirst({
    where: { email: process.env.OWNER_EMAIL ?? "owner@local" },
  });
  if (!owner) throw new Error("Owner user not found.");

  // Verify all 3 workouts exist and belong to owner
  const workouts = await prisma.workout.findMany({
    where: { id: { in: Object.values(WORKOUT_IDS) }, userId: owner.id },
    select: { id: true, sessionIntent: true, scheduledDate: true },
  });
  if (workouts.length !== 3) {
    throw new Error(`Expected 3 workouts, found ${workouts.length}. Check IDs.`);
  }
  console.log("Workouts verified ✓");
  workouts.forEach(w => console.log(`  ${w.sessionIntent} — ${w.scheduledDate.toISOString().slice(0,10)} — ${w.id}`));

  // 1. Create MacroCycle
  const macro = await prisma.macroCycle.create({
    data: {
      userId: owner.id,
      startDate: MACRO_START,
      endDate: MACRO_END,
      durationWeeks: MACRO_DURATION_WEEKS,
      trainingAge: "INTERMEDIATE",
      primaryGoal: "HYPERTROPHY",
    },
  });
  console.log(`\nMacroCycle created: ${macro.id}`);

  // 2. Create Mesocycle
  // completedSessions = 3 (the 3 week-1 workouts already performed)
  const meso = await prisma.mesocycle.create({
    data: {
      macroCycleId: macro.id,
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: MESO_DURATION_WEEKS,
      focus: "Strength-Hypertrophy",
      volumeTarget: VolumeTarget.MODERATE,      // Week 1-2 = building, not peak
      intensityBias: IntensityBias.HYPERTROPHY, // 6-12 rep dominant with heavy compounds
      completedSessions: 3,                     // Pull + Push + Legs already done
      isActive: true,
    },
  });
  console.log(`Mesocycle created: ${meso.id} (completedSessions: 3)`);

  // 3. Create TrainingBlock — Accumulation (weeks 1-4)
  // Week 5 (deload) gets its own block when the time comes
  const block = await prisma.trainingBlock.create({
    data: {
      mesocycleId: meso.id,
      blockNumber: 1,
      blockType: BlockType.ACCUMULATION,
      startWeek: 0,
      durationWeeks: BLOCK_DURATION_WEEKS,
      volumeTarget: VolumeTarget.MODERATE,
      intensityBias: IntensityBias.HYPERTROPHY,
      adaptationType: AdaptationType.MYOFIBRILLAR_HYPERTROPHY,
    },
  });
  console.log(`TrainingBlock created: ${block.id} (ACCUMULATION, weeks 1-4)`);

  // 4. Back-link all 3 workouts to the block, set weekInBlock = 1
  await prisma.workout.updateMany({
    where: { id: { in: Object.values(WORKOUT_IDS) } },
    data: {
      trainingBlockId: block.id,
      weekInBlock: 1,
    },
  });
  console.log(`\nAll 3 workouts linked to block, weekInBlock = 1 ✓`);

  // 5. Verification summary
  const mesoCheck = await prisma.mesocycle.findUnique({
    where: { id: meso.id },
    select: { completedSessions: true, isActive: true, focus: true, durationWeeks: true },
  });
  const linkedWorkouts = await prisma.workout.findMany({
    where: { trainingBlockId: block.id },
    select: { id: true, sessionIntent: true, weekInBlock: true, scheduledDate: true },
  });

  console.log("\n--- Verification ---");
  console.log("Mesocycle:", mesoCheck);
  console.log("Linked workouts:");
  linkedWorkouts.forEach(w =>
    console.log(`  ${w.sessionIntent} | week ${w.weekInBlock} | ${w.scheduledDate.toISOString().slice(0,10)} | ${w.id}`)
  );

  console.log("\n✓ Done. You are now in Week 2 of Meso 1.");
  console.log(`  MacroCycle:    ${macro.id}`);
  console.log(`  Mesocycle:     ${meso.id}`);
  console.log(`  TrainingBlock: ${block.id}`);
  console.log(`  Sessions completed: 3 / ~12 working sessions`);
  console.log(`  RIR target for Week 2: 2-3 RIR (per research)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await pool.end(); });
