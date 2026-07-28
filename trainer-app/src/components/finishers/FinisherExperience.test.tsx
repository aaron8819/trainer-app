import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinisherExperience } from "./FinisherExperience";
import type {
  FinisherExecutionDto,
  FinisherRoutineDto,
} from "@/lib/api/finisher-service";

const routine: FinisherRoutineDto = {
  id: "11111111-1111-4111-8111-111111111111",
  routineId: "22222222-2222-4222-8222-222222222222",
  code: "core-stability-10",
  version: 1,
  name: "Core Stability 10",
  description: "Ten controlled core movements.",
  category: "CORE",
  placement: "POST_WORKOUT",
  kind: "FINISHER",
  protocol: "TIMED_INTERVALS",
  difficulty: "MODERATE",
  fatigueCost: "MODERATE",
  impactLevel: "LOW",
  preparationSeconds: 10,
  includesFinalRecovery: true,
  durationSeconds: 600,
  equipmentRequirements: ["BODYWEIGHT"],
  bodyRegions: ["core"],
  limitationTags: [],
  warnings: [],
  steps: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      orderIndex: 0,
      movementName: "Dead Bug",
      workSeconds: 40,
      recoverySeconds: 20,
      techniqueCues: ["Slow and controlled."],
      alternatives: [],
    },
  ],
};

function offer(execution: FinisherExecutionDto | null = null) {
  return {
    routines: [routine],
    recommendation: {
      routineVersionId: routine.id,
      reason: "Low-fatigue option that has not been performed recently.",
    },
    recommendationUnavailableReason: null,
    execution,
  };
}

function execution(
  overrides: Partial<FinisherExecutionDto> = {}
): FinisherExecutionDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    workoutId: "workout-1",
    routine,
    state: "PARTIAL",
    selectedAt: "2026-07-28T12:00:00.000Z",
    startedAt: "2026-07-28T12:00:10.000Z",
    completedAt: null,
    endedAt: "2026-07-28T12:00:35.000Z",
    timer: {
      segment: "FINISHED",
      currentStepIndex: 0,
      segmentStartedAt: "2026-07-28T12:00:35.000Z",
      segmentEndsAt: "2026-07-28T12:00:35.000Z",
      pausedAt: null,
      pausedRemainingMs: null,
      revision: 3,
    },
    resolvedStepCount: 1,
    completedStepCount: 0,
    skippedStepCount: 1,
    substitutionCount: 0,
    actualDurationSeconds: 25,
    difficultyFeedback: null,
    steps: [
      {
        id: "step-execution-1",
        orderIndex: 0,
        prescribedMovement: "Dead Bug",
        performedMovement: "Dead Bug",
        status: "SKIPPED",
        startedAt: "2026-07-28T12:00:10.000Z",
        resolvedAt: "2026-07-28T12:00:35.000Z",
        actualWorkMs: 25_000,
        performedAlternativeId: null,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FinisherExperience", () => {
  it("offers a recommendation, browse, preview, and decline after completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => offer(),
      })
    );
    render(<FinisherExperience workoutId="workout-1" />);

    await waitFor(() =>
      expect(screen.getByText("Add an optional finisher?")).toBeInTheDocument()
    );
    expect(screen.getByText("Core Stability 10")).toBeInTheDocument();
    expect(screen.getByText(/already saved.*tracked separately/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Finisher preview")).toBeInTheDocument();
    expect(screen.getByText(/1\. Dead Bug/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Finish without a finisher" })
    );
    expect(screen.getByText(/No finisher was started/i)).toBeInTheDocument();
  });

  it("shows partial performance as a separate Finisher summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => offer(execution()),
      })
    );
    render(<FinisherExperience workoutId="workout-1" historyOnly />);

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Finisher summary" })).toBeInTheDocument()
    );
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText(/0 completed · 1 skipped · 0:25/)).toBeInTheDocument();
    expect(screen.getByText(/Dead Bug — skipped/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Finisher session difficulty")
    ).not.toBeInTheDocument();
  });

  it("restores a paused timer with Resume and End Finisher recovery actions", async () => {
    const paused = execution({
      state: "IN_PROGRESS",
      endedAt: null,
      resolvedStepCount: 0,
      skippedStepCount: 0,
      actualDurationSeconds: 15,
      timer: {
        segment: "WORK",
        currentStepIndex: 0,
        segmentStartedAt: "2026-07-28T12:00:10.000Z",
        segmentEndsAt: null,
        pausedAt: "2026-07-28T12:00:25.000Z",
        pausedRemainingMs: 25_000,
        revision: 4,
      },
      steps: [
        {
          id: "step-execution-1",
          orderIndex: 0,
          prescribedMovement: "Dead Bug",
          performedMovement: "Dead Bug",
          status: "PENDING",
          startedAt: "2026-07-28T12:00:10.000Z",
          resolvedAt: null,
          actualWorkMs: null,
          performedAlternativeId: null,
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => offer(paused),
      })
    );
    render(<FinisherExperience workoutId="workout-1" />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "End finisher" })).toBeInTheDocument();
    expect(screen.getByLabelText("25 seconds remaining")).toBeInTheDocument();
  });
});
