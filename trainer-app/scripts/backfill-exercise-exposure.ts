/**
 * Backfill exercise exposure data for all users.
 * Aggregates workout history from the last 12 weeks to populate exposure tracking.
 *
 * Run with: npx tsx scripts/backfill-exercise-exposure.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WEEKS_4 = 4 * 7 * 24 * 60 * 60 * 1000; // 4 weeks in milliseconds
const WEEKS_8 = 8 * 7 * 24 * 60 * 60 * 1000; // 8 weeks in milliseconds
const WEEKS_12 = 12 * 7 * 24 * 60 * 60 * 1000; // 12 weeks in milliseconds

async function backfillExerciseExposure() {
  console.log("Starting exercise exposure backfill...");

  const users = await prisma.user.findMany({
    include: {
      workouts: {
        where: {
          status: "COMPLETED",
          scheduledDate: {
            gte: new Date(Date.now() - WEEKS_12),
          },
        },
        include: {
          exercises: {
            include: {
              exercise: true,
              sets: {
                include: {
                  logs: true,
                },
              },
            },
          },
        },
        orderBy: {
          scheduledDate: "desc",
        },
      },
    },
  });

  console.log(`Found ${users.length} users with workout history`);

  let totalExposures = 0;

  for (const user of users) {
    if (user.workouts.length === 0) {
      console.log(`  Skipping user ${user.id} (no completed workouts)`);
      continue;
    }

    // Aggregate exposure data by exercise name
    const exposureMap = new Map<
      string,
      {
        lastUsedAt: Date;
        timesUsedL4W: number;
        timesUsedL8W: number;
        timesUsedL12W: number;
        totalSetsL12W: number;
        totalVolumeL12W: number;
      }
    >();

    const now = Date.now();
    const cutoff4W = now - WEEKS_4;
    const cutoff8W = now - WEEKS_8;
    const cutoff12W = now - WEEKS_12;

    for (const workout of user.workouts) {
      const workoutTime = new Date(workout.scheduledDate).getTime();

      for (const workoutExercise of workout.exercises) {
        const exerciseName = workoutExercise.exercise.name;
        const completedSets = workoutExercise.sets.filter(
          (s) => s.logs.length === 0 || !s.logs[0].wasSkipped
        );
        const setsCount = completedSets.length;
        const volume = completedSets.reduce((sum, set) => {
          const log = set.logs[0];
          const reps = log?.actualReps ?? set.targetReps;
          const load = log?.actualLoad ?? set.targetLoad ?? 0;
          return sum + reps * load;
        }, 0);

        if (!exposureMap.has(exerciseName)) {
          exposureMap.set(exerciseName, {
            lastUsedAt: workout.scheduledDate,
            timesUsedL4W: 0,
            timesUsedL8W: 0,
            timesUsedL12W: 0,
            totalSetsL12W: 0,
            totalVolumeL12W: 0,
          });
        }

        const exposure = exposureMap.get(exerciseName)!;

        // Update last used date if this workout is more recent
        if (workout.scheduledDate > exposure.lastUsedAt) {
          exposure.lastUsedAt = workout.scheduledDate;
        }

        // Count usage in different time windows
        if (workoutTime >= cutoff4W) {
          exposure.timesUsedL4W++;
        }
        if (workoutTime >= cutoff8W) {
          exposure.timesUsedL8W++;
        }
        if (workoutTime >= cutoff12W) {
          exposure.timesUsedL12W++;
          exposure.totalSetsL12W += setsCount;
          exposure.totalVolumeL12W += volume;
        }
      }
    }

    // Calculate averages and upsert to database
    for (const [exerciseName, data] of exposureMap.entries()) {
      const weeksInWindow = Math.min(
        12,
        Math.ceil((now - new Date(data.lastUsedAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
      );
      const avgSetsPerWeek = weeksInWindow > 0 ? data.totalSetsL12W / weeksInWindow : 0;
      const avgVolumePerWeek = weeksInWindow > 0 ? data.totalVolumeL12W / weeksInWindow : 0;

      await prisma.exerciseExposure.upsert({
        where: {
          userId_exerciseName: {
            userId: user.id,
            exerciseName,
          },
        },
        create: {
          userId: user.id,
          exerciseName,
          lastUsedAt: data.lastUsedAt,
          timesUsedL4W: data.timesUsedL4W,
          timesUsedL8W: data.timesUsedL8W,
          timesUsedL12W: data.timesUsedL12W,
          avgSetsPerWeek,
          avgVolumePerWeek,
        },
        update: {
          lastUsedAt: data.lastUsedAt,
          timesUsedL4W: data.timesUsedL4W,
          timesUsedL8W: data.timesUsedL8W,
          timesUsedL12W: data.timesUsedL12W,
          avgSetsPerWeek,
          avgVolumePerWeek,
        },
      });

      totalExposures++;
    }

    console.log(`  Processed ${exposureMap.size} exercises for user ${user.id}`);
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Total exercise exposures created/updated: ${totalExposures}`);
}

backfillExerciseExposure()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
