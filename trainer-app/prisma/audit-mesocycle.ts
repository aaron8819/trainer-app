import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MESOCYCLE_ID = process.argv[2] ?? "85ecd62b-788e-4a51-96c1-e38862996377";
const WORKOUT_ID = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
const NO_FILE_OUTPUT = process.argv.includes("--no-file");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function deriveWeek(accumulationSessionsCompleted: number, sessionsPerWeek: number): number {
  const divisor = Math.max(1, sessionsPerWeek);
  return Math.floor(accumulationSessionsCompleted / divisor) + 1;
}

function rpeToRir(rpe: number | null | undefined): number | null {
  if (rpe == null) {
    return null;
  }
  return Number((10 - rpe).toFixed(2));
}

function inferSetLogStatus(
  hasLog: boolean,
  wasSkipped: boolean | null | undefined,
  hasAnyActual: boolean
): "MISSING" | "SKIPPED" | "LOGGED" | "LOGGED_EMPTY" {
  if (!hasLog) {
    return "MISSING";
  }
  if (wasSkipped) {
    return "SKIPPED";
  }
  if (hasAnyActual) {
    return "LOGGED";
  }
  return "LOGGED_EMPTY";
}

async function main() {
  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: MESOCYCLE_ID },
    include: {
      workouts: {
        where: {
          status: "COMPLETED",
          ...(WORKOUT_ID ? { id: WORKOUT_ID } : {}),
        },
        orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
        include: {
          exercises: {
            orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
            include: {
              exercise: {
                select: { id: true, name: true },
              },
              sets: {
                orderBy: [{ setIndex: "asc" }, { id: "asc" }],
                include: {
                  logs: true,
                },
              },
            },
          },
        },
      },
      exerciseRoles: {
        orderBy: [
          { sessionIntent: "asc" },
          { role: "asc" },
          { addedInWeek: "asc" },
          { createdAt: "asc" },
          { exerciseId: "asc" },
        ],
        include: {
          exercise: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${MESOCYCLE_ID}`);
  }

  const derivedWeek = deriveWeek(mesocycle.accumulationSessionsCompleted, mesocycle.sessionsPerWeek);

  const workouts = mesocycle.workouts.map((workout) => ({
    id: workout.id,
    scheduledDate: workout.scheduledDate.toISOString(),
    status: workout.status,
    mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
    mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    mesoSessionSnapshot: workout.mesoSessionSnapshot,
    selectionMode: workout.selectionMode,
    exercises: workout.exercises.map((we) => ({
      workoutExerciseId: we.id,
      exerciseId: we.exercise.id,
      exerciseName: we.exercise.name,
      section: we.section,
      orderIndex: we.orderIndex,
      prescribed: we.sets.map((set) => {
        const log = set.logs[0] ?? null;
        const hasAnyActual =
          log != null && (log.actualReps != null || log.actualLoad != null || log.actualRpe != null);
        return {
          workoutSetId: set.id,
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRepMin: set.targetRepMin,
          targetRepMax: set.targetRepMax,
          targetLoad: set.targetLoad,
          targetRpe: set.targetRpe,
          targetRirDerived: rpeToRir(set.targetRpe),
          setLog: {
            status: inferSetLogStatus(log != null, log?.wasSkipped, hasAnyActual),
            id: log?.id ?? null,
            wasSkipped: log?.wasSkipped ?? null,
            actualReps: log?.actualReps ?? null,
            actualLoad: log?.actualLoad ?? null,
            actualRpe: log?.actualRpe ?? null,
            actualRirDerived: rpeToRir(log?.actualRpe),
            notes: log?.notes ?? null,
            completedAt: log?.completedAt?.toISOString() ?? null,
          },
        };
      }),
    })),
  }));

  const roles = mesocycle.exerciseRoles.map((role) => ({
    mesocycleId: role.mesocycleId,
    exerciseId: role.exerciseId,
    exerciseName: role.exercise.name,
    sessionIntent: role.sessionIntent,
    role: role.role,
    addedInWeek: role.addedInWeek,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    mesocycleId: mesocycle.id,
    assumptions: {
      rirDerivation: "RIR is derived as (10 - RPE) for target and actual values when RPE exists.",
      workoutFilter: WORKOUT_ID
        ? `Includes only workout ${WORKOUT_ID} in this mesocycle with status COMPLETED.`
        : "Includes only workouts in this mesocycle with status COMPLETED.",
      setLogStatusRules: {
        MISSING: "No SetLog row on WorkoutSet.",
        SKIPPED: "SetLog exists and wasSkipped=true.",
        LOGGED: "SetLog exists and at least one actual value present.",
        LOGGED_EMPTY: "SetLog exists but no actual reps/load/RPE values.",
      },
    },
    mesocycleState: {
      state: mesocycle.state,
      accumulationSessionsCompleted: mesocycle.accumulationSessionsCompleted,
      sessionsPerWeek: mesocycle.sessionsPerWeek,
      derivedWeek: derivedWeek,
      derivationFormula: "floor(accumulationSessionsCompleted / sessionsPerWeek) + 1",
    },
    workoutsCompletedCount: workouts.length,
    workouts,
    mesocycleExerciseRoles: roles,
  };

  const outDir = join(process.cwd(), "output");
  console.log(JSON.stringify(report, null, 2));
  if (!NO_FILE_OUTPUT) {
    mkdirSync(outDir, { recursive: true });
    const outPath = join(
      outDir,
      WORKOUT_ID
        ? `mesocycle-audit-${MESOCYCLE_ID}-workout-${WORKOUT_ID}.json`
        : `mesocycle-audit-${MESOCYCLE_ID}.json`
    );
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`\nSaved report: ${outPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
