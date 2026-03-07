import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRestTimerState } from "@/components/log-workout/useRestTimerState";

function RestTimerStateHarness() {
  const { restTimer, startTimer } = useRestTimerState("workout-1");

  return (
    <div>
      <button onClick={() => startTimer(90)} type="button">
        start
      </button>
      <div data-testid="timer-running">{String(restTimer !== null)}</div>
      <div data-testid="timer-end">{restTimer?.endAtMs ?? ""}</div>
    </div>
  );
}

describe("useRestTimerState", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("re-syncs an active timer when the page becomes visible again", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    render(<RestTimerStateHarness />);

    fireEvent.click(screen.getByRole("button", { name: "start" }));

    await waitFor(() => {
      expect(screen.getByTestId("timer-running")).toHaveTextContent("true");
      expect(screen.getByTestId("timer-end")).toHaveTextContent("91000");
    });

    nowSpy.mockReturnValue(5000);
    window.sessionStorage.setItem(
      "workout_rest_timer_workout-1",
      JSON.stringify({ startedAtMs: 5000, endAtMs: 65000 })
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByTestId("timer-end")).toHaveTextContent("65000");
    });
  });
});
