import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateServerEpochAtMonotonicOrigin,
  FinisherExperience,
} from "./FinisherExperience";
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
    serverTime: "2026-07-28T12:00:25.000Z",
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
      syncRequired: false,
      syncToken: null,
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
    timing: {
      preparationActiveMs: 10_000,
      activeWorkMs: 25_000,
      activeRecoveryMs: 0,
      preparationPausedMs: 0,
      workPausedMs: 0,
      recoveryPausedMs: 0,
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it("labels a substituted current step as partially performed without claiming completion", async () => {
    const partial = execution({
      resolvedStepCount: 1,
      completedStepCount: 0,
      skippedStepCount: 0,
      substitutionCount: 1,
      steps: [
        {
          id: "step-execution-1",
          orderIndex: 0,
          prescribedMovement: "Dead Bug",
          performedMovement: "Heel Tap Dead Bug",
          status: "PARTIAL",
          startedAt: "2026-07-28T12:00:10.000Z",
          resolvedAt: "2026-07-28T12:00:25.000Z",
          actualWorkMs: 15_000,
          performedAlternativeId:
            "55555555-5555-4555-8555-555555555555",
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => offer(partial),
      }),
    );

    render(<FinisherExperience workoutId="workout-1" />);

    await waitFor(() =>
      expect(
        screen.getByText(
          /Heel Tap Dead Bug \(for Dead Bug\) — partially performed/,
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/0 completed · 0 skipped · 1 substituted/)).toBeInTheDocument();
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
        syncRequired: false,
        syncToken: null,
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
          actualWorkMs: 0,
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

  it("aligns display time to server time independently of wall-clock skew", () => {
    const origin = estimateServerEpochAtMonotonicOrigin({
      serverTime: "2026-07-28T12:00:10.000Z",
      requestStartedAt: 1_000,
      responseReceivedAt: 1_200,
    });
    expect(origin + 1_100).toBe(
      new Date("2026-07-28T12:00:10.000Z").getTime(),
    );
    expect(origin + 6_100).toBe(
      new Date("2026-07-28T12:00:15.000Z").getTime(),
    );
  });

  it.each([
    ["materially ahead", "2036-07-28T12:00:00.000Z"],
    ["materially behind", "2016-07-28T12:00:00.000Z"],
  ])("ignores a client wall clock that is %s", (_label, clientTime) => {
    vi.useFakeTimers();
    vi.setSystemTime(clientTime);
    const origin = estimateServerEpochAtMonotonicOrigin({
      serverTime: "2026-07-28T12:00:10.000Z",
      requestStartedAt: 1_000,
      responseReceivedAt: 1_200,
    });
    expect(origin + 1_100).toBe(
      new Date("2026-07-28T12:00:10.000Z").getTime(),
    );
  });

  it("renders the routine's actual preparation duration", async () => {
    const twelveSecondPreparation = {
      ...routine,
      preparationSeconds: 12,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...offer(),
          routines: [twelveSecondPreparation],
        }),
      }),
    );
    render(<FinisherExperience workoutId="workout-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    expect(
      screen.getByText(/12-second optional preparation/),
    ).toBeInTheDocument();
  });

  it("uses a labeled modal dialog, supports Escape, and restores trigger focus", async () => {
    const running = execution({
      state: "IN_PROGRESS",
      endedAt: null,
      resolvedStepCount: 0,
      skippedStepCount: 0,
      timer: {
        segment: "WORK",
        currentStepIndex: 0,
        segmentStartedAt: "2026-07-28T12:00:10.000Z",
        segmentEndsAt: "2026-07-28T12:00:50.000Z",
        pausedAt: null,
        pausedRemainingMs: null,
        revision: 4,
        syncRequired: false,
        syncToken: null,
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
          actualWorkMs: 0,
          performedAlternativeId: null,
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => offer(running),
      }),
    );
    render(<FinisherExperience workoutId="workout-1" />);
    const trigger = await screen.findByRole("button", { name: "End finisher" });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "End this finisher as partial?",
    });
    expect(dialog).toHaveAttribute("aria-describedby", "end-finisher-description");
    expect(
      screen.getByRole("button", { name: "Continue finisher" }),
    ).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("sends at most one synchronization request for one revision boundary while the response is slow", async () => {
    const projected = execution({
      state: "IN_PROGRESS",
      endedAt: null,
      timer: {
        segment: "RECOVERY",
        currentStepIndex: 0,
        segmentStartedAt: "2026-07-28T12:00:50.000Z",
        segmentEndsAt: "2026-07-28T12:01:10.000Z",
        pausedAt: null,
        pausedRemainingMs: null,
        revision: 7,
        syncRequired: true,
        syncToken: "execution:7:WORK:boundary",
      },
    });
    let resolveSync: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => offer(projected),
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinisherExperience workoutId="workout-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      action: "sync",
      expectedRevision: 7,
    });

    resolveSync?.({
      ok: true,
      json: async () =>
        offer(
          execution({
            ...projected,
            timer: {
              ...projected.timer,
              revision: 8,
              syncRequired: false,
              syncToken: null,
            },
          }),
        ),
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument(),
    );
  });

  it("synchronizes a terminal projection when the read model requires persistence", async () => {
    const projected = execution({
      state: "COMPLETED",
      completedAt: "2026-07-28T12:01:10.000Z",
      endedAt: null,
      timer: {
        segment: "FINISHED",
        currentStepIndex: 0,
        segmentStartedAt: "2026-07-28T12:01:10.000Z",
        segmentEndsAt: "2026-07-28T12:01:10.000Z",
        pausedAt: null,
        pausedRemainingMs: null,
        revision: 7,
        syncRequired: true,
        syncToken: "execution:7:FINISHED:boundary",
      },
    });
    const persisted = execution({
      ...projected,
      timer: {
        ...projected.timer,
        revision: 8,
        syncRequired: false,
        syncToken: null,
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => offer(projected),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => offer(persisted),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<FinisherExperience workoutId="workout-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      action: "sync",
      expectedRevision: 7,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
