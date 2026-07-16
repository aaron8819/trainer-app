import "dotenv/config";
import {
  Prisma,
  PrismaClient,
  WorkoutStatus,
  type WorkoutSessionIntent,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildSavedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { assertOperationalProductionWriteAllowed } from "@/lib/operations/rollout-environment";

const OWNER_EMAIL = "aaron8819@gmail.com";
const TARGET_MESOCYCLE_ID = "12079700-5333-4ffc-9cbd-bb303588f288";

const TARGETS = [
  {
    id: "915e5aef-c203-4318-a7ea-45a4b2e881c6",
    title: "Upper 1 - Wk5-S1 - Deload",
    sessionIntent: "UPPER",
    mesoSessionSnapshot: 1,
    exerciseCount: 3,
    setCount: 9,
  },
  {
    id: "7ef7d0f8-46df-4f61-a1cc-8acfc2ec8262",
    title: "Lower 1 - Wk5-S2 - Deload",
    sessionIntent: "LOWER",
    mesoSessionSnapshot: 2,
    exerciseCount: 3,
    setCount: 7,
  },
  {
    id: "d3cc5f1e-9e82-442d-a1de-b79d410fe5a7",
    title: "Upper 2 - Wk5-S3 - Deload",
    sessionIntent: "UPPER",
    mesoSessionSnapshot: 3,
    exerciseCount: 3,
    setCount: 8,
  },
  {
    id: "f2d0abe4-3e5f-4915-83bc-891b48383ad1",
    title: "Lower 2 - Wk5-S4 - Deload",
    sessionIntent: "LOWER",
    mesoSessionSnapshot: 4,
    exerciseCount: 2,
    setCount: 6,
  },
] as const;

type TargetDefinition = (typeof TARGETS)[number];

type ParsedArgs = {
  apply: boolean;
};

type TargetWorkout = {
  id: string;
  userId: string;
  status: WorkoutStatus;
  completedAt: Date | null;
  selectionMode: string | null;
  sessionIntent: WorkoutSessionIntent | null;
  selectionMetadata: Prisma.JsonValue | null;
  advancesSplit: boolean | null;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: string | null;
  mesoSessionSnapshot: number | null;
  scheduledDate: Date;
  revision: number;
  exercises: Array<{
    id: string;
    orderIndex: number;
    sets: Array<{
      id: string;
      logs: Array<{
        id: string;
        actualReps: number | null;
        actualRpe: number | null;
        actualLoad: number | null;
        wasSkipped: boolean;
      }>;
    }>;
  }>;
  mesocycle: {
    id: string;
    state: string;
    isActive: boolean;
    completedSessions: number;
    accumulationSessionsCompleted: number;
    deloadSessionsCompleted: number;
    sessionsPerWeek: number;
    durationWeeks: number;
  } | null;
};

type ReportRow = {
  id: string;
  title: string;
  beforeStatus: WorkoutStatus;
  afterStatus: WorkoutStatus | null;
  completedAt: string | null;
  scheduledDate: string;
  mesocycleId: string | null;
  week: number | null;
  session: number | null;
  phase: string | null;
  advancesSplit: boolean | null;
  exerciseCount: number;
  setCount: number;
  logCount: number;
  performedLogCount: number;
  skippedLogCount: number;
  isDeload: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  return {
    apply: argv.includes("--apply"),
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getExpected(workoutId: string): TargetDefinition {
  const expected = TARGETS.find((target) => target.id === workoutId);
  if (!expected) {
    throw new Error(`Unexpected workout selected: ${workoutId}`);
  }
  return expected;
}

function flattenLogs(workout: TargetWorkout) {
  return workout.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      set.logs.map((log) => ({
        ...log,
        workoutSetId: set.id,
      }))
    )
  );
}

function countPerformedLogs(workout: TargetWorkout): number {
  return flattenLogs(workout).filter(
    (log) =>
      !log.wasSkipped &&
      (log.actualReps != null || log.actualRpe != null || log.actualLoad != null)
  ).length;
}

function buildReportRow(workout: TargetWorkout, afterStatus: WorkoutStatus | null): ReportRow {
  const expected = getExpected(workout.id);
  const logs = flattenLogs(workout);
  const semantics = deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    selectionMetadata: workout.selectionMetadata,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  });

  return {
    id: workout.id,
    title: expected.title,
    beforeStatus: workout.status,
    afterStatus,
    completedAt: workout.completedAt?.toISOString() ?? null,
    scheduledDate: workout.scheduledDate.toISOString(),
    mesocycleId: workout.mesocycleId,
    week: workout.mesocycleWeekSnapshot,
    session: workout.mesoSessionSnapshot,
    phase: workout.mesocyclePhaseSnapshot,
    advancesSplit: workout.advancesSplit,
    exerciseCount: workout.exercises.length,
    setCount: workout.exercises.flatMap((exercise) => exercise.sets).length,
    logCount: logs.length,
    performedLogCount: countPerformedLogs(workout),
    skippedLogCount: logs.filter((log) => log.wasSkipped).length,
    isDeload: semantics.isDeload,
  };
}

function assertTargetWorkout(workout: TargetWorkout, ownerId: string): void {
  const expected = getExpected(workout.id);
  const setCount = workout.exercises.flatMap((exercise) => exercise.sets).length;
  const logCount = flattenLogs(workout).length;
  const semantics = deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    selectionMetadata: workout.selectionMetadata,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  });

  if (workout.userId !== ownerId) {
    throw new Error(`${expected.title}: owner mismatch`);
  }
  if (workout.mesocycleId !== TARGET_MESOCYCLE_ID) {
    throw new Error(`${expected.title}: mesocycle mismatch`);
  }
  if (workout.status !== WorkoutStatus.COMPLETED) {
    throw new Error(`${expected.title}: expected COMPLETED, found ${workout.status}`);
  }
  if (workout.mesocycleWeekSnapshot !== 5) {
    throw new Error(`${expected.title}: expected week 5`);
  }
  if (workout.mesocyclePhaseSnapshot !== "DELOAD") {
    throw new Error(`${expected.title}: expected DELOAD phase`);
  }
  if (workout.sessionIntent !== expected.sessionIntent) {
    throw new Error(`${expected.title}: expected ${expected.sessionIntent} intent`);
  }
  if (workout.mesoSessionSnapshot !== expected.mesoSessionSnapshot) {
    throw new Error(`${expected.title}: session snapshot mismatch`);
  }
  if (workout.exercises.length !== expected.exerciseCount) {
    throw new Error(`${expected.title}: exercise count mismatch`);
  }
  if (setCount !== expected.setCount) {
    throw new Error(`${expected.title}: set count mismatch`);
  }
  if (logCount !== expected.setCount) {
    throw new Error(`${expected.title}: expected one SetLog per set`);
  }
  if (!semantics.isDeload) {
    throw new Error(`${expected.title}: canonical semantics did not identify deload`);
  }
}

function assertBatch(workouts: TargetWorkout[], ownerId: string): void {
  const expectedIds = new Set(TARGETS.map((target) => target.id));
  const actualIds = new Set(workouts.map((workout) => workout.id));

  if (workouts.length !== TARGETS.length) {
    throw new Error(`Expected exactly ${TARGETS.length} target workouts, found ${workouts.length}`);
  }
  for (const expectedId of expectedIds) {
    if (!actualIds.has(expectedId)) {
      throw new Error(`Missing target workout ${expectedId}`);
    }
  }
  for (const workout of workouts) {
    assertTargetWorkout(workout, ownerId);
  }

  const mesocycleIds = new Set(workouts.map((workout) => workout.mesocycleId));
  if (mesocycleIds.size !== 1 || !mesocycleIds.has(TARGET_MESOCYCLE_ID)) {
    throw new Error("Targets do not belong to the expected single mesocycle");
  }
}

function buildNextSelectionMetadata(workout: TargetWorkout): Prisma.InputJsonValue {
  const nextSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
    workout.selectionMetadata ?? {},
    buildSavedSessionAuditSnapshot({
      selectionMetadata: workout.selectionMetadata,
      workoutId: workout.id,
      revision: workout.revision,
      status: WorkoutStatus.SKIPPED,
      advancesSplit: workout.advancesSplit ?? true,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    })
  );

  return toPrismaJson(nextSelectionMetadata);
}

async function loadTargetWorkouts(
  prisma: PrismaClient,
  ownerId: string
): Promise<TargetWorkout[]> {
  return prisma.workout.findMany({
    where: {
      id: { in: TARGETS.map((target) => target.id) },
      userId: ownerId,
    },
    orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }],
    select: {
      id: true,
      userId: true,
      status: true,
      completedAt: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      advancesSplit: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesocyclePhaseSnapshot: true,
      mesoSessionSnapshot: true,
      scheduledDate: true,
      revision: true,
      exercises: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          sets: {
            orderBy: { setIndex: "asc" },
            select: {
              id: true,
              logs: {
                select: {
                  id: true,
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                  wasSkipped: true,
                },
              },
            },
          },
        },
      },
      mesocycle: {
        select: {
          id: true,
          state: true,
          isActive: true,
          completedSessions: true,
          accumulationSessionsCompleted: true,
          deloadSessionsCompleted: true,
          sessionsPerWeek: true,
          durationWeeks: true,
        },
      },
    },
  }) as Promise<TargetWorkout[]>;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertOperationalProductionWriteAllowed({
    argv: process.argv.slice(2),
    writeRequested: args.apply,
  });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const owner = await prisma.user.findUnique({
      where: { email: OWNER_EMAIL },
      select: { id: true, email: true },
    });

    if (!owner) {
      throw new Error(`Owner not found: ${OWNER_EMAIL}`);
    }

    const before = await loadTargetWorkouts(prisma, owner.id);
    assertBatch(before, owner.id);
    const beforeReport = before.map((workout) => buildReportRow(workout, null));
    const mesocycleBefore = before[0]?.mesocycle ?? null;

    if (!args.apply) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            owner,
            targetMesocycleId: TARGET_MESOCYCLE_ID,
            mesocycleBefore,
            wouldModifyWorkoutIds: TARGETS.map((target) => target.id),
            wouldUpdateSetLogs: before.reduce(
              (sum, workout) => sum + flattenLogs(workout).length,
              0
            ),
            before: beforeReport,
          },
          null,
          2
        )
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const workout of before) {
        const setIds = workout.exercises.flatMap((exercise) =>
          exercise.sets.map((set) => set.id)
        );

        await tx.setLog.updateMany({
          where: {
            workoutSetId: { in: setIds },
          },
          data: {
            actualReps: null,
            actualRpe: null,
            actualLoad: null,
            wasSkipped: true,
          },
        });

        await tx.workout.update({
          where: { id: workout.id },
          data: {
            status: WorkoutStatus.SKIPPED,
            completedAt: null,
            selectionMetadata: buildNextSelectionMetadata(workout),
          },
        });
      }
    });

    const after = await loadTargetWorkouts(prisma, owner.id);
    const afterReport = after.map((workout) => buildReportRow(workout, workout.status));
    const modifiedNonTargets = after.filter(
      (workout) => !TARGETS.some((target) => target.id === workout.id)
    );
    const allSkipped = after.every((workout) => workout.status === WorkoutStatus.SKIPPED);
    const allLogsSkipped = after.every((workout) => {
      const logs = flattenLogs(workout);
      return (
        logs.length === getExpected(workout.id).setCount &&
        logs.every(
          (log) =>
            log.wasSkipped &&
            log.actualReps == null &&
            log.actualRpe == null &&
            log.actualLoad == null
        )
      );
    });

    if (modifiedNonTargets.length > 0) {
      throw new Error("Unexpected non-target workout appeared in post-repair set");
    }
    if (!allSkipped) {
      throw new Error("Not all target workouts were repaired to SKIPPED");
    }
    if (!allLogsSkipped) {
      throw new Error("Not all target SetLog rows were repaired to skipped/no performance values");
    }

    console.log(
      JSON.stringify(
        {
          mode: "apply",
          owner,
          targetMesocycleId: TARGET_MESOCYCLE_ID,
          mesocycleBefore,
          mesocycleAfter: after[0]?.mesocycle ?? null,
          modifiedWorkoutIds: TARGETS.map((target) => target.id),
          modifiedWorkoutCount: after.length,
          modifiedSetLogCount: after.reduce(
            (sum, workout) => sum + flattenLogs(workout).length,
            0
          ),
          before: beforeReport,
          after: afterReport,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[repair-week5-deload-not-performed] ${message}`);
  process.exitCode = 1;
});
