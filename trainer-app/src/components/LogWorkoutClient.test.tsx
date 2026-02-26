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

describe("LogWorkoutClient UX behavior", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
    window.localStorage.clear();
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

  it("shows completion confirmation before calling completion API", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "Mark workout completed" }));

    expect(screen.getByRole("dialog", { name: "Workout completion confirmation" })).toBeInTheDocument();
    expect(mockedSaveWorkoutRequest).not.toHaveBeenCalled();
  });

  it("does not call completion API when confirmation is canceled", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "Mark workout completed" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedSaveWorkoutRequest).not.toHaveBeenCalled();
  });

  it("writes draft to localStorage on input change", async () => {
    const user = userEvent.setup();
    renderClient();

    const repsInput = screen.getByLabelText("Reps") as HTMLInputElement;
    await user.clear(repsInput);
    await user.type(repsInput, "9");

    await new Promise((resolve) => setTimeout(resolve, 650));

    const saved = window.localStorage.getItem("draft_set_workout-1_set-1");
    expect(saved).not.toBeNull();
    expect(saved).toContain('"reps":"9"');
  });

  it("restores draft values on remount", () => {
    window.localStorage.setItem(
      "draft_set_workout-1_set-1",
      JSON.stringify({ reps: "8", load: "47.5", rpe: "7.5", savedAt: Date.now() })
    );

    renderClient();

    expect(screen.getByLabelText("Reps")).toHaveValue(8);
    expect(screen.getByLabelText("Load")).toHaveValue(47.5);
    expect(screen.getByLabelText("RPE")).toHaveValue(7.5);
    return waitFor(() => {
      expect(screen.getByText("Draft restored")).toBeInTheDocument();
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

  it("scrolls reps and load input into view on focus", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });

    renderClient();

    await user.click(screen.getByLabelText("Reps"));
    await user.click(screen.getByLabelText("Load"));

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });
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

describe("4d — Inline edit on chip tap", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
    window.localStorage.clear();
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

  it("chip tap opens micro-form pre-populated with logged values", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    // Log set-1 with prefilled values (reps=10, load=50, RPE=8)
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(1);
    });

    // Find and click the logged set-1 chip
    const loggedChip = screen.getByRole("button", { name: /Set 1 · 50 ea×10/ });
    await user.click(loggedChip);

    // Verify micro-form appears with pre-populated values
    const form = screen.getByTestId("chip-edit-form");
    expect(form).toBeInTheDocument();
    expect(screen.getByLabelText("Chip edit reps")).toHaveValue(10);
    expect(screen.getByLabelText("Chip edit load")).toHaveValue(50);
    expect(screen.getByLabelText("Chip edit RPE")).toHaveValue(8);
  });

  it("micro-form save calls update path with correct payload", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    // Log set-1
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(1);
    });

    // Open micro-form for logged set-1
    const loggedChip = screen.getByRole("button", { name: /Set 1 · 50 ea×10/ });
    await user.click(loggedChip);

    // Edit reps to 12
    const chipReps = screen.getByLabelText("Chip edit reps");
    await user.clear(chipReps);
    await user.type(chipReps, "12");

    // Click Save
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(2);
      expect(mockedLogSetRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actualReps: 12,
          actualLoad: 50,
          actualRpe: 8,
        })
      );
    });
  });

  it("micro-form cancel leaves logged value unchanged", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    // Log set-1
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => {
      expect(mockedLogSetRequest).toHaveBeenCalledTimes(1);
    });

    // Open micro-form
    const loggedChip = screen.getByRole("button", { name: /Set 1 · 50 ea×10/ });
    await user.click(loggedChip);

    // Edit reps
    const chipReps = screen.getByLabelText("Chip edit reps");
    await user.clear(chipReps);
    await user.type(chipReps, "99");

    // Click Cancel
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Micro-form should be gone
    expect(screen.queryByTestId("chip-edit-form")).not.toBeInTheDocument();

    // logSetRequest should NOT have been called again
    expect(mockedLogSetRequest).toHaveBeenCalledTimes(1);

    // Chip still shows original logged values
    expect(screen.getByRole("button", { name: /Set 1 · 50 ea×10/ })).toBeInTheDocument();
  });

  it("active set chip does not open micro-form (uses existing panel)", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeExercises()} />);

    // Log both sets so set-2 becomes logged AND active
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Log set|Update set/ }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(2));

    // set-2 is now active (dark chip). Click it.
    const activeChip = screen.getByRole("button", { name: /Set 2 · 50 ea/ });
    await user.click(activeChip);

    // No micro-form should appear
    expect(screen.queryByTestId("chip-edit-form")).not.toBeInTheDocument();
  });

  it("only one micro-form open at a time", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeThreeSetExercise()} />);

    // Log set-1
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    // Log set-2
    await user.click(screen.getByRole("button", { name: /Log set|Update set/ }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(2));

    // Now set-1 and set-2 are logged, set-3 is active
    // Open micro-form for set-1
    const chip1 = screen.getByRole("button", { name: /Set 1 · 50 ea/ });
    await user.click(chip1);
    expect(screen.getByTestId("chip-edit-form")).toBeInTheDocument();
    expect(screen.getByText("Edit Set 1")).toBeInTheDocument();

    // Open micro-form for set-2 (should close set-1's)
    const chip2 = screen.getByRole("button", { name: /Set 2 · 50 ea/ });
    await user.click(chip2);

    const forms = screen.getAllByTestId("chip-edit-form");
    expect(forms).toHaveLength(1);
    expect(screen.getByText("Edit Set 2")).toBeInTheDocument();
    expect(screen.queryByText("Edit Set 1")).not.toBeInTheDocument();
  });
});

describe("4i — Collapse exercise queue during active set", () => {
  beforeEach(() => {
    mockedLogSetRequest.mockResolvedValue({ data: { status: "ok", wasCreated: true }, error: null });
    mockedSaveWorkoutRequest.mockResolvedValue({ data: { status: "ok", workoutStatus: "COMPLETED" }, error: null });
    window.localStorage.clear();
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

  it("non-active exercise sections are collapsed when active set exists", () => {
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    // Active set is in warmup (first unlogged), so main and accessory should be collapsed
    const mainSummary = screen.getByTestId("collapsed-summary-main");
    expect(mainSummary).toBeInTheDocument();
    expect(within(mainSummary).getByText("Barbell Bench Press")).toBeInTheDocument();
    expect(within(mainSummary).getByText("0/2 sets logged")).toBeInTheDocument();

    const accSummary = screen.getByTestId("collapsed-summary-accessory");
    expect(accSummary).toBeInTheDocument();
    expect(within(accSummary).getByText("Cable Fly")).toBeInTheDocument();
    expect(within(accSummary).getByText("0/1 sets logged")).toBeInTheDocument();

    // Warmup should NOT have a collapsed summary (it's expanded)
    expect(screen.queryByTestId("collapsed-summary-warmup")).not.toBeInTheDocument();
  });

  it("active exercise section is expanded and others are collapsed on set advance", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    // Initially active set is in warmup. Log it to advance to main section.
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(mockedLogSetRequest).toHaveBeenCalledTimes(1));

    // After logging warmup set, active set advances to main section (set-m1)
    // Now warmup should be collapsed, main should be expanded
    await waitFor(() => {
      expect(screen.getByTestId("collapsed-summary-warmup")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();
  });

  it("manual expand of collapsed section works without changing active set", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    // Active set is in warmup. Main is collapsed.
    expect(screen.getByTestId("collapsed-summary-main")).toBeInTheDocument();

    // Click "Show" on main section to expand it manually
    const mainSection = screen.getByTestId("collapsed-summary-main").closest("div.rounded-2xl") as HTMLElement;
    const showButton = within(mainSection).getByRole("button", { name: /Show/ });
    await user.click(showButton);

    // Main section should now be expanded (no collapsed summary)
    expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();

    // Active set should still be in warmup — verify warmup info in the active set panel
    expect(screen.getByText(/Warmup · Set 1/)).toBeInTheDocument();
  });

  it("all sections hidden when workout is completed", async () => {
    const user = userEvent.setup();
    render(<LogWorkoutClient workoutId="workout-1" exercises={makeMultiSectionExercises()} />);

    // Complete the workout
    await user.click(screen.getByRole("button", { name: "Mark workout completed" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByText(/Session complete|Workout marked as completed/)).toBeInTheDocument();
    });

    // No collapsed summaries should exist (exercise queue is hidden)
    expect(screen.queryByTestId("collapsed-summary-warmup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-main")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-summary-accessory")).not.toBeInTheDocument();
  });
});
