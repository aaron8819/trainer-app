import Link from "next/link";
import { generateWorkoutExplanation } from "@/lib/api/explainability";
import { resolveOwner } from "@/lib/api/workout-context";
import { PostWorkoutInsights } from "@/components/post-workout/PostWorkoutInsights";
import { SessionContextCard } from "@/components/explainability";
import { prisma } from "@/lib/db/prisma";
import { parseExplainabilitySelectionMetadata } from "@/lib/ui/explainability";
import { isDumbbellEquipment, formatLoad } from "@/lib/ui/load-display";
import {
  getLoadProvenanceNote,
  hasPerformedHistory,
  isPerformedWorkoutStatus,
} from "@/lib/ui/session-overview";
import { evaluateTargetReps } from "@/lib/session-semantics/target-evaluation";
import { buildSessionSummaryModel } from "@/lib/ui/session-summary";
import { getWorkoutDetailTitle, getWorkoutWorkflowState } from "@/lib/workout-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const formatTargetRepDisplay = (set?: {
  targetReps: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
}) => {
  if (!set) {
    return "-- reps";
  }
  if (set.targetRepMin != null && set.targetRepMax != null && set.targetRepMin !== set.targetRepMax) {
    return `${set.targetRepMin}-${set.targetRepMax} reps`;
  }
  return `${set.targetReps} reps`;
};

const hasBodyweightEquipment = (exercise: {
  exerciseEquipment?: { equipment: { type: string } }[];
}) =>
  (exercise.exerciseEquipment ?? []).some(
    (item) => item.equipment.type.toLowerCase() === "bodyweight"
  );

const hasDumbbellEquipment = (exercise: {
  exerciseEquipment?: { equipment: { type: string } }[];
}) =>
  isDumbbellEquipment(
    (exercise.exerciseEquipment ?? []).map((item) => item.equipment.type)
  );

const formatProgressionCall = (trigger?: string | null) => {
  switch (trigger) {
    case "double_progression":
      return "Today's written target moved up from your prior session anchor.";
    case "hold":
      return "Today's written target held your prior session anchor.";
    case "deload":
      return "Today's written target was reduced for deload work.";
    case "readiness_scale":
      return "Today's written target was adjusted for readiness.";
    default:
      return "Today's written target stayed close to plan because recent performed history was limited.";
  }
};

export default async function WorkoutDetailPage({
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
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              exerciseEquipment: {
                include: {
                  equipment: true,
                },
              },
            },
          },
          sets: {
            orderBy: { setIndex: "asc" },
            include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } },
          },
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

  const [injuries, explanationResult] = await Promise.all([
    prisma.injury.findMany({ where: { userId: workout.userId, isActive: true } }),
    generateWorkoutExplanation(workout.id),
  ]);

  const explanation = "error" in explanationResult ? null : explanationResult;
  const selectionMetadata = parseExplainabilitySelectionMetadata(workout.selectionMetadata);
  const sessionDecisionReceipt = selectionMetadata.sessionDecisionReceipt;
  const workoutStructureState = selectionMetadata.workoutStructureState;
  const hasPerformedStatus = isPerformedWorkoutStatus(workout.status);
  const workflow = getWorkoutWorkflowState(workout.status);
  const startLoggingHref = workflow.isResumable ? `/log/${workout.id}` : null;
  const hasHighSeverityInjury = injuries.some((injury) => injury.severity >= 3);
  const summary =
    explanation != null
      ? buildSessionSummaryModel({
          context: explanation.sessionContext,
          receipt: sessionDecisionReceipt,
          sessionIntent: workout.sessionIntent,
          estimatedMinutes: workout.estimatedMinutes,
          workoutStructureState,
        })
      : null;

  const sectionedExercises = (() => {
    const warmup: typeof workout.exercises = [];
    const main: typeof workout.exercises = [];
    const accessory: typeof workout.exercises = [];
    const ordered = [...workout.exercises].sort((a, b) => a.orderIndex - b.orderIndex);

    for (const exercise of ordered) {
      if (exercise.section === "WARMUP") {
        warmup.push(exercise);
      } else if (exercise.section === "MAIN") {
        main.push(exercise);
      } else if (exercise.section === "ACCESSORY") {
        accessory.push(exercise);
      } else if (exercise.isMainLift) {
        main.push(exercise);
      } else if (warmup.length < 2) {
        warmup.push(exercise);
      } else {
        accessory.push(exercise);
      }
    }

    return [
      { label: "Warmup", items: warmup },
      { label: "Main Lifts", items: main },
      { label: "Accessories", items: accessory },
    ];
  })();

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Workout</p>
            <h1 className="page-title mt-1.5">{getWorkoutDetailTitle(workout.status)}</h1>
            <p className="mt-1.5 text-sm text-slate-600">Estimated {workout.estimatedMinutes ?? "--"} minutes</p>
          </div>
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-sm font-semibold text-slate-700 sm:w-auto"
            href={`/workout/${workout.id}/audit`}
          >
            Audit
          </Link>
        </div>

        <section className="mt-6 space-y-6 sm:mt-8 sm:space-y-8">
          {hasPerformedStatus && explanation ? (
            <PostWorkoutInsights
              explanation={explanation}
              exercises={workout.exercises.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                exerciseName: exercise.exercise.name,
                isMainLift: exercise.isMainLift || exercise.section === "MAIN",
              }))}
            />
          ) : summary ? (
            <SessionContextCard summary={summary} startLoggingHref={startLoggingHref} />
          ) : null}

          {sectionedExercises
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div key={section.label} className="space-y-3 sm:space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.label}</h2>
                {section.items.map((exercise) => {
                  const isBodyweightExercise = hasBodyweightEquipment(exercise.exercise);
                  const isDumbbellExercise = hasDumbbellEquipment(exercise.exercise);
                  const targetLoad = exercise.sets[0]?.targetLoad;
                  const topSetLoadDisplay = formatLoad(targetLoad, isDumbbellExercise, isBodyweightExercise);
                  const backOffSets = exercise.sets.slice(1);
                  const hasBackOff =
                    backOffSets.length > 0 &&
                    (backOffSets[0]?.targetReps !== exercise.sets[0]?.targetReps ||
                      backOffSets[0]?.targetLoad !== exercise.sets[0]?.targetLoad);
                  const backOffLoadDisplay = hasBackOff
                    ? formatLoad(backOffSets[0]?.targetLoad, isDumbbellExercise, isBodyweightExercise)
                    : null;

                  const progressionReceipt = explanation?.progressionReceipts.get(exercise.exerciseId);
                  const loadNote = getLoadProvenanceNote({
                    targetLoad,
                    isBodyweightExercise,
                    hasHistory: hasPerformedHistory(progressionReceipt),
                  });

                  const stressNote = hasHighSeverityInjury
                    ? `Joint stress: ${exercise.exercise.jointStress.toLowerCase()}; higher-stress options were filtered out.`
                    : `Joint stress: ${exercise.exercise.jointStress.toLowerCase()}.`;
                  const roleLabel =
                    exercise.section === "WARMUP"
                      ? "Warmup"
                      : exercise.section === "MAIN" || exercise.isMainLift
                      ? "Main lift"
                      : "Accessory";
                  const loadDeltaLabel =
                    progressionReceipt?.delta.loadPercent != null
                      ? `${progressionReceipt.delta.loadPercent >= 0 ? "+" : ""}${progressionReceipt.delta.loadPercent.toFixed(1)}% load`
                      : null;

                  return (
                    <div key={exercise.id} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">{exercise.exercise.name}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {hasBackOff ? (
                              <>
                                {`Top set: ${formatTargetRepDisplay(exercise.sets[0])}`}
                                {topSetLoadDisplay ? ` | ${topSetLoadDisplay}` : ""}
                                {exercise.sets[0]?.targetRpe ? ` | RPE ${exercise.sets[0].targetRpe}` : ""}
                                {` + ${backOffSets.length}x back-off`}
                                {backOffLoadDisplay
                                  ? `: ${formatTargetRepDisplay(backOffSets[0])} | ${backOffLoadDisplay}`
                                  : ""}
                              </>
                            ) : (
                              <>
                                {`${exercise.sets.length} sets - ${formatTargetRepDisplay(exercise.sets[0])}`}
                                {topSetLoadDisplay ? ` | ${topSetLoadDisplay}` : ""}
                                {exercise.sets[0]?.targetRpe ? ` | RPE ${exercise.sets[0].targetRpe}` : ""}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-slate-500">{roleLabel}</span>
                        </div>
                      </div>
                      {roleLabel === "Main lift" && !hasPerformedStatus && progressionReceipt ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {formatProgressionCall(progressionReceipt.trigger)}
                          {loadDeltaLabel ? ` ${loadDeltaLabel}.` : ""}
                        </p>
                      ) : null}
                      <p className="mt-3 text-[11px] leading-5 text-slate-400">
                        {stressNote} {loadNote}
                      </p>

                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        {exercise.sets.map((set) => {
                          const log = set.logs[0];
                          const repEvaluation =
                            hasPerformedStatus && log && !log.wasSkipped
                              ? evaluateTargetReps({
                                  actualReps: log.actualReps,
                                  targetReps: set.targetReps,
                                  targetRepMin: set.targetRepMin,
                                  targetRepMax: set.targetRepMax,
                                })
                              : null;
                          const loadMiss =
                            log?.actualLoad != null && set.targetLoad != null
                              ? log.actualLoad < set.targetLoad * 0.9
                              : false;
                          const actualColor =
                            repEvaluation == null || repEvaluation.kind === "missing_actual" || repEvaluation.kind === "missing_target"
                              ? "text-slate-500"
                              : (repEvaluation.kind === "in_range" || repEvaluation.kind === "above") && !loadMiss
                              ? "text-emerald-700"
                              : (repEvaluation.kind === "in_range" || repEvaluation.kind === "above") && loadMiss
                              ? "text-amber-700"
                              : repEvaluation.kind === "below" && repEvaluation.deviation === -1
                              ? "text-amber-700"
                              : "text-rose-700";

                          return (
                            <div key={set.id} className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <span>{set.setIndex === 1 ? "Top set" : `Set ${set.setIndex}`}</span>
                                <span className="text-slate-700">
                                  {formatTargetRepDisplay(set)}
                                  {formatLoad(set.targetLoad, isDumbbellExercise, isBodyweightExercise)
                                    ? ` | ${formatLoad(set.targetLoad, isDumbbellExercise, isBodyweightExercise)}`
                                    : ""}
                                  {set.targetRpe ? ` | RPE ${set.targetRpe}` : ""}
                                </span>
                              </div>
                              {hasPerformedStatus && log ? (
                                <>
                                  <div className={`mt-0.5 text-xs font-medium ${actualColor}`}>
                                    {log.wasSkipped
                                      ? "Actual: Skipped"
                                      : [
                                          `Actual: ${log.actualReps ?? "?"} reps`,
                                          log.actualLoad != null
                                            ? formatLoad(log.actualLoad, isDumbbellExercise, false)
                                            : null,
                                          log.actualRpe != null ? `RPE ${log.actualRpe}` : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" | ")}
                                    {!log.wasSkipped &&
                                    repEvaluation != null &&
                                    (repEvaluation.kind === "in_range" || repEvaluation.kind === "above") &&
                                    !loadMiss
                                      ? " OK"
                                      : ""}
                                  </div>
                                  {loadMiss && !log.wasSkipped && log.actualLoad != null && set.targetLoad != null ? (
                                    <div className="mt-0.5 text-xs text-slate-500">
                                      {`Load: ${log.actualLoad} / ${set.targetLoad} lbs (${Math.round(
                                        ((log.actualLoad - set.targetLoad) / set.targetLoad) * 100
                                      )}%)`}
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
        </section>
      </div>
    </main>
  );
}
