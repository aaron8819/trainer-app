import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as workoutApi from "@/components/log-workout/api";
import { useWorkoutSessionCompletion } from "@/components/log-workout/useWorkoutSessionCompletion";
import type { SaveWorkoutResponse, WorkoutStatus } from "@/lib/api/workout-save-contract";

vi.mock("@/components/log-workout/api", () => ({
  saveWorkoutRequest: vi.fn(),
}));

const mockedSaveWorkoutRequest = vi.mocked(workoutApi.saveWorkoutRequest);

type CompletionHarnessCallbacks = {
  clearAllDrafts: () => void;
  clearTimer: () => void;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showStatus: (message: string) => void;
  clearAllDraftsSpy: ReturnType<typeof vi.fn>;
  clearTimerSpy: ReturnType<typeof vi.fn>;
  clearFeedbackSpy: ReturnType<typeof vi.fn>;
  showErrorSpy: ReturnType<typeof vi.fn>;
  showStatusSpy: ReturnType<typeof vi.fn>;
};

function CompletionHarness({
  callbacks,
  totalSets = 2,
  completedSetCount = 1,
  skippedSetCount = 1,
}: {
  callbacks: CompletionHarnessCallbacks;
  totalSets?: number;
  completedSetCount?: number;
  skippedSetCount?: number;
}) {
  const completion = useWorkoutSessionCompletion({
    workoutId: "workout-1",
    totalSets,
    completedSetCount,
    skippedSetCount,
    clearAllDrafts: callbacks.clearAllDrafts,
    clearTimer: callbacks.clearTimer,
    clearFeedback: callbacks.clearFeedback,
    showError: callbacks.showError,
    showStatus: callbacks.showStatus,
  });

  return (
    <div>
      <button onClick={() => completion.openConfirm("mark_completed")} type="button">
        open-complete
      </button>
      <button onClick={() => completion.setSkipReason("Travel")} type="button">
        set-skip-reason
      </button>
      <button onClick={() => completion.toggleSkipOptions()} type="button">
        toggle-skip
      </button>
      <button onClick={() => void completion.run("mark_completed")} type="button">
        complete
      </button>
      <button onClick={() => void completion.run("mark_partial")} type="button">
        partial
      </button>
      <button onClick={() => void completion.run("mark_skipped")} type="button">
        skip
      </button>
      <div data-testid="completion-action">{completion.state.completionAction ?? ""}</div>
      <div data-testid="skip-reason">{completion.state.skipReason}</div>
      <div data-testid="show-skip">{String(completion.state.showSkipOptions)}</div>
      <div data-testid="terminal-state">{completion.state.terminalState}</div>
      <div data-testid="pending">{String(completion.pending)}</div>
      <div data-testid="clear-drafts">{String(callbacks.clearAllDraftsSpy.mock.calls.length)}</div>
      <div data-testid="clear-timer">{String(callbacks.clearTimerSpy.mock.calls.length)}</div>
      <div data-testid="clear-feedback">{String(callbacks.clearFeedbackSpy.mock.calls.length)}</div>
      <div data-testid="show-error">{callbacks.showErrorSpy.mock.calls[0]?.[0] ?? ""}</div>
      <div data-testid="show-status">{callbacks.showStatusSpy.mock.calls[0]?.[0] ?? ""}</div>
    </div>
  );
}

function createCallbacks(): CompletionHarnessCallbacks {
  const clearAllDraftsSpy = vi.fn();
  const clearTimerSpy = vi.fn();
  const clearFeedbackSpy = vi.fn();
  const showErrorSpy = vi.fn();
  const showStatusSpy = vi.fn();

  return {
    clearAllDrafts: () => clearAllDraftsSpy(),
    clearTimer: () => clearTimerSpy(),
    clearFeedback: () => clearFeedbackSpy(),
    showError: (message) => showErrorSpy(message),
    showStatus: (message) => showStatusSpy(message),
    clearAllDraftsSpy,
    clearTimerSpy,
    clearFeedbackSpy,
    showErrorSpy,
    showStatusSpy,
  };
}

function makeSaveWorkoutResponse(
  workoutStatus: WorkoutStatus,
  overrides: Partial<SaveWorkoutResponse & { baselineSummary?: unknown }> = {}
) : Awaited<ReturnType<typeof workoutApi.saveWorkoutRequest>> {
  const action: SaveWorkoutResponse["action"] =
    workoutStatus === "SKIPPED"
      ? "mark_skipped"
      : workoutStatus === "PARTIAL"
        ? "mark_partial"
        : "mark_completed";

  return {
    data: {
      status: "saved",
      workoutId: "workout-1",
      revision: 1,
      workoutStatus,
      action,
      ...overrides,
    },
    error: null,
  };
}

describe("useWorkoutSessionCompletion", () => {
  beforeEach(() => {
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("owns terminal completion state without showing the removed baseline summary card path", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("COMPLETED", {
        baselineSummary: {
          context: "post-workout",
          evaluatedExercises: 1,
          updated: 1,
          skipped: 0,
          items: [{ exerciseName: "Bench", newTopSetWeight: 55, reps: 11 }],
          skippedItems: [],
        },
      })
    );

    render(<CompletionHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "open-complete" }));
    fireEvent.click(screen.getByRole("button", { name: "complete" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_completed",
          status: "COMPLETED",
        })
      );
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("completed");
      expect(screen.getByTestId("clear-drafts")).toHaveTextContent("1");
      expect(screen.getByTestId("clear-timer")).toHaveTextContent("1");
      expect(screen.getByTestId("show-status")).toHaveTextContent("Workout marked as completed");
    });
  });

  it("owns skip confirmation state and submits skip reason", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("SKIPPED", { action: "mark_skipped" })
    );

    render(<CompletionHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "toggle-skip" }));
    fireEvent.click(screen.getByRole("button", { name: "set-skip-reason" }));
    fireEvent.click(screen.getByRole("button", { name: "skip" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "mark_skipped",
          status: "SKIPPED",
          notes: "Skipped: Travel",
        })
      );
      expect(screen.getByTestId("show-skip")).toHaveTextContent("false");
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("skipped");
      expect(screen.getByTestId("show-status")).toHaveTextContent("Workout marked as skipped");
    });
  });

  it("keeps the session active for partial saves", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("PARTIAL", { action: "mark_partial" })
    );

    render(<CompletionHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "partial" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_partial",
          status: "PARTIAL",
        })
      );
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("active");
      expect(screen.getByTestId("clear-drafts")).toHaveTextContent("0");
      expect(screen.getByTestId("clear-timer")).toHaveTextContent("1");
      expect(screen.getByTestId("show-status")).toHaveTextContent(
        "Workout saved as partial (some planned sets were unresolved)"
      );
    });
  });

  it("keeps the session active when mark_completed persists as partial", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("PARTIAL", { action: "mark_completed" })
    );

    render(<CompletionHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "complete" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_completed",
          status: "COMPLETED",
        })
      );
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("active");
      expect(screen.getByTestId("clear-drafts")).toHaveTextContent("0");
      expect(screen.getByTestId("clear-timer")).toHaveTextContent("1");
      expect(screen.getByTestId("show-status")).toHaveTextContent(
        "Workout saved as partial (some planned sets were unresolved)"
      );
    });
  });

  it("maps all-skipped completion to mark_skipped", async () => {
    const callbacks = createCallbacks();

    render(
      <CompletionHarness
        callbacks={callbacks}
        totalSets={2}
        completedSetCount={0}
        skippedSetCount={2}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "open-complete" }));

    expect(screen.getByTestId("completion-action")).toHaveTextContent("mark_skipped");

    fireEvent.click(screen.getByRole("button", { name: "complete" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_skipped",
          status: "SKIPPED",
        })
      );
    });
  });
});
