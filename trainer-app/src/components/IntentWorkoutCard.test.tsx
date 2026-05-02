import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentWorkoutCard } from "./IntentWorkoutCard";

describe("IntentWorkoutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the recommended-session reason metadata when provided", () => {
    render(
      <IntentWorkoutCard
        initialIntent="lower"
        initialSlotId="lower_a"
        primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
        nextSessionLabel="Lower 1"
        nextSessionDescription="First lower session this week"
      />
    );

    expect(screen.queryByText("Generate Workout")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start workout" })).toBeInTheDocument();
    expect(screen.getByText("Recommended next session:")).toBeInTheDocument();
    expect(screen.getByText("Lower 1")).toBeInTheDocument();
    expect(screen.getByText("First lower session this week")).toBeInTheDocument();
  });

  it("round-trips supplemental deficit metadata unchanged and saves as non-advancing", async () => {
    const selectionMetadata = {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 2,
          weekInBlock: 2,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionSlot: {
          slotId: "body_part_a",
          intent: "body_part",
          sequenceIndex: 0,
          sequenceLength: 1,
          source: "mesocycle_slot_sequence",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        targetMuscles: ["rear delts"],
        exceptions: [
          {
            code: "supplemental_deficit_session",
            message: "Marked as supplemental deficit session.",
          },
        ],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workout: {
            id: "w-supp-1",
            scheduledDate: "2026-03-05T00:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "we-1",
                orderIndex: 0,
                isMainLift: true,
                exercise: { id: "ex-1", name: "Cable Fly" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
            ],
            accessories: [],
            estimatedMinutes: 35,
          },
          sraWarnings: [],
          substitutions: [],
          volumePlanByMuscle: {},
          selectionMode: "INTENT",
          sessionIntent: "body_part",
          selectionSummary: { selectedCount: 1, pinnedCount: 0, setTargetCount: 1 },
          selectionMetadata,
          filteredExercises: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workoutId: "w-supp-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IntentWorkoutCard
        initialIntent="body_part"
        primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
        nextSessionLabel="Body Part"
        nextSessionDescription="Server-provided body-part session"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("e.g., chest, triceps"), {
      target: { value: "rear delts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Body Part 1")).not.toBeInTheDocument();

    const generateCall = fetchMock.mock.calls[0];
    expect(generateCall[0]).toBe("/api/workouts/generate-from-intent");
    expect(JSON.parse(generateCall[1].body as string)).toMatchObject({
      intent: "body_part",
      targetMuscles: ["rear delts"],
    });
    expect(JSON.parse(generateCall[1].body as string)).not.toHaveProperty(
      "supplementalDeficitSession"
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveCall = fetchMock.mock.calls[1];
    expect(saveCall[0]).toBe("/api/workouts/save");
    const savePayload = JSON.parse(saveCall[1].body as string);
    expect(savePayload).not.toHaveProperty("advancesSplit");
    expect(savePayload.selectionMode).toBe("INTENT");
    expect(savePayload.sessionIntent).toBe("BODY_PART");
    expect(savePayload.selectionMetadata).toEqual(selectionMetadata);
  });

  it("saves generated next-workout exercises by planned orderIndex instead of section grouping", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workout: {
            id: "w-lower-b",
            scheduledDate: "2026-05-02T00:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "we-sldl",
                orderIndex: 0,
                isMainLift: true,
                exercise: { id: "sldl", name: "Stiff-Legged Deadlift" },
                sets: [{ setIndex: 1, targetReps: 8 }],
              },
              {
                id: "we-split-squat",
                orderIndex: 2,
                isMainLift: true,
                exercise: { id: "split-squat", name: "Bulgarian Split Squat" },
                sets: [{ setIndex: 1, targetReps: 10 }],
              },
            ],
            accessories: [
              {
                id: "we-leg-curl",
                orderIndex: 1,
                isMainLift: false,
                exercise: { id: "leg-curl", name: "Seated Leg Curl" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
              {
                id: "we-calf",
                orderIndex: 3,
                isMainLift: false,
                exercise: { id: "calf-raise", name: "Seated Calf Raise" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
            ],
            estimatedMinutes: 50,
          },
          sraWarnings: [],
          substitutions: [],
          volumePlanByMuscle: {},
          selectionMode: "INTENT",
          sessionIntent: "lower",
          selectionSummary: { selectedCount: 4, pinnedCount: 0, setTargetCount: 4 },
          selectionMetadata: {},
          filteredExercises: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workoutId: "w-lower-b" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IntentWorkoutCard
        initialIntent="lower"
        initialSlotId="lower_b"
        primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
        nextSessionLabel="Lower B"
        nextSessionDescription="Fourth session this week"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));

    await waitFor(() => {
      expect(screen.getByText("Seated Calf Raise")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveCall = fetchMock.mock.calls[1];
    const savePayload = JSON.parse(saveCall[1].body as string);

    expect(savePayload.exercises.map((exercise: { exerciseId: string }) => exercise.exerciseId))
      .toEqual(["sldl", "leg-curl", "split-squat", "calf-raise"]);
    expect(savePayload.exercises.map((exercise: { section: string }) => exercise.section))
      .toEqual(["MAIN", "ACCESSORY", "MAIN", "ACCESSORY"]);
  });
});
