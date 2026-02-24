import { PrismaClient, type MesocycleExerciseRoleType, type WorkoutSessionIntent } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MESOCYCLE_ID = "85ecd62b-788e-4a51-96c1-e38862996377";
const SESSION_INTENT: WorkoutSessionIntent = "PULL";

type CanonicalExercise = {
  searchLabel: string;
  searchTerms: string[];
  role: MesocycleExerciseRoleType;
  addedInWeek: number;
};

const CANONICAL_PULL_EXERCISES: CanonicalExercise[] = [
  {
    searchLabel: "T-Bar Row",
    searchTerms: ["T-Bar Row", "T Bar Row"],
    role: "CORE_COMPOUND",
    addedInWeek: 1,
  },
  {
    searchLabel: "Lat Pulldown",
    searchTerms: ["Lat Pulldown"],
    role: "CORE_COMPOUND",
    addedInWeek: 2,
  },
  {
    searchLabel: "Cable Pullover",
    searchTerms: ["Cable Pullover"],
    role: "ACCESSORY",
    addedInWeek: 1,
  },
  {
    searchLabel: "Face Pull",
    searchTerms: ["Face Pull"],
    role: "ACCESSORY",
    addedInWeek: 1,
  },
  {
    searchLabel: "EZ-Bar Curl",
    searchTerms: ["EZ-Bar Curl", "EZ Bar Curl", "EZ"],
    role: "ACCESSORY",
    addedInWeek: 2,
  },
  {
    searchLabel: "Hammer Curl",
    searchTerms: ["Hammer Curl"],
    role: "ACCESSORY",
    addedInWeek: 2,
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
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreCandidate(candidateName: string, searchTerms: string[]): number {
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

function isExcludedPullExercise(name: string): boolean {
  const n = normalize(name);
  return (
    n.includes("deadlift") ||
    n.includes("assisted pull up") ||
    n === "pull up" ||
    n.includes("pullup") ||
    n.includes("chest supported dumbbell row") ||
    n === "cable curl" ||
    n.includes("bayesian curl") ||
    n.includes("incline dumbbell curl")
  );
}

async function resolveCanonicalExercise(input: CanonicalExercise) {
  const candidates = await prisma.exercise.findMany({
    where: {
      OR: input.searchTerms.map((term) => ({
        name: { contains: term, mode: "insensitive" },
      })),
    },
    select: { id: true, name: true },
    take: 30,
  });

  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((a, b) => {
    const aScore = scoreCandidate(a.name, input.searchTerms);
    const bScore = scoreCandidate(b.name, input.searchTerms);
    if (aScore !== bScore) return aScore - bScore;
    return a.name.length - b.name.length;
  });

  return sorted[0] ?? null;
}

async function main() {
  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: MESOCYCLE_ID },
    select: { id: true },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${MESOCYCLE_ID}`);
  }

  const matchedCanonical: Array<{
    input: CanonicalExercise;
    exerciseId: string;
    exerciseName: string;
  }> = [];

  console.log("Exercise matching results (searched -> found -> ID):");
  for (const input of CANONICAL_PULL_EXERCISES) {
    const found = await resolveCanonicalExercise(input);
    if (!found) {
      throw new Error(`No exercise match found for "${input.searchLabel}" using terms: ${input.searchTerms.join(", ")}`);
    }
    console.log(`  "${input.searchLabel}" -> "${found.name}" -> ${found.id}`);
    matchedCanonical.push({
      input,
      exerciseId: found.id,
      exerciseName: found.name,
    });
  }

  const uniqueExerciseIds = new Set(matchedCanonical.map((m) => m.exerciseId));
  if (uniqueExerciseIds.size !== matchedCanonical.length) {
    throw new Error("Canonical list resolved to duplicate exercise IDs. Refine search terms before applying.");
  }

  const deleted = await prisma.mesocycleExerciseRole.deleteMany({
    where: {
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
    },
  });

  let rowsInserted = 0;
  let rowsUpdated = 0;

  for (const match of matchedCanonical) {
    const existing = await prisma.mesocycleExerciseRole.findUnique({
      where: {
        mesocycleId_exerciseId_sessionIntent: {
          mesocycleId: MESOCYCLE_ID,
          exerciseId: match.exerciseId,
          sessionIntent: SESSION_INTENT,
        },
      },
      select: { id: true },
    });

    await prisma.mesocycleExerciseRole.upsert({
      where: {
        mesocycleId_exerciseId_sessionIntent: {
          mesocycleId: MESOCYCLE_ID,
          exerciseId: match.exerciseId,
          sessionIntent: SESSION_INTENT,
        },
      },
      create: {
        mesocycleId: MESOCYCLE_ID,
        exerciseId: match.exerciseId,
        sessionIntent: SESSION_INTENT,
        role: match.input.role,
        addedInWeek: match.input.addedInWeek,
      },
      update: {
        role: match.input.role,
        addedInWeek: match.input.addedInWeek,
      },
    });

    if (existing) rowsUpdated += 1;
    else rowsInserted += 1;
  }

  const pullRolesPostUpsert = await prisma.mesocycleExerciseRole.findMany({
    where: {
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
    },
    include: {
      exercise: { select: { id: true, name: true } },
    },
  });

  const excludedRoleIds = pullRolesPostUpsert
    .filter((row) => isExcludedPullExercise(row.exercise.name))
    .map((row) => row.id);

  let excludedRemovedCount = 0;
  if (excludedRoleIds.length > 0) {
    const removed = await prisma.mesocycleExerciseRole.deleteMany({
      where: { id: { in: excludedRoleIds } },
    });
    excludedRemovedCount = removed.count;
  }

  const finalRows = await prisma.mesocycleExerciseRole.findMany({
    where: {
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
    },
    include: {
      exercise: { select: { id: true, name: true } },
    },
    orderBy: [{ addedInWeek: "asc" }, { role: "asc" }, { exercise: { name: "asc" } }],
  });

  console.log("");
  console.log(`Rows deleted (existing PULL roles): ${deleted.count}`);
  console.log(`Rows inserted (upsert create path): ${rowsInserted}`);
  console.log(`Rows updated (upsert update path): ${rowsUpdated}`);
  console.log(`Excluded rows removed post-upsert: ${excludedRemovedCount}`);
  console.log("");
  console.log("Final MesocycleExerciseRole rows for PULL intent:");
  for (const row of finalRows) {
    console.log(`  (${row.exerciseId}, ${row.exercise.name}, ${row.role}, ${row.addedInWeek})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
