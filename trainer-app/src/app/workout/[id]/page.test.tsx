import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  generateWorkoutExplanation: vi.fn(),
  workoutFindFirst: vi.fn(),
  injuryFindMany: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/explainability", () => ({
  generateWorkoutExplanation: (...args: unknown[]) => mocks.generateWorkoutExplanation(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
    },
    injury: {
      findMany: (...args: unknown[]) => mocks.injuryFindMany(...args),
    },
  },
}));

describe("WorkoutDetailPage", { timeout: 15000 }, () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.generateWorkoutExplanation.mockResolvedValue({ error: "unavailable" });
    mocks.injuryFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(["PLANNED", "COMPLETED"])("renders the audit entry point for %s workouts", async (status) => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status,
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PUSH",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/workout/workout-1/audit");
  });

  it("renders a partial-specific title when the workout is reviewable and resumable", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "PARTIAL",
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PUSH",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Partial Session")).toBeInTheDocument();
  });

  it("renders the post-workout insights hierarchy for performed workouts", async () => {
    mocks.generateWorkoutExplanation.mockResolvedValue({
      confidence: { level: "high", summary: "ok", missingSignals: [] },
      sessionContext: {
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 4,
          totalWeeksInBlock: 4,
          primaryGoal: "build",
        },
        volumeStatus: { muscleStatuses: new Map(), overallSummary: "ok" },
        readinessStatus: {
          overall: "moderate",
          signalAge: 0,
          availability: "recent",
          label: "Recent readiness",
          perMuscleFatigue: new Map(),
          sorenessSuppressedMuscles: [],
          adaptations: [],
        },
        progressionContext: {
          weekInMesocycle: 4,
          volumeProgression: "building",
          intensityProgression: "ramping",
          nextMilestone: "deload next",
        },
        cycleSource: "computed",
        narrative: "narrative",
      },
      coachMessages: [],
      exerciseRationales: new Map(),
      prescriptionRationales: new Map(),
      progressionReceipts: new Map([
        [
          "lat-pull",
          {
            lastPerformed: {
              reps: 12,
              load: 35,
              rpe: 8,
              performedAt: "2026-02-18T00:00:00.000Z",
            },
            todayPrescription: { reps: 10, load: 40, rpe: 8 },
            delta: { load: 5, loadPercent: 14.2857, reps: -2, rpe: 0 },
            trigger: "double_progression",
            decisionLog: [],
          },
        ],
      ]),
      nextExposureDecisions: new Map([
        [
          "lat-pull",
          {
            action: "hold",
            summary: "Next exposure: hold load for now.",
            reason:
              "Median reps stayed at 8 in the 8-12 band, so keep building reps before adding load.",
            anchorLoad: 40,
            repRange: { min: 8, max: 12 },
            modalRpe: 8,
            medianReps: 8,
          },
        ],
      ]),
      filteredExercises: [],
      volumeCompliance: [
        {
          muscle: "Lats",
          performedEffectiveVolumeBeforeSession: 6,
          plannedEffectiveVolumeThisSession: 4,
          projectedEffectiveVolume: 10,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          status: "ON_TARGET",
        },
      ],
    });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PULL",
      exercises: [
        {
          id: "we-1",
          orderIndex: 0,
          exerciseId: "lat-pull",
          isMainLift: true,
          section: "MAIN",
          exercise: {
            name: "Lat Pulldown",
            jointStress: "MEDIUM",
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 40,
              targetRpe: 8,
              logs: [{ actualReps: 8, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Session outcome")).toBeInTheDocument();
    expect(
      screen.getByText("Key lifts stayed on track, but nothing clearly earned a load jump yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("Key lift takeaways")).toBeInTheDocument();
    expect(screen.getByText("Today's target context")).toBeInTheDocument();
    expect(screen.getByText(/Next exposure: hold load for now\./)).toBeInTheDocument();
    expect(screen.getAllByText("Program impact")).toHaveLength(1);
  });
});
