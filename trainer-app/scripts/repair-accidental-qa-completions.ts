import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertAuditPreflight,
  buildResolvedAuditIdentityRequest,
  loadAuditEnv,
  parseArgs,
  printAuditPreflight,
  runAuditPreflight,
} from "./audit-cli-support";

const TARGET_MESOCYCLE_ID = "9b861675-c98f-42f7-bc8c-64a7de411b77";
const QA_WORKOUT_IDS = [
  "029c61a0-1dd3-44cb-81f9-3a33e2390c00",
  "e67a2faa-5768-4130-b1a6-b8e0be309e09",
] as const;
const LEGITIMATE_WORKOUT_IDS = [
  "df4c88f3-9a9f-4529-90b5-ecb91771b340",
  "61385894-2a28-4c7d-8351-7acfb96ab603",
] as const;
const TARGET_WEEK_CLOSE_ID = "85a7dea8-ec3a-4c2a-9ace-76ada52216be";
const TARGET_READINESS_SNAPSHOT_ID = "2295bdd0-268e-414b-850b-f62921dfa3b3";
const EXPECTED_SLOT_PLAN_SEED_HASH =
  "b534aee8a93867c48dc657dc2c258731f7df4d5b85f547f8e11fa5d25c8d6782";
const EXPECTED_SLOT_SEQUENCE_HASH =
  "febecdf3bac85a2bc23e7d3bd8dafceb79059a3aefc3d560663160d90a94619d";

const EXPECTED_CHILD_COUNTS = {
  workoutExercises: 11,
  workoutSets: 34,
  setLogs: 34,
};

const EXPECTED_REPAIRED_COUNTERS = {
  completedSessions: 2,
  accumulationSessionsCompleted: 2,
  deloadSessionsCompleted: 0,
};

type DbClient = Prisma.TransactionClient;
type ProjectedIncompleteWorkout = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  performedSetLogCount?: number;
  totalSetLogCount?: number;
  plannedExercises?: Array<{ exerciseId: string; setCount: number }>;
  selectionMetadata?: unknown;
};

type Modules = {
  prisma: PrismaClient;
  closePrismaResourcesForAuditCli: () => Promise<void>;
  resolveWorkoutAuditIdentity: (request: {
    userId?: string;
    ownerEmail?: string;
  }) => Promise<{ userId: string; ownerEmail?: string }>;
  loadNextWorkoutContext: (userId: string) => Promise<{
    intent: string | null;
    slotId: string | null;
    source: string;
    weekInMeso: number | null;
    sessionInWeek: number | null;
    existingWorkoutId: string | null;
  }>;
  resolveNextWorkoutContext: (input: {
    mesocycle: {
      id: string;
      durationWeeks: number;
      accumulationSessionsCompleted: number;
      deloadSessionsCompleted: number;
      sessionsPerWeek: number;
      state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
      slotSequenceJson?: unknown;
      slotPlanSeedJson?: unknown;
    } | null;
    weeklySchedule: string[];
    incompleteWorkouts: ProjectedIncompleteWorkout[];
    performedAdvancingIntentsThisWeek?: string[];
    performedAdvancingSlotIdsThisWeek?: string[];
    pendingWeekClose?: { id: string; targetWeek: number; status: string } | null;
  }) => {
    intent: string | null;
    slotId: string | null;
    source: string;
    weekInMeso: number | null;
    sessionInWeek: number | null;
    existingWorkoutId: string | null;
    derivationTrace: string[];
  };
  buildAdvancingPerformedSlots: (
    workouts: Array<{
      advancesSplit: boolean | null;
      selectionMetadata?: unknown;
      selectionMode: string | null;
      sessionIntent: string | null;
    }>
  ) => Array<{ slotId?: string | null; intent?: string | null }>;
  readRuntimeSlotSequence: (input: {
    slotSequenceJson?: unknown;
    weeklySchedule: string[];
  }) => { slots: Array<{ slotId: string }>; source: string };
  deriveCurrentMesocycleSession: (mesocycle: {
    state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
    accumulationSessionsCompleted: number;
    deloadSessionsCompleted: number;
    sessionsPerWeek: number;
    durationWeeks: number;
  }) => { week: number; session: number; phase: "ACCUMULATION" | "DELOAD" };
  hashPreSessionReadinessSnapshotSource: (value: unknown) => string;
  performedWorkoutStatuses: readonly string[];
};

type GuardCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

type RepairPlan = {
  deleteSetLogIds: string[];
  deleteWorkoutSetIds: string[];
  deleteWorkoutExerciseIds: string[];
  deleteFilteredExerciseIds: string[];
  deleteSessionCheckInIds: string[];
  deleteWorkoutIds: string[];
  deleteWeekCloseId: string | null;
  invalidateReadinessSnapshotId: string | null;
  resetMesocycleCounters: typeof EXPECTED_REPAIRED_COUNTERS;
};

function boolArg(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1";
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = sorted(left);
  const sortedRight = sorted(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function hashJson(modules: Modules, value: unknown): string | null {
  return value == null ? null : modules.hashPreSessionReadinessSnapshotSource(value);
}

function compactNextContext(context: {
  intent: string | null;
  slotId: string | null;
  source: string;
  weekInMeso: number | null;
  sessionInWeek: number | null;
  existingWorkoutId: string | null;
  derivationTrace?: string[];
}) {
  return {
    source: context.source,
    weekInMeso: context.weekInMeso,
    sessionInWeek: context.sessionInWeek,
    intent: context.intent,
    slotId: context.slotId,
    existingWorkoutId: context.existingWorkoutId,
    derivationTrace: context.derivationTrace ?? undefined,
  };
}

async function loadModules(): Promise<Modules> {
  const [
    dbModule,
    contextBuilderModule,
    nextSessionModule,
    mesocycleMathModule,
    slotRuntimeModule,
    snapshotModule,
    workoutStatusModule,
  ] = await Promise.all([
    import("@/lib/db/prisma"),
    import("@/lib/audit/workout-audit/context-builder"),
    import("@/lib/api/next-session"),
    import("@/lib/api/mesocycle-lifecycle-math"),
    import("@/lib/api/mesocycle-slot-runtime"),
    import("@/lib/api/pre-session-readiness-snapshot"),
    import("@/lib/workout-status"),
  ]);

  return {
    prisma: dbModule.prisma,
    closePrismaResourcesForAuditCli: dbModule.closePrismaResourcesForAuditCli,
    resolveWorkoutAuditIdentity: contextBuilderModule.resolveWorkoutAuditIdentity,
    loadNextWorkoutContext: nextSessionModule.loadNextWorkoutContext,
    resolveNextWorkoutContext: nextSessionModule.resolveNextWorkoutContext,
    buildAdvancingPerformedSlots: nextSessionModule.buildAdvancingPerformedSlots,
    readRuntimeSlotSequence: slotRuntimeModule.readRuntimeSlotSequence,
    deriveCurrentMesocycleSession: mesocycleMathModule.deriveCurrentMesocycleSession,
    hashPreSessionReadinessSnapshotSource:
      snapshotModule.hashPreSessionReadinessSnapshotSource,
    performedWorkoutStatuses: workoutStatusModule.PERFORMED_WORKOUT_STATUSES,
  };
}

async function projectNextContext(input: {
  client: DbClient;
  modules: Modules;
  userId: string;
  mesocycle: {
    id: string;
    durationWeeks: number;
    accumulationSessionsCompleted: number;
    deloadSessionsCompleted: number;
    sessionsPerWeek: number;
    state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
    slotSequenceJson: unknown;
    slotPlanSeedJson: unknown;
  } | null;
  excludeWorkoutIds?: readonly string[];
  excludeWeekCloseIds?: readonly string[];
}) {
  const [constraints, rawIncomplete, pendingWeekClose] = await Promise.all([
    input.client.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
    input.client.workout.findMany({
      where: {
        userId: input.userId,
        status: { in: ["IN_PROGRESS", "PARTIAL", "PLANNED"] },
        ...(input.excludeWorkoutIds?.length
          ? { id: { notIn: [...input.excludeWorkoutIds] } }
          : {}),
        OR: [{ mesocycleId: null }, { mesocycle: { isActive: true } }],
      },
      orderBy: { scheduledDate: "asc" },
      take: 20,
      select: {
        id: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        mesoSessionSnapshot: true,
        sessionIntent: true,
        status: true,
        scheduledDate: true,
        selectionMetadata: true,
        exercises: {
          orderBy: { orderIndex: "asc" },
          select: {
            exerciseId: true,
            sets: {
              select: {
                logs: {
                  select: { wasSkipped: true },
                },
              },
            },
          },
        },
      },
    }),
    input.mesocycle
      ? input.client.mesocycleWeekClose.findFirst({
          where: {
            mesocycleId: input.mesocycle.id,
            status: "PENDING_OPTIONAL_GAP_FILL",
            targetPhase: "ACCUMULATION",
            ...(input.excludeWeekCloseIds?.length
              ? { id: { notIn: [...input.excludeWeekCloseIds] } }
              : {}),
          },
          orderBy: { targetWeek: "desc" },
          select: { id: true, targetWeek: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => String(intent));
  const currentSession = input.mesocycle
    ? input.modules.deriveCurrentMesocycleSession(input.mesocycle)
    : null;
  const rawPerformedAdvancingThisWeek =
    input.mesocycle && currentSession
      ? await input.client.workout.findMany({
          where: {
            userId: input.userId,
            mesocycleId: input.mesocycle.id,
            mesocycleWeekSnapshot: currentSession.week,
            status: { in: [...input.modules.performedWorkoutStatuses] as never[] },
            sessionIntent: { not: null },
            ...(input.excludeWorkoutIds?.length
              ? { id: { notIn: [...input.excludeWorkoutIds] } }
              : {}),
          },
          orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }],
          select: {
            advancesSplit: true,
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
          },
        })
      : [];
  const performedAdvancingSlots =
    input.modules.buildAdvancingPerformedSlots(rawPerformedAdvancingThisWeek);
  const runtimeSlotSequence = input.modules.readRuntimeSlotSequence({
    slotSequenceJson: input.mesocycle?.slotSequenceJson,
    weeklySchedule,
  });

  return input.modules.resolveNextWorkoutContext({
    mesocycle: input.mesocycle,
    weeklySchedule,
    incompleteWorkouts: rawIncomplete.map((workout) => {
      const exercises = workout.exercises ?? [];
      const setLogs = exercises.flatMap((exercise) =>
        exercise.sets.flatMap((set) => set.logs)
      );
      return {
        id: workout.id,
        status: workout.status,
        scheduledDate: workout.scheduledDate,
        sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
        mesocycleId: workout.mesocycleId,
        mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
        mesoSessionSnapshot: workout.mesoSessionSnapshot,
        performedSetLogCount: setLogs.filter((log) => !log.wasSkipped).length,
        totalSetLogCount: setLogs.length,
        plannedExercises: exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          setCount: exercise.sets.length,
        })),
        selectionMetadata: workout.selectionMetadata,
      };
    }),
    performedAdvancingSlotIdsThisWeek: performedAdvancingSlots
      .map((workout) => workout.slotId ?? null)
      .filter(
        (slotId): slotId is string =>
          Boolean(slotId) &&
          runtimeSlotSequence.slots.some((slot) => slot.slotId === slotId)
      ),
    performedAdvancingIntentsThisWeek: performedAdvancingSlots
      .map((workout) => workout.intent ?? null)
      .filter((intent): intent is string => Boolean(intent)),
    pendingWeekClose,
  });
}

async function buildRepairState(input: {
  client: DbClient;
  modules: Modules;
  userId: string;
}) {
  const [
    mesocycle,
    qaWorkouts,
    legitimateWorkouts,
    completedWorkoutsForMeso,
    filteredExercises,
    sessionCheckIns,
    readinessSnapshotsLinkedToQa,
    weekClose,
    readinessSnapshot,
  ] = await Promise.all([
    input.client.mesocycle.findUnique({
      where: { id: TARGET_MESOCYCLE_ID },
      select: {
        id: true,
        completedSessions: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        durationWeeks: true,
        state: true,
        isActive: true,
        slotPlanSeedJson: true,
        slotSequenceJson: true,
        macroCycle: { select: { userId: true } },
      },
    }),
    input.client.workout.findMany({
      where: { id: { in: [...QA_WORKOUT_IDS] } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        mesocycleId: true,
        status: true,
        sessionIntent: true,
        selectionMode: true,
        advancesSplit: true,
        scheduledDate: true,
        completedAt: true,
        mesocycleWeekSnapshot: true,
        mesoSessionSnapshot: true,
        mesocyclePhaseSnapshot: true,
        exercises: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            workoutId: true,
            exerciseId: true,
            orderIndex: true,
            sets: {
              orderBy: { setIndex: "asc" },
              select: {
                id: true,
                workoutExerciseId: true,
                setIndex: true,
                logs: {
                  select: {
                    id: true,
                    workoutSetId: true,
                    completedAt: true,
                    wasSkipped: true,
                    actualReps: true,
                    actualLoad: true,
                    actualRpe: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    input.client.workout.findMany({
      where: { id: { in: [...LEGITIMATE_WORKOUT_IDS] } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        mesocycleId: true,
        status: true,
        sessionIntent: true,
        advancesSplit: true,
        mesocycleWeekSnapshot: true,
        mesoSessionSnapshot: true,
        completedAt: true,
      },
    }),
    input.client.workout.findMany({
      where: { mesocycleId: TARGET_MESOCYCLE_ID, status: "COMPLETED" },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        status: true,
        sessionIntent: true,
        advancesSplit: true,
        mesocycleWeekSnapshot: true,
        mesoSessionSnapshot: true,
        completedAt: true,
      },
    }),
    input.client.filteredExercise.findMany({
      where: { workoutId: { in: [...QA_WORKOUT_IDS] } },
      orderBy: { id: "asc" },
      select: { id: true, workoutId: true, exerciseName: true, reason: true },
    }),
    input.client.sessionCheckIn.findMany({
      where: { workoutId: { in: [...QA_WORKOUT_IDS] } },
      orderBy: { id: "asc" },
      select: { id: true, workoutId: true, date: true },
    }),
    input.client.preSessionReadinessSnapshot.findMany({
      where: { plannedWorkoutId: { in: [...QA_WORKOUT_IDS] } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        plannedWorkoutId: true,
        activeMesocycleId: true,
        weekInMeso: true,
        sessionInWeek: true,
        slotId: true,
        invalidatedAt: true,
      },
    }),
    input.client.mesocycleWeekClose.findUnique({
      where: { id: TARGET_WEEK_CLOSE_ID },
      select: {
        id: true,
        mesocycleId: true,
        targetWeek: true,
        targetPhase: true,
        status: true,
        resolution: true,
        optionalWorkoutId: true,
      },
    }),
    input.client.preSessionReadinessSnapshot.findUnique({
      where: { id: TARGET_READINESS_SNAPSHOT_ID },
      select: {
        id: true,
        userId: true,
        activeMesocycleId: true,
        mesocycleState: true,
        weekInMeso: true,
        sessionInWeek: true,
        slotId: true,
        slotIntent: true,
        plannedWorkoutId: true,
        invalidatedAt: true,
        invalidatedReason: true,
        slotPlanSeedHash: true,
        slotSequenceHash: true,
      },
    }),
  ]);

  const workoutExerciseIds = qaWorkouts.flatMap((workout) =>
    workout.exercises.map((exercise) => exercise.id)
  );
  const workoutSetIds = qaWorkouts.flatMap((workout) =>
    workout.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id))
  );
  const setLogIds = qaWorkouts.flatMap((workout) =>
    workout.exercises.flatMap((exercise) =>
      exercise.sets.flatMap((set) => set.logs.map((log) => log.id))
    )
  );
  const beforeNextSession = await input.modules.loadNextWorkoutContext(input.userId);
  const repairedMesocycle = mesocycle
    ? {
        id: mesocycle.id,
        durationWeeks: mesocycle.durationWeeks,
        sessionsPerWeek: mesocycle.sessionsPerWeek,
        state: mesocycle.state,
        slotPlanSeedJson: mesocycle.slotPlanSeedJson,
        slotSequenceJson: mesocycle.slotSequenceJson,
        ...EXPECTED_REPAIRED_COUNTERS,
      }
    : null;
  const afterNextSession = await projectNextContext({
    client: input.client,
    modules: input.modules,
    userId: input.userId,
    mesocycle: repairedMesocycle,
    excludeWorkoutIds: QA_WORKOUT_IDS,
    excludeWeekCloseIds: [TARGET_WEEK_CLOSE_ID],
  });

  const plan: RepairPlan = {
    deleteSetLogIds: sorted(setLogIds),
    deleteWorkoutSetIds: sorted(workoutSetIds),
    deleteWorkoutExerciseIds: sorted(workoutExerciseIds),
    deleteFilteredExerciseIds: sorted(filteredExercises.map((row) => row.id)),
    deleteSessionCheckInIds: sorted(sessionCheckIns.map((row) => row.id)),
    deleteWorkoutIds: sorted([...QA_WORKOUT_IDS]),
    deleteWeekCloseId: weekClose?.id ?? null,
    invalidateReadinessSnapshotId: readinessSnapshot?.id ?? null,
    resetMesocycleCounters: EXPECTED_REPAIRED_COUNTERS,
  };

  const seedHashes = mesocycle
    ? {
        slotPlanSeedHash: hashJson(input.modules, mesocycle.slotPlanSeedJson),
        slotSequenceHash: hashJson(input.modules, mesocycle.slotSequenceJson),
      }
    : {
        slotPlanSeedHash: null,
        slotSequenceHash: null,
      };

  return {
    mesocycle,
    qaWorkouts,
    legitimateWorkouts,
    completedWorkoutsForMeso,
    filteredExercises,
    sessionCheckIns,
    readinessSnapshotsLinkedToQa,
    weekClose,
    readinessSnapshot,
    childCounts: {
      workoutExercises: workoutExerciseIds.length,
      workoutSets: workoutSetIds.length,
      setLogs: setLogIds.length,
      filteredExercises: filteredExercises.length,
      sessionCheckIns: sessionCheckIns.length,
      readinessSnapshotsLinkedToQa: readinessSnapshotsLinkedToQa.length,
    },
    seedHashes,
    beforeNextSession: compactNextContext(beforeNextSession),
    afterNextSession: compactNextContext(afterNextSession),
    rotationHistory: "derived_from_performed_workout_history",
    plan,
  };
}

function buildGuardChecks(state: Awaited<ReturnType<typeof buildRepairState>>, userId: string): GuardCheck[] {
  const completedIds = state.completedWorkoutsForMeso.map((workout) => workout.id);
  const qaIds = state.qaWorkouts.map((workout) => workout.id);
  const legitIds = state.legitimateWorkouts.map((workout) => workout.id);
  const afterCompletedIds = completedIds.filter(
    (id) => !(QA_WORKOUT_IDS as readonly string[]).includes(id)
  );

  const checks: GuardCheck[] = [
    {
      name: "target mesocycle exists and belongs to resolved owner",
      passed:
        state.mesocycle?.id === TARGET_MESOCYCLE_ID &&
        state.mesocycle.macroCycle.userId === userId,
      detail: `mesocycle=${state.mesocycle?.id ?? "missing"} user=${state.mesocycle?.macroCycle.userId ?? "missing"}`,
    },
    {
      name: "target mesocycle is active accumulation",
      passed: state.mesocycle?.isActive === true && state.mesocycle.state === "ACTIVE_ACCUMULATION",
      detail: `isActive=${state.mesocycle?.isActive ?? "missing"} state=${state.mesocycle?.state ?? "missing"}`,
    },
    {
      name: "current counters match accidental Week 2 state",
      passed:
        state.mesocycle?.completedSessions === 4 &&
        state.mesocycle.accumulationSessionsCompleted === 4 &&
        state.mesocycle.deloadSessionsCompleted === 0,
      detail: JSON.stringify({
        completedSessions: state.mesocycle?.completedSessions,
        accumulationSessionsCompleted: state.mesocycle?.accumulationSessionsCompleted,
        deloadSessionsCompleted: state.mesocycle?.deloadSessionsCompleted,
      }),
    },
    {
      name: "seed and slot sequence hashes match expected unchanged values",
      passed:
        state.seedHashes.slotPlanSeedHash === EXPECTED_SLOT_PLAN_SEED_HASH &&
        state.seedHashes.slotSequenceHash === EXPECTED_SLOT_SEQUENCE_HASH,
      detail: JSON.stringify(state.seedHashes),
    },
    {
      name: "all and only target QA workout roots are selected",
      passed: sameStringSet(qaIds, QA_WORKOUT_IDS),
      detail: JSON.stringify(qaIds),
    },
    {
      name: "QA workouts are completed advancing rows on the target mesocycle",
      passed:
        state.qaWorkouts.length === QA_WORKOUT_IDS.length &&
        state.qaWorkouts.every(
          (workout) =>
            workout.userId === userId &&
            workout.mesocycleId === TARGET_MESOCYCLE_ID &&
            workout.status === "COMPLETED" &&
            workout.advancesSplit !== false
        ),
      detail: JSON.stringify(
        state.qaWorkouts.map((workout) => ({
          id: workout.id,
          userId: workout.userId,
          mesocycleId: workout.mesocycleId,
          status: workout.status,
          advancesSplit: workout.advancesSplit,
          intent: workout.sessionIntent,
          week: workout.mesocycleWeekSnapshot,
          session: workout.mesoSessionSnapshot,
        }))
      ),
    },
    {
      name: "legitimate completed workouts are present and preserved",
      passed:
        sameStringSet(legitIds, LEGITIMATE_WORKOUT_IDS) &&
        state.legitimateWorkouts.every(
          (workout) =>
            workout.userId === userId &&
            workout.mesocycleId === TARGET_MESOCYCLE_ID &&
            workout.status === "COMPLETED"
        ),
      detail: JSON.stringify(
        state.legitimateWorkouts.map((workout) => ({
          id: workout.id,
          status: workout.status,
          intent: workout.sessionIntent,
          week: workout.mesocycleWeekSnapshot,
          session: workout.mesoSessionSnapshot,
        }))
      ),
    },
    {
      name: "completed workout set for target mesocycle matches known four rows",
      passed: sameStringSet(completedIds, [...LEGITIMATE_WORKOUT_IDS, ...QA_WORKOUT_IDS]),
      detail: JSON.stringify(completedIds),
    },
    {
      name: "after deleting QA rows, only legitimate completions remain",
      passed: sameStringSet(afterCompletedIds, LEGITIMATE_WORKOUT_IDS),
      detail: JSON.stringify(afterCompletedIds),
    },
    {
      name: "direct execution child counts match expected investigation",
      passed:
        state.childCounts.workoutExercises === EXPECTED_CHILD_COUNTS.workoutExercises &&
        state.childCounts.workoutSets === EXPECTED_CHILD_COUNTS.workoutSets &&
        state.childCounts.setLogs === EXPECTED_CHILD_COUNTS.setLogs,
      detail: JSON.stringify(state.childCounts),
    },
    {
      name: "no readiness snapshots are directly linked to QA workout rows",
      passed: state.childCounts.readinessSnapshotsLinkedToQa === 0,
      detail: JSON.stringify(state.readinessSnapshotsLinkedToQa),
    },
    {
      name: "target WeekClose row belongs to target mesocycle",
      passed:
        state.weekClose?.id === TARGET_WEEK_CLOSE_ID &&
        state.weekClose.mesocycleId === TARGET_MESOCYCLE_ID,
      detail: JSON.stringify(state.weekClose),
    },
    {
      name: "target readiness snapshot belongs to target mesocycle and owner",
      passed:
        state.readinessSnapshot?.id === TARGET_READINESS_SNAPSHOT_ID &&
        state.readinessSnapshot.userId === userId &&
        state.readinessSnapshot.activeMesocycleId === TARGET_MESOCYCLE_ID,
      detail: JSON.stringify(state.readinessSnapshot),
    },
    {
      name: "before next session reflects accidental Week 2 state",
      passed:
        state.beforeNextSession.weekInMeso === 2 &&
        state.beforeNextSession.sessionInWeek === 1,
      detail: JSON.stringify(state.beforeNextSession),
    },
    {
      name: "projected repaired next session is Week 1 Session 3 upper_b",
      passed:
        state.afterNextSession.source === "rotation" &&
        state.afterNextSession.weekInMeso === 1 &&
        state.afterNextSession.sessionInWeek === 3 &&
        state.afterNextSession.intent === "upper" &&
        state.afterNextSession.slotId === "upper_b",
      detail: JSON.stringify(state.afterNextSession),
    },
  ];

  return checks;
}

function assertGuards(checks: GuardCheck[]): void {
  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    throw new Error(
      `Repair guards failed: ${failed
        .map((check) => `${check.name}: ${check.detail}`)
        .join("; ")}`
    );
  }
}

async function executeRepair(input: {
  modules: Modules;
  userId: string;
}) {
  const beforeState = await buildRepairState({
    client: input.modules.prisma,
    modules: input.modules,
    userId: input.userId,
  });
  const beforeGuards = buildGuardChecks(beforeState, input.userId);
  assertGuards(beforeGuards);

  const transactionResult = await input.modules.prisma.$transaction(async (tx) => {
    const txState = await buildRepairState({
      client: tx,
      modules: input.modules,
      userId: input.userId,
    });
    const txGuards = buildGuardChecks(txState, input.userId);
    assertGuards(txGuards);

    await tx.mesocycleWeekClose.delete({
      where: { id: TARGET_WEEK_CLOSE_ID },
    });
    await tx.setLog.deleteMany({
      where: { id: { in: txState.plan.deleteSetLogIds } },
    });
    await tx.workoutSet.deleteMany({
      where: { id: { in: txState.plan.deleteWorkoutSetIds } },
    });
    await tx.workoutExercise.deleteMany({
      where: { id: { in: txState.plan.deleteWorkoutExerciseIds } },
    });
    if (txState.plan.deleteFilteredExerciseIds.length > 0) {
      await tx.filteredExercise.deleteMany({
        where: { id: { in: txState.plan.deleteFilteredExerciseIds } },
      });
    }
    if (txState.plan.deleteSessionCheckInIds.length > 0) {
      await tx.sessionCheckIn.deleteMany({
        where: { id: { in: txState.plan.deleteSessionCheckInIds } },
      });
    }
    await tx.workout.deleteMany({
      where: { id: { in: [...QA_WORKOUT_IDS] } },
    });
    await tx.mesocycle.update({
      where: { id: TARGET_MESOCYCLE_ID },
      data: EXPECTED_REPAIRED_COUNTERS,
    });
    await tx.preSessionReadinessSnapshot.update({
      where: { id: TARGET_READINESS_SNAPSHOT_ID },
      data: {
        invalidatedAt: new Date(),
        invalidatedReason: "invalidated_after_accidental_visual_qa_completion_repair",
      },
    });

    const repairedMesocycle = await tx.mesocycle.findUnique({
      where: { id: TARGET_MESOCYCLE_ID },
      select: {
        completedSessions: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        slotPlanSeedJson: true,
        slotSequenceJson: true,
      },
    });

    return {
      txGuards,
      writes: txState.plan,
      repairedCounters: {
        completedSessions: repairedMesocycle?.completedSessions,
        accumulationSessionsCompleted: repairedMesocycle?.accumulationSessionsCompleted,
        deloadSessionsCompleted: repairedMesocycle?.deloadSessionsCompleted,
      },
      repairedSeedHashes: {
        slotPlanSeedHash: hashJson(input.modules, repairedMesocycle?.slotPlanSeedJson),
        slotSequenceHash: hashJson(input.modules, repairedMesocycle?.slotSequenceJson),
      },
    };
  });

  const postState = await buildRepairState({
    client: input.modules.prisma,
    modules: input.modules,
    userId: input.userId,
  }).catch((error) => ({
    postStateError: error instanceof Error ? error.message : String(error),
  }));
  const postNextSession = await input.modules.loadNextWorkoutContext(input.userId);
  const postMesocycle = await input.modules.prisma.mesocycle.findUnique({
    where: { id: TARGET_MESOCYCLE_ID },
    select: {
      completedSessions: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      slotPlanSeedJson: true,
      slotSequenceJson: true,
    },
  });
  const postReadinessSnapshot =
    await input.modules.prisma.preSessionReadinessSnapshot.findUnique({
      where: { id: TARGET_READINESS_SNAPSHOT_ID },
      select: { id: true, invalidatedAt: true, invalidatedReason: true },
    });

  return {
    mode: "execute",
    beforeGuards,
    transactionResult,
    postExecuteVerification: {
      mesocycleCounters: {
        completedSessions: postMesocycle?.completedSessions,
        accumulationSessionsCompleted: postMesocycle?.accumulationSessionsCompleted,
        deloadSessionsCompleted: postMesocycle?.deloadSessionsCompleted,
      },
      seedHashes: {
        slotPlanSeedHash: hashJson(input.modules, postMesocycle?.slotPlanSeedJson),
        slotSequenceHash: hashJson(input.modules, postMesocycle?.slotSequenceJson),
      },
      nextSession: compactNextContext(postNextSession),
      readinessSnapshot: postReadinessSnapshot,
      postState,
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const execute = boolArg(args.execute);
  const dryRun = boolArg(args["dry-run"]);
  if (execute && dryRun) {
    throw new Error("--execute and --dry-run are mutually exclusive.");
  }

  const env = loadAuditEnv(argv, { allowWrite: true });
  const modules = await loadModules();

  try {
    const preflight = await runAuditPreflight({
      args,
      resolveIdentity: modules.resolveWorkoutAuditIdentity,
      checkDb: async () => {
        await modules.prisma.$queryRawUnsafe("SELECT 1");
      },
    });
    preflight.envFilePath = env.envFilePath;
    preflight.status.env_loaded = env.envLoaded;
    printAuditPreflight("repair-accidental-qa-completions", preflight);
    assertAuditPreflight("repair-accidental-qa-completions", preflight);
    const identityRequest = buildResolvedAuditIdentityRequest(args, preflight);
    const identity = await modules.resolveWorkoutAuditIdentity(identityRequest);

    if (execute) {
      const result = await executeRepair({ modules, userId: identity.userId });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const state = await buildRepairState({
      client: modules.prisma,
      modules,
      userId: identity.userId,
    });
    const guardChecks = buildGuardChecks(state, identity.userId);
    const output = {
      mode: "dry-run",
      dbWriteOccurred: false,
      target: {
        ownerEmail: identity.ownerEmail ?? preflight.ownerEmail,
        userId: identity.userId,
        mesocycleId: TARGET_MESOCYCLE_ID,
        qaWorkoutIds: QA_WORKOUT_IDS,
        legitimateWorkoutIds: LEGITIMATE_WORKOUT_IDS,
        weekCloseId: TARGET_WEEK_CLOSE_ID,
        readinessSnapshotId: TARGET_READINESS_SNAPSHOT_ID,
      },
      rowsFound: {
        mesocycle: state.mesocycle
          ? {
              id: state.mesocycle.id,
              state: state.mesocycle.state,
              isActive: state.mesocycle.isActive,
              completedSessions: state.mesocycle.completedSessions,
              accumulationSessionsCompleted:
                state.mesocycle.accumulationSessionsCompleted,
              deloadSessionsCompleted: state.mesocycle.deloadSessionsCompleted,
              sessionsPerWeek: state.mesocycle.sessionsPerWeek,
              durationWeeks: state.mesocycle.durationWeeks,
            }
          : null,
        qaWorkouts: state.qaWorkouts.map((workout) => ({
          id: workout.id,
          status: workout.status,
          intent: workout.sessionIntent,
          selectionMode: workout.selectionMode,
          advancesSplit: workout.advancesSplit,
          week: workout.mesocycleWeekSnapshot,
          session: workout.mesoSessionSnapshot,
          completedAt: workout.completedAt,
        })),
        legitimateWorkouts: state.legitimateWorkouts,
        completedWorkoutsForMesocycle: state.completedWorkoutsForMeso,
        childCounts: state.childCounts,
        directChildRows: {
          workoutExerciseIds: state.plan.deleteWorkoutExerciseIds,
          workoutSetIds: state.plan.deleteWorkoutSetIds,
          setLogIds: state.plan.deleteSetLogIds,
          filteredExerciseIds: state.plan.deleteFilteredExerciseIds,
          sessionCheckInIds: state.plan.deleteSessionCheckInIds,
          readinessSnapshotsLinkedToQa: state.readinessSnapshotsLinkedToQa,
        },
        weekClose: state.weekClose,
        readinessSnapshot: state.readinessSnapshot,
        seedHashes: state.seedHashes,
      },
      expectedBeforeAfter: {
        countersBefore: {
          completedSessions: state.mesocycle?.completedSessions,
          accumulationSessionsCompleted:
            state.mesocycle?.accumulationSessionsCompleted,
          deloadSessionsCompleted: state.mesocycle?.deloadSessionsCompleted,
        },
        countersAfter: EXPECTED_REPAIRED_COUNTERS,
        nextSessionBefore: state.beforeNextSession,
        nextSessionAfter: state.afterNextSession,
        homeProgramAfter: {
          expectedCurrentWeek: 1,
          expectedCompletedAdvancingSessionsThisWeek: 2,
          expectedTotalAdvancingSessionsThisWeek: 4,
        },
      },
      plannedWrites: state.plan,
      guardChecks,
      dryRunMatchesExpectedInvestigation: guardChecks.every((check) => check.passed),
      executionStatus: "not_run_requires_--execute",
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.dryRunMatchesExpectedInvestigation) {
      process.exitCode = 1;
    }
  } finally {
    await modules.closePrismaResourcesForAuditCli();
  }
}

main().catch((error) => {
  console.error(
    `[repair-accidental-qa-completions] ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
});
