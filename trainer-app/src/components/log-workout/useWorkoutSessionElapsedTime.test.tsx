import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkoutSessionElapsedTime } from "@/components/log-workout/useWorkoutSessionElapsedTime";

function SessionElapsedHarness({
  active = true,
  workoutId = "workout-1",
}: {
  active?: boolean;
  workoutId?: string;
}) {
  const sessionElapsed = useWorkoutSessionElapsedTime(workoutId, active);

  return (
    <div>
      <div data-testid="elapsed-label">{sessionElapsed.elapsedLabel}</div>
      <div data-testid="started-at">{sessionElapsed.startedAtMs}</div>
    </div>
  );
}

describe("useWorkoutSessionElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tracks elapsed wall-clock time for the active workout session", () => {
    render(<SessionElapsedHarness />);

    expect(screen.getByTestId("elapsed-label")).toHaveTextContent("0:00");

    act(() => {
      vi.setSystemTime(new Date("2026-01-01T12:01:05.000Z"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(screen.getByTestId("elapsed-label")).toHaveTextContent("1:05");
  });

  it("restores the same session start after remount in the current tab", () => {
    const { unmount } = render(<SessionElapsedHarness />);
    const startedAt = screen.getByTestId("started-at").textContent;

    unmount();
    vi.setSystemTime(new Date("2026-01-01T12:05:00.000Z"));
    render(<SessionElapsedHarness />);

    expect(screen.getByTestId("started-at")).toHaveTextContent(startedAt ?? "");
    expect(screen.getByTestId("elapsed-label")).toHaveTextContent("5:00");
  });

  it("does not advance while inactive", () => {
    render(<SessionElapsedHarness active={false} />);

    act(() => {
      vi.setSystemTime(new Date("2026-01-01T12:01:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId("elapsed-label")).toHaveTextContent("0:00");
  });
});
