import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogWorkoutClient, { type LogExerciseInput } from "./LogWorkoutClient";
import type { SectionedExercises } from "@/components/log-workout/types";
import * as workoutApi from "@/components/log-workout/api";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/log-workout/api", () => ({
  logSetRequest: vi.fn(),
  deleteSetLogRequest: vi.fn(),
  saveWorkoutRequest: vi.fn(),
}));

const mockedLogSetRequest = vi.mocked(workoutApi.logSetRequest);
const mockedDeleteSetLogRequest = vi.mocked(workoutApi.deleteSetLogRequest);
const mockedSaveWorkoutRequest = vi.mocked(workoutApi.saveWorkoutRequest);

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
  let resizeHandler: (() => void) | undefined;
  const mockViewport = {
    height: initialHeight,
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      resizeHandler = handler;
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: mockViewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: initialHeight });

  return {
    setHeight(nextHeight: number) {
      mockViewport.height = nextHeight;
      resizeHandler?.();
    },
  };
}

describe("LogWorkoutClient UX behavior", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
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

  it("applies quick adjustments as exact deltas", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "+2.5" }));
    expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("52.5");

    await user.click(screen.getByRole("button", { name: "-5" }));
    expect((screen.getByLabelText("Load") as HTMLInputElement).value).toBe("47.5");
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

  it("does not call completion API when confirmation is canceled", async () => {
    const user = userEvent.setup();
    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedSaveWorkoutRequest).not.toHaveBeenCalled();
  });

  it("renders the extracted completed review after finishing the workout", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce({
      data: {
        status: "ok",
        workoutStatus: "COMPLETED",
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
      },
      error: null,
    });

    renderClient();

    await logAllSets(user);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText("Session complete!")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
      expect(screen.getByText("Strength updates")).toBeInTheDocument();
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
    expect(finishBar.className).toContain("bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]");
    expect(finishBar.style.bottom).toBe("");
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "... Workout options" })).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.paddingBottom).toContain("var(--mobile-nav-height)");
    expect((container.firstChild as HTMLElement).style.paddingBottom).toContain("88px");
  });

  it("keeps the logging UI active after leave-for-now confirms a partial save", async () => {
    const user = userEvent.setup();
    mockedSaveWorkoutRequest.mockResolvedValueOnce({
      data: { status: "ok", workoutStatus: "PARTIAL" },
      error: null,
    });

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
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
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

    // Log the active set → exercise changes → scrollToActiveSet fires
    fireEvent.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
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

function makeMixedRestExercise(): LogExerciseInput[] {
  return [
    {
      workoutExerciseId: "ex-rest",
      name: "Barbell Row",
      equipment: ["barbell"],
      isMainLift: true,
      sets: [
        { setId: "set-r1", setIndex: 1, targetReps: 8, targetLoad: 135, targetRpe: 8, restSeconds: 60 },
        { setId: "set-r2", setIndex: 2, targetReps: 8, targetLoad: 135, targetRpe: 8, restSeconds: 180 },
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
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
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
      expect(screen.getByText("Editing Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(10);
      expect(screen.getByLabelText("Load")).toHaveValue(50);
      expect(screen.getByLabelText("RPE")).toHaveValue(8);
      expect(screen.queryByTestId("chip-edit-form")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Return to current set" }));

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
    await user.click(screen.getByRole("button", { name: "Return to current set" }));

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

    await user.click(screen.getByRole("button", { name: "Return to current set" }));
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

    await user.click(screen.getByRole("button", { name: "Return to current set" }));
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
    expect(screen.getByText("Editing Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
    expect(screen.getByLabelText("Reps")).toHaveValue(11);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.getByText("Editing Set 1 - Dumbbell Bench Press")).toBeInTheDocument();
      expect(screen.getByLabelText("Reps")).toHaveValue(11);
    });

    await user.click(screen.getByRole("button", { name: /Set 2 OK 50 x 10 @8/ }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Discard edit confirmation" })).not.toBeInTheDocument();
      expect(screen.getByText("Editing Set 2 - Dumbbell Bench Press")).toBeInTheDocument();
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
    expect(screen.getByText("Editing Set 1 - Dumbbell Bench Press")).toBeInTheDocument();

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
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
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
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
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
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
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

  it("L-3: undo toast renders with position fixed when undoSnapshot is set", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));

    await waitFor(() => {
      const paragraph = screen.getByText(/Set logged. Undo available/);
      const toast = paragraph.closest("div[style]") as HTMLElement | null;
      expect(toast).not.toBeNull();
      expect(toast).toHaveStyle({ position: "fixed" });
    });
  });

  it("restores the previous rest timer when undoing a later set log", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMixedRestExercise()} />);

    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(screen.getByText("1:00")).toBeInTheDocument();
    });

    await clickResolvedSubmitButton(user);
    await waitFor(() => {
      expect(screen.getByText("3:00")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByText("1:00")).toBeInTheDocument();
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

    fireEvent.focus(screen.getByLabelText("Reps"));
    viewport.setHeight(480);

    await waitFor(() => {
      expect(screen.getByTestId("rest-timer-hud")).toBeInTheDocument();
      expect(root.style.paddingTop).toBe("");
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
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
        "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]"
      );
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
});

describe("I-2/I-4/I-5/E-4/E-5/E-6/L-4/S-5 — Remaining low-priority fixes", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedDeleteSetLogRequest.mockResolvedValue({ data: { status: "ok" }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
    window.localStorage.clear();
    window.sessionStorage.clear();
    setupDialogMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollBy", { configurable: true, value: vi.fn() });
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
    let resolveSave!: (val: { data: { status: string; workoutStatus: string }; error: null }) => void;
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

    resolveSave({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });

    await waitFor(() => {
      expect(screen.queryByTestId("completion-spinner")).not.toBeInTheDocument();
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
