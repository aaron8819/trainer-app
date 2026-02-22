/**
 * One-off import script: Leg workout performed 2026-02-20, logged externally.
 * Run: npx ts-node --project tsconfig.json prisma/import-leg-workout.ts
 * Or:  npx tsx prisma/import-leg-workout.ts
 */

import { PrismaClient, WorkoutStatus, WorkoutSelectionMode, WorkoutSessionIntent, WorkoutExerciseSection } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Resolve owner
  const owner = await prisma.user.findFirst({ where: { email: process.env.OWNER_EMAIL ?? "owner@local" } });
  if (!owner) throw new Error("Owner user not found. Run the app once to initialize.");

  const workoutDate = new Date("2026-02-20T12:00:00.000Z");

  // Resolve exercise IDs
  async function findExercise(name: string) {
    const ex = await prisma.exercise.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (!ex) throw new Error(`Exercise not found in library: "${name}"`);
    return ex;
  }

  const [squat, legPress, rdl, legCurl, standingCalf, seatedCalf] = await Promise.all([
    findExercise("Barbell Back Squat"),
    findExercise("Leg Press"),
    findExercise("Romanian Deadlift"),
    findExercise("Seated Leg Curl"),
    findExercise("Standing Calf Raise"),
    findExercise("Seated Calf Raise"),
  ]);

  console.log("All exercises resolved ✓");

  // Create workout
  const workout = await prisma.workout.create({
    data: {
      userId: owner.id,
      scheduledDate: workoutDate,
      completedAt: workoutDate,
      status: WorkoutStatus.COMPLETED,
      selectionMode: WorkoutSelectionMode.MANUAL,
      sessionIntent: WorkoutSessionIntent.LEGS,
      notes: "Manually imported — performed externally 2026-02-20",
      revision: 1,
      advancesSplit: true,
    },
  });

  console.log(`Workout created: ${workout.id}`);

  // Helper: create WorkoutExercise + WorkoutSets + SetLogs in one chain
  async function createExerciseWithSets(
    orderIndex: number,
    exerciseId: string,
    isMainLift: boolean,
    section: WorkoutExerciseSection,
    sets: { reps: number; load: number; rir: number }[]
  ) {
    const we = await prisma.workoutExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId,
        orderIndex,
        isMainLift,
        section,
      },
    });

    for (let i = 0; i < sets.length; i++) {
      const { reps, load, rir } = sets[i];
      const rpe = 10 - rir; // RIR → RPE
      const ws = await prisma.workoutSet.create({
        data: {
          workoutExerciseId: we.id,
          setIndex: i,
          targetReps: reps,
          targetRpe: rpe,
          targetLoad: load,
        },
      });

      await prisma.setLog.create({
        data: {
          workoutSetId: ws.id,
          actualReps: reps,
          actualRpe: rpe,
          actualLoad: load,
          wasSkipped: false,
          completedAt: workoutDate,
        },
      });
    }

    console.log(`  ✓ ${sets.length} sets logged for orderIndex ${orderIndex}`);
  }

  // 1. Barbell Back Squat — 4x6 @ 135lb, 3 RIR
  await createExerciseWithSets(0, squat.id, true, WorkoutExerciseSection.MAIN, [
    { reps: 6, load: 135, rir: 3 },
    { reps: 6, load: 135, rir: 3 },
    { reps: 6, load: 135, rir: 3 },
    { reps: 6, load: 135, rir: 3 },
  ]);

  // 2. Leg Press — 1x10 @ 180lb, 2x12 @ 140lb, 2 RIR
  await createExerciseWithSets(1, legPress.id, false, WorkoutExerciseSection.MAIN, [
    { reps: 10, load: 180, rir: 2 },
    { reps: 12, load: 140, rir: 2 },
    { reps: 12, load: 140, rir: 2 },
  ]);

  // 3. Romanian Deadlift — 3x10 @ 45lb per dumbbell, 2 RIR
  await createExerciseWithSets(2, rdl.id, false, WorkoutExerciseSection.MAIN, [
    { reps: 10, load: 45, rir: 2 },
    { reps: 10, load: 45, rir: 2 },
    { reps: 10, load: 45, rir: 2 },
  ]);

  // 4. Seated Leg Curl — 3x15 @ 55lb, 2 RIR
  await createExerciseWithSets(3, legCurl.id, false, WorkoutExerciseSection.ACCESSORY, [
    { reps: 15, load: 55, rir: 2 },
    { reps: 15, load: 55, rir: 2 },
    { reps: 15, load: 55, rir: 2 },
  ]);

  // 5. Standing Calf Raise — 3x12 @ 90lb, 2 RIR
  await createExerciseWithSets(4, standingCalf.id, false, WorkoutExerciseSection.ACCESSORY, [
    { reps: 12, load: 90, rir: 2 },
    { reps: 12, load: 90, rir: 2 },
    { reps: 12, load: 90, rir: 2 },
  ]);

  // 6. Seated Calf Raise — 3x15 @ 50lb, 2 RIR
  await createExerciseWithSets(5, seatedCalf.id, false, WorkoutExerciseSection.ACCESSORY, [
    { reps: 15, load: 50, rir: 2 },
    { reps: 15, load: 50, rir: 2 },
    { reps: 15, load: 50, rir: 2 },
  ]);

  // Increment completedSessions on active mesocycle — mirrors save route behavior
  const activeMeso = await prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId: owner.id },
    },
  });

  if (activeMeso) {
    await prisma.mesocycle.update({
      where: { id: activeMeso.id },
      data: { completedSessions: { increment: 1 } },
    });
    console.log(`  ✓ completedSessions incremented on mesocycle ${activeMeso.id} (was ${activeMeso.completedSessions})`);
  } else {
    console.warn("  ⚠ No active mesocycle found — completedSessions not incremented");
  }

  console.log(`\nDone. Workout ID: ${workout.id}`);
  console.log(`View at: /workout/${workout.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
