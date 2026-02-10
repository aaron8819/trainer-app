import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import {
  loadWorkoutContext,
  mapConstraints,
  mapExercises,
  mapHistory,
  resolveOwner,
} from "@/lib/api/workout-context";
import { getSplitPreview } from "@/lib/api/split-preview";
import { SPLIT_PATTERNS } from "@/lib/engine";
import { PrimaryGoal, SplitDay, SplitType, TrainingAge, WorkoutSelectionMode } from "@prisma/client";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type BaselineSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

const BASELINE_ALIAS_MAP: Record<string, string> = {
  "barbell bench press": "flat barbell bench press",
  "bench press": "flat barbell bench press",
  "overhead press": "overhead press",
  "romanian deadlift": "romanian deadlift (bb)",
  rdl: "romanian deadlift (bb)",
  "face pull": "face pulls (rope)",
  "chest-supported row": "chest-supported machine row",
  "machine row": "chest-supported machine row",
  "db shoulder press": "db shoulder press",
  "dumbbell shoulder press": "db shoulder press",
};

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s()-]/g, "")
    .trim();

const formatSplitType = (splitType: SplitType) =>
  splitType
    .toLowerCase()
    .replace("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatTrainingAge = (trainingAge?: TrainingAge | null) =>
  trainingAge ? trainingAge.toLowerCase() : "intermediate";

const splitDayLabel = (forcedSplit?: SplitDay | null) => {
  if (!forcedSplit) {
    return null;
  }
  return forcedSplit.toLowerCase().replace("_", " ");
};

const resolveForcedPatterns = (forcedSplit?: SplitDay | null) => {
  if (!forcedSplit) {
    return null;
  }
  const value = forcedSplit.toLowerCase();
  if (value === "push") {
    return ["push"];
  }
  if (value === "pull") {
    return ["pull"];
  }
  if (value === "legs" || value === "lower") {
    return ["squat", "hinge"];
  }
  if (value === "upper") {
    return ["push", "pull"];
  }
  if (value === "full_body") {
    return ["push", "pull", "squat", "hinge", "rotate"];
  }
  return null;
};

const formatPainFlags = (painFlags?: unknown) => {
  if (!painFlags || typeof painFlags !== "object") {
    return [] as string[];
  }
  return Object.entries(painFlags as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" && value >= 2)
    .map(([key]) => key.replace(/_/g, " "));
};


function buildBaselineSummary({
  workout,
  baselines,
  context,
}: {
  workout: Prisma.WorkoutGetPayload<{
    include: {
      exercises: {
        include: {
          exercise: true;
          sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } };
        };
      };
    };
  }>;
  baselines: { exerciseName: string; context: string; topSetWeight: number | null }[];
  context: string;
}): BaselineSummary {
  const evaluatedExercises = workout.exercises.filter((exercise) => exercise.sets.length >= 2);
  const items: BaselineSummary["items"] = [];
  const skippedItems: BaselineSummary["skippedItems"] = [];
  let updated = 0;
  let skipped = 0;

  const findBaseline = (exerciseName: string) => {
    const normalized = normalizeName(exerciseName);
    const alias = BASELINE_ALIAS_MAP[normalized];
    const matches = baselines.filter((baseline) => {
      if (baseline.context !== context && baseline.context !== "default") {
        return false;
      }
      const baselineNormalized = normalizeName(baseline.exerciseName);
      if (baselineNormalized === normalized) {
        return true;
      }
      if (alias && baselineNormalized === alias) {
        return true;
      }
      return false;
    });
    if (matches.length === 0) {
      return undefined;
    }
    return (
      matches.find((baseline) => baseline.context === context) ??
      matches.find((baseline) => baseline.context === "default") ??
      matches[0]
    );
  };

  for (const exercise of evaluatedExercises) {
    const sets = exercise.sets.map((set) => ({
      targetReps: set.targetReps ?? undefined,
      targetRpe: set.targetRpe ?? undefined,
      actualReps: set.logs[0]?.actualReps ?? undefined,
      actualLoad: set.logs[0]?.actualLoad ?? undefined,
      actualRpe: set.logs[0]?.actualRpe ?? undefined,
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
      hasLog: Boolean(set.logs[0]),
    }));

    const unskipped = sets.filter((set) => !set.wasSkipped);
    if (unskipped.length === 0) {
      skippedItems.push({ exerciseName: exercise.exercise.name, reason: "All sets marked skipped." });
      skipped += 1;
      continue;
    }

    const withPerformance = unskipped.filter(
      (set) => set.actualReps !== undefined && set.actualLoad !== undefined
    );
    if (withPerformance.length === 0) {
      const hasAnyLog = sets.some((set) => set.hasLog);
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: hasAnyLog ? "Missing logged reps or load." : "No logged sets.",
      });
      skipped += 1;
      continue;
    }

    const qualifyingSets = withPerformance.filter((set) => {
      if (set.targetReps !== undefined && set.actualReps! < set.targetReps) {
        return false;
      }
      if (set.targetRpe !== undefined && set.actualRpe !== undefined) {
        return set.actualRpe <= set.targetRpe;
      }
      return true;
    });

    if (qualifyingSets.length === 0) {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: "Targets not met (reps or RPE).",
      });
      skipped += 1;
      continue;
    }

    const bestSet = qualifyingSets.reduce((best, current) =>
      (current.actualLoad ?? 0) > (best.actualLoad ?? 0) ? current : best
    );

    if (bestSet.actualLoad === undefined || bestSet.actualReps === undefined) {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: "Missing logged reps or load.",
      });
      skipped += 1;
      continue;
    }

    const baseline = findBaseline(exercise.exercise.name);
    if (baseline?.topSetWeight && bestSet.actualLoad <= baseline.topSetWeight) {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: "Not above current baseline top set.",
      });
      skipped += 1;
      continue;
    }

    items.push({
      exerciseName: exercise.exercise.name,
      previousTopSetWeight: baseline?.topSetWeight ?? undefined,
      newTopSetWeight: bestSet.actualLoad,
      reps: bestSet.actualReps,
    });
    updated += 1;
  }

  return {
    context,
    evaluatedExercises: evaluatedExercises.length,
    updated,
    skipped,
    items,
    skippedItems,
  };
}

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;

  if (!resolvedParams?.id) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
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
          exercise: true,
          sets: { orderBy: { setIndex: "asc" }, include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  if (!workout) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Workout not found</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const [goals, profile, constraints, injuries, latestCheckIn] = await Promise.all([
    prisma.goals.findUnique({ where: { userId: workout.userId } }),
    prisma.profile.findUnique({ where: { userId: workout.userId } }),
    prisma.constraints.findUnique({ where: { userId: workout.userId } }),
    prisma.injury.findMany({ where: { userId: workout.userId, isActive: true } }),
    prisma.sessionCheckIn.findFirst({
      where: { userId: workout.userId },
      orderBy: { date: "desc" },
    }),
  ]);
  const context = goals?.primaryGoal === PrimaryGoal.STRENGTH ? "strength" : "volume";
  const baselines = await prisma.baseline.findMany({
    where: { userId: workout.userId },
    select: {
      exerciseName: true,
      context: true,
      topSetWeight: true,
      workingWeightMin: true,
      workingWeightMax: true,
    },
  });
  const baselineSummary = buildBaselineSummary({ workout, baselines, context });

  const workoutsBefore = await prisma.workout.count({
    where: {
      userId: workout.userId,
      scheduledDate: { lt: workout.scheduledDate },
      status: "COMPLETED",
      advancesSplit: true,
    },
  });
    const previewContext = await loadWorkoutContext(owner.id);
  const splitPreview = previewContext.constraints
    ? getSplitPreview(
        mapConstraints(previewContext.constraints),
        mapHistory(previewContext.workouts),
        mapExercises(previewContext.exercises)
      )
    : undefined;
  const daysPerWeek = Math.max(1, constraints?.daysPerWeek ?? 3);
  const splitKey = (constraints?.splitType?.toLowerCase() ??
    "full_body") as keyof typeof SPLIT_PATTERNS;
  const splitOptions = SPLIT_PATTERNS[splitKey] ?? SPLIT_PATTERNS.full_body;
  const dayIndex = workoutsBefore % daysPerWeek;
  const forcedPatterns = resolveForcedPatterns(workout.forcedSplit);
  const targetPatterns = forcedPatterns ?? splitOptions[dayIndex % splitOptions.length];
  const nextAutoLabel = splitPreview?.nextAutoLabel ?? "Not available";
  const queuePreview = splitPreview?.queuePreview ?? "Not available";
  const hasHighSeverityInjury = injuries.some((injury) => injury.severity >= 3);
  const primaryGoal = goals?.primaryGoal?.toLowerCase() ?? "general_health";
  const secondaryGoal = goals?.secondaryGoal?.toLowerCase() ?? "none";
  const splitLabel = constraints?.splitType
    ? formatSplitType(constraints.splitType)
    : "Full Body";
  const trainingAge = formatTrainingAge(profile?.trainingAge ?? TrainingAge.INTERMEDIATE);
  const selectionMode = workout.selectionMode ?? WorkoutSelectionMode.AUTO;
  const forcedSplitLabel = splitDayLabel(workout.forcedSplit);
  const painLabels = formatPainFlags(latestCheckIn?.painFlags);
  const readinessLine = latestCheckIn
    ? `Readiness: ${latestCheckIn.readiness}/5${
        painLabels.length > 0 ? ` - Pain: ${painLabels.join(", ")}` : ""
      }.`
    : "Readiness: defaulted to 3 (no readiness logs currently stored).";

  const findBaseline = (exerciseName: string) => {
    const normalized = normalizeName(exerciseName);
    const alias = BASELINE_ALIAS_MAP[normalized];
    const matches = baselines.filter((baseline) => {
      if (baseline.context !== context && baseline.context !== "default") {
        return false;
      }
      const baselineNormalized = normalizeName(baseline.exerciseName);
      if (baselineNormalized === normalized) {
        return true;
      }
      if (alias && baselineNormalized === alias) {
        return true;
      }
      return false;
    });
    if (matches.length === 0) {
      return undefined;
    }
    return (
      matches.find((baseline) => baseline.context === context) ??
      matches.find((baseline) => baseline.context === "default") ??
      matches[0]
    );
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Workout</p>
            <h1 className="mt-2 text-3xl font-semibold">Session Overview</h1>
            <p className="mt-2 text-slate-600">
              Estimated {workout.estimatedMinutes ?? "--"} minutes
            </p>
          </div>
          <Link
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
            href={`/log/${workout.id}`}
          >
            Start logging
          </Link>
        </div>

        <section className="mt-8 space-y-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <p className="font-semibold text-slate-900">Why this workout was generated</p>
            <div className="mt-3 space-y-2 text-slate-600">
              <p>
                Goal focus: {primaryGoal.replace("_", " ")} (secondary: {secondaryGoal.replace("_", " ")}).
              </p>
              <p>
                Split: {splitLabel} - Day {dayIndex + 1} of {daysPerWeek} - Target patterns:{" "}
                {targetPatterns.join(", ")}.
              </p>
              <p>
                Selection mode: {selectionMode.toLowerCase()}
                {forcedSplitLabel ? ` (forced ${forcedSplitLabel})` : ""} - Advances split:{" "}
                {workout.advancesSplit ?? true ? "yes" : "no"}.
              </p>
              <p>
                Next auto day: {nextAutoLabel}. Queue: {queuePreview}.
              </p>
              <p>
                Training age: {trainingAge}. Main lifts default to 4 sets; accessories default to 3 sets.
              </p>
              <p>
                Injury filter: {injuries.length > 0 ? (
                  <>
                    {injuries.map((injury) => injury.bodyPart).join(", ")} (severity 3+ filter{" "}
                    {hasHighSeverityInjury ? "active" : "inactive"}).
                  </>
                ) : (
                  "No active injuries on file."
                )}
              </p>
              <p>{readinessLine}</p>
              <p>
                Baseline context: {context}. Loads are seeded when a baseline matches the exercise name.
              </p>
            </div>
          </div>
          {baselineSummary.evaluatedExercises > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm">
              <p className="font-semibold text-slate-900">Baseline updates</p>
              <p className="mt-1 text-slate-600">
                Context: {baselineSummary.context} · Evaluated: {baselineSummary.evaluatedExercises} · Updated:{" "}
                {baselineSummary.updated} · Skipped: {baselineSummary.skipped}
              </p>
              {baselineSummary.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {baselineSummary.items.map((item) => (
                    <div key={`${item.exerciseName}-${item.newTopSetWeight}`} className="flex flex-wrap gap-2">
                      <span className="font-medium text-slate-900">{item.exerciseName}</span>
                      <span className="text-slate-600">
                        {item.previousTopSetWeight ? `${item.previousTopSetWeight} → ` : ""}
                        {item.newTopSetWeight} lbs × {item.reps}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-slate-600">No baseline increases detected for this session.</p>
              )}
              {baselineSummary.skippedItems.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why skipped</p>
                  {baselineSummary.skippedItems.map((item) => (
                    <div key={`${item.exerciseName}-${item.reason}`} className="flex flex-wrap gap-2">
                      <span className="font-medium text-slate-900">{item.exerciseName}</span>
                      <span className="text-slate-600">{item.reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {[{
            label: "Warmup",
            items: workout.exercises.filter((exercise) => !exercise.isMainLift).slice(0, 2),
          }, {
            label: "Main Lifts",
            items: workout.exercises.filter((exercise) => exercise.isMainLift),
          }, {
            label: "Accessories",
            items: workout.exercises.filter((exercise) => !exercise.isMainLift).slice(2),
          }].map((section) => (
            <div key={section.label} className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.label}</h2>
              {section.items.length === 0 ? (
                <p className="text-sm text-slate-500">No exercises in this section.</p>
              ) : (
                section.items.map((exercise) => {
                  const baseline = findBaseline(exercise.exercise.name);
                  const baselineRange =
                    baseline &&
                    baseline.workingWeightMin !== null &&
                    baseline.workingWeightMax !== null
                      ? `${baseline.workingWeightMin}-${baseline.workingWeightMax} lbs`
                      : baseline?.topSetWeight
                      ? `${baseline.topSetWeight} lbs`
                      : undefined;
                  const targetLoad = exercise.sets[0]?.targetLoad;
                  const loadNote = targetLoad
                    ? `Load seeded from baseline${baselineRange ? ` (${baselineRange})` : ""}.`
                    : "Load to be chosen during logging (no baseline match).";
                  const stressNote = hasHighSeverityInjury
                    ? `Joint stress: ${exercise.exercise.jointStress.toLowerCase()} (high stress filtered).`
                    : `Joint stress: ${exercise.exercise.jointStress.toLowerCase()}.`;

                  return (
                    <div key={exercise.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">{exercise.exercise.name}</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {exercise.sets.length} sets � {exercise.sets[0]?.targetReps ?? "--"} reps
                            {targetLoad ? ` � ${targetLoad} lbs` : ""}
                            {exercise.sets[0]?.targetRpe ? ` � RPE ${exercise.sets[0].targetRpe}` : ""}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                          {exercise.isMainLift ? "Main lift" : "Accessory"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Why: {(exercise.movementPatterns?.length ? exercise.movementPatterns.map((p: string) => p.toLowerCase().replace(/_/g, " ")).join(", ") : "unknown")} pattern. {stressNote} {loadNote}
                      </p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        {exercise.sets.map((set) => (
                          <div key={set.id} className="flex items-center justify-between">
                            <span>Set {set.setIndex}</span>
                            <span>
                              {set.targetReps} reps
                              {set.targetLoad ? ` � ${set.targetLoad} lbs` : ""}
                              {set.targetRpe ? ` � RPE ${set.targetRpe}` : ""}
                            </span>
                          </div>
                        ))}
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





