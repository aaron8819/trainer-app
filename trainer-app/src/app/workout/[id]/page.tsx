import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { mapLatestCheckIn } from "@/lib/api/checkin-staleness";
import { generateWorkoutExplanation } from "@/lib/api/explainability";
import type { WorkoutExplanation as WorkoutExplanationType } from "@/lib/engine/explainability";
import { PrimaryGoal, TrainingAge } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { WorkoutExplanation } from "@/components/WorkoutExplanation";
import { isDumbbellEquipment, formatLoad } from "@/lib/ui/load-display";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";


const formatTrainingAge = (trainingAge?: TrainingAge | null) =>
  trainingAge ? trainingAge.toLowerCase() : "intermediate";

const formatPainFlags = (painFlags?: unknown) => {
  if (!painFlags || typeof painFlags !== "object") {
    return [] as string[];
  }
  return Object.entries(painFlags as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" && value >= 2)
    .map(([key]) => key.replace(/_/g, " "));
};

const formatTargetRepDisplay = (set?: { targetReps: number; targetRepMin: number | null; targetRepMax: number | null }) => {
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

  const [goals, profile, injuries, latestCheckIn] = await Promise.all([
    prisma.goals.findUnique({ where: { userId: workout.userId } }),
    prisma.profile.findUnique({ where: { userId: workout.userId } }),
    prisma.injury.findMany({ where: { userId: workout.userId, isActive: true } }),
    prisma.sessionCheckIn.findFirst({
      where: { userId: workout.userId },
      orderBy: { date: "desc" },
    }),
  ]);
  // Load workout explanation (unified data source for inline badges + detail panel)
  const explanationResult = await generateWorkoutExplanation(workout.id);
  const explanation = "error" in explanationResult ? null : explanationResult;

  const hasHighSeverityInjury = injuries.some((injury) => injury.severity >= 3);
  const primaryGoal = goals?.primaryGoal?.toLowerCase() ?? "general_health";
  const secondaryGoal = goals?.secondaryGoal?.toLowerCase() ?? "none";
  const sourceLabel =
    workout.selectionMode === "INTENT"
      ? "intent"
      : workout.templateId
        ? "template"
        : "legacy";
  const intentLabel = workout.sessionIntent
    ? workout.sessionIntent.toLowerCase().replaceAll("_", " ")
    : undefined;
  const trainingAge = formatTrainingAge(profile?.trainingAge ?? TrainingAge.INTERMEDIATE);
  const freshCheckIn = mapLatestCheckIn(latestCheckIn ? [latestCheckIn] : undefined);
  const painLabels = formatPainFlags(freshCheckIn?.painFlags);
  const readinessLine = freshCheckIn
    ? `Readiness: ${freshCheckIn.readiness}/5${
        painLabels.length > 0 ? ` - Pain: ${painLabels.join(", ")}` : ""
      }.`
    : latestCheckIn
      ? "Readiness: defaulted to 3 (latest check-in is older than 48 hours)."
    : "Readiness: defaulted to 3 (no readiness logs currently stored).";

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
            <h1 className="page-title mt-1.5">
              {workout.status === "COMPLETED" ? "Session Review" : "Session Overview"}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Estimated {workout.estimatedMinutes ?? "--"} minutes
            </p>
          </div>
          {workout.status !== "COMPLETED" && workout.status !== "SKIPPED" && (
            <Link
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
              href={`/log/${workout.id}`}
            >
              Start logging
            </Link>
          )}
        </div>

        <section className="mt-6 space-y-6 sm:mt-8 sm:space-y-8">
          <WorkoutExplanation workoutId={workout.id} explanation={explanation} />
          {sectionedExercises.filter((section) => section.items.length > 0).map((section) => (
            <div key={section.label} className="space-y-3 sm:space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.label}</h2>
              {(
                section.items.map((exercise) => {
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
                  const loadNote = targetLoad !== null && targetLoad !== undefined
                    ? "Estimated load (from workout history)."
                    : isBodyweightExercise
                    ? "Bodyweight movement (BW). Add load during logging only for weighted variations."
                    : "Load to be chosen during logging.";
                  const stressNote = hasHighSeverityInjury
                    ? `Joint stress: ${exercise.exercise.jointStress.toLowerCase()} (high stress filtered).`
                    : `Joint stress: ${exercise.exercise.jointStress.toLowerCase()}.`;
                  const roleLabel =
                    exercise.section === "WARMUP"
                      ? "Warmup"
                      : exercise.section === "MAIN" || exercise.isMainLift
                      ? "Main lift"
                      : "Accessory";
                  // Get exercise rationale from new explainability system
                  const exerciseRationale = explanation?.exerciseRationales.get(exercise.exercise.id);
                  const primaryReason = exerciseRationale?.primaryReasons[0]; // Top reason from KB-backed system
                  const topReasons = exerciseRationale?.primaryReasons.slice(0, 2) ?? [];

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
                                {` + ${backOffSets.length}× back-off`}
                                {backOffLoadDisplay ? `: ${formatTargetRepDisplay(backOffSets[0])} | ${backOffLoadDisplay}` : ""}
                              </>
                            ) : (
                              <>
                                {`${exercise.sets.length} sets – ${formatTargetRepDisplay(exercise.sets[0])}`}
                                {topSetLoadDisplay ? ` | ${topSetLoadDisplay}` : ""}
                                {exercise.sets[0]?.targetRpe ? ` | RPE ${exercise.sets[0].targetRpe}` : ""}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-slate-500">
                            {roleLabel}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Why: {(exercise.movementPatterns?.length ? exercise.movementPatterns.map((p: string) => p.toLowerCase().replace(/_/g, " ")).join(", ") : "unknown")} pattern. {stressNote} {loadNote}
                      </p>
                      {topReasons.length > 0 ? (
                        <div className="mt-2 text-xs text-slate-600">
                          <p>
                            Why included: {topReasons.join(" • ")}
                          </p>
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        {exercise.sets.map((set) => {
                          const log = set.logs[0];
                          const isCompleted = workout.status === "COMPLETED";
                          const repDiff = isCompleted && log && !log.wasSkipped
                            ? (log.actualReps ?? 0) - (set.targetReps ?? 0)
                            : null;
                          const loadMiss =
                            log?.actualLoad != null && set.targetLoad != null
                              ? log.actualLoad < set.targetLoad * 0.9
                              : false;
                          const actualColor =
                            repDiff === null
                              ? "text-slate-500"
                              : repDiff >= 0 && !loadMiss
                              ? "text-emerald-700"
                              : repDiff >= 0 && loadMiss
                              ? "text-amber-700"
                              : repDiff === -1
                              ? "text-amber-700"
                              : "text-rose-700";
                          return (
                            <div
                              key={set.id}
                              className="rounded-lg bg-slate-50 px-3 py-2"
                            >
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
                              {isCompleted && log ? (
                                <>
                                  <div className={`mt-0.5 text-xs font-medium ${actualColor}`}>
                                    {log.wasSkipped
                                      ? "Actual: Skipped"
                                      : [
                                          `Actual: ${log.actualReps ?? "?"} reps`,
                                          log.actualLoad != null ? formatLoad(log.actualLoad, isDumbbellExercise, false) : null,
                                          log.actualRpe != null ? `RPE ${log.actualRpe}` : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" | ")}
                                    {!log.wasSkipped && repDiff !== null && repDiff >= 0 && !loadMiss ? " ✓" : ""}
                                  </div>
                                  {loadMiss && !log.wasSkipped && log.actualLoad != null && set.targetLoad != null ? (
                                    <div className="mt-0.5 text-xs text-slate-500">
                                      {`Load: ${log.actualLoad} / ${set.targetLoad} lbs (${Math.round(((log.actualLoad - set.targetLoad) / set.targetLoad) * 100)}%)`}
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
                })
              )}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}





