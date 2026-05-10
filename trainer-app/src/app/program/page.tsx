import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import {
  loadProgramPageData,
  type ProgramCurrentWeekPlanRow,
} from "@/lib/api/program-page";
import { CycleAnchorControls } from "@/components/CycleAnchorControls";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import { CloseoutCard } from "@/components/CloseoutCard";
import { OptionalWeekCompletion } from "@/components/OptionalWeekCompletion";
import { WeekCompletionOutlookSection } from "./WeekCompletionOutlookSection";
import { VolumeSnapshotSection } from "./VolumeSnapshotSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CURRENT_WEEK_PLAN_STATE_STYLE: Record<
  ProgramCurrentWeekPlanRow["uiState"],
  string
> = {
  completed: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
  active:
    "border-blue-300 bg-white text-blue-900 shadow-sm ring-1 ring-blue-200/80",
  planned:
    "border-blue-300 bg-white text-blue-900 shadow-sm ring-1 ring-blue-200/80",
  projected: "border-slate-200 bg-slate-50/80 text-slate-700",
  blocked: "border-rose-200 bg-rose-50/80 text-rose-800",
};

function formatBlockLabel(value: string | null): string {
  if (!value) {
    return "Program";
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatPlannedSetLabel(value: number): string {
  return `${value} ${value === 1 ? "set" : "sets"}`;
}

function formatSlotWorkoutActionLabel(slot: ProgramCurrentWeekPlanRow): string {
  if (slot.volumeBasis === "actual_completed") {
    return "Review workout";
  }

  if (slot.volumeBasis === "projected_next") {
    return `Open ${slot.label}`;
  }

  return "Open workout";
}

function formatSlotWorkoutStatusLabel(slot: ProgramCurrentWeekPlanRow): string | null {
  const status = slot.linkedWorkoutStatus?.trim();
  if (!status) {
    return null;
  }

  const label = status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  return `Workout: ${label}`;
}

function formatCompletedSlotSetSummary(
  slot: ProgramCurrentWeekPlanRow,
): string | null {
  if (slot.exerciseSource !== "linked_workout_structure") {
    return null;
  }

  const totalSets = (slot.exercises ?? []).reduce(
    (sum, exercise) => sum + exercise.setCount,
    0,
  );

  if (totalSets <= 0) {
    return null;
  }

  return `Performed: ${formatPlannedSetLabel(totalSets)}`;
}

function findTrainNextSlot(
  slots: ProgramCurrentWeekPlanRow[],
): ProgramCurrentWeekPlanRow | null {
  return (
    slots.find(
      (slot) =>
        slot.volumeBasis === "projected_next" && slot.uiState !== "completed",
    ) ?? null
  );
}

function formatTrainNextSetTotal(
  slot: ProgramCurrentWeekPlanRow,
): string | null {
  const totalSets = (slot.exercises ?? []).reduce(
    (sum, exercise) => sum + exercise.setCount,
    0,
  );

  if (totalSets <= 0) {
    return null;
  }

  return `${totalSets} planned ${totalSets === 1 ? "set" : "sets"}`;
}

function formatTrainNextExerciseOverview(
  slot: ProgramCurrentWeekPlanRow,
): string | null {
  const exercises = slot.exercises ?? [];
  if (exercises.length === 0) {
    return null;
  }

  const visibleExercises = exercises
    .slice(0, 4)
    .map((exercise) => exercise.name);
  const hiddenCount = exercises.length - visibleExercises.length;

  return `${visibleExercises.join(" + ")}${hiddenCount > 0 ? ` + ${hiddenCount} more` : ""}`;
}

function formatTrainNextSourceLabel(slot: ProgramCurrentWeekPlanRow): string {
  const linkedWorkoutStatus =
    slot.linkedWorkoutStatus?.trim().toLowerCase() ?? null;
  const isActiveWorkout =
    linkedWorkoutStatus === "in_progress" || linkedWorkoutStatus === "partial";

  switch (slot.exerciseSource) {
    case "persisted_slot_plan_seed":
      return "From your accepted plan";
    case "linked_workout_structure":
      return isActiveWorkout ? "From your active workout" : "From saved workout";
    case "projected_week_volume":
      return "Projected from remaining plan";
    case "unavailable":
      return "Exercise details unavailable";
  }
}

function formatTrainNextCtaLabel(slot: ProgramCurrentWeekPlanRow): string {
  const status = slot.linkedWorkoutStatus?.trim().toLowerCase() ?? null;

  if (status === "in_progress" || status === "partial") {
    return "Open workout";
  }

  return "Start workout";
}

function resolveTrainNextHref(slot: ProgramCurrentWeekPlanRow): string {
  return slot.linkedWorkoutId
    ? `/log/${slot.linkedWorkoutId}`
    : "/#generate-workout";
}

export default async function ProgramPage() {
  const user = await resolveOwner();
  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);

  if (pendingHandoff) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <h1 className="page-title">My Program</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Training is paused while the handoff is pending.
          </p>

          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Handoff Pending
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Meso {pendingHandoff.mesoNumber}: {pendingHandoff.focus}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Review the saved handoff recommendation, make any setup edits you
              want, then accept the next cycle to resume generation and program
              controls.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/mesocycles/${pendingHandoff.mesocycleId}/review`}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
              >
                Review handoff
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              >
                Home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const data = await loadProgramPageData(user.id);
  const currentWeekPlan = data.currentWeekPlan;
  const closeout = data.closeout;
  const activeWeekCloseout =
    closeout && closeout.isPriorWeek !== true ? closeout : null;
  const priorWeekCloseout =
    closeout && closeout.isPriorWeek === true ? closeout : null;
  const trainNextSlot = currentWeekPlan
    ? findTrainNextSlot(currentWeekPlan.slots)
    : null;
  const trainNextExercises = trainNextSlot?.exercises ?? [];
  const trainNextSetTotal = trainNextSlot
    ? formatTrainNextSetTotal(trainNextSlot)
    : null;
  const trainNextExerciseOverview = trainNextSlot
    ? formatTrainNextExerciseOverview(trainNextSlot)
    : null;
  const unavailableExerciseSlotCount =
    currentWeekPlan?.slots.filter(
      (slot) =>
        slot.uiState !== "completed" &&
        slot.volumeBasis !== "actual_completed" &&
        (slot.exercises ?? []).length === 0,
    ).length ?? 0;
  const rirTarget =
    data.overview?.rirTarget ?? data.volumeDetails.dashboard.rirTarget;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl pb-8">
        <h1 className="page-title">My Program</h1>
        <p className="mt-1.5 hidden text-sm text-slate-600 sm:block">
          Your active mesocycle, next slot, and projected week landing. Use
          History for completed sessions and Analytics for longer-term trends.
        </p>

        {data.overview ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 sm:mt-6 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Active Mesocycle
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-2xl">
                  Meso {data.overview.mesoNumber}: {data.overview.focus}
                </h2>
                <p className="mt-1.5 hidden text-sm text-slate-600 sm:mt-2 sm:block">
                  {data.overview.coachingCue}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {formatBlockLabel(data.overview.currentBlockType)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:rounded-xl sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
                  Week
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 sm:mt-2 sm:text-xl">
                  {data.overview.currentWeek} / {data.overview.durationWeeks}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:rounded-xl sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
                  Progress
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 sm:mt-2 sm:text-xl">
                  {data.overview.percentComplete}%
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:rounded-xl sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
                  Target RIR
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 sm:mt-2 sm:text-xl">
                  {data.overview.rirTarget
                    ? `${data.overview.rirTarget.min}-${data.overview.rirTarget.max} RIR`
                    : "n/a"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:rounded-xl sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
                  Deload Week
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 sm:mt-2 sm:text-xl">
                  W{data.overview.durationWeeks}
                </p>
              </div>
            </div>

            <div className="mt-3 h-2 w-full rounded-full bg-slate-200 sm:mt-5">
              <div
                className="h-2 rounded-full bg-slate-900 transition-all"
                style={{ width: `${data.overview.percentComplete}%` }}
              />
            </div>

            {data.overview.blocks.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-5 sm:gap-2">
                {data.overview.blocks.map((block) => {
                  const endWeek = block.startWeek + block.durationWeeks - 1;
                  return (
                    <span
                      key={`${block.blockType}:${block.startWeek}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {formatBlockLabel(block.blockType)} W{block.startWeek}
                      {endWeek > block.startWeek ? `-${endWeek}` : ""}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="mt-6">
            <ProgramStatusCard initialData={data.volumeDetails.dashboard} />
          </section>
        )}

        {currentWeekPlan && trainNextSlot ? (
          <section className="mt-7 rounded-3xl border-2 border-slate-900 bg-slate-950 p-5 text-white shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                  Next Workout
                </p>
                <h2
                  className="mt-1 text-2xl font-semibold"
                  id="train-next-heading"
                >
                  Train next: {trainNextSlot.label}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Week {currentWeekPlan.week} · {trainNextSlot.label}
                  {rirTarget
                    ? ` · Target ${rirTarget.min}-${rirTarget.max} RIR`
                    : ""}
                  {trainNextSetTotal ? ` · ${trainNextSetTotal}` : ""}
                </p>
              </div>
              <Link
                href={resolveTrainNextHref(trainNextSlot)}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-blue-50"
              >
                {formatTrainNextCtaLabel(trainNextSlot)}
              </Link>
            </div>

            <div
              className={
                trainNextExercises.length > 0
                  ? "mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]"
                  : "mt-5"
              }
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200">
                  Why it matters
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {trainNextSlot.impact?.summaryLabel ??
                    trainNextSlot.statusDescription}
                </p>
                {trainNextExerciseOverview ? (
                  <>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-blue-200">
                      Focus
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {trainNextExerciseOverview}
                    </p>
                  </>
                ) : null}
                <p className="mt-4 text-xs font-semibold text-blue-100">
                  {formatTrainNextSourceLabel(trainNextSlot)}
                </p>
              </div>

              {trainNextExercises.length > 0 ? (
                <div className="min-w-0 border-t border-white/15 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200">
                    Exercises
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    {trainNextExercises.map((exercise) => (
                      <div
                        key={`train-next:${trainNextSlot.slotId}:${exercise.exerciseId ?? exercise.name}`}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 truncate text-slate-100">
                          {exercise.name}
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-100">
                          {formatPlannedSetLabel(exercise.setCount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {currentWeekPlan ? (
          <section className="mt-7 rounded-3xl border-2 border-blue-200 bg-gradient-to-b from-blue-50 via-white to-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Current Week Plan
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                  This Week&apos;s Training Plan
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Train the next slot first, then use the finish projection
                  below to see how the week is likely to land.
                </p>
                {unavailableExerciseSlotCount > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Exercise details unavailable for{" "}
                    {unavailableExerciseSlotCount}{" "}
                    {unavailableExerciseSlotCount === 1 ? "slot" : "slots"}.
                  </p>
                ) : null}
              </div>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                Week {currentWeekPlan.week}
              </span>
            </div>

            <div className="mt-5 grid gap-3">
              {currentWeekPlan.slots.map((slot) => {
                const slotExercises = slot.exercises ?? [];
                const isCompletedSlot =
                  slot.uiState === "completed" ||
                  slot.volumeBasis === "actual_completed";
                const linkedWorkoutStatusLabel =
                  formatSlotWorkoutStatusLabel(slot);
                const completedSlotSetSummary =
                  isCompletedSlot ? formatCompletedSlotSetSummary(slot) : null;
                return (
                  <div
                    key={slot.slotId}
                    className={`rounded-2xl border px-4 py-4 transition-colors sm:px-5 ${CURRENT_WEEK_PLAN_STATE_STYLE[slot.uiState]}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-slate-900">
                            {slot.label}
                          </p>
                          {slot.volumeBasis === "projected_next" ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                              Next up
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Session {slot.sessionInWeek} of{" "}
                          {currentWeekPlan.slots.length}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {slot.statusDescription}
                        </p>
                        {isCompletedSlot ? (
                          <div className="mt-3 grid gap-1 text-sm text-slate-700">
                            {linkedWorkoutStatusLabel ? (
                              <p>{linkedWorkoutStatusLabel}</p>
                            ) : null}
                            {completedSlotSetSummary ? (
                              <p>{completedSlotSetSummary}</p>
                            ) : null}
                          </div>
                        ) : slotExercises.length > 0 ? (
                          <div className="mt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Exercises
                            </p>
                            <div className="mt-1.5 grid gap-1.5">
                              {slotExercises.map((exercise) => (
                                <div
                                  key={`${slot.slotId}:${exercise.exerciseId ?? exercise.name}`}
                                  className="flex items-baseline justify-between gap-3 text-sm text-slate-800"
                                >
                                  <span className="min-w-0 truncate">
                                    {exercise.name}
                                  </span>
                                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">
                                    {formatPlannedSetLabel(exercise.setCount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {!isCompletedSlot && slot.impact ? (
                          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                              If you train this slot
                            </p>
                            <p className="mt-1 text-sm font-medium text-slate-900">
                              {slot.impact.summaryLabel}
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <span className="rounded-full border border-current px-2.5 py-1 text-xs font-semibold">
                          {slot.statusLabel}
                        </span>
                        {slot.linkedWorkoutId ? (
                          <Link
                            href={`/workout/${slot.linkedWorkoutId}`}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 transition-colors hover:border-slate-400"
                          >
                            {formatSlotWorkoutActionLabel(slot)}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeWeekCloseout ? (
          <section className="mt-7">
            <OptionalWeekCompletion
              activeWeek={
                data.overview?.currentWeek ??
                data.volumeDetails.dashboard.currentWeek
              }
              customSession={activeWeekCloseout}
            />
          </section>
        ) : null}

        {priorWeekCloseout ? (
          <section className="mt-7">
            <CloseoutCard
              closeout={priorWeekCloseout}
              titleElement="h2"
              titleClassName="mt-1 text-xl font-semibold text-slate-900"
            />
          </section>
        ) : null}

        {data.weekCompletionOutlook ? (
          <WeekCompletionOutlookSection outlook={data.weekCompletionOutlook} />
        ) : null}

        {data.overview ? (
          <VolumeSnapshotSection dashboard={data.volumeDetails.dashboard} />
        ) : null}

        {data.overview ? (
          <section className="mt-8">
            <details className="rounded-2xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-slate-500">
                Advanced Cycle Actions
              </summary>
              <p className="mt-3 text-sm text-slate-600">
                Manual mesocycle adjustments live here so the main Program flow
                stays focused on understanding the active week.
              </p>
              <CycleAnchorControls
                availableActions={data.advancedActions.availableActions}
                showHeading={false}
              />
            </details>
          </section>
        ) : null}
      </div>
    </main>
  );
}
