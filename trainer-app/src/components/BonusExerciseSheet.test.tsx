import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BonusExerciseSheet } from "./BonusExerciseSheet";

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

  it("renders server-backed preview copy and adds the same prescription the preview showed", async () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BonusExerciseSheet
        isOpen
        onClose={onClose}
        workoutId="workout-1"
        onAdd={onAdd}
      />
    );

    expect(
      await screen.findByText(
        "Preview: 2 sets · 10-14 reps · RPE 6.5 · 90 sec rest · Load hint 35 lbs"
      )
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by name or muscle group..."), {
      target: { value: "row" },
    });

    expect(
      await screen.findByText("Preview: 2 sets · 8-10 reps · RPE 7 · 2 min rest")
    ).toBeInTheDocument();

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
});
