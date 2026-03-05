import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mapExercises } from "@/lib/api/workout-context";
import {
  collectStimulusFallbackExercises,
  hasExplicitStimulusProfile,
} from "@/lib/engine/stimulus";

const STRICT_STIMULUS_COVERAGE_ENV = "STRICT_STIMULUS_PROFILE_COVERAGE";
const CLEANUP_STRICT_STIMULUS_COVERAGE_ENV = "CLEANUP_STRICT_STIMULUS_PROFILE_COVERAGE";

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function shouldUseStrictCoverage(): boolean {
  if (process.argv.includes("--strict")) {
    return true;
  }
  if (isTruthyEnv(process.env[STRICT_STIMULUS_COVERAGE_ENV])) {
    return true;
  }
  if (isTruthyEnv(process.env[CLEANUP_STRICT_STIMULUS_COVERAGE_ENV])) {
    return true;
  }
  return isTruthyEnv(process.env.CI);
}

function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
  const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;

  const sanitizedConnectionString = (() => {
    if (!disableVerify) {
      return connectionString;
    }
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  })();

  const pool = new Pool({ connectionString: sanitizedConnectionString, ssl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function isPlannerEligibleExercise(exercise: ReturnType<typeof mapExercises>[number]): boolean {
  const hasPlannerSplit = (exercise.splitTags ?? []).some((tag) =>
    tag === "push" || tag === "pull" || tag === "legs"
  );
  return hasPlannerSplit && (exercise.primaryMuscles?.length ?? 0) > 0;
}

async function main() {
  const prisma = createPrisma();
  const strictCoverage = shouldUseStrictCoverage();

  try {
    const dbExercises = await prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
      },
      orderBy: { name: "asc" },
    });

    const exerciseLibrary = mapExercises(dbExercises);
    const plannerEligible = exerciseLibrary.filter(isPlannerEligibleExercise);
    const covered = plannerEligible.filter((exercise) => hasExplicitStimulusProfile(exercise));
    const uncovered = collectStimulusFallbackExercises(plannerEligible);
    const coveragePct =
      plannerEligible.length === 0 ? 100 : (covered.length / plannerEligible.length) * 100;

    const splitCoverage = (["push", "pull", "legs"] as const).map((splitTag) => {
      const exercises = plannerEligible.filter((exercise) => exercise.splitTags.includes(splitTag));
      const coveredCount = exercises.filter((exercise) => hasExplicitStimulusProfile(exercise)).length;
      const uncoveredCount = exercises.length - coveredCount;
      return {
        splitTag,
        total: exercises.length,
        covered: coveredCount,
        uncovered: uncoveredCount,
      };
    });

    console.log("Stimulus Profile Coverage Report");
    console.log(`Planner-eligible exercises: ${plannerEligible.length}`);
    console.log(`Explicitly covered: ${covered.length}`);
    console.log(`Fallback required: ${uncovered.length}`);
    console.log(`Coverage: ${coveragePct.toFixed(1)}%`);
    console.log(`Strict coverage mode: ${strictCoverage ? "on" : "off"}`);

    console.log("\nCoverage by split:");
    for (const row of splitCoverage) {
      console.log(
        `- ${row.splitTag}: ${row.covered}/${row.total} covered (${row.uncovered} fallback)`
      );
    }

    if (uncovered.length > 0) {
      console.log("\nExercises still relying on fallback:");
      for (const exercise of uncovered) {
        console.log(`- ${exercise.name} (${exercise.id})`);
      }
    }

    if (strictCoverage && uncovered.length > 0) {
      throw new Error(
        `Strict stimulus coverage check failed: ${uncovered.length} exercise(s) still rely on fallback.`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to report stimulus profile coverage", error);
  process.exit(1);
});
