import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeExerciseSwapSheet } from "./RuntimeExerciseSwapSheet";

function setupDialogMocks() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
    }),
  });
}

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsedUrl = new URL(String(input), "http://localhost");

    if (
      parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise" &&
      init?.method == null
    ) {
      const query = parsedUrl.searchParams.get("q");

      if (query === "machine") {
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                exerciseId: "machine-row",
                exerciseName: "Machine Row",
                primaryMuscles: ["lats", "upper back"],
                equipment: ["machine"],
                reason: "Keeps lats, matches horizontal pull, and reduces setup demands.",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              exerciseId: "chest-supported-db-row",
              exerciseName: "Chest-Supported Dumbbell Row",
              primaryMuscles: ["lats", "upper back"],
              equipment: ["dumbbell"],
              reason: "Keeps lats, matches horizontal pull, and reduces fatigue.",
            },
            {
              exerciseId: "cable-row",
              exerciseName: "Cable Row",
              primaryMuscles: ["lats", "upper back"],
              equipment: ["cable"],
              reason: "Keeps lats, matches horizontal pull, and reduces fatigue.",
            },
          ],
        }),
      };
    }

    if (parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise-preview") {
      const candidateId = parsedUrl.searchParams.get("exerciseId");

      if (candidateId === "chest-supported-db-row") {
        return {
          ok: true,
          json: async () => ({
            exercise: {
              workoutExerciseId: "we-1",
              exerciseId: "chest-supported-db-row",
              name: "Chest-Supported Dumbbell Row",
              equipment: ["DUMBBELL"],
              movementPatterns: ["horizontal_pull"],
              isMainLift: false,
              isSwapped: true,
              section: "MAIN",
              sessionNote:
                "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
              sets: [
                {
                  setId: "set-1",
                  setIndex: 1,
                  targetReps: 10,
                  targetRepRange: { min: 8, max: 12 },
                  targetLoad: 27.5,
                  targetRpe: 8,
                  restSeconds: 120,
                },
                {
                  setId: "set-2",
                  setIndex: 2,
                  targetReps: 10,
                  targetRepRange: { min: 8, max: 12 },
                  targetLoad: 27.5,
                  targetRpe: 8,
                  restSeconds: 120,
                },
              ],
            },
          }),
        };
      }

      if (candidateId === "cable-row") {
        return {
          ok: true,
          json: async () => ({
            exercise: {
              workoutExerciseId: "we-1",
              exerciseId: "cable-row",
              name: "Cable Row",
              equipment: ["CABLE"],
              movementPatterns: ["horizontal_pull"],
              isMainLift: false,
              isSwapped: true,
              section: "MAIN",
              sessionNote:
                "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
              sets: [
                {
                  setId: "set-1",
                  setIndex: 1,
                  targetReps: 12,
                  targetRepRange: { min: 10, max: 14 },
                  targetLoad: null,
                  targetRpe: 7,
                  restSeconds: 90,
                },
              ],
            },
          }),
        };
      }

      if (candidateId === "machine-row") {
        return {
          ok: true,
          json: async () => ({
            exercise: {
              workoutExerciseId: "we-1",
              exerciseId: "machine-row",
              name: "Machine Row",
              equipment: ["MACHINE"],
              movementPatterns: ["horizontal_pull"],
              isMainLift: false,
              isSwapped: true,
              section: "MAIN",
              sessionNote:
                "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
              sets: [
                {
                  setId: "set-1",
                  setIndex: 1,
                  targetReps: 12,
                  targetRepRange: { min: 10, max: 14 },
                  targetLoad: 90,
                  targetRpe: 7,
                  restSeconds: 90,
                },
              ],
            },
          }),
        };
      }
    }

    if (
      parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise" &&
      init?.method === "POST"
    ) {
      return {
        ok: true,
        json: async () => ({
          exercise: {
            workoutExerciseId: "we-1",
            exerciseId: "chest-supported-db-row",
            name: "Chest-Supported Dumbbell Row",
            equipment: ["DUMBBELL"],
            movementPatterns: ["horizontal_pull"],
            isMainLift: false,
            isSwapped: true,
            section: "MAIN",
            sessionNote:
              "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
            sets: [
              {
                setId: "set-1",
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 27.5,
                targetRpe: 8,
                restSeconds: 120,
              },
              {
                setId: "set-2",
                setIndex: 2,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 27.5,
                targetRpe: 8,
                restSeconds: 120,
              },
            ],
          },
        }),
      };
    }

    throw new Error(`Unhandled fetch: ${String(input)}`);
  });
}

describe("RuntimeExerciseSwapSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDialogMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders canonical preview rows for visible candidates before confirm and keeps mutation unchanged", async () => {
    const onSwap = vi.fn();
    const onClose = vi.fn();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RuntimeExerciseSwapSheet
        isOpen
        onClose={onClose}
        workoutId="workout-1"
        exercise={{ workoutExerciseId: "we-1", name: "T-Bar Row" }}
        onSwap={onSwap}
      />
    );

    expect(
      screen.getByText(
        "This replaces the exercise in place for this session and keeps future progression exercise-specific to the replacement."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Search replacements")).toBeInTheDocument();
    expect(screen.queryByText(/Narrow runtime swap/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/planned slot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/constrained equivalents/i)).not.toBeInTheDocument();
    expect(await screen.findAllByText("Post-swap prescription")).toHaveLength(2);
    expect(
      screen.getByText("Set 1: 10 reps (8-12) | Load hint 27.5 lbs each | Target RPE 8 | 2 min rest")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Set 2: 10 reps (8-12) | Load hint 27.5 lbs each | Target RPE 8 | 2 min rest")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Set 1: 12 reps (10-14) | No load hint | Target RPE 7 | 90 sec rest")
    ).toBeInTheDocument();

    const previewCalls = fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl).startsWith("/api/workouts/workout-1/swap-exercise-preview?")
    );
    expect(previewCalls).toHaveLength(2);
    expect(
      previewCalls.some(([requestUrl]) =>
        String(requestUrl).includes("exerciseId=chest-supported-db-row")
      )
    ).toBe(true);
    expect(
      previewCalls.some(([requestUrl]) => String(requestUrl).includes("exerciseId=cable-row"))
    ).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Use swap" })[0]);

    await waitFor(() => {
      expect(onSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Chest-Supported Dumbbell Row",
          sets: [
            expect.objectContaining({
              targetRepRange: { min: 8, max: 12 },
              targetLoad: 27.5,
              targetRpe: 8,
              restSeconds: 120,
            }),
            expect.objectContaining({
              targetRepRange: { min: 8, max: 12 },
              targetLoad: 27.5,
              targetRpe: 8,
              restSeconds: 120,
            }),
          ],
        })
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps confirm disabled until the canonical preview has loaded", async () => {
    let resolvePreview!: (value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const parsedUrl = new URL(String(input), "http://localhost");

      if (
        parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise" &&
        init?.method == null
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            candidates: [
              {
                exerciseId: "chest-supported-db-row",
                exerciseName: "Chest-Supported Dumbbell Row",
                primaryMuscles: ["lats", "upper back"],
                equipment: ["dumbbell"],
                reason: "Keeps lats, matches horizontal pull, and reduces fatigue.",
              },
            ],
          }),
        });
      }

      if (parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise-preview") {
        return new Promise((resolve) => {
          resolvePreview = resolve;
        });
      }

      throw new Error(`Unhandled fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RuntimeExerciseSwapSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        exercise={{ workoutExerciseId: "we-1", name: "T-Bar Row" }}
        onSwap={vi.fn()}
      />
    );

    expect(await screen.findByText("Chest-Supported Dumbbell Row")).toBeInTheDocument();
    expect(await screen.findByText("Loading exact post-swap prescription...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loading preview..." })).toBeDisabled();

    resolvePreview({
      ok: true,
      json: async () => ({
        exercise: {
          workoutExerciseId: "we-1",
          exerciseId: "chest-supported-db-row",
          name: "Chest-Supported Dumbbell Row",
          equipment: ["DUMBBELL"],
          movementPatterns: ["horizontal_pull"],
          isMainLift: false,
          isSwapped: true,
          section: "MAIN",
          sessionNote:
            "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
          sets: [
            {
              setId: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepRange: { min: 8, max: 12 },
              targetLoad: 27.5,
              targetRpe: 8,
              restSeconds: 120,
            },
          ],
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Use swap" })).toBeEnabled();
    });
  });

  it("makes preview failure explicit and disables confirm for that row", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsedUrl = new URL(String(input), "http://localhost");

      if (
        parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise" &&
        init?.method == null
      ) {
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                exerciseId: "chest-supported-db-row",
                exerciseName: "Chest-Supported Dumbbell Row",
                primaryMuscles: ["lats", "upper back"],
                equipment: ["dumbbell"],
                reason: "Keeps lats, matches horizontal pull, and reduces fatigue.",
              },
            ],
          }),
        };
      }

      if (parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise-preview") {
        return {
          ok: false,
          json: async () => ({ error: "Preview route failed." }),
        };
      }

      throw new Error(`Unhandled fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RuntimeExerciseSwapSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        exercise={{ workoutExerciseId: "we-1", name: "T-Bar Row" }}
        onSwap={vi.fn()}
      />
    );

    expect(
      await screen.findByText(
        "Preview unavailable. Confirm is disabled until the exact prescription loads."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Preview route failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview required" })).toBeDisabled();
  });

  it("uses the same server-backed route for typed narrowing and only preview-hydrates visible search results", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RuntimeExerciseSwapSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        exercise={{ workoutExerciseId: "we-1", name: "T-Bar Row" }}
        onSwap={vi.fn()}
      />
    );

    expect(await screen.findAllByText("Post-swap prescription")).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText("Search by name, alias, muscle, or equipment..."), {
      target: { value: "machine" },
    });

    expect(await screen.findByText("Machine Row")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([requestUrl]) =>
          String(requestUrl) ===
          "/api/workouts/workout-1/swap-exercise?workoutExerciseId=we-1&q=machine&limit=8"
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([requestUrl]) => String(requestUrl).startsWith("/api/exercises/search"))
    ).toBe(false);

    const machinePreviewCalls = fetchMock.mock.calls.filter(
      ([requestUrl]) =>
        String(requestUrl).startsWith("/api/workouts/workout-1/swap-exercise-preview?") &&
        String(requestUrl).includes("exerciseId=machine-row")
    );
    expect(machinePreviewCalls).toHaveLength(1);

    const previewCallsAfterSearch = fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl).startsWith("/api/workouts/workout-1/swap-exercise-preview?")
    );
    expect(previewCallsAfterSearch).toHaveLength(3);
  });

  it("renders an empty candidate state as a clean no-replacement outcome", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const parsedUrl = new URL(String(input), "http://localhost");

      if (
        parsedUrl.pathname === "/api/workouts/workout-1/swap-exercise" &&
        init?.method == null
      ) {
        return {
          ok: true,
          json: async () => ({ candidates: [] }),
        };
      }

      throw new Error(`Unhandled fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RuntimeExerciseSwapSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        exercise={{ workoutExerciseId: "we-1", name: "Closeout Cable Fly" }}
        onSwap={vi.fn()}
      />
    );

    expect(await screen.findByText("No safe replacements found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use swap" })).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});
