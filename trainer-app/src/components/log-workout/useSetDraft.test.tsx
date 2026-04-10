import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSetDraft } from "@/components/log-workout/useSetDraft";
import type { SetDraftBuffers } from "@/components/log-workout/types";

const WORKOUT_ID = "workout-1";
const SET_ID = "set-1";

function readStoredDraft(workoutId = WORKOUT_ID, setId = SET_ID) {
  const value = window.localStorage.getItem(`draft_set_${workoutId}_${setId}`);
  return value ? (JSON.parse(value) as { reps: string; load: string; rpe: string; savedAt: number }) : null;
}

function SetDraftHarness({
  workoutId = WORKOUT_ID,
  setIds = [SET_ID],
}: {
  workoutId?: string;
  setIds?: string[];
}) {
  const [restoredDrafts, setRestoredDrafts] = useState<Record<string, SetDraftBuffers>>({});
  const { saveDraft } = useSetDraft({
    workoutId,
    setIds,
    onRestore: (setId, draft) => {
      setRestoredDrafts((prev) => ({ ...prev, [setId]: draft }));
    },
  });

  return (
    <div>
      <input aria-label="Draft input" />
      <button
        onClick={() =>
          saveDraft(SET_ID, {
            reps: "10",
            load: "100",
            rpe: "8",
          })
        }
        type="button"
      >
        save-first
      </button>
      <button
        onClick={() =>
          saveDraft(SET_ID, {
            reps: "11",
            load: "105",
            rpe: "8.5",
          })
        }
        type="button"
      >
        save-latest
      </button>
      <div data-testid="restored-draft">{JSON.stringify(restoredDrafts[SET_ID] ?? null)}</div>
    </div>
  );
}

describe("useSetDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T10:00:00.000Z"));
    window.localStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the debounced write path and restores saved drafts on remount", () => {
    const initialRender = render(<SetDraftHarness />);

    fireEvent.click(screen.getByRole("button", { name: "save-first" }));

    expect(readStoredDraft()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(readStoredDraft()).toMatchObject({
      reps: "10",
      load: "100",
      rpe: "8",
    });

    initialRender.unmount();
    render(<SetDraftHarness />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByTestId("restored-draft")).toHaveTextContent(
      JSON.stringify({ reps: "10", load: "100", rpe: "8" })
    );
  });

  it("flushes a pending draft on input blur without leaving a trailing timer write", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<SetDraftHarness />);

    fireEvent.click(screen.getByRole("button", { name: "save-latest" }));
    fireEvent.focusOut(screen.getByLabelText("Draft input"));

    expect(readStoredDraft()).toMatchObject({
      reps: "11",
      load: "105",
      rpe: "8.5",
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending draft when the page becomes hidden", () => {
    render(<SetDraftHarness />);

    fireEvent.click(screen.getByRole("button", { name: "save-latest" }));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));

    expect(readStoredDraft()).toMatchObject({
      reps: "11",
      load: "105",
      rpe: "8.5",
    });
  });

  it("flushes a pending draft on pagehide", () => {
    render(<SetDraftHarness />);

    fireEvent.click(screen.getByRole("button", { name: "save-latest" }));
    fireEvent(window, new Event("pagehide"));

    expect(readStoredDraft()).toMatchObject({
      reps: "11",
      load: "105",
      rpe: "8.5",
    });
  });

  it("flushes a pending draft during unmount so the latest edit restores after remount", () => {
    const initialRender = render(<SetDraftHarness />);

    fireEvent.click(screen.getByRole("button", { name: "save-latest" }));
    initialRender.unmount();

    expect(readStoredDraft()).toMatchObject({
      reps: "11",
      load: "105",
      rpe: "8.5",
    });

    render(<SetDraftHarness />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByTestId("restored-draft")).toHaveTextContent(
      JSON.stringify({ reps: "11", load: "105", rpe: "8.5" })
    );
  });
});
