import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getCurrentMesoWeek, transitionMesocycleState } from "../src/lib/api/mesocycle-lifecycle";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type LoggedSet = {
  reps: number;
  load: number;
  rpe: number;
  note?: string;
};

type ExerciseInput = {
  requestedName: string;
  searchTerms: string[];
  section: "MAIN" | "ACCESSORY";
  isMainLift: boolean;
  orderIndex: number;
  sets: LoggedSet[];
};

const USER_EMAIL = "aaron8819@gmail.com";
const MESOCYCLE_ID = "85ecd62b-788e-4a51-96c1-e38862996377";
const SESSION_DATE = new Date("2026-02-23T00:00:00.000Z");
const SESSION_INTENT = "PULL" as const;
const ASSISTED_PULLUP_NOTE = "assisted: 100 lbs counterbalance";

const WEEK2_PULL_EXERCISES: ExerciseInput[] = [
  {
    requestedName: "Barbell Deadlift",
    searchTerms: ["Barbell Deadlift", "Deadlift"],
    section: "MAIN",
    isMainLift: true,
    orderIndex: 0,
    sets: [
      { reps: 5, load: 155, rpe: 8 },
      { reps: 5, load: 155, rpe: 8 },
      { reps: 5, load: 155, rpe: 8 },
    ],
  },
  {
    requestedName: "Assisted Pull-Up",
    searchTerms: ["Assisted Pull-Up", "Pull-Up"],
    section: "MAIN",
    isMainLift: true,
    orderIndex: 1,
    sets: [
      { reps: 8, load: 0, rpe: 8.5, note: ASSISTED_PULLUP_NOTE },
      { reps: 8, load: 0, rpe: 8.5, note: ASSISTED_PULLUP_NOTE },
      { reps: 8, load: 0, rpe: 8.5, note: ASSISTED_PULLUP_NOTE },
      { reps: 8, load: 0, rpe: 8.5, note: ASSISTED_PULLUP_NOTE },
    ],
  },
  {
    requestedName: "Chest-Supported Row",
    searchTerms: [
      "Chest-Supported Row",
      "Chest Supported",
      "Chest-Supported Dumbbell Row",
      "Machine Row",
    ],
    section: "MAIN",
    isMainLift: true,
    orderIndex: 2,
    sets: [
      { reps: 12, load: 100, rpe: 9 },
      { reps: 12, load: 95, rpe: 9 },
      { reps: 12, load: 90, rpe: 9 },
    ],
  },
  {
    requestedName: "Lat Pulldown (neutral grip)",
    searchTerms: ["Lat Pulldown", "Lat Pull-Down"],
    section: "ACCESSORY",
    isMainLift: false,
    orderIndex: 3,
    sets: [
      { reps: 12, load: 85, rpe: 8 },
      { reps: 12, load: 85, rpe: 8 },
      { reps: 12, load: 85, rpe: 8 },
    ],
  },
  {
    requestedName: "Rear Delt Machine Fly",
    searchTerms: ["Rear Delt Machine Fly", "Rear Delt Fly", "Reverse Fly"],
    section: "ACCESSORY",
    isMainLift: false,
    orderIndex: 4,
    sets: [
      { reps: 20, load: 40, rpe: 5, note: "warmup feel set (logged as performed set)" },
      { reps: 13, load: 55, rpe: 9 },
      { reps: 15, load: 55, rpe: 10 },
    ],
  },
  {
    requestedName: "EZ Bar Curl",
    searchTerms: ["EZ Bar Curl", "EZ-Bar Curl", "Barbell Curl"],
    section: "ACCESSORY",
    isMainLift: false,
    orderIndex: 5,
    sets: [
      { reps: 10, load: 50, rpe: 10 },
      { reps: 8, load: 50, rpe: 10 },
      { reps: 9, load: 50, rpe: 10 },
    ],
  },
  {
    requestedName: "Hammer Curl",
    searchTerms: ["Hammer Curl", "Hammer Curl - Dumbbell"],
    section: "ACCESSORY",
    isMainLift: false,
    orderIndex: 6,
    sets: [
      { reps: 12, load: 20, rpe: 9.5 },
      { reps: 12, load: 20, rpe: 9.5 },
      { reps: 12, load: 20, rpe: 9.5 },
    ],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function scoreMatch(candidateName: string, searchTerms: string[]): number {
  const candidate = normalize(candidateName);
  let best = Number.POSITIVE_INFINITY;

  for (const termRaw of searchTerms) {
    const term = normalize(termRaw);
    if (!term) continue;
    if (candidate === term) return 0;
    if (candidate.includes(term) || term.includes(candidate)) {
      best = Math.min(best, 0.25);
      continue;
    }
    best = Math.min(best, levenshtein(candidate, term));
  }

  return best;
}

async function matchExercise(input: ExerciseInput) {
  const candidates = await prisma.exercise.findMany({
    where: {
      OR: input.searchTerms.map((term) => ({
        name: { contains: term, mode: "insensitive" },
      })),
    },
    select: { id: true, name: true, movementPatterns: true },
    take: 25,
  });

  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((a, b) => {
    const aScore = scoreMatch(a.name, input.searchTerms);
    const bScore = scoreMatch(b.name, input.searchTerms);
    if (aScore !== bScore) return aScore - bScore;
    return a.name.length - b.name.length;
  });

  return sorted[0] ?? null;
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(`User not found: ${USER_EMAIL}`);
  }

  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: MESOCYCLE_ID },
    select: { id: true },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${MESOCYCLE_ID}`);
  }

  const duplicate = await prisma.workout.findFirst({
    where: {
      userId: user.id,
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
      scheduledDate: SESSION_DATE,
      mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 2,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new Error(`A workout with this exact week2 pull snapshot already exists: ${duplicate.id}`);
  }

  const matched: Array<{
    input: ExerciseInput;
    exerciseId: string;
    exerciseName: string;
    movementPatterns: string[];
  }> = [];

  console.log("Exercise matching results:");
  for (const input of WEEK2_PULL_EXERCISES) {
    const resolved = await matchExercise(input);
    if (!resolved) {
      console.warn(`  WARN: "${input.requestedName}" -> no match found, skipping`);
      continue;
    }
    console.log(`  "${input.requestedName}" -> "${resolved.name}" (${resolved.id})`);
    matched.push({
      input,
      exerciseId: resolved.id,
      exerciseName: resolved.name,
      movementPatterns: resolved.movementPatterns ?? [],
    });
  }

  if (matched.length === 0) {
    throw new Error("No exercises matched. Nothing to insert.");
  }

  let setLogInserted = 0;
  const workout = await prisma.$transaction(async (tx) => {
    const createdWorkout = await tx.workout.create({
      data: {
        userId: user.id,
        scheduledDate: SESSION_DATE,
        completedAt: SESSION_DATE,
        status: "COMPLETED",
        selectionMode: "MANUAL",
        sessionIntent: SESSION_INTENT,
        mesocycleId: MESOCYCLE_ID,
        mesocycleWeekSnapshot: 2,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 2,
        notes: "Manual backfill: Week 2 Pull session",
      },
      select: { id: true },
    });

    for (const item of matched) {
      const createdExercise = await tx.workoutExercise.create({
        data: {
          workoutId: createdWorkout.id,
          exerciseId: item.exerciseId,
          orderIndex: item.input.orderIndex,
          section: item.input.section,
          isMainLift: item.input.isMainLift,
          movementPatterns: item.movementPatterns as never,
        },
        select: { id: true },
      });

      for (let i = 0; i < item.input.sets.length; i++) {
        const set = item.input.sets[i];
        const createdSet = await tx.workoutSet.create({
          data: {
            workoutExerciseId: createdExercise.id,
            setIndex: i + 1,
            targetReps: set.reps,
            targetRpe: set.rpe,
            targetLoad: set.load,
          },
          select: { id: true },
        });

        const logNotes = [set.note].filter(Boolean).join("; ") || undefined;
        await tx.setLog.create({
          data: {
            workoutSetId: createdSet.id,
            actualReps: set.reps,
            actualLoad: set.load,
            actualRpe: set.rpe,
            notes: logNotes,
            wasSkipped: false,
            completedAt: SESSION_DATE,
          },
        });
        setLogInserted += 1;
      }
    }

    const roleRows = matched.map((item) => ({
      mesocycleId: MESOCYCLE_ID,
      exerciseId: item.exerciseId,
      sessionIntent: SESSION_INTENT,
      role: item.input.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
      addedInWeek: 2,
    }));
    await tx.mesocycleExerciseRole.createMany({
      data: roleRows,
      skipDuplicates: true,
    });

    return createdWorkout;
  });

  console.log(`Note: Assisted pull-up counterbalance stored in SetLog.notes: "${ASSISTED_PULLUP_NOTE}"`);
  console.log(`Workout ID created: ${workout.id}`);
  console.log(`WorkoutExercise count inserted: ${matched.length}`);
  console.log(`SetLog count inserted: ${setLogInserted}`);

  const transitioned = await transitionMesocycleState(MESOCYCLE_ID);
  const currentWeek = getCurrentMesoWeek(transitioned);
  const roleCount = await prisma.mesocycleExerciseRole.count({
    where: { mesocycleId: MESOCYCLE_ID },
  });

  console.log("Mesocycle after lifecycle transition:");
  console.log(`  accumulationSessionsCompleted: ${transitioned.accumulationSessionsCompleted}`);
  console.log(`  state: ${transitioned.state}`);
  console.log(`  currentWeek: ${currentWeek}`);
  console.log(`MesocycleExerciseRole total rows: ${roleCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

