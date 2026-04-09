import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BonusExerciseSheet } from "./BonusExerciseSheet";

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              reason: "Chest has room to grow (8/12 sets this week)",
              suggestedSets: 3,
              suggestedLoad: null,
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
            {
              id: "row",
              name: "Cable Row",
              primaryMuscles: ["Back"],
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
          previews: (body.exerciseIds ?? []).flatMap((exerciseId) => {
            if (exerciseId === "fly") {
              return [
                {
                  exerciseId: "fly",
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
                },
              ];
            }

            if (exerciseId === "row") {
              return [
                {
                  exerciseId: "row",
                  exerciseName: "Cable Row",
                  equipment: ["CABLE"],
                  section: "ACCESSORY",
                  isMainLift: false,
                  setCount: 2,
                  targetReps: 9,
                  targetRepRange: { min: 8, max: 10 },
                  targetLoad: null,
                  targetRpe: 7,
                  restSeconds: 120,
                  prescriptionSource: "session_accessory_defaults",
                },
              ];
            }

            return [];
          }),
        }),
      };
    }

    if (url === "/api/workouts/workout-1/add-exercise") {
      return {
        ok: true,
        json: async () => ({
          exercise: {
            workoutExerciseId: "we-2",
            name: "Cable Fly",
            equipment: ["CABLE"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "ACCESSORY",
            sessionNote: "Added during workout. Session-only; future planning ignores it.",
            sets: [
              {
                setId: "set-1",
                setIndex: 1,
                targetReps: 12,
                targetRepRange: { min: 10, max: 14 },
                targetLoad: 35,
                targetRpe: 6.5,
                restSeconds: 90,
              },
              {
                setId: "set-2",
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
}

describe("BonusExerciseSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  afterEach(() => {
    cleanup();
  });

  it("renders server-backed preview copy and adds the same prescription the preview showed", async () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BonusExerciseSheet
        isOpen
        onClose={onClose}
        workoutId="workout-1"
        onAdd={onAdd}
      />
    );

    expect(await screen.findByText(/Preview:\s*2 sets/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by name or muscle group..."), {
      target: { value: "row" },
    });

    expect(await screen.findByText(/Cable Row/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Cable Fly",
          sets: [
            expect.objectContaining({
              targetRepRange: { min: 10, max: 14 },
              targetLoad: 35,
              targetRpe: 6.5,
              restSeconds: 90,
            }),
            expect.objectContaining({
              targetRepRange: { min: 10, max: 14 },
              targetLoad: 35,
              targetRpe: 6.5,
              restSeconds: 90,
            }),
          ],
        })
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses mobile-safe search input sizing and tap targets", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BonusExerciseSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        onAdd={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: "Add" });

    const searchInput = screen.getByPlaceholderText("Search by name or muscle group...");
    expect(searchInput).toHaveAttribute("type", "search");
    expect(searchInput).toHaveAttribute("enterkeyhint", "search");
    expect(searchInput).toHaveAttribute("autocapitalize", "none");
    expect(searchInput).toHaveAttribute("autocorrect", "off");
    expect(searchInput).toHaveAttribute("spellcheck", "false");
    expect(searchInput.className).toContain("min-h-11");
    expect(searchInput.className).toContain("text-base");

    const addButton = screen.getByRole("button", { name: "Add" });
    expect(addButton.className).toContain("min-h-11");
    expect(addButton.className).toContain("min-w-11");
    expect(addButton.className).toContain("text-sm");
  });

  it("resets local query state on reopen while preserving add flow", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <BonusExerciseSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        onAdd={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: "Add" });

    const searchInput = screen.getByPlaceholderText("Search by name or muscle group...") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "row" } });
    await screen.findByText(/Cable Row/);
    expect(searchInput.value).toBe("row");

    rerender(
      <BonusExerciseSheet
        isOpen={false}
        onClose={vi.fn()}
        workoutId="workout-1"
        onAdd={vi.fn()}
      />
    );

    rerender(
      <BonusExerciseSheet
        isOpen
        onClose={vi.fn()}
        workoutId="workout-1"
        onAdd={vi.fn()}
      />
    );

    const reopenedInput = screen.getByPlaceholderText("Search by name or muscle group...") as HTMLInputElement;
    await waitFor(() => {
      expect(reopenedInput.value).toBe("");
    });
    expect(screen.queryByText(/Cable Row/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/workouts/workout-1/bonus-suggestions");
  });
});
