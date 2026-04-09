import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogWorkoutClient, { type LogExerciseInput } from "./LogWorkoutClient";
import type { SectionedExercises } from "@/components/log-workout/types";
import * as workoutApi from "@/components/log-workout/api";
import type { SaveWorkoutResponse, WorkoutStatus } from "@/lib/api/workout-save-contract";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/log-workout/api", () => ({
  addSetToExerciseRequest: vi.fn(),
  logSetRequest: vi.fn(),
  deleteSetLogRequest: vi.fn(),
  saveWorkoutRequest: vi.fn(),
  loadWeeklyVolumeCheckRequest: vi.fn(),
}));

const mockedAddSetToExerciseRequest = vi.mocked(workoutApi.addSetToExerciseRequest);
const mockedLogSetRequest = vi.mocked(workoutApi.logSetRequest);
const mockedDeleteSetLogRequest = vi.mocked(workoutApi.deleteSetLogRequest);
const mockedSaveWorkoutRequest = vi.mocked(workoutApi.saveWorkoutRequest);
const mockedLoadWeeklyVolumeCheckRequest = vi.mocked(workoutApi.loadWeeklyVolumeCheckRequest);
const mockedFetch = vi.fn();

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

function makeExplanationResponse() {
  return {
    confidence: { level: "high", summary: "ok", missingSignals: [] },
    sessionContext: {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 4,
        totalWeeksInBlock: 4,
        primaryGoal: "build",
      },
      volumeStatus: { muscleStatuses: {}, overallSummary: "ok" },
      readinessStatus: {
        overall: "moderate",
        signalAge: 0,
        availability: "recent",
        label: "Recent readiness",
        perMuscleFatigue: {},
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
    exerciseRationales: {},
    prescriptionRationales: {},
    progressionReceipts: {
      "ex-1": {
        lastPerformed: {
          reps: 10,
          load: 45,
          rpe: 8,
          performedAt: "2026-02-18T00:00:00.000Z",
        },
        todayPrescription: { reps: 10, load: 50, rpe: 8 },
        delta: { load: 5, loadPercent: 11.1, reps: 0, rpe: 0 },
        trigger: "double_progression",
        decisionLog: [],
      },
    },
    nextExposureDecisions: {
      "ex-1": {
        action: "hold",
        summary: "Next exposure: hold load.",
        reason: "Median reps stayed at 10 in the 8-10 band, so keep building reps before adding load.",
        anchorLoad: 50,
        repRange: { min: 8, max: 10 },
        modalRpe: 8,
        medianReps: 10,
      },
    },
    filteredExercises: [],
    volumeCompliance: [
      {
        muscle: "Chest",
        performedEffectiveVolumeBeforeSession: 6,
        plannedEffectiveVolumeThisSession: 4,
        projectedEffectiveVolume: 10,
        weeklyTarget: 10,
        mev: 8,
        mav: 16,
        status: "ON_TARGET",
      },
    ],
  };
}

function makeWeeklyVolumeCheckResponse(
  overrides: Partial<{
    shouldShow: boolean;
    rows: Array<{
      muscle: string;
      doneNow: number;
      projectedRemainingWeek: number;
      projectedEndOfWeek: number;
      weeklyTarget: number;
      deltaToTarget: number;
      mev: number;
      mav: number;
      mrv: number;
      status: "below_mev" | "in_range" | "near_target" | "on_target" | "near_mrv" | "at_mrv";
      statusLabel: string;
      topUpHint: string | null;
    }>;
  }> = {}
) {
  return {
    data: {
      workoutId: "workout-1",
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      shouldShow: overrides.shouldShow ?? true,
      rows:
        overrides.rows ??
        [
          {
            muscle: "Chest",
            doneNow: 6,
            projectedRemainingWeek: 2,
            projectedEndOfWeek: 8,
            weeklyTarget: 10,
            deltaToTarget: -2,
            mev: 8,
            mav: 16,
            mrv: 20,
            status: "below_mev",
            statusLabel: "Below MEV",
            topUpHint: "Likely needs ~1-2 more hard sets",
          },
        ],
    },
    error: null,
  };
}

function makeExercises(): LogExerciseInput[] {
  return [
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
          restSeconds: 90,
        },
        {
          setId: "set-2",
          setIndex: 2,
          targetReps: 10,
          targetLoad: 50,
          targetRpe: 8,
          restSeconds: 90,
        },
      ],
    },
  ];
}

function renderClient() {
  return render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
}

function setupDialogMocks() {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
}

async function openRestTimerControls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("rest-timer-hud"));
  return screen.findByTestId("rest-timer-expanded-controls");
}

async function clickResolvedSubmitButton(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Log set|Update set/ }));
}

async function logVisibleSets(user: ReturnType<typeof userEvent.setup>, count: number) {
  for (let index = 0; index < count; index += 1) {
    await clickResolvedSubmitButton(user);
  }
}

async function logAllSets(user: ReturnType<typeof userEvent.setup>) {
  await logVisibleSets(user, 2);
}

async function openWorkoutOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "... Workout options" }));
  await screen.findByRole("heading", { name: "Workout options" });
}

function setupVisualViewport(initialHeight = 800) {
  const resizeHandlers = new Set<() => void>();
  const scrollHandlers = new Set<() => void>();
  const mockViewport = {
    height: initialHeight,
    offsetTop: 0,
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      if (_event === "resize") {
        resizeHandlers.add(handler);
      }
      if (_event === "scroll") {
        scrollHandlers.add(handler);
      }
    }),
    removeEventListener: vi.fn((_event: string, handler: () => void) => {
      if (_event === "resize") {
        resizeHandlers.delete(handler);
      }
      if (_event === "scroll") {
        scrollHandlers.delete(handler);
      }
    }),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: mockViewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: initialHeight });

  return {
    setHeight(nextHeight: number) {
      mockViewport.height = nextHeight;
      for (const handler of resizeHandlers) {
        handler();
      }
    },
    setViewport(next: { height?: number; offsetTop?: number }) {
      if (next.height != null) {
        mockViewport.height = next.height;
      }
      if (next.offsetTop != null) {
        mockViewport.offsetTop = next.offsetTop;
      }
      for (const handler of resizeHandlers) {
        handler();
      }
      for (const handler of scrollHandlers) {
        handler();
      }
    },
  };
}

describe("LogWorkoutClient UX behavior", { timeout: 15000 }, () => {
  beforeEach(() => {
    mockedAddSetToExerciseRequest.mockResolvedValue({
      data: {
        set: {
          setId: "set-3",
          setIndex: 3,
          targetReps: 10,
          targetLoad: 50,
          targetRpe: 8,
          restSeconds: 90,
          isRuntimeAdded: true,
        },
      },
      error: null,
    });
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    mockedLoadWeeklyVolumeCheckRequest.mockResolvedValue(makeWeeklyVolumeCheckResponse());
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => makeExplanationResponse(),
    });
    vi.stubGlobal("fetch", mockedFetch);
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("prefills first set from targets with muted prefill style", () => {
    renderClient();
    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    const rpeInput = screen.getByLabelText("RPE") as HTMLInputElement;

    expect(repsInput.value).toBe("10");
    expect(loadInput.value).toBe("50");
    expect(rpeInput.value).toBe("8");
    expect(repsInput.className).toContain("text-slate-400");
  });

  it("prefills second set from previous logged actuals", async () => {
    const user = userEvent.setup();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    const rpeInput = screen.getByLabelText("RPE") as HTMLInputElement;

    await user.clear(repsInput);
    await user.type(repsInput, "12");

    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "55");
    fireEvent.blur(loadInput);
    await waitFor(() => {
      expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("55");
    });

    await user.clear(rpeInput);
    await user.type(rpeInput, "9");

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Reps") as HTMLInputElement).value).toBe("12");
      expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("55");
      expect((screen.getByLabelText("RPE") as HTMLInputElement).value).toBe("9");
    });
  });

  it("does not auto-submit prefilled values", () => {
    renderClient();
    expect(screen.getByLabelText("Reps")).toHaveValue(10);
    expect(mockedLogSetRequest).not.toHaveBeenCalled();
  });

  it("shows the added exercise label in the queue for runtime-added exercises", () => {
    render(
      <LogWorkoutClient
        workoutId="workout-1"
        exercises={[
          {
            workoutExerciseId: "ex-added",
            name: "Pec Deck",
            equipment: ["machine"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "ACCESSORY",
            sessionNote: "Added during workout. Session-only; future planning ignores it.",
            sets: [
              {
                setId: "set-added-1",
                setIndex: 1,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 6.5,
                restSeconds: 90,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Added exercise")).toBeInTheDocument();
    expect(
      screen.getByText("Added during workout. Session-only; future planning ignores it.")
    ).toBeInTheDocument();
  });

  it("returns to the new active logging context after adding an exercise", async () => {
    const user = userEvent.setup();
    const scrollIntoViewSpy = vi.fn();
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewSpy,
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });
    mockedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/workouts/workout-1/bonus-suggestions") {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              {
                exerciseId: "fly",
                exerciseName: "Cable Fly",
                primaryMuscles: ["Chest"],
                equipment: ["CABLE"],
                reason: "Chest has room to grow",
                suggestedSets: 2,
                suggestedLoad: 35,
              },
            ],
          }),
        };
      }

      if (url === "/api/exercises") {
        return {
          ok: true,
          json: async () => ({
            exercises: [
              {
                id: "fly",
                name: "Cable Fly",
                primaryMuscles: ["Chest"],
                equipment: ["CABLE"],
              },
            ],
          }),
        };
      }

      if (url === "/api/workouts/workout-1/add-exercise-preview") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { exerciseIds?: string[] };
        return {
          ok: true,
          json: async () => ({
            previews: (body.exerciseIds ?? []).map((exerciseId) => ({
              exerciseId,
              exerciseName: "Cable Fly",
              equipment: ["CABLE"],
              section: "ACCESSORY",
              isMainLift: false,
              setCount: 2,
              targetReps: 12,
              targetRepRange: { min: 10, max: 14 },
              targetLoad: 35,
              targetRpe: 6.5,
              restSeconds: 90,
              prescriptionSource: "session_accessory_defaults",
            })),
          }),
        };
      }

      if (url === "/api/workouts/workout-1/add-exercise") {
        return {
          ok: true,
          json: async () => ({
            exercise: {
              workoutExerciseId: "ex-added",
              name: "Cable Fly",
              equipment: ["CABLE"],
              isRuntimeAdded: true,
              isMainLift: false,
              section: "ACCESSORY",
              sessionNote: "Added during workout. Session-only; future planning ignores it.",
              sets: [
                {
                  setId: "set-added-1",
                  setIndex: 1,
                  targetReps: 12,
                  targetRepRange: { min: 10, max: 14 },
                  targetLoad: 35,
                  targetRpe: 6.5,
                  restSeconds: 90,
                },
                {
                  setId: "set-added-2",
                  setIndex: 2,
                  targetReps: 12,
                  targetRepRange: { min: 10, max: 14 },
                  targetLoad: 35,
                  targetRpe: 6.5,
                  restSeconds: 90,
                },
              ],
            },
          }),
        };
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    await waitFor(() => {
      expect(screen.getByTestId("active-set-edit-banner")).toBeInTheDocument();
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    scrollIntoViewSpy.mockClear();
    scrollToSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "+ Add Exercise" }));
    await screen.findByText("Cable Fly");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Cable Fly" })).toBeInTheDocument();
      expect(screen.getByText(/Set 1 of 2/)).toBeInTheDocument();
      expect(scrollIntoViewSpy).toHaveBeenCalled();
      expect(scrollToSpy).toHaveBeenCalled();
    });

    const addedRow = screen.getByTestId("queue-row-ex-added");
    expect(within(addedRow).getByTestId("exercise-set-chip-list")).toBeInTheDocument();
    expect(within(addedRow).getByRole("button", { name: /Set 1/ })).toBeInTheDocument();
  });

  it("does not snap dumbbell load while typing", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "40");

    expect(loadInput.value).toBe("40");
  });

  it("normalizes load on blur", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "41");
    fireEvent.blur(loadInput);

    expect(loadInput.value).toBe("40");
  });

  it("does not treat mixed barbell+dumbbell metadata as dumbbell-style logging UI", () => {
    render(
      <LogWorkoutClient
        workoutId="workout-1"
        exercises={[
          {
            workoutExerciseId: "ex-mixed",
            name: "Stiff-Legged Deadlift",
            equipment: ["barbell", "dumbbell"],
            isMainLift: true,
            section: "MAIN",
            sets: [
              {
                setId: "set-mixed-1",
                setIndex: 1,
                targetReps: 8,
                targetLoad: 185,
                targetRpe: 8,
                restSeconds: 120,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByLabelText("Load")).toBeInTheDocument();
    expect(screen.getByText("Load (lbs)")).toBeInTheDocument();
    expect(screen.queryByText("Load per dumbbell (lbs)")).not.toBeInTheDocument();
  });

  it("quantizes non-grid dumbbell loads to canonical 2.5-lb increments", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "41.3");
    fireEvent.blur(loadInput);

    expect(loadInput.value).toBe("42.5");
  });

  it("applies quick adjustments as exact deltas", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "+2.5" }));
    expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("52.5");

    await user.click(screen.getByRole("button", { name: "-5" }));
    expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("47.5");
  });

  it("persists and renders 52.5 dumbbell loads without snapping them down", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "52.5");
    fireEvent.blur(loadInput);
    await clickResolvedSubmitButton(user);
    await clickResolvedSubmitButton(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          workoutSetId: "set-1",
          actualLoad: 52.5,
        })
      );
      expect(screen.getAllByText(/52\.5 lbs each/)).toHaveLength(2);
    });
  });

  it("blocks load-only performed sets before submit", async () => {
    const user = userEvent.setup();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    const rpeInput = screen.getByLabelText("RPE") as HTMLInputElement;
    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;

    await user.clear(repsInput);
    fireEvent.blur(repsInput);
    await user.clear(rpeInput);
    fireEvent.blur(rpeInput);
    await user.clear(loadInput);
    await user.type(loadInput, "55");

    const submitButton = screen.getByRole("button", { name: "Add reps or RPE" });
    expect(submitButton).toBeDisabled();
    expect(screen.getByText("Load alone will not save. Add reps or RPE, or skip the set.")).toBeInTheDocument();
    expect(mockedLogSetRequest).not.toHaveBeenCalled();
  });

  it("updates reps immediately from increment buttons even while input buffer is active", async () => {
    const user = userEvent.setup();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    await user.click(repsInput);
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    await user.click(screen.getByRole("button", { name: "+1" }));

    expect((screen.getByLabelText("Reps") as HTMLInputElement).value).toBe("12");
  });

  it("shows completion confirmation before calling completion API", async () => {
    const user = userEvent.setup();
    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));

    expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toBeInTheDocument();
    expect(mockedSaveWorkoutRequest).not.toHaveBeenCalled();
  });

  it("keeps the weekly volume check hidden before the planned-work checkpoint", () => {
    renderClient();

    expect(screen.queryByTestId("weekly-volume-check")).not.toBeInTheDocument();
    expect(mockedLoadWeeklyVolumeCheckRequest).not.toHaveBeenCalled();
  });

  it("shows the weekly volume check above the finish bar at the checkpoint", async () => {
    const user = userEvent.setup();
    renderClient();

    await logAllSets(user);

    const card = await screen.findByTestId("weekly-volume-check");
    const finishBar = screen.getByTestId("workout-finish-bar");

    expect(mockedLoadWeeklyVolumeCheckRequest).toHaveBeenCalledWith("workout-1");
    expect(card.compareDocumentPosition(finishBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows only flagged muscles in the weekly volume check", async () => {
    const user = userEvent.setup();
    mockedLoadWeeklyVolumeCheckRequest.mockResolvedValueOnce(
      makeWeeklyVolumeCheckResponse({
        rows: [
          {
            muscle: "Chest",
            doneNow: 6,
            projectedRemainingWeek: 2,
            projectedEndOfWeek: 8,
            weeklyTarget: 10,
            deltaToTarget: -2,
            mev: 8,
            mav: 16,
            mrv: 20,
            status: "below_mev",
            statusLabel: "Below MEV",
            topUpHint: "Likely needs ~1-2 more hard sets",
          },
        ],
      })
    );

    renderClient();
    await logAllSets(user);

    await screen.findByTestId("weekly-volume-check");
    expect(screen.getByTestId("weekly-volume-row-Chest")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-volume-row-Quads")).not.toBeInTheDocument();
  });

  it("refreshes the weekly volume check after a top-up add-set action and keeps finishing non-blocking", async () => {
    const user = userEvent.setup();
    mockedLoadWeeklyVolumeCheckRequest.mockReset();
    mockedLoadWeeklyVolumeCheckRequest
      .mockResolvedValueOnce(
        makeWeeklyVolumeCheckResponse({
          rows: [
            {
              muscle: "Chest",
              doneNow: 6,
              projectedRemainingWeek: 2,
              projectedEndOfWeek: 8,
              weeklyTarget: 10,
              deltaToTarget: -2,
              mev: 8,
              mav: 16,
              mrv: 20,
              status: "below_mev",
              statusLabel: "Below MEV",
              topUpHint: "Likely needs ~1-2 more hard sets",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeWeeklyVolumeCheckResponse({
          rows: [
            {
              muscle: "Chest",
              doneNow: 7,
              projectedRemainingWeek: 2,
              projectedEndOfWeek: 9,
              weeklyTarget: 10,
              deltaToTarget: -1,
              mev: 8,
              mav: 16,
              mrv: 20,
              status: "near_target",
              statusLabel: "Near target",
              topUpHint: "Likely needs ~1 more hard set",
            },
          ],
        })
      )
      .mockResolvedValue(makeWeeklyVolumeCheckResponse({ rows: [] }));

    renderClient();
    await logAllSets(user);

    await screen.findByText(/Likely needs ~1-2 more hard sets/);
    await user.click(screen.getByRole("button", { name: "+ Add set" }));

    await screen.findByText(/Likely needs ~1 more hard set/);
    expect(screen.getByTestId("weekly-volume-check")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await screen.findByText(/no muscles are currently projected below target/i);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({ workoutId: "workout-1", action: "mark_completed" })
      );
    });
  });

  it("does not call completion API when confirmation is canceled", async () => {
    const user = userEvent.setup();
    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedSaveWorkoutRequest).not.toHaveBeenCalled();
  });

  it("renders the post-workout insights and completion actions after finishing the workout", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("COMPLETED", {
        baselineSummary: {
          context: "post-workout",
          evaluatedExercises: 1,
          updated: 1,
          skipped: 0,
          items: [
            {
              exerciseName: "Dumbbell Bench Press",
              previousTopSetWeight: 45,
              newTopSetWeight: 50,
              reps: 10,
            },
          ],
          skippedItems: [],
        },
      })
    );

    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText("Session complete!")).toBeInTheDocument();
      expect(screen.getByText("Session outcome")).toBeInTheDocument();
      expect(
        screen.getByText("Key lifts point to a hold next time while reps keep building.")
      ).toBeInTheDocument();
      expect(screen.getByText("Key lift takeaways")).toBeInTheDocument();
      expect(screen.getByText(/Next exposure: hold load\./)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Detailed set log" })).toBeInTheDocument();
      expect(screen.queryByText("Strength updates")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "See the full workout review for the original workout structure, deeper exercise detail, and fuller session context. When you're ready, generate the next workout and log a same-day readiness check-in first."
        )
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View full review" })).toHaveAttribute("href", "/workout/workout-1");
      expect(screen.getByRole("link", { name: "Generate next workout" })).toHaveAttribute("href", "/");
    });
  });

  it("keeps leave-for-now in the workout options sheet while a workout is in progress", async () => {
    const user = userEvent.setup();
    renderClient();

    expect(screen.queryByRole("button", { name: "Leave for now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish workout" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    expect(screen.getByRole("button", { name: "... Workout options" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish workout" })).not.toBeInTheDocument();

    await openWorkoutOptions(user);

    expect(screen.getByRole("button", { name: "Leave for now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip workout" })).toBeInTheDocument();
  });

  it("shows a sticky finish bar only after all sets are logged", async () => {
    const user = userEvent.setup();
    const { container } = renderClient();

    expect(screen.queryByTestId("workout-finish-bar")).not.toBeInTheDocument();

    await logAllSets(user);

    await waitFor(() => expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument());

    const finishBar = screen.getByTestId("workout-finish-bar");
    expect(finishBar).toHaveClass("fixed");
    expect(finishBar.className).toContain(
      "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+var(--workout-footer-viewport-offset,0px))]"
    );
    expect(finishBar.style.bottom).toBe("");
    expect(finishBar.style.getPropertyValue("--workout-footer-viewport-offset")).toBe("0px");
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "... Workout options" })).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.paddingBottom).toContain("var(--mobile-nav-height)");
    expect((container.firstChild as HTMLElement).style.paddingBottom).toContain("88px");
  });

  it("appends an extra set to an existing exercise and requires it before finishing", async () => {
    const user = userEvent.setup();
    renderClient();

    await logAllSets(user);
    await waitFor(() => expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument());

    const queueRow = screen.getByTestId("queue-row-ex-1");
    expect(
      within(screen.getByTestId("exercise-set-chip-list")).getByRole("button", { name: "+ Add set" })
    ).toBeInTheDocument();

    await user.click(within(queueRow).getByRole("button", { name: "+ Add set" }));

    await waitFor(() => {
      expect(mockedAddSetToExerciseRequest).toHaveBeenCalledWith({
        workoutId: "workout-1",
        workoutExerciseId: "ex-1",
      });
      expect(screen.getByRole("button", { name: /Set 3 Extra set/ })).toBeInTheDocument();
      expect(screen.getByText(/Set 3 of 3 · Extra set/)).toBeInTheDocument();
      expect(screen.getByText("1 sets remaining")).toBeInTheDocument();
      expect(screen.queryByTestId("workout-finish-bar")).not.toBeInTheDocument();
    });

    await clickResolvedSubmitButton(user);

    await waitFor(() => {
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    });
  });

  it("keeps append targeting on the new runtime-added set when triggered from edit mode", async () => {
    const user = userEvent.setup();
    mockedAddSetToExerciseRequest
      .mockResolvedValueOnce({
        data: {
          set: {
            setId: "set-3",
            setIndex: 3,
            targetReps: 10,
            targetLoad: 50,
            targetRpe: 8,
            restSeconds: 90,
            isRuntimeAdded: true,
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          set: {
            setId: "set-4",
            setIndex: 4,
            targetReps: 10,
            targetLoad: 50,
            targetRpe: 8,
            restSeconds: 90,
            isRuntimeAdded: true,
          },
        },
        error: null,
      });
    renderClient();

    await logAllSets(user);
    await waitFor(() => expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument());

    const queueRow = screen.getByTestId("queue-row-ex-1");

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));

    await waitFor(() => {
      expect(screen.getByTestId("active-set-edit-banner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update set" })).toBeInTheDocument();
    });

    await user.click(within(queueRow).getByRole("button", { name: "+ Add set" }));

    await waitFor(() => {
      expect(mockedAddSetToExerciseRequest).toHaveBeenNthCalledWith(1, {
        workoutId: "workout-1",
        workoutExerciseId: "ex-1",
      });
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Set 3 Extra set/ })).toBeInTheDocument();
      expect(screen.getByText(/Set 3 of 3/)).toBeInTheDocument();
      expect(screen.queryByTestId("workout-finish-bar")).not.toBeInTheDocument();
    });

    await clickResolvedSubmitButton(user);

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          workoutSetId: "set-3",
          wasSkipped: false,
        })
      );
      expect(screen.getByRole("button", { name: /Set 3 Extra set OK 50 x 10 @8/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Set 3 Extra set skipped/i })).not.toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));

    await waitFor(() => {
      expect(screen.getByTestId("active-set-edit-banner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update set" })).toBeInTheDocument();
    });

    await user.click(within(queueRow).getByRole("button", { name: "+ Add set" }));

    await waitFor(() => {
      expect(mockedAddSetToExerciseRequest).toHaveBeenNthCalledWith(2, {
        workoutId: "workout-1",
        workoutExerciseId: "ex-1",
      });
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Set 4 Extra set/ })).toBeInTheDocument();
      expect(screen.getByText(/Set 4 of 4/)).toBeInTheDocument();
    });
  });

  it("counts skipped sets as satisfied and routes the footer CTA to skip", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: /Skip set/i }));
    await user.click(screen.getByRole("button", { name: /Skip set/i }));

    await waitFor(() => {
      expect(screen.getByText("0 sets remaining")).toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip workout" })).toBeInTheDocument();
    });
  });

  it("renders finish CTA when completion is mixed logged + skipped", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await user.click(screen.getByRole("button", { name: /Skip set/i }));

    await waitFor(() => {
      expect(screen.getByText("0 sets remaining")).toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    });
  });

  it("saves all-skipped workouts as skipped instead of completed", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: /Skip set/i }));
    await user.click(screen.getByRole("button", { name: /Skip set/i }));
    await user.click(screen.getByRole("button", { name: "Skip workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

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

  it("shows a clear skipped terminal state after skip confirmation", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("SKIPPED", { action: "mark_skipped" })
    );
    renderClient();

    await user.click(screen.getByRole("button", { name: /Skip set/i }));
    await user.click(screen.getByRole("button", { name: /Skip set/i }));
    await user.click(screen.getByRole("button", { name: "Skip workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText("Workout skipped")).toBeInTheDocument();
      expect(screen.getByText("This workout was skipped.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Generate a replacement session" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    });
  });

  it("uses identical completion gating for gap-fill workouts", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-gap-fill" exercises={makeGapFillExercises()} />);

    await waitFor(() => {
      expect(screen.getByText("1 sets remaining")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Skip set/i }));

    await waitFor(() => {
      expect(screen.getByText("0 sets remaining")).toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    });
  });

  it("shows constrained swap controls when runtime swap is enabled for an eligible exercise", () => {
    render(
      <LogWorkoutClient
        workoutId="workout-gap-fill"
        exercises={makeGapFillSwapExercises()}
        allowBonusExerciseAdd={false}
        allowRuntimeExerciseSwap={true}
      />
    );

    expect(screen.queryByRole("button", { name: "+ Add Exercise" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap" })).toBeInTheDocument();
  });

  it("keeps the logging UI active after leave-for-now confirms a partial save", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("PARTIAL", { action: "mark_partial" })
    );

    renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await openWorkoutOptions(user);
    await user.click(screen.getByRole("button", { name: "Leave for now" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_partial",
          status: "PARTIAL",
        })
      );
      expect(screen.getByText(/Workout saved as partial/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Log set|Update set/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "... Workout options" })).toBeInTheDocument();
      expect(screen.queryByText("Session complete!")).not.toBeInTheDocument();
    });
  });

  it("does not render the completed review when mark_completed persists as partial", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce(
      makeSaveWorkoutResponse("PARTIAL", { action: "mark_completed" })
    );

    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "workout-1",
          action: "mark_completed",
          status: "COMPLETED",
        })
      );
      expect(screen.queryByText("Session complete!")).not.toBeInTheDocument();
      expect(screen.queryByText("Session outcome")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View full review" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Add Exercise" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    });
  });

  it("writes draft to localStorage on input change", async () => {
    vi.useFakeTimers();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    fireEvent.change(repsInput, { target: { value: "9" } });

    await vi.advanceTimersByTimeAsync(650);

    const saved = window.localStorage.getItem("draft_set_workout-1_set-1");
    expect(saved).not.toBeNull();
    expect(saved).toContain('"reps":"9"');
  });

  it("shows draft save feedback while editing", async () => {
    vi.useFakeTimers();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    fireEvent.change(repsInput, { target: { value: "9" } });

    expect(screen.getByText("Saving draft...")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(650);

    expect(screen.getByText(/Draft saved/)).toBeInTheDocument();
  });

  it("restores draft values on remount", () => {
    window.localStorage.setItem(
      "draft_set_workout-1_set-1",
      JSON.stringify({ reps: "8", load: "47.5", rpe: "7.5", savedAt: Date.now() })
    );

    renderClient();

    return waitFor(() => {
      expect(screen.getByLabelText("Reps")).toHaveValue(8);
      expect(screen.getByLabelText("Load")).toHaveValue(47.5);
      expect(screen.getByLabelText("RPE")).toHaveValue(7.5);
      expect(screen.getByText("Draft restored")).toBeInTheDocument();
    });
  });

  it("does not treat restored drafts as logged sets", async () => {
    window.localStorage.setItem(
      "draft_set_workout-1_set-1",
      JSON.stringify({ reps: "8", load: "47.5", rpe: "7.5", savedAt: Date.now() })
    );

    renderClient();

    await waitFor(() => {
      expect(screen.getByText("0/2 logged")).toBeInTheDocument();
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Leave for now" })).not.toBeInTheDocument();
    });
  });

  it("restores an active rest timer after remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.queryByTestId("rest-timer-expanded-controls")).not.toBeInTheDocument();
    });

    unmount();
    renderClient();

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.queryByTestId("rest-timer-expanded-controls")).not.toBeInTheDocument();
    });
  });

  it("restores both draft values and the active rest timer after remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderClient();

    await user.click(screen.getByRole("button", { name: /Set 2/ }));
    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    await user.clear(repsInput);
    await user.type(repsInput, "9");
    await waitFor(() => {
      expect(screen.getByText(/Draft saved/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Set 1/ }));
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
    });

    unmount();
    renderClient();

    await waitFor(() => {
      expect(screen.getByLabelText("Reps")).toHaveValue(9);
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.getByText("Draft restored")).toBeInTheDocument();
    });
  });

  it("persists the selected active set across remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderClient();

    await user.click(screen.getByRole("button", { name: /Set 2/ }));
    expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();

    unmount();
    renderClient();

    await waitFor(() => {
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });
  });

  it("persists rest timer mute preference across remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
    });

    await openRestTimerControls(user);
    await user.click(screen.getByRole("button", { name: "Mute alerts" }));
    expect(screen.getByRole("button", { name: "Unmute alerts" })).toBeInTheDocument();

    unmount();
    renderClient();

    await waitFor(() => expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument());
    expect(within(screen.getByTestId("rest-timer-hud")).getByText("Muted")).toBeInTheDocument();

    await openRestTimerControls(user);
    expect(screen.getByRole("button", { name: "Unmute alerts" })).toBeInTheDocument();
  });

  it("logs typed load and rpe without requiring blur", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    const rpeInput = screen.getByLabelText("RPE") as HTMLInputElement;

    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "55");

    await user.click(rpeInput);
    await user.clear(rpeInput);
    await user.type(rpeInput, "9");

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actualLoad: 55,
          actualRpe: 9,
        })
      );
    });
  });

  it("does not wipe sibling prefills when focusing another field", async () => {
    renderClient();

    fireEvent.focus(screen.getByLabelText("Load"));

    await waitFor(() => {
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
      expect(screen.getByLabelText("Load")).toHaveValue(50);
      expect(screen.getByLabelText("RPE")).toHaveValue(8);
    });
  });

  it("blur commit only updates the targeted field", async () => {
    const user = userEvent.setup();
    renderClient();

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "55");
    fireEvent.blur(loadInput);

    await waitFor(() => {
      expect(screen.getByLabelText("Load")).toHaveValue(55);
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
      expect(screen.getByLabelText("RPE")).toHaveValue(8);
    });
  });

  it("preserves draft text when changing active sets", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeThreeSetExercise()} />);

    await user.click(screen.getByRole("button", { name: /Set 2/ }));

    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    await user.click(loadInput);
    await user.clear(loadInput);
    await user.type(loadInput, "57.5");

    await user.click(screen.getByRole("button", { name: /Set 1/ }));
    await user.click(screen.getByRole("button", { name: /Set 2/ }));

    await waitFor(() => {
      expect(screen.getByLabelText("Load")).toHaveValue(57.5);
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
      expect(screen.getByLabelText("RPE")).toHaveValue(8);
    });
  });

  it("clears draft after successful set log", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "draft_set_workout-1_set-1",
      JSON.stringify({ reps: "8", load: "47.5", rpe: "7.5", savedAt: Date.now() })
    );

    renderClient();

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("draft_set_workout-1_set-1")).toBeNull();
    });
  });

  it("uses text-base font size on reps, load, and RPE inputs to prevent iOS autozoom", () => {
    renderClient();
    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    const loadInput = screen.getByLabelText("Load") as HTMLInputElement;
    const rpeInput = screen.getByLabelText("RPE") as HTMLInputElement;
    expect(repsInput.className).toContain("text-base");
    expect(loadInput.className).toContain("text-base");
    expect(rpeInput.className).toContain("text-base");
  });

  it("scrolls active set panel on exercise change, not on every input focus", async () => {
    const scrollSpy = vi.fn();
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });
    // scrollBy is not implemented in jsdom — stub it to suppress noise

    render(
      <LogWorkoutClient
        workoutId="workout-1"
        exercises={makeMultiSectionExercises()}
      />
    );

    // Wait for initial mount scroll (scrollToActiveSet has 150ms delay)
    await new Promise((resolve) => setTimeout(resolve, 300));
    scrollSpy.mockClear();

    // Focus inputs — should NOT trigger scroll
    fireEvent.focus(screen.getByLabelText("Reps"));
    fireEvent.focus(screen.getByLabelText("Load"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(scrollToSpy).not.toHaveBeenCalled();

    // Log the active set → exercise changes → scrollToActiveSet fires
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
  });

  it("does not auto-scroll when toggling an exercise row in the queue", async () => {
    const user = userEvent.setup();
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });

    renderClient();

    const queueRow = screen.getByTestId("queue-row-ex-1");
    await user.click(within(queueRow).getByRole("button", { name: /Dumbbell Bench Press/ }));

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Set 1 of 2/)).toBeInTheDocument();
  });
});

function makeThreeSetExercise(): LogExerciseInput[] {
  return [
    {
      workoutExerciseId: "ex-1",
      name: "Dumbbell Bench Press",
      equipment: ["dumbbell"],
      isMainLift: true,
      sets: [
        { setId: "set-1", setIndex: 1, targetReps: 10, targetLoad: 50, targetRpe: 8, restSeconds: 90 },
        { setId: "set-2", setIndex: 2, targetReps: 10, targetLoad: 50, targetRpe: 8, restSeconds: 90 },
        { setId: "set-3", setIndex: 3, targetReps: 10, targetLoad: 50, targetRpe: 8, restSeconds: 90 },
      ],
    },
  ];
}

function makeMultiSectionExercises(): SectionedExercises {
  return {
    warmup: [
      {
        workoutExerciseId: "ex-warmup",
        name: "Band Pull Apart",
        isMainLift: false,
        sets: [{ setId: "set-w1", setIndex: 1, targetReps: 15, restSeconds: 60 }],
      },
    ],
    main: [
      {
        workoutExerciseId: "ex-main",
        name: "Barbell Bench Press",
        equipment: ["barbell"],
        isMainLift: true,
        sets: [
          { setId: "set-m1", setIndex: 1, targetReps: 5, targetLoad: 185, targetRpe: 8, restSeconds: 180 },
          { setId: "set-m2", setIndex: 2, targetReps: 5, targetLoad: 185, targetRpe: 8, restSeconds: 180 },
        ],
      },
    ],
    accessory: [
      {
        workoutExerciseId: "ex-acc",
        name: "Cable Fly",
        equipment: ["cable"],
        isMainLift: false,
        sets: [{ setId: "set-a1", setIndex: 1, targetReps: 12, targetLoad: 30, targetRpe: 8, restSeconds: 90 }],
      },
    ],
  };
}

function makeGapFillExercises(): SectionedExercises {
  return {
    warmup: [],
    main: [
      {
        workoutExerciseId: "ex-gap-main",
        name: "Leg Press",
        equipment: ["machine"],
        isMainLift: true,
        sets: [
          {
            setId: "set-gap-main-1",
            setIndex: 1,
            targetReps: 10,
            targetLoad: 180,
            targetRpe: 8,
            restSeconds: 120,
            actualReps: 10,
            actualLoad: 180,
            actualRpe: 8,
          },
        ],
      },
    ],
    accessory: [
      {
        workoutExerciseId: "ex-gap-acc",
        name: "Seated Leg Curl",
        equipment: ["machine"],
        isMainLift: false,
        sets: [
          {
            setId: "set-gap-acc-1",
            setIndex: 1,
            targetReps: 12,
            targetLoad: 60,
            targetRpe: 8,
            restSeconds: 90,
            wasSkipped: true,
          },
          {
            setId: "set-gap-acc-2",
            setIndex: 2,
            targetReps: 12,
            targetLoad: 60,
            targetRpe: 8,
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

function makeGapFillSwapExercises(): SectionedExercises {
  return {
    warmup: [],
    main: [],
    accessory: [
      {
        workoutExerciseId: "ex-gap-swap",
        name: "T-Bar Row",
        equipment: ["barbell"],
        movementPatterns: ["horizontal_pull"],
        isMainLift: false,
        sets: [
          {
            setId: "set-gap-swap-1",
            setIndex: 1,
            targetReps: 10,
            targetLoad: 120,
            targetRpe: 8,
            restSeconds: 120,
          },
          {
            setId: "set-gap-swap-2",
            setIndex: 2,
            targetReps: 10,
            targetLoad: 120,
            targetRpe: 8,
            restSeconds: 120,
          },
        ],
      },
    ],
  };
}

function makeQueuePerformanceExercises(): LogExerciseInput[] {
  return [
    {
      workoutExerciseId: "ex-1",
      name: "Dumbbell Bench Press",
      equipment: ["dumbbell"],
      isMainLift: true,
      sets: [
        { setId: "set-1", setIndex: 1, targetReps: 10, targetLoad: 50, targetRpe: 8, restSeconds: 90 },
        { setId: "set-2", setIndex: 2, targetReps: 10, targetLoad: 50, targetRpe: 8, restSeconds: 90 },
      ],
    },
    {
      workoutExerciseId: "ex-2",
      name: "Chest Supported Row",
      equipment: ["dumbbell"],
      isMainLift: false,
      sets: [
        { setId: "set-3", setIndex: 1, targetReps: 12, targetLoad: 40, targetRpe: 8, restSeconds: 90 },
        { setId: "set-4", setIndex: 2, targetReps: 12, targetLoad: 40, targetRpe: 8, restSeconds: 90 },
      ],
    },
  ];
}

describe("4d - Active card edit mode", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("logged chip opens the active card in edit mode with canonical values", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));

    await waitFor(() => {
      expect(screen.getByTestId("active-set-edit-banner")).toBeInTheDocument();
      expect(screen.getByText("Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
      expect(screen.getByLabelText("Load")).toHaveValue(50);
      expect(screen.getByLabelText("RPE")).toHaveValue(8);
      expect(screen.queryByTestId("chip-edit-form")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Return" }));

    await waitFor(() => {
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });
  });

  it("returning from edit mode does not prompt when the draft is untouched", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    await user.click(screen.getByRole("button", { name: "Return" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });
  });

  it("prompts before discarding dirty edit-mode changes and cancel keeps editing", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    await user.click(screen.getByRole("button", { name: "Return" }));
    expect(screen.getByRole("dialog", { name: "Discard edit confirmation" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.getByTestId("active-set-edit-banner")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(11);
    });
  });

  it("discard confirmation resets the edit draft and returns to the live set", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    await user.click(screen.getByRole("button", { name: "Return" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
    });
  });

  it("prompt protects switching to another logged set while edit mode is dirty", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeQueuePerformanceExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    await user.click(screen.getByRole("button", { name: /Set 2 OK 50 x 10 @8/ }));

    expect(screen.getByRole("dialog", { name: "Discard edit confirmation" })).toBeInTheDocument();
    expect(screen.getByText("Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
    expect(screen.getByLabelText("Reps")).toHaveValue(11);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.getByText("Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(11);
    });

    await user.click(screen.getByRole("button", { name: /Set 2 OK 50 x 10 @8/ }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.getByText("Set 2 - Dumbbell Bench Press")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
    });
  });

  it("prompt protects switching to another queue target while edit mode is dirty", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    await user.click(screen.getByRole("button", { name: /Set 2$/ }));

    expect(screen.getByRole("dialog", { name: "Discard edit confirmation" })).toBeInTheDocument();
    expect(screen.getByText("Set 1 - Dumbbell Bench Press")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
    });
  });

  it("clean draft switches to another queue target immediately without prompting", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    await user.click(screen.getByRole("button", { name: /Set 2$/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });
  });

  it("submitting edit mode updates the logged set and returns to the live set", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));

    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "12");
    await user.click(screen.getByRole("button", { name: "Update set" }));

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(2);
      expect(mockedLogSetRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workoutSetId: "set-1",
          actualReps: 12,
          actualLoad: 50,
          actualRpe: 8,
        })
      );
      expect(screen.queryByTestId("active-set-edit-banner")).not.toBeInTheDocument();
      expect(screen.getByText(/Set 2 of 2/)).toBeInTheDocument();
    });
  });

  it("editing a logged set does not restart the live rest timer", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByText("1:30")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    await user.clear(screen.getByLabelText("Reps"));
    await user.type(screen.getByLabelText("Reps"), "12");
    await user.click(screen.getByRole("button", { name: "Update set" }));

    await waitFor(() => {
      expect(screen.getByText("1:30")).toBeInTheDocument();
    });
  });

  it("shows queue guidance for active-card editing", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText("Dark chip is the selected set. Logged chips reopen the active card in edit mode.")
    ).toBeInTheDocument();
  });
});

describe("Queue render stability", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("typing in the active set does not rerender unrelated exercise rows", async () => {
    const user = userEvent.setup();
    const rowRenderSpy = vi.fn();
    render(
      <LogWorkoutClient
        workoutId="workout-1"
        exercises={makeQueuePerformanceExercises()}
        onQueueExerciseRowRender={rowRenderSpy}
      />
    );

    await waitFor(() => {
      expect(rowRenderSpy).toHaveBeenCalledWith("ex-1");
      expect(rowRenderSpy).toHaveBeenCalledWith("ex-2");
    });

    rowRenderSpy.mockClear();

    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");

    expect(rowRenderSpy).not.toHaveBeenCalled();
  });

  it("editing a logged set rerenders only the affected exercise row", async () => {
    const user = userEvent.setup();
    const rowRenderSpy = vi.fn();
    render(
      <LogWorkoutClient
        workoutId="workout-1"
        exercises={makeQueuePerformanceExercises()}
        onQueueExerciseRowRender={rowRenderSpy}
      />
    );

    await waitFor(() => {
      expect(rowRenderSpy).toHaveBeenCalledWith("ex-1");
      expect(rowRenderSpy).toHaveBeenCalledWith("ex-2");
    });

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    rowRenderSpy.mockClear();
    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");
    await user.click(screen.getByRole("button", { name: "Update set" }));

    await waitFor(() => {
      const rerenderedRows = rowRenderSpy.mock.calls.map(([exerciseId]) => exerciseId);
      expect(rerenderedRows).toContain("ex-1");
      expect(rerenderedRows).not.toContain("ex-2");
    });
  });
});

describe("4i - Exercise queue expansion stays user-controlled", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not force-collapse non-active sections by layout side effects", () => {
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    expect(screen.queryByTestId("collapsed-summary-warmup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-accessory")).not.toBeInTheDocument();
  });

  it("advancing sets does not rewrite section expansion state", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(screen.queryByTestId("collapsed-summary-warmup")).not.toBeInTheDocument();
      expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();
    });
  });

  it("manual section toggles are preserved while active set remains in warmup", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    const warmupSection = screen.getByRole("button", { name: /Warmup.*Hide/i });
    await user.click(warmupSection);
    expect(screen.getByTestId("collapsed-summary-warmup")).toBeInTheDocument();

    expect(screen.getByText(/Warmup .* Set 1/)).toBeInTheDocument();
  });

  it("all sections hidden when workout is completed", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    await logVisibleSets(user, 4);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText(/Session complete|Workout marked as completed/)).toBeInTheDocument();
    });

    expect(screen.queryByTestId("collapsed-summary-warmup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-accessory")).not.toBeInTheDocument();
  });
});

describe("L-2/L-3/L-1/T-1/T-3 — Layout and UX fixes", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("L-3: logging a set does not show the transient undo toast", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.queryByText(/Set logged. Undo available/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });
  });

  it("T-3: mute preference persists across rest timer remounts", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument());

    await openRestTimerControls(user);
    await user.click(screen.getByRole("button", { name: "Mute alerts" }));
    expect(screen.getByRole("button", { name: "Unmute alerts" })).toBeInTheDocument();

    await clickResolvedSubmitButton(user);

    await waitFor(() => expect(within(screen.getByTestId("rest-timer-hud")).getByText("Muted")).toBeInTheDocument());
  });

  it("T-1: compact timer HUD remains visible and dismisses the sheet when keyboard opens", async () => {
    const viewport = setupVisualViewport();

    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument());
    await openRestTimerControls(user);
    expect(screen.getByTestId("rest-timer-expanded-controls")).toBeInTheDocument();

    viewport.setHeight(480);

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.queryByTestId("rest-timer-expanded-controls")).not.toBeInTheDocument();
    });
  });

  it("T-1: expanded timer controls stay hidden until the HUD is tapped", async () => {
    const viewport = setupVisualViewport();

    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.queryByTestId("rest-timer-expanded-controls")).not.toBeInTheDocument();
    });

    viewport.setHeight(800);

    await openRestTimerControls(user);

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-expanded-controls")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mute alerts" })).toBeInTheDocument();
    });
  });

  it("L-1: bottom padding updates when visualViewport height changes", async () => {
    const viewport = setupVisualViewport();

    const { container } = render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    const root = container.firstChild as HTMLElement;

    // Initially: keyboard closed, padding uses safe-area fallback
    expect(root).toHaveStyle({ paddingBottom: "env(safe-area-inset-bottom, 16px)" });

    // Simulate keyboard opening (320px keyboard)
    viewport.setHeight(480);

    await waitFor(() => {
      expect(root).toHaveStyle({ paddingBottom: "336px" }); // 320 + 16
    });
  });

  it("does not reserve fake top padding when focusing inputs with an active timer", async () => {
    const viewport = setupVisualViewport();

    const user = userEvent.setup();
    const { container } = render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    const root = container.firstChild as HTMLElement;

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(root.style.paddingTop).toBe("");
    });

    (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    (window.scrollTo as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.focus(screen.getByLabelText("Reps"));
    viewport.setHeight(480);

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(root.style.paddingTop).toBe("");
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });

  it("finish bar stays reachable with timer HUD and keyboard viewport changes", async () => {
    const viewport = setupVisualViewport();
    const user = userEvent.setup();
    const { container } = render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    const root = container.firstChild as HTMLElement;

    await logAllSets(user);

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar")).toBeInTheDocument();
      expect(screen.getByTestId("workout-finish-bar").className).toContain(
        "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+var(--workout-footer-viewport-offset,0px))]"
      );
      expect(
        screen.getByTestId("workout-finish-bar").style.getPropertyValue("--workout-footer-viewport-offset")
      ).toBe("0px");
      expect(root.style.paddingBottom).toContain("var(--mobile-nav-height)");
      expect(root.style.paddingBottom).toContain("88px");
    });

    viewport.setHeight(480);

    await waitFor(() => {
      expect(screen.getByTestId("workout-finish-bar")).toHaveStyle({ bottom: "320px" });
      expect(root).toHaveStyle({ paddingBottom: "408px" });
      expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    });
  });

  it("completion dialog follows visual viewport drift when browser chrome shrinks without a keyboard", async () => {
    const viewport = setupVisualViewport();
    const user = userEvent.setup();
    const { container } = render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    const root = container.firstChild as HTMLElement;

    await logAllSets(user);

    viewport.setViewport({ height: 760 });

    await waitFor(() => {
      expect(screen.getByTestId("workout-finish-bar").style.bottom).toBe("");
      expect(
        screen.getByTestId("workout-finish-bar").style.getPropertyValue("--workout-footer-viewport-offset")
      ).toBe("40px");
      expect(root.style.paddingBottom).toContain("var(--mobile-nav-height)");
    });

    await user.click(screen.getByRole("button", { name: "Finish workout" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toHaveStyle({
        bottom: "40px",
      });
    });
  });

  it("discard confirmation follows visual viewport drift when browser chrome shrinks without a keyboard", async () => {
    const viewport = setupVisualViewport();
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    viewport.setViewport({ height: 760 });

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = await screen.findByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");
    await user.click(screen.getByRole("button", { name: "Return" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Discard edit confirmation" })).toHaveStyle({
        bottom: "40px",
      });
    });
  });

  it("keyboard viewport changes do not add fake bottom offset to the completion dialog", async () => {
    const viewport = setupVisualViewport();
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await logAllSets(user);
    viewport.setHeight(480);

    await user.click(screen.getByRole("button", { name: "Finish workout" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toHaveStyle({
        bottom: "0px",
      });
    });
  });

  it("keyboard viewport changes do not add fake bottom offset to the discard confirmation", async () => {
    const viewport = setupVisualViewport();
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    viewport.setHeight(480);

    await user.click(screen.getByRole("button", { name: /Set 1 OK 50 x 10 @8/ }));
    const repsInput = await screen.findByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "11");
    await user.click(screen.getByRole("button", { name: "Return" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Discard edit confirmation" })).toHaveStyle({
        bottom: "0px",
      });
    });
  });
});

describe("I-2/I-4/I-5/E-4/E-5/E-6/L-4/S-5 — Remaining low-priority fixes", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue(makeSaveWorkoutResponse("COMPLETED"));
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("I-2: Same as last button is disabled when no previous set is logged", () => {
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    const btn = screen.getByRole("button", { name: "Same as last" });
    expect(btn).toBeDisabled();
  });

  it("I-2: Same as last button is enabled after first set is logged", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Same as last" })).not.toBeDisabled();
    });
  });

  it("I-4: RPE preset buttons include 6", () => {
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    // All five preset buttons should be present
    expect(screen.getByRole("button", { name: "6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10" })).toBeInTheDocument();
  });

  it("I-5: shows spinner in Log set button while saving", async () => {
    let resolveLog!: (val: { data: { status: string; wasCreated: boolean }; error: null }) => void;
    mockedLogSetRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLog = resolve;
        })
    );

    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.getByTestId("log-set-spinner")).toBeInTheDocument();
    });

    resolveLog({ data: { status: "ok", wasCreated: true }, error: null });

    await waitFor(() => {
      expect(screen.queryByTestId("log-set-spinner")).not.toBeInTheDocument();
    });
  });

  it("E-4: shows spinner in Confirm button while completion submitting", async () => {
    const user = userEvent.setup();
    let resolveSave!: (
      val: Awaited<ReturnType<typeof workoutApi.saveWorkoutRequest>>
    ) => void;
    mockedSaveWorkoutRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    await logAllSets(user);

    await user.click(screen.getByRole("button", { name: "Finish workout" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByTestId("completion-spinner")).toBeInTheDocument();
    });

    resolveSave(makeSaveWorkoutResponse("COMPLETED"));

    await waitFor(() => {
      expect(screen.queryByTestId("completion-spinner")).not.toBeInTheDocument();
    });
  });

  it("E-5: error snackbar follows visual viewport drift without treating it as keyboard state", async () => {
    const viewport = setupVisualViewport();
    mockedLogSetRequest.mockResolvedValueOnce({ data: null, error: "Shifted error" });

    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    viewport.setViewport({ height: 760 });
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      const snackbar = screen.getByTestId("error-snackbar");
      expect(snackbar.style.bottom).toContain("40px");
    });
  });

  it("E-5: log set error renders as fixed snackbar with Dismiss button", async () => {
    mockedLogSetRequest.mockResolvedValueOnce({ data: null, error: "Server error" });

    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.getByTestId("error-snackbar")).toBeInTheDocument();
    });

    const snackbar = screen.getByTestId("error-snackbar");
    expect(snackbar).toHaveStyle({ position: "fixed" });
    expect(screen.getByText("Server error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("E-5: Dismiss button clears the error snackbar", async () => {
    mockedLogSetRequest.mockResolvedValueOnce({ data: null, error: "Server error" });

    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => expect(screen.getByTestId("error-snackbar")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByTestId("error-snackbar")).not.toBeInTheDocument();
    });
  });

  it("E-5: error snackbar auto-clears after 5 seconds", async () => {
    mockedLogSetRequest.mockResolvedValueOnce({ data: null, error: "Auto-clear error" });

    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => expect(screen.getByTestId("error-snackbar")).toBeInTheDocument());

    await new Promise((resolve) => setTimeout(resolve, 5100));

    await waitFor(() => {
      expect(screen.queryByTestId("error-snackbar")).not.toBeInTheDocument();
    });
  }, 10000);

  it("E-6: rest timer is cleared after successful workout completion", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await logAllSets(user);

    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockedSaveWorkoutRequest).toHaveBeenCalledWith(
        expect.objectContaining({ workoutId: "workout-1", action: "mark_completed" })
      );
      expect(screen.getByText("Session complete!")).toBeInTheDocument();
      expect(screen.queryByTestId("rest-timer-hud")).not.toBeInTheDocument();
    });
  });

  it("L-4: status message clears after 2500ms", async () => {
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    fireEvent.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      expect(screen.getByText("Set logged. Rest timer started.")).toBeInTheDocument();
    });

    await new Promise((resolve) => setTimeout(resolve, 2600));

    await waitFor(() => {
      expect(screen.queryByText("Set logged. Rest timer started.")).not.toBeInTheDocument();
    });
  }, 8000);
});
