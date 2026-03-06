import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as workoutApi from "@/components/log-workout/api";
import type { LogExerciseInput, NormalizedExercises } from "@/components/log-workout/types";
import { useWorkoutSessionFlow } from "@/components/log-workout/useWorkoutSessionFlow";
import { getNextUnloggedSetId } from "@/components/log-workout/useWorkoutLogState";

vi.mock("@/components/log-workout/api", () => ({
  logSetRequest: vi.fn(),
  deleteSetLogRequest: vi.fn(),
  saveWorkoutRequest: vi.fn(),
}));

const mockedLogSetRequest = vi.mocked(workoutApi.logSetRequest);
const mockedDeleteSetLogRequest = vi.mocked(workoutApi.deleteSetLogRequest);
const mockedSaveWorkoutRequest = vi.mocked(workoutApi.saveWorkoutRequest);

function makeExercises(): NormalizedExercises {
  return {
    warmup: [],
    main: [
      {
        workoutExerciseId: "ex-1",
        name: "Dumbbell Bench Press",
        equipment: ["dumbbell"],
        isMainLift: true,
        sets: [
          {
            setId: "set-1",
            setIndex: 1,
            targetReps: 10,
            targetLoad: 50,
            targetRpe: 8,
            actualReps: 10,
            actualLoad: 50,
            actualRpe: 6,
            restSeconds: 90,
          },
          {
            setId: "set-2",
            setIndex: 2,
            targetReps: 10,
            targetLoad: 50,
            targetRpe: 8,
            restSeconds: 120,
          },
        ],
      },
    ],
    accessory: [],
  };
}

function isBodyweightExercise(exercise: LogExerciseInput): boolean {
  return (exercise.equipment ?? []).some((item) => item.toLowerCase() === "bodyweight");
}

function isDumbbellExercise(exercise: LogExerciseInput): boolean {
  return (exercise.equipment ?? []).some((item) => item.toLowerCase() === "dumbbell");
}

function toInputNumberString(value: number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

function parseNullableNumber(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLoadInput(raw: string): number | null {
  return parseNullableNumber(raw);
}

type HarnessCallbacks = {
  clearDraft: (setId: string) => void;
  clearAllDrafts: () => void;
  clearDraftInputBuffers: (setId: string) => void;
  setFieldPrefilled: (setId: string, field: string, value: boolean) => void;
  clearDraftSpy: ReturnType<typeof vi.fn>;
  clearAllDraftsSpy: ReturnType<typeof vi.fn>;
  clearDraftInputBuffersSpy: ReturnType<typeof vi.fn>;
  setFieldPrefilledSpy: ReturnType<typeof vi.fn>;
};

function WorkoutSessionFlowHarness({
  callbacks,
}: {
  callbacks: HarnessCallbacks;
}) {
  const [data, setData] = useState<NormalizedExercises>(makeExercises());
  const [loggedSetIds, setLoggedSetIds] = useState<Set<string>>(new Set());
  const [activeSetId, setActiveSetId] = useState<string | null>("set-1");
  const [restTimer, setRestTimer] = useState<{ startedAtMs: number; endAtMs: number } | null>({
    startedAtMs: 1000,
    endAtMs: 61000,
  });

  const flatSets = useMemo(
    () =>
      data.main.flatMap((exercise, exerciseIndex) =>
        exercise.sets.map((set, setIndex) => ({
          section: "main" as const,
          sectionLabel: "Main Lifts",
          exerciseIndex,
          setIndex,
          exercise,
          set,
        }))
      ),
    [data]
  );

  const updateSetFields = (setId: string, updater: (set: (typeof flatSets)[number]["set"]) => (typeof flatSets)[number]["set"]) => {
    setData((prev) => ({
      ...prev,
      main: prev.main.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => (set.setId === setId ? updater(set) : set)),
      })),
    }));
  };

  const hook = useWorkoutSessionFlow({
    workoutId: "workout-1",
    flatSets,
    loggedSetIds,
    setLoggedSetIds,
    setActiveSetId,
    setData,
    restTimer,
    startTimer: (durationSeconds) => {
      setRestTimer({
        startedAtMs: 5000,
        endAtMs: 5000 + durationSeconds * 1000,
      });
    },
    clearTimer: () => setRestTimer(null),
    restoreTimer: (snapshot) => setRestTimer(snapshot),
    clearDraft: callbacks.clearDraft,
    clearAllDrafts: callbacks.clearAllDrafts,
    clearDraftInputBuffers: callbacks.clearDraftInputBuffers,
    setFieldPrefilled: (setId, field, value) => callbacks.setFieldPrefilled(setId, field, value),
    updateSetFields,
    isBodyweightExercise,
    isDumbbellExercise,
    toInputNumberString,
    parseNullableNumber,
    normalizeLoadInput,
  });

  return (
    <div>
      <button onClick={() => void hook.actions.logSet("set-1")} type="button">
        log-first
      </button>
      <button onClick={() => void hook.actions.undo()} type="button">
        undo
      </button>
      <button
        onClick={() => {
          hook.completion.setSkipReason("Travel");
          void hook.completion.run("mark_skipped");
        }}
        type="button"
      >
        skip
      </button>
      <button onClick={() => void hook.completion.run("mark_completed")} type="button">
        complete
      </button>
      <button onClick={() => void hook.completion.run("mark_partial")} type="button">
        partial
      </button>

      <div data-testid="logged-ids">{Array.from(loggedSetIds).join(",")}</div>
      <div data-testid="active-set-id">{activeSetId ?? ""}</div>
      <div data-testid="status">{hook.status ?? ""}</div>
      <div data-testid="error">{hook.error ?? ""}</div>
      <div data-testid="undo-set-id">{hook.undoSnapshot?.setId ?? ""}</div>
      <div data-testid="autoreg-hint">{hook.autoregHint?.message ?? ""}</div>
      <div data-testid="terminal-state">{hook.completion.state.terminalState}</div>
      <div data-testid="baseline-summary">
        {hook.baselineSummary ? JSON.stringify(hook.baselineSummary) : ""}
      </div>
      <div data-testid="timer-end">{restTimer?.endAtMs ?? ""}</div>
      <div data-testid="set-1-reps">{data.main[0]?.sets[0]?.actualReps ?? ""}</div>
      <div data-testid="set-1-load">{data.main[0]?.sets[0]?.actualLoad ?? ""}</div>
      <div data-testid="set-1-rpe">{data.main[0]?.sets[0]?.actualRpe ?? ""}</div>
      <div data-testid="next-unlogged">{getNextUnloggedSetId(flatSets, loggedSetIds, "set-1") ?? ""}</div>
    </div>
  );
}

describe("useWorkoutSessionFlow", () => {
  function createCallbacks(): HarnessCallbacks {
    const clearDraftSpy = vi.fn();
    const clearAllDraftsSpy = vi.fn();
    const clearDraftInputBuffersSpy = vi.fn();
    const setFieldPrefilledSpy = vi.fn();

    return {
      clearDraft: (setId) => clearDraftSpy(setId),
      clearAllDrafts: () => clearAllDraftsSpy(),
      clearDraftInputBuffers: (setId) => clearDraftInputBuffersSpy(setId),
      setFieldPrefilled: (setId, field, value) => setFieldPrefilledSpy(setId, field, value),
      clearDraftSpy,
      clearAllDraftsSpy,
      clearDraftInputBuffersSpy,
      setFieldPrefilledSpy,
    };
  }

  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({
      data: { status: "ok", workoutStatus: "COMPLETED" },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("logs a set, advances active set, creates undo state, and starts rest timer", async () => {
    const callbacks = createCallbacks();

    render(<WorkoutSessionFlowHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "log-first" }));

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutSetId: "set-1",
          actualReps: 10,
          actualLoad: 50,
          actualRpe: 6,
        })
      );
      expect(screen.getByTestId("logged-ids")).toHaveTextContent("set-1");
      expect(screen.getByTestId("active-set-id")).toHaveTextContent("set-2");
      expect(screen.getByTestId("undo-set-id")).toHaveTextContent("set-1");
      expect(screen.getByTestId("status")).toHaveTextContent("Set logged. Rest timer started.");
      expect(screen.getByTestId("timer-end")).toHaveTextContent("95000");
      expect(screen.getByTestId("autoreg-hint")).toHaveTextContent("Set felt easier than target");
    });

    expect(callbacks.clearDraftSpy).toHaveBeenCalledWith("set-1");
    expect(callbacks.clearDraftInputBuffersSpy).toHaveBeenCalledWith("set-1");
    expect(callbacks.setFieldPrefilledSpy).toHaveBeenCalledTimes(3);
  });

  it("undoes a created set log and restores the previous rest timer", async () => {
    const callbacks = createCallbacks();

    render(<WorkoutSessionFlowHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "log-first" }));
    await waitFor(() => expect(screen.getByTestId("undo-set-id")).toHaveTextContent("set-1"));

    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    await waitFor(() => {
      expect(mockedDeleteSetLogRequest).toHaveBeenCalledWith("set-1");
      expect(screen.getByTestId("logged-ids")).toHaveTextContent("");
      expect(screen.getByTestId("active-set-id")).toHaveTextContent("set-1");
      expect(screen.getByTestId("status")).toHaveTextContent("Last set log reverted");
      expect(screen.getByTestId("timer-end")).toHaveTextContent("61000");
    });
  });

  it("completes a workout and clears drafts/timer while storing baseline summary", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce({
      data: {
        status: "ok",
        workoutStatus: "COMPLETED",
        baselineSummary: {
          context: "post-workout",
          evaluatedExercises: 1,
          updated: 1,
          skipped: 0,
          items: [{ exerciseName: "Dumbbell Bench Press", newTopSetWeight: 55, reps: 11 }],
          skippedItems: [],
        },
      },
      error: null,
    });

    render(<WorkoutSessionFlowHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "complete" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_completed",
          status: "COMPLETED",
        })
      );
      expect(callbacks.clearAllDraftsSpy).toHaveBeenCalled();
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("completed");
      expect(screen.getByTestId("timer-end")).toHaveTextContent("");
      expect(screen.getByTestId("baseline-summary")).toHaveTextContent("Dumbbell Bench Press");
    });
  });

  it("keeps the logging flow active for partial saves", async () => {
    const callbacks = createCallbacks();
    mockedSaveWorkoutRequest.mockResolvedValueOnce({
      data: { status: "ok", workoutStatus: "PARTIAL" },
      error: null,
    });

    render(<WorkoutSessionFlowHarness callbacks={callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "partial" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_partial",
          status: "PARTIAL",
        })
      );
      expect(callbacks.clearAllDraftsSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("terminal-state")).toHaveTextContent("active");
      expect(screen.getByTestId("timer-end")).toHaveTextContent("");
      expect(screen.getByTestId("baseline-summary")).toHaveTextContent("");
      expect(screen.getByTestId("status")).toHaveTextContent(
        "Workout saved as partial (some planned sets were unresolved)"
      );
    });
  });
});
