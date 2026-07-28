import Link from "next/link";
import { DashboardGenerateSection } from "@/components/DashboardGenerateSection";
import HistoryClient from "@/components/HistoryClient";
import LogWorkoutClient from "@/components/LogWorkoutClient";
import { PlanManagementClient } from "@/components/plans/PlanManagementClient";
import { PlanReviewView } from "@/components/plans/PlanReviewView";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import RecentWorkouts from "@/components/RecentWorkouts";
import type {
  LogExerciseInput,
  LogWorkoutCapabilities,
  SectionedExercises,
} from "@/components/log-workout/types";
import type {
  UiAuditFixture,
} from "@/lib/ui-audit-fixtures/fixtures";

const UI_AUDIT_TIMER_STARTED_AT_MS = Date.now();

type SessionIntent =
  | "push"
  | "pull"
  | "legs"
  | "upper"
  | "lower"
  | "full_body"
  | "body_part";

function isSessionIntent(value: string | null | undefined): value is SessionIntent {
  return (
    value === "push" ||
    value === "pull" ||
    value === "legs" ||
    value === "upper" ||
    value === "lower" ||
    value === "full_body" ||
    value === "body_part"
  );
}

function FixtureHome({ fixture }: { fixture: UiAuditFixture }) {
  const home = fixture.home;
  if (!home) {
    return <FixtureUnavailable label="Home" />;
  }
  if (home.pendingHandoff) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <header className="mb-8 md:mb-10">
            <p className="text-sm uppercase tracking-wide text-slate-500">
              Personal AI Trainer
            </p>
            <h1 className="page-title mt-2">Mesocycle Handoff</h1>
            <p className="mt-2 text-sm text-slate-500">
              {home.headerContext}
            </p>
          </header>
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Action Required
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Meso {home.pendingHandoff.mesoNumber}:{" "}
              {home.pendingHandoff.focus}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Training is paused. Review and accept your next cycle to
              continue.
            </p>
          </section>
          <RecentWorkouts
            recentWorkouts={home.recentActivity}
            heading="Recent Activity"
            showCount={false}
            showDeleteActions={false}
            viewAllLabel="Open History"
          />
        </div>
      </main>
    );
  }

  const action = home.primaryAction;
  const decision = home.decision;
  const homeProgram = home.homeProgram;
  if (!action || !decision || !homeProgram) {
    return <FixtureUnavailable label="Home" />;
  }
  const generationAction =
    action.state === "planned" && action.mode === "generate"
      ? action
      : null;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">
            Personal AI Trainer
          </p>
          <h1 className="page-title mt-2">Today&apos;s Training</h1>
          <p className="mt-2 text-sm text-slate-500">
            {home.headerContext}
          </p>
        </header>

        <section className="space-y-6">
          {generationAction ? (
            <DashboardGenerateSection
              initialIntent={
                isSessionIntent(generationAction.initialIntent)
                  ? generationAction.initialIntent
                  : undefined
              }
              initialSlotId={generationAction.initialSlotId}
              eligibleAlternativeSessions={
                homeProgram.eligibleAlternativeSessions
              }
              primaryAction={{
                label: generationAction.label,
                state: "planned",
                mode: "generate",
              }}
              nextSessionLabel={decision.nextSessionLabel}
              nextSessionDescription={decision.nextSessionDescription}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Today&apos;s Action
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{action.label}</h2>
              {"reasonLabel" in action && action.reasonLabel ? (
                <p className="mt-2 text-sm font-medium text-slate-800">
                  {action.reasonLabel}
                </p>
              ) : null}
              {"reason" in action && action.reason ? (
                <p className="mt-2 text-slate-600">{action.reason}</p>
              ) : null}
              {"href" in action && action.href ? (
                <Link
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                  href={action.href}
                >
                  {action.label}
                </Link>
              ) : null}
            </div>
          )}
        </section>

        {decision.activeWeekLabel ? (
          <section className="mt-8 rounded-2xl border border-slate-200 p-5 md:mt-10">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Active Week
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {decision.activeWeekLabel}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Next due: {decision.nextSessionLabel ?? "No next session"}
            </p>
          </section>
        ) : null}

        {home.programData ? (
          <section className="mt-8 md:mt-10">
            <ProgramStatusCard
              initialData={home.programData}
              variant="homeCompact"
            />
          </section>
        ) : null}

        <RecentWorkouts
          recentWorkouts={home.recentActivity}
          heading="Recent Activity"
          showCount={false}
          showDeleteActions={false}
          viewAllLabel="Open History"
        />
      </div>
    </main>
  );
}

function FixtureProgram({ fixture }: { fixture: UiAuditFixture }) {
  const program = fixture.program;
  if (!program) {
    return <FixtureUnavailable label="Program" />;
  }
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">
            Training overview
          </p>
          <h1 className="page-title mt-2">My Program</h1>
          <p className="mt-2 text-sm text-slate-600">
            Current block, weekly progress, and planned session context.
          </p>
        </header>
        <ProgramStatusCard
          initialData={program.volumeDetails.dashboard}
          variant="default"
        />
        {program.currentWeekPlan?.slots?.length ? (
          <section className="mt-8 rounded-2xl border border-slate-200 p-5">
            <h2 className="text-lg font-semibold">Current week</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {program.currentWeekPlan.slots.map((slot) => (
                <article
                  key={slot.slotId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="font-semibold">{slot.label}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {slot.statusDescription}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function FixtureHistory({ fixture }: { fixture: UiAuditFixture }) {
  const history = fixture.history;
  if (!history) {
    return <FixtureUnavailable label="History" />;
  }
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <h1 className="page-title">Workout History</h1>
          <p className="mt-2 text-slate-600">
            Browse completed Hypertrophy and Strength sessions.
          </p>
        </header>
        <HistoryClient
          initialWorkouts={history.initialWorkouts}
          initialNextCursor={history.initialNextCursor}
          initialTotalCount={history.initialTotalCount}
          mesocycles={history.mesocycles}
        />
      </div>
    </main>
  );
}

function FixturePlans({ fixture }: { fixture: UiAuditFixture }) {
  if (!fixture.plans) {
    return <FixtureUnavailable label="Plans" />;
  }
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl pb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Plan management
        </p>
        <h1 className="page-title mt-2">Training plans</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Create and review hypertrophy or strength plans, then explicitly
          choose which READY plan drives your training.
        </p>
        <PlanManagementClient initialData={fixture.plans} />
      </div>
    </main>
  );
}

function countResolvedSets(exercise: LogExerciseInput): number {
  return exercise.sets.filter(
    (set) =>
      set.wasSkipped === true ||
      set.actualReps != null ||
      set.actualLoad != null ||
      set.actualRpe != null,
  ).length;
}

function attachCapabilities(
  exercises: SectionedExercises,
  capabilities: LogWorkoutCapabilities,
): SectionedExercises {
  const attach = (exercise: LogExerciseInput): LogExerciseInput => ({
    ...exercise,
    capabilities: {
      canAddSet: capabilities.canAddSet,
      canRemove:
        capabilities.canRemoveSet &&
        (exercise.isRuntimeAdded ?? false) &&
        countResolvedSets(exercise) === 0,
      canSwap:
        capabilities.canSwapExercise &&
        countResolvedSets(exercise) === 0 &&
        !(exercise.isSwapped ?? false),
    },
  });
  return {
    warmup: exercises.warmup?.map(attach) ?? [],
    main: exercises.main.map(attach),
    accessory: exercises.accessory?.map(attach) ?? [],
  };
}

function FixtureLog({
  fixture,
  workoutId,
}: {
  fixture: UiAuditFixture;
  workoutId: string;
}) {
  const workout = fixture.logWorkouts?.[workoutId];
  if (!workout) {
    return <FixtureUnavailable label="Workout Log" />;
  }
  const capabilities: LogWorkoutCapabilities = {
    canAddSet: true,
    canRemoveSet: true,
    canSwapExercise: true,
    canAddExercise: true,
    canFinish: true,
    showWeeklyCheck: true,
  };
  const timerDuration = workout.initialRestTimerDurationSeconds;
  const startedAtMs = timerDuration ? UI_AUDIT_TIMER_STARTED_AT_MS : null;
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <div>
          <h1 className="page-title">Workout Log</h1>
          <p className="mt-1 text-sm text-slate-600">
            {workout.sessionIdentityLabel}
          </p>
        </div>
        <LogWorkoutClient
          workoutId={workout.workoutId}
          initialRevision={1}
          exercises={attachCapabilities(workout.exercises, capabilities)}
          allowBonusExerciseAdd={true}
          allowRuntimeExerciseSwap={true}
          capabilities={capabilities}
          initialRestTimer={
            timerDuration && startedAtMs
              ? {
                  startedAtMs,
                  endAtMs: startedAtMs + timerDuration * 1000,
                }
              : null
          }
          sessionIdentityLabel={workout.sessionIdentityLabel}
          sessionTechnicalLabel={workout.sessionTechnicalLabel}
        />
      </div>
    </main>
  );
}

function FixtureUnavailable({ label }: { label: string }) {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <h1 className="page-title">{label}</h1>
        <p className="mt-2 text-sm text-slate-600">
          This deterministic audit scenario has no data for this surface.
        </p>
      </div>
    </main>
  );
}

export function UiAuditFixturePage({
  pathname,
  fixture,
}: {
  pathname: string;
  fixture: UiAuditFixture;
}) {
  if (pathname === "/") return <FixtureHome fixture={fixture} />;
  if (pathname === "/program") return <FixtureProgram fixture={fixture} />;
  if (pathname === "/history") return <FixtureHistory fixture={fixture} />;
  if (pathname === "/plans") return <FixturePlans fixture={fixture} />;
  if (pathname === "/analytics") {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <h1 className="page-title">Analytics</h1>
          <p className="mt-2 text-slate-600">
            Deterministic weekly volume and recovery fixture.
          </p>
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            {Object.entries(
              fixture.analytics?.volume.landmarks ?? {},
            ).map(([muscle, landmarks]) => (
              <article
                key={muscle}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <h2 className="font-semibold">{muscle}</h2>
                <p className="mt-2 text-sm text-slate-600">
                  MEV {landmarks.mev} · MAV {landmarks.mav} · MRV{" "}
                  {landmarks.mrv}
                </p>
              </article>
            ))}
          </section>
        </div>
      </main>
    );
  }
  if (pathname === "/settings") {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
          <h1 className="page-title">Settings</h1>
          <p className="mt-2 text-slate-600">
            Profile and training preferences are represented by a read-only
            browser fixture.
          </p>
        </div>
      </main>
    );
  }

  const reviewMatch = pathname.match(/^\/plans\/([^/]+)\/review\/?$/);
  if (reviewMatch?.[1]) {
    const plan = fixture.planReviews?.[reviewMatch[1]];
    return plan ? (
      <PlanReviewView plan={plan} />
    ) : (
      <FixtureUnavailable label="Plan review" />
    );
  }
  const logMatch = pathname.match(/^\/log\/([^/]+)\/?$/);
  if (logMatch?.[1]) {
    return <FixtureLog fixture={fixture} workoutId={logMatch[1]} />;
  }
  return <FixtureUnavailable label="UI audit fixture" />;
}
