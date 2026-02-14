import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { mapLatestCheckIn } from "@/lib/api/checkin-staleness";
import { isSetQualifiedForBaseline } from "@/lib/baseline-qualification";
import {
  describePrimaryDriver,
  getSelectionStepLabel,
  getTopComponentLabels,
  parseExplainabilitySelectionMetadata,
  summarizeSelectionDrivers,
} from "@/lib/ui/explainability";
import { PrimaryGoal, TrainingAge } from "@prisma/client";
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

const formatLoadDisplay = (targetLoad: number | null | undefined, isBodyweight: boolean) => {
  if (targetLoad !== null && targetLoad !== undefined) {
    return `${targetLoad} lbs`;
  }
  if (isBodyweight) {
    return "BW";
  }
  return undefined;
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

    const qualifyingSets = withPerformance.filter((set) => isSetQualifiedForBaseline(set));

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
  const selectionMetadata = parseExplainabilitySelectionMetadata(workout.selectionMetadata);
  const selectionSummary = summarizeSelectionDrivers(selectionMetadata.rationale);
  const selectedCount =
    selectionMetadata.selectedExerciseIds?.length ??
    Object.keys(selectionMetadata.rationale ?? {}).length;
  const autoSelectedCount = Math.max(
    0,
    selectedCount - selectionSummary.countsByStep.pin
  );

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
            <h1 className="page-title mt-1.5">Session Overview</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Estimated {workout.estimatedMinutes ?? "--"} minutes
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
            href={`/log/${workout.id}`}
          >
            Start logging
          </Link>
        </div>

        <section className="mt-6 space-y-6 sm:mt-8 sm:space-y-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
            <p className="font-semibold text-slate-900">Why this workout was generated</p>
            <div className="mt-3 space-y-2 text-slate-600">
              <p>
                Goal focus: {primaryGoal.replace("_", " ")} (secondary: {secondaryGoal.replace("_", " ")}).
              </p>
              <p>
                Source: {sourceLabel} generation.
              </p>
              {intentLabel ? (
                <p>
                  Session intent: {intentLabel}.
                </p>
              ) : null}
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
              {selectedCount > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Decision summary</p>
                  <ul className="mt-1 space-y-1">
                    <li>
                      Session focus: {intentLabel ?? "general"} ({sourceLabel} generation).
                    </li>
                    <li>{describePrimaryDriver(selectionSummary.primaryDriver)}</li>
                    <li>
                      Selection mix: {selectedCount} selected, {selectionSummary.countsByStep.pin} pinned,
                      {" "}{autoSelectedCount} auto-selected.
                    </li>
                    {selectionMetadata.adaptiveDeloadApplied ? (
                      <li>Recovery mode applied from recent fatigue/readiness signals.</li>
                    ) : null}
                    {selectionMetadata.periodizationWeek ? (
                      <li>Program week context: Week {selectionMetadata.periodizationWeek}.</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
          {baselineSummary.evaluatedExercises > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm sm:p-5">
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
          {sectionedExercises.map((section) => (
            <div key={section.label} className="space-y-3 sm:space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.label}</h2>
              {section.items.length === 0 ? (
                <p className="text-sm text-slate-500">No exercises in this section.</p>
              ) : (
                section.items.map((exercise) => {
                  const baseline = findBaseline(exercise.exercise.name);
                  const isBodyweightExercise = hasBodyweightEquipment(exercise.exercise);
                  const baselineRange =
                    baseline &&
                    baseline.workingWeightMin !== null &&
                    baseline.workingWeightMax !== null
                      ? `${baseline.workingWeightMin}-${baseline.workingWeightMax} lbs`
                      : baseline?.topSetWeight
                      ? `${baseline.topSetWeight} lbs`
                      : undefined;
                  const targetLoad = exercise.sets[0]?.targetLoad;
                  const topSetLoadDisplay = formatLoadDisplay(targetLoad, isBodyweightExercise);
                  const loadNote = targetLoad !== null && targetLoad !== undefined
                    ? `Load seeded from baseline${baselineRange ? ` (${baselineRange})` : ""}.`
                    : isBodyweightExercise
                    ? "Bodyweight movement (BW). Add load during logging only for weighted variations."
                    : "Load to be chosen during logging (no baseline match).";
                  const stressNote = hasHighSeverityInjury
                    ? `Joint stress: ${exercise.exercise.jointStress.toLowerCase()} (high stress filtered).`
                    : `Joint stress: ${exercise.exercise.jointStress.toLowerCase()}.`;
                  const roleLabel =
                    exercise.section === "WARMUP"
                      ? "Warmup"
                      : exercise.section === "MAIN" || exercise.isMainLift
                      ? "Main lift"
                      : "Accessory";
                  const rationaleEntry = selectionMetadata.rationale?.[exercise.exercise.id];
                  const reasonChip = getSelectionStepLabel(rationaleEntry?.selectedStep);
                  const topReasons = getTopComponentLabels(rationaleEntry?.components, 2);
                  const detailComponents = Object.entries(rationaleEntry?.components ?? {})
                    .filter(([, value]) => Number.isFinite(value))
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4);

                  return (
                    <div key={exercise.id} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">{exercise.exercise.name}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {exercise.sets.length} sets - {formatTargetRepDisplay(exercise.sets[0])}
                            {topSetLoadDisplay ? ` | ${topSetLoadDisplay}` : ""}
                            {exercise.sets[0]?.targetRpe ? ` | RPE ${exercise.sets[0].targetRpe}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-slate-500">
                            {roleLabel}
                          </span>
                          {rationaleEntry ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {reasonChip}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Why: {(exercise.movementPatterns?.length ? exercise.movementPatterns.map((p: string) => p.toLowerCase().replace(/_/g, " ")).join(", ") : "unknown")} pattern. {stressNote} {loadNote}
                      </p>
                      {rationaleEntry ? (
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <p>
                            Why included:{" "}
                            {topReasons.length > 0
                              ? topReasons.join(" • ")
                              : "Balanced fit for session goals and constraints."}
                          </p>
                          {detailComponents.length > 0 ? (
                            <details>
                              <summary className="cursor-pointer text-slate-500">
                                Details
                              </summary>
                              <p className="mt-1 text-slate-500">
                                {detailComponents
                                  .map(([name, value]) => `${name}: ${value.toFixed(2)}`)
                                  .join(" • ")}
                              </p>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        {exercise.sets.map((set) => (
                          <div
                            key={set.id}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2"
                          >
                            <span>Set {set.setIndex}</span>
                            <span className="text-slate-700">
                              {formatTargetRepDisplay(set)}
                              {formatLoadDisplay(set.targetLoad, isBodyweightExercise)
                                ? ` | ${formatLoadDisplay(set.targetLoad, isBodyweightExercise)}`
                                : ""}
                              {set.targetRpe ? ` | RPE ${set.targetRpe}` : ""}
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





