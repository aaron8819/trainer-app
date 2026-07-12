import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadMesocycleReviewFromPrisma: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => mocks.notFound(...args),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-review", () => ({
  buildMesocycleReviewPlainEnglishSummary: () => "5 weeks closed â€¢ 9 sessions finished â€¢ core adherence 89%",
  loadMesocycleReviewFromPrisma: (...args: unknown[]) =>
    mocks.loadMesocycleReviewFromPrisma(...args),
}));

function buildReview(overrides?: Record<string, unknown>) {
  return {
    mesocycleId: "meso-1",
    mesoNumber: 3,
    focus: "Upper Hypertrophy",
    closedAt: "2026-04-01T00:00:00.000Z",
    archive: {
      currentState: "AWAITING_HANDOFF",
      reviewState: "pending_handoff",
      isEditableHandoff: true,
    },
    frozenSummary: {
      lifecycle: {
        durationWeeks: 5,
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
      },
      closedAt: "2026-04-01T00:00:00.000Z",
      training: {
        focus: "Upper Hypertrophy",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
      },
      carryForwardRecommendations: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sessionIntent: "UPPER",
          role: "CORE_COMPOUND",
          recommendation: "keep",
        },
        {
          exerciseId: "row",
          exerciseName: "Chest-Supported Row",
          sessionIntent: "UPPER",
          role: "ACCESSORY",
          recommendation: "rotate",
        },
      ],
      recommendedNextSeed: {
        structure: {
          splitType: "UPPER_LOWER",
          sessionsPerWeek: 4,
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "lower_a", intent: "LOWER" },
          ],
        },
        carryForwardSelections: [{ action: "keep" }],
      },
    },
    recommendation: {
      summary:
        "4x/week Upper / Lower. This frozen recommendation is the evidence-based design baseline saved at handoff close.",
      structureReasons: ["Upper / lower was selected for a four-plus-session schedule."],
      carryForwardSummary: "Carry-forward decisions at handoff: 1 keep, 1 rotate, 0 drop.",
      slotOrderSummary:
        "Ordered-flexible keeps the slot order fixed while still allowing week-to-week scheduling flexibility.",
      startingPointSummary:
        "The next cycle re-enters accumulation from a conservative baseline chosen from the closeout evidence, rather than carrying deload forward.",
      startingPointReasons: ["The next cycle re-enters accumulation conservatively after the deload boundary."],
    },
    closeout: {
      kind: "completed_with_deload",
      plannedDurationWeeks: 5,
      plannedAccumulationWeeks: 4,
      performedTrainingWeeks: 5,
      unperformedPlannedWeeks: 0,
      accumulationSessionsCompleted: 8,
      deloadSessionsCompleted: 1,
      deloadPerformed: true,
    },
    derived: {
      scopedWorkoutCount: 10,
      performedWorkoutCount: 9,
      adherence: {
        plannedSessions: 9,
        performedSessions: 8,
        coreCompletedSessions: 7,
        partialSessions: 1,
        skippedSessions: 1,
        adherenceRate: 0.889,
        completionRate: 0.778,
        optionalPerformedSessions: 1,
      },
      weeklyBreakdown: [
        { week: 1, phase: "ACCUMULATION", plannedSessions: 2, performedSessions: 2 },
        { week: 5, phase: "DELOAD", plannedSessions: 1, performedSessions: 1 },
      ],
      topProgressedExercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sessionIntent: "UPPER",
          exposureCount: 3,
          signal: "estimated_strength",
          changePct: 0.08,
          summary: "Estimated strength up 8% across 3 exposures.",
          latestBestSet: "8 reps @ 110 lb @ RPE 8",
        },
      ],
      muscleVolumeSummary: [
        {
          muscle: "Chest",
          targetSets: 40,
          actualEffectiveSets: 42,
          delta: 2,
          percentDelta: 0.05,
          status: "on_target",
          topContributors: [{ exerciseName: "Bench Press", effectiveSets: 20 }],
        },
      ],
      weeklyRetroCalibration: {
        status: "watch",
        headline: "Repeated under-plan execution",
        detail:
          "2 rows came in under the written plan. Review evidence only; no automatic plan change.",
        bullets: ["2 under plan", "No seed or plan changes made"],
        rowCount: 2,
        patternCount: 1,
        source: {
          ownerSeam: "api/mesocycle-review",
          contractOwnerSeam: "api/weekly-retro-calibration-contract",
          readOnly: true,
          evidenceOnly: true,
          noMutationNote: "No seed or plan changes made",
        },
      },
    },
    ...overrides,
  };
}

describe("MesocycleReviewPage", () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadMesocycleReviewFromPrisma.mockResolvedValue(buildReview());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders saved handoff facts and live-derived mesocycle review sections", async () => {
    const { default: MesocycleReviewPage } = await import("./page");
    const ui = await MesocycleReviewPage({ params: Promise.resolve({ id: "meso-1" }) });

    render(ui);

    expect(screen.getByRole("heading", { name: "Meso 3 complete" })).toBeInTheDocument();
    expect(screen.getByText("Pending Handoff Review")).toBeInTheDocument();
    expect(screen.getAllByText("Saved handoff summary")).toHaveLength(2);
    expect(screen.getAllByText("Closeout analysis")).toHaveLength(2);
    expect(
      screen.getByText(/They do not change the saved recommendation saved at handoff/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Execution calibration" })).toBeInTheDocument();
    expect(screen.getByText("Repeated under-plan execution")).toBeInTheDocument();
    expect(screen.getByText("2 under plan")).toBeInTheDocument();
    expect(screen.getByText(/2 performed-reality rows/i)).toBeInTheDocument();
    expect(screen.getAllByText("Bench Press").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/This saved recommendation is the evidence-based design baseline saved at handoff close/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Carry-forward policy decisions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review and edit next-cycle setup" })).toHaveAttribute(
      "href",
      "/mesocycles/meso-1/setup"
    );
  });

  it("keeps completed closeouts reviewable without exposing the editable handoff CTA", async () => {
    mocks.loadMesocycleReviewFromPrisma.mockResolvedValueOnce(
      buildReview({
        archive: {
          currentState: "COMPLETED",
          reviewState: "historical_closeout",
          isEditableHandoff: false,
        },
      })
    );

    const { default: MesocycleReviewPage } = await import("./page");
    const ui = await MesocycleReviewPage({ params: Promise.resolve({ id: "meso-1" }) });

    render(ui);

    expect(screen.getByText("Historical Closeout Archive")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review and edit next-cycle setup" })).not.toBeInTheDocument();
    expect(screen.getByText(/editable handoff workflow is no longer available/i)).toBeInTheDocument();
  });

  it("renders an early accumulation closeout without claiming completion or deload", async () => {
    mocks.loadMesocycleReviewFromPrisma.mockResolvedValueOnce(
      buildReview({
        closeout: {
          kind: "ended_early_during_accumulation",
          plannedDurationWeeks: 5,
          plannedAccumulationWeeks: 4,
          performedTrainingWeeks: 3,
          unperformedPlannedWeeks: 2,
          accumulationSessionsCompleted: 11,
          deloadSessionsCompleted: 0,
          deloadPerformed: false,
        },
      })
    );

    const { default: MesocycleReviewPage } = await import("./page");
    const ui = await MesocycleReviewPage({ params: Promise.resolve({ id: "meso-1" }) });
    render(ui);

    expect(screen.getByRole("heading", { name: "Meso 3 ended early" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cycle ended early during accumulation" })).toBeInTheDocument();
    expect(screen.getByText("The training break is not recorded as a deload")).toBeInTheDocument();
    expect(screen.getByText(/3 of 5 planned training weeks/i)).toBeInTheDocument();
    expect(screen.queryByText("Deload Complete")).not.toBeInTheDocument();
  });

  it("hides weekly calibration when the read model has no useful evidence", async () => {
    mocks.loadMesocycleReviewFromPrisma.mockResolvedValueOnce(
      buildReview({
        derived: {
          ...buildReview().derived,
          weeklyRetroCalibration: null,
        },
      })
    );

    const { default: MesocycleReviewPage } = await import("./page");
    const ui = await MesocycleReviewPage({ params: Promise.resolve({ id: "meso-1" }) });

    render(ui);

    expect(screen.queryByRole("heading", { name: "Execution calibration" })).not.toBeInTheDocument();
    expect(screen.queryByText(/performed-reality rows/i)).not.toBeInTheDocument();
  });
});
