import Link from "next/link";
import { generateWorkoutExplanation } from "@/lib/api/explainability";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutExplanation } from "@/components/WorkoutExplanation";
import { prisma } from "@/lib/db/prisma";
import { parseExplainabilitySelectionMetadata } from "@/lib/ui/explainability";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function WorkoutAuditPage({
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
    select: {
      id: true,
      status: true,
      mesocycleId: true,
      sessionIntent: true,
      estimatedMinutes: true,
      selectionMetadata: true,
      mesocycle: {
        select: {
          state: true,
          isActive: true,
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

  const explanationResult = await generateWorkoutExplanation(workout.id);
  const explanation = "error" in explanationResult ? null : explanationResult;
  const selectionMetadata = parseExplainabilitySelectionMetadata(workout.selectionMetadata);
  const sessionDecisionReceipt = selectionMetadata.sessionDecisionReceipt;
  const workoutStructureState = selectionMetadata.workoutStructureState;
  const workflow = getWorkoutWorkflowState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycle?.state ?? null,
    mesocycleIsActive: workout.mesocycle?.isActive ?? null,
  });
  const startLoggingHref = workflow.isResumable ? `/log/${workout.id}` : null;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Workout Audit</p>
            <h1 className="page-title mt-1.5">Explainability Audit</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Receipt-first audit view for session decisions, missing signals, and per-exercise reasoning.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
            href={`/workout/${workout.id}`}
          >
            Back to workout
          </Link>
        </div>

        <section className="mt-6 space-y-6 sm:mt-8 sm:space-y-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Internal audit view</p>
            <p className="mt-1">
              This surface is for backend auditing and rule verification. Scan the session-level evidence first, then use the exercise drill-down only for the lifts that look wrong or surprising.
            </p>
          </div>

          {explanation ? (
            <WorkoutExplanation
              workoutId={workout.id}
              explanation={explanation}
              sessionDecisionReceipt={sessionDecisionReceipt}
              sessionIntent={workout.sessionIntent}
              estimatedMinutes={workout.estimatedMinutes}
              startLoggingHref={startLoggingHref}
              workoutStructureState={workoutStructureState}
            />
          ) : (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:p-5">
              Failed to load explainability for this workout.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
