import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerateFromTemplateCard } from "./GenerateFromTemplateCard";

const templates = [
  {
    id: "template-1",
    name: "Push Template",
    exerciseCount: 1,
  },
];

function makeTemplateGenerationResponse() {
  return {
    workout: {
      id: "workout-1",
      scheduledDate: "2026-04-28T12:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "workout-exercise-1",
          orderIndex: 0,
          isMainLift: true,
          exercise: { id: "bench-press", name: "Bench Press" },
          sets: [{ setIndex: 1, targetReps: 8, targetLoad: 185, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 45,
    },
    sraWarnings: [],
    substitutions: [],
    selectionMode: "AUTO",
    sessionIntent: "push",
    selectionMetadata: {
      selectedExerciseIds: ["bench-press"],
      rationale: {},
      sessionDecisionReceipt: {
        version: 2,
        cycleContext: {
          weekInMeso: 1,
          weekInBlock: 1,
          mesocycleLength: 5,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: "meso-v4",
          compositionSource: "persisted_slot_plan_seed",
          seedProvenance: {
            revisionId: "revision-v4",
            revision: 1,
            hash: "3d4e807cbafdb89bd52dc0fb475842b8c18761e2212967614e41acf5e22913b9",
          },
        },
        sessionSlot: {
          slotId: "upper-a",
          intent: "upper",
          sequenceIndex: 0,
          sequenceLength: 4,
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
        exceptions: [],
      },
    },
  };
}

describe("GenerateFromTemplateCard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the pre-generation check-in to the canonical readiness route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeTemplateGenerationResponse(),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByLabelText("Shoulder"));
    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "left shoulder cranky" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const readinessCall = fetchMock.mock.calls[0];
    expect(readinessCall[0]).toBe("/api/readiness/submit");
    expect(JSON.parse(readinessCall[1].body as string)).toEqual({
      subjective: {
        readiness: 3,
        motivation: 3,
        soreness: {
          shoulder: 2,
          elbow: 1,
          low_back: 1,
          knee: 1,
          wrist: 1,
        },
      },
    });

    expect(fetchMock.mock.calls[1][0]).toBe("/api/workouts/generate-from-template");
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("keeps the skip path generating from the selected template", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeTemplateGenerationResponse(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/workouts/generate-from-template");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      templateId: "template-1",
    });
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("formats generated semantic-zero targets from the frozen snapshot", async () => {
    const response = makeTemplateGenerationResponse();
    response.workout.mainLifts = [
      {
        id: "workout-exercise-bulgarian",
        orderIndex: 0,
        isMainLift: true,
        exercise: { id: "bulgarian", name: "Bulgarian Split Squat" },
        sets: [{ setIndex: 1, targetReps: 10, targetLoad: 0, targetRpe: 8 }],
        measurement: {
          profile: "REPS_EXTERNAL_LOAD",
          loadConvention: "IMPLEMENT_WEIGHT",
          repBasis: "PER_SIDE",
        },
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
      } as (typeof response.workout.mainLifts)[number] & {
        measurement: {
          profile: "REPS_EXTERNAL_LOAD";
          loadConvention: "IMPLEMENT_WEIGHT";
          repBasis: "PER_SIDE";
        };
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD";
      },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(await screen.findByText(/Bodyweight/)).toBeInTheDocument();
  });

  it("round-trips the released AUTO template shape without client-authored intent or scheduling receipt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeTemplateGenerationResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workoutId: "workout-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const savePayload = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(savePayload).toMatchObject({
      workoutId: "workout-1",
      templateId: "template-1",
      selectionMode: "AUTO",
      advancesSplit: false,
      selectionMetadata: {
        sessionDecisionReceipt: {
          sessionSlot: {
            slotId: "upper-a",
            intent: "upper",
            sequenceIndex: 0,
            sequenceLength: 4,
            source: "mesocycle_slot_sequence",
          },
        },
      },
    });
    expect(savePayload).not.toHaveProperty("sessionIntent");
    expect(
      savePayload.selectionMetadata.sessionDecisionReceipt,
    ).not.toHaveProperty("scheduledSlotReceipt");
  });
});
