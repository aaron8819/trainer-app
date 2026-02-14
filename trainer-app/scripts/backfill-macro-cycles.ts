/**
 * Backfill macro cycles for all existing users.
 * Creates a 12-week macro cycle for each user based on their profile and goals.
 *
 * Run with: npx tsx scripts/backfill-macro-cycles.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateMacroCycle } from "../src/lib/engine";

const prisma = new PrismaClient();

async function backfillMacroCycles() {
  console.log("Starting macro cycle backfill...");

  const users = await prisma.user.findMany({
    include: {
      profile: true,
      goals: true,
      macroCycles: true,
    },
  });

  console.log(`Found ${users.length} users`);

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    // Skip if user already has a macro cycle
    if (user.macroCycles.length > 0) {
      console.log(`  Skipping user ${user.id} (already has macro cycle)`);
      skipped++;
      continue;
    }

    // Skip if user doesn't have profile or goals
    if (!user.profile || !user.goals) {
      console.log(`  Skipping user ${user.id} (missing profile or goals)`);
      skipped++;
      continue;
    }

    // Map Prisma enums to engine types (lowercase)
    const trainingAge = user.profile.trainingAge.toLowerCase() as "beginner" | "intermediate" | "advanced";
    const primaryGoal = user.goals.primaryGoal.toLowerCase() as
      | "hypertrophy"
      | "strength"
      | "fat_loss"
      | "athleticism"
      | "general_health";

    // Generate macro cycle using engine
    const macro = generateMacroCycle({
      userId: user.id,
      startDate: new Date(),
      durationWeeks: 12,
      trainingAge,
      primaryGoal,
    });

    // Create macro cycle in database with nested mesos and blocks
    await prisma.macroCycle.create({
      data: {
        id: macro.id,
        userId: macro.userId,
        startDate: macro.startDate,
        endDate: macro.endDate,
        durationWeeks: macro.durationWeeks,
        trainingAge: user.profile.trainingAge, // Use Prisma enum
        primaryGoal: user.goals.primaryGoal === "ATHLETICISM"
          ? "GENERAL_HEALTH"
          : user.goals.primaryGoal, // Map to Prisma enum
        mesocycles: {
          create: macro.mesocycles.map((meso) => ({
            id: meso.id,
            mesoNumber: meso.mesoNumber,
            startWeek: meso.startWeek,
            durationWeeks: meso.durationWeeks,
            focus: meso.focus,
            volumeTarget: meso.volumeTarget.toUpperCase() as "LOW" | "MODERATE" | "HIGH" | "PEAK",
            intensityBias: meso.intensityBias.toUpperCase() as "STRENGTH" | "HYPERTROPHY" | "ENDURANCE",
            blocks: {
              create: meso.blocks.map((block) => ({
                id: block.id,
                blockNumber: block.blockNumber,
                blockType: block.blockType.toUpperCase() as "ACCUMULATION" | "INTENSIFICATION" | "REALIZATION" | "DELOAD",
                startWeek: block.startWeek,
                durationWeeks: block.durationWeeks,
                volumeTarget: block.volumeTarget.toUpperCase() as "LOW" | "MODERATE" | "HIGH" | "PEAK",
                intensityBias: block.intensityBias.toUpperCase() as "STRENGTH" | "HYPERTROPHY" | "ENDURANCE",
                adaptationType: block.adaptationType.toUpperCase() as
                  | "NEURAL_ADAPTATION"
                  | "MYOFIBRILLAR_HYPERTROPHY"
                  | "SARCOPLASMIC_HYPERTROPHY"
                  | "WORK_CAPACITY"
                  | "RECOVERY",
              })),
            },
          })),
        },
      },
    });

    console.log(`  Created macro cycle for user ${user.id} (${trainingAge}, ${primaryGoal})`);
    created++;
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
}

backfillMacroCycles()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
