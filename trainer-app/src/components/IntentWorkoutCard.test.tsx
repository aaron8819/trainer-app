import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntentWorkoutCard } from "./IntentWorkoutCard";

describe("IntentWorkoutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    render(<IntentWorkoutCard initialIntent="body_part" />);

    fireEvent.change(screen.getByPlaceholderText("e.g., chest, triceps"), {
      target: { value: "rear delts" },
    });
    fireEvent.click(screen.getByLabelText("Supplemental deficit session"));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const generateCall = fetchMock.mock.calls[0];
    expect(generateCall[0]).toBe("/api/workouts/generate-from-intent");
    expect(JSON.parse(generateCall[1].body as string)).toMatchObject({
      intent: "body_part",
      targetMuscles: ["rear delts"],
      supplementalDeficitSession: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveCall = fetchMock.mock.calls[1];
    expect(saveCall[0]).toBe("/api/workouts/save");
    const savePayload = JSON.parse(saveCall[1].body as string);
    expect(savePayload.advancesSplit).toBe(false);
    expect(savePayload.selectionMode).toBe("INTENT");
    expect(savePayload.sessionIntent).toBe("BODY_PART");
    expect(savePayload.selectionMetadata).toEqual(selectionMetadata);
  });
});
