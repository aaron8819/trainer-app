import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import LogWorkoutClient from "@/components/LogWorkoutClient";
import type {
  LogExerciseInput,
  LogWorkoutCapabilities,
  SectionedExercises,
} from "@/components/log-workout/types";
import { prisma } from "@/lib/db/prisma";
import { parseExplainabilitySelectionMetadata } from "@/lib/ui/explainability";
import { splitExercises } from "@/lib/ui/workout-sections";
import {
  formatSessionIdentityLabel,
} from "@/lib/ui/session-identity";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { getLogWorkoutPageState } from "@/lib/workout-workflow";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";
import {
  getLogWorkoutExecutionGuidanceForExercise,
  loadLogWorkoutExecutionGuidance,
  normalizeLogWorkoutGuidanceExerciseLabel,
  type LogWorkoutExecutionGuidanceByExercise,
} from "@/lib/api/log-workout-execution-guidance";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function formatLogHeaderTechnicalLabel(label?: string | null): string | null {
  const resolvedLabel = label?.trim() || null;
  if (!resolvedLabel) {
    return null;
  }

  return null;
}

function LogWorkoutHeader({
  sessionIdentityLabel,
  sessionTechnicalLabel,
}: {
  sessionIdentityLabel?: string | null;
  sessionTechnicalLabel?: string | null;
}) {
  const sessionContext = [
    sessionIdentityLabel?.trim() || null,
    formatLogHeaderTechnicalLabel(sessionTechnicalLabel),
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="page-title">Workout Log</h1>
        {sessionContext ? <p className="mt-1 text-sm text-slate-600">{sessionContext}</p> : null}
      </div>
    </div>
  );
}

function buildInitialRestTimer(durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const startedAtMs = Date.now();
  return {
    startedAtMs,
    endAtMs: startedAtMs + durationSeconds * 1000,
  };
}

function countResolvedSets(exercise: LogExerciseInput): number {
  return exercise.sets.filter(
    (set) =>
      set.wasSkipped === true ||
      set.actualReps != null ||
      set.actualLoad != null ||
      set.actualRpe != null
  ).length;
}

function attachLogExerciseCapabilities(
  exercises: SectionedExercises,
  capabilities: LogWorkoutCapabilities
): SectionedExercises {
  const attach = (exercise: LogExerciseInput): LogExerciseInput => {
    const resolvedSetCount = countResolvedSets(exercise);
    return {
      ...exercise,
      capabilities: {
        canAddSet: capabilities.canAddSet,
        canRemove:
          capabilities.canRemoveSet &&
          (exercise.isRuntimeAdded ?? false) &&
          resolvedSetCount === 0,
        canSwap:
          capabilities.canSwapExercise &&
          resolvedSetCount === 0 &&
          !(exercise.isSwapped ?? false),
      },
    };
  };

  return {
    warmup: exercises.warmup?.map(attach) ?? [],
    main: exercises.main.map(attach),
    accessory: exercises.accessory?.map(attach) ?? [],
  };
}

function attachLogExerciseExecutionGuidance(
  exercises: SectionedExercises,
  guidanceByExercise: LogWorkoutExecutionGuidanceByExercise
): SectionedExercises {
  const exerciseNameCounts = new Map<string, number>();
  const allExercises = [
    ...(exercises.warmup ?? []),
    ...exercises.main,
    ...(exercises.accessory ?? []),
  ];
  for (const exercise of allExercises) {
    const key = normalizeLogWorkoutGuidanceExerciseLabel(exercise.name);
    if (!key) {
      continue;
    }
    exerciseNameCounts.set(key, (exerciseNameCounts.get(key) ?? 0) + 1);
  }

  const attach = (exercise: LogExerciseInput): LogExerciseInput => {
    const exerciseNameKey = normalizeLogWorkoutGuidanceExerciseLabel(exercise.name);
    const executionGuidance = getLogWorkoutExecutionGuidanceForExercise(
      guidanceByExercise,
      {
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        hasAmbiguousName:
          exerciseNameKey != null && (exerciseNameCounts.get(exerciseNameKey) ?? 0) > 1,
      }
    );
    return executionGuidance.length > 0
      ? { ...exercise, executionGuidance }
      : exercise;
  };

  return {
    warmup: exercises.warmup?.map(attach) ?? [],
    main: exercises.main.map(attach),
    accessory: exercises.accessory?.map(attach) ?? [],
  };
}

export default async function LogWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;

  if (!resolvedParams?.id) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <h1 className="text-2xl font-semibold">Missing workout id</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const fixture = await getUiAuditFixtureForServer();
  const logFixture = fixture?.logWorkouts?.[resolvedParams.id] ?? null;
  if (logFixture) {
    const fixtureCapabilities: LogWorkoutCapabilities = {
      canAddSet: true,
      canRemoveSet: true,
      canSwapExercise: true,
      canAddExercise: true,
      canFinish: true,
      showWeeklyCheck: true,
    };
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <LogWorkoutHeader
            sessionIdentityLabel={logFixture.sessionIdentityLabel}
            sessionTechnicalLabel={logFixture.sessionTechnicalLabel}
          />

          <LogWorkoutClient
            workoutId={logFixture.workoutId}
            initialRevision={1}
            exercises={attachLogExerciseCapabilities(logFixture.exercises, fixtureCapabilities)}
            allowBonusExerciseAdd={true}
            allowRuntimeExerciseSwap={true}
            capabilities={fixtureCapabilities}
            initialRestTimer={buildInitialRestTimer(logFixture.initialRestTimerDurationSeconds)}
            sessionIdentityLabel={logFixture.sessionIdentityLabel}
            sessionTechnicalLabel={logFixture.sessionTechnicalLabel}
          />
        </div>
      </main>
    );
  }

  const owner = await resolveOwner();
  const workout = await prisma.workout.findFirst({
    where: { id: resolvedParams.id, userId: owner.id },
    include: {
      mesocycle: {
        select: {
          state: true,
          isActive: true,
        },
      },
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              aliases: true,
              exerciseMuscles: {
                include: {
                  muscle: true,
                },
              },
              exerciseEquipment: {
                include: {
                  equipment: true,
                },
              },
            },
          },
          sets: { orderBy: { setIndex: "asc" }, include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  if (!workout) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <h1 className="text-2xl font-semibold">Workout not found</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }
  const pageState = getLogWorkoutPageState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycle?.state ?? null,
    mesocycleIsActive: workout.mesocycle?.isActive ?? null,
  });
  if (pageState.mutability !== "editable") {
    const isBlocked = pageState.uiState === "blocked";
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {isBlocked ? "Blocked" : "Read-only"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {isBlocked ? "Workout unavailable" : "Session review only"}
          </h1>
          <p className="mt-3 text-sm text-slate-600">{pageState.reason}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              href={`/workout/${workout.id}`}
            >
              View workout
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
              href="/"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const exercises = splitExercises(workout.exercises, workout.selectionMetadata);
  const executionGuidanceByExercise = await loadLogWorkoutExecutionGuidance({
    userId: owner.id,
    workoutId: workout.id,
  });
  const exercisesWithExecutionGuidance = attachLogExerciseExecutionGuidance(
    exercises,
    executionGuidanceByExercise
  );
  const selectionMetadata = parseExplainabilitySelectionMetadata(workout.selectionMetadata);
  const sessionDecisionReceipt = selectionMetadata.sessionDecisionReceipt;
  const sessionIdentityLabel = formatSessionIdentityLabel({
    intent: workout.sessionIntent,
    slotId: sessionDecisionReceipt?.sessionSlot?.slotId ?? null,
  });
  const sessionTechnicalLabel = null;
  const isStrictGapFill = isStrictOptionalGapFillSession({
    selectionMetadata: workout.selectionMetadata,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
  });
  const logCapabilities: LogWorkoutCapabilities = {
    canAddSet: pageState.mutability === "editable",
    canRemoveSet: pageState.mutability === "editable",
    canSwapExercise: pageState.mutability === "editable",
    canAddExercise: pageState.mutability === "editable" && !isStrictGapFill,
    canFinish: pageState.mutability === "editable",
    showWeeklyCheck: pageState.mutability === "editable",
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <LogWorkoutHeader
          sessionIdentityLabel={sessionIdentityLabel}
          sessionTechnicalLabel={sessionTechnicalLabel}
        />

        <LogWorkoutClient
          workoutId={workout.id}
          initialRevision={workout.revision}
          exercises={attachLogExerciseCapabilities(
            exercisesWithExecutionGuidance,
            logCapabilities
          )}
          allowBonusExerciseAdd={!isStrictGapFill}
          allowRuntimeExerciseSwap={pageState.mutability === "editable"}
          capabilities={logCapabilities}
          sessionIdentityLabel={sessionIdentityLabel}
          sessionTechnicalLabel={sessionTechnicalLabel}
        />
      </div>
    </main>
  );
}
