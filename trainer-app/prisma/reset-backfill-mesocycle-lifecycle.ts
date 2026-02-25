import {
  PrismaClient,
  type MesocycleExerciseRoleType,
  type WorkoutSessionIntent,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PERFORMED_STATUSES = ["COMPLETED", "PARTIAL"] as const;

function buildVolumeRampConfig() {
  return {
    splitType: "PPL",
    daysPerWeek: 3,
    sessionsPerWeek: 3,
    model: "mev_progressive_then_deload",
    weekTargets: {
      week1: "MEV",
      week2: "MEV+2",
      week3: "MEV+4",
      week4: "min(MAV_upper, MRV)",
      week5Deload: "round(week4*0.45)",
    },
  } as const;
}

function buildRirBandConfig() {
  return {
    splitType: "PPL",
    daysPerWeek: 3,
    sessionsPerWeek: 3,
    weekBands: {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 2, max: 3 },
      week4: { min: 1, max: 2 },
      week5Deload: { min: 4, max: 6 },
    },
  } as const;
}

function resolveSnapshotForIndex(index: number): {
  week: number;
  phase: "ACCUMULATION" | "DELOAD";
  mesoSession: number;
} {
  if (index === 0) {
    return { week: 1, phase: "ACCUMULATION", mesoSession: 1 };
  }
  if (index === 1) {
    return { week: 1, phase: "ACCUMULATION", mesoSession: 2 };
  }
  return { week: 2, phase: "ACCUMULATION", mesoSession: 1 };
}

async function ensureActiveMesocycle(userId: string) {
  const active = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    orderBy: [{ macroCycle: { startDate: "desc" } }, { mesoNumber: "desc" }],
    include: { macroCycle: true },
  });

  if (active) {
    return active;
  }

  const latestMacro = await prisma.macroCycle.findFirst({
    where: { userId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });

  let macroCycleId = latestMacro?.id;
  if (!macroCycleId) {
    const now = new Date();
    const macro = await prisma.macroCycle.create({
      data: {
        userId,
        startDate: now,
        endDate: new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000),
        durationWeeks: 5,
        trainingAge: "INTERMEDIATE",
        primaryGoal: "HYPERTROPHY",
      },
    });
    macroCycleId = macro.id;
    console.log(`Created macroCycle: ${macro.id}`);
  }

  const maxMeso = await prisma.mesocycle.findFirst({
    where: { macroCycleId },
    orderBy: { mesoNumber: "desc" },
    select: { mesoNumber: true },
  });
  const nextMesoNumber = (maxMeso?.mesoNumber ?? 0) + 1;

  const meso = await prisma.mesocycle.create({
    data: {
      macroCycleId,
      mesoNumber: nextMesoNumber,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy 4+1",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      state: "ACTIVE_ACCUMULATION",
      completedSessions: 3,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: buildVolumeRampConfig(),
      rirBandConfig: buildRirBandConfig(),
    },
    include: { macroCycle: true },
  });
  console.log(`Created mesocycle: ${meso.id}`);

  const existingAccumBlock = await prisma.trainingBlock.findFirst({
    where: { mesocycleId: meso.id, blockType: "ACCUMULATION", blockNumber: 1 },
    select: { id: true },
  });
  if (!existingAccumBlock) {
    await prisma.trainingBlock.create({
      data: {
        mesocycleId: meso.id,
        blockNumber: 1,
        blockType: "ACCUMULATION",
        startWeek: 0,
        durationWeeks: 4,
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
      },
    });
    console.log("Created default accumulation block for new mesocycle.");
  }

  return meso;
}

async function main() {
  const user = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { email: { not: { endsWith: "@test.com" } } },
  });

  if (!user) {
    throw new Error("No non-test user found.");
  }
  console.log(`Resolved user: ${user.email} (${user.id})`);

  const meso = await ensureActiveMesocycle(user.id);

  // Ensure only one active mesocycle for the user.
  await prisma.mesocycle.updateMany({
    where: {
      macroCycle: { userId: user.id },
      id: { not: meso.id },
      isActive: true,
    },
    data: { isActive: false },
  });

  await prisma.mesocycle.update({
    where: { id: meso.id },
    data: {
      isActive: true,
      state: "ACTIVE_ACCUMULATION",
      completedSessions: 3,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: buildVolumeRampConfig(),
      rirBandConfig: buildRirBandConfig(),
    },
  });
  console.log(`Mesocycle reset: ${meso.id}`);

  const performed = await prisma.workout.findMany({
    where: {
      userId: user.id,
      status: { in: [...PERFORMED_STATUSES] },
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    take: 3,
    include: {
      exercises: {
        select: {
          exerciseId: true,
          isMainLift: true,
        },
      },
    },
  });

  if (performed.length < 3) {
    throw new Error(`Expected at least 3 performed workouts; found ${performed.length}.`);
  }

  console.log("Backfilling workout mesocycle snapshots:");
  for (let i = 0; i < performed.length; i++) {
    const workout = performed[i];
    const snapshot = resolveSnapshotForIndex(i);
    await prisma.workout.update({
      where: { id: workout.id },
      data: {
        mesocycleId: meso.id,
        mesocycleWeekSnapshot: snapshot.week,
        mesocyclePhaseSnapshot: snapshot.phase,
        mesoSessionSnapshot: snapshot.mesoSession,
      },
    });
    console.log(
      `  [${i + 1}] ${workout.id} ${workout.status} ${workout.scheduledDate.toISOString().slice(0, 10)} -> week=${snapshot.week}, phase=${snapshot.phase}, session=${snapshot.mesoSession}`
    );
  }

  await prisma.mesocycleExerciseRole.deleteMany({
    where: { mesocycleId: meso.id },
  });

  type RoleSeed = {
    mesocycleId: string;
    exerciseId: string;
    sessionIntent: WorkoutSessionIntent;
    role: MesocycleExerciseRoleType;
    addedInWeek: number;
  };
  const dedup = new Map<string, RoleSeed>();

  for (const workout of performed) {
    if (!workout.sessionIntent) {
      continue;
    }
    const week = workout.mesocycleWeekSnapshot ?? 1;
    for (const ex of workout.exercises) {
      const key = `${meso.id}::${ex.exerciseId}::${workout.sessionIntent}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.set(key, {
        mesocycleId: meso.id,
        exerciseId: ex.exerciseId,
        sessionIntent: workout.sessionIntent,
        role: ex.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
        addedInWeek: week,
      });
    }
  }

  if (dedup.size > 0) {
    await prisma.mesocycleExerciseRole.createMany({
      data: [...dedup.values()],
      skipDuplicates: true,
    });
  }
  console.log(`MesocycleExerciseRole rows seeded: ${dedup.size}`);

  const setLogCount = await prisma.setLog.count({
    where: { workoutSet: { workoutExercise: { workout: { userId: user.id } } } },
  });
  console.log(`SetLog records preserved: ${setLogCount}`);

  const verification = await prisma.mesocycle.findUnique({
    where: { id: meso.id },
    select: {
      id: true,
      state: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      daysPerWeek: true,
      splitType: true,
      completedSessions: true,
    },
  });
  console.log("Mesocycle verification:", verification);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
