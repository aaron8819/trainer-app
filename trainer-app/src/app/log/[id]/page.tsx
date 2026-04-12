import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import LogWorkoutClient from "@/components/LogWorkoutClient";
import { prisma } from "@/lib/db/prisma";
import { parseExplainabilitySelectionMetadata } from "@/lib/ui/explainability";
import { splitExercises } from "@/lib/ui/workout-sections";
import {
  formatSessionIdentityLabel,
  formatSessionSlotTechnicalLabel,
} from "@/lib/ui/session-identity";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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
  const workflow = getWorkoutWorkflowState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycle?.state ?? null,
    mesocycleIsActive: workout.mesocycle?.isActive ?? null,
  });
  const resumeBlockedReason = workflow.resumeBlockedReason;
  if (resumeBlockedReason) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <h1 className="text-2xl font-semibold">Workout unavailable for logging</h1>
          <p className="mt-3 text-sm text-slate-600">{resumeBlockedReason}</p>
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
  const selectionMetadata = parseExplainabilitySelectionMetadata(workout.selectionMetadata);
  const sessionDecisionReceipt = selectionMetadata.sessionDecisionReceipt;
  const sessionIdentityLabel = formatSessionIdentityLabel({
    intent: workout.sessionIntent,
    slotId: sessionDecisionReceipt?.sessionSlot?.slotId ?? null,
  });
  const sessionTechnicalLabel = formatSessionSlotTechnicalLabel(
    sessionDecisionReceipt?.sessionSlot?.slotId ?? null
  );
  const isStrictGapFill = isStrictOptionalGapFillSession({
    selectionMetadata: workout.selectionMetadata,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
  });

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Log Session</p>
            <h1 className="page-title mt-1.5">Workout Log</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              {sessionIdentityLabel}
              {sessionTechnicalLabel ? ` | ${sessionTechnicalLabel}` : ""}
              {" | Tap to log each set quickly."}
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
            href={`/workout/${workout.id}`}
          >
            View workout
          </Link>
        </div>

        <LogWorkoutClient
          workoutId={workout.id}
          exercises={exercises}
          allowBonusExerciseAdd={!isStrictGapFill}
          allowRuntimeExerciseSwap={workflow.isResumable}
          sessionIdentityLabel={sessionIdentityLabel}
          sessionTechnicalLabel={sessionTechnicalLabel}
        />
      </div>
    </main>
  );
}
