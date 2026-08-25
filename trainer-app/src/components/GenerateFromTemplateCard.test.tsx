import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeDuplicateSuggestionResponse() {
  const response = makeTemplateGenerationResponse();
  response.workout.mainLifts = [
    { ...response.workout.mainLifts[0]!, id: "bench-a", orderIndex: 0 },
    { ...response.workout.mainLifts[0]!, id: "bench-b", orderIndex: 1 },
  ];
  response.substitutions = [
    {
      placementId: "bench-a",
      originalExerciseId: "bench-press",
      originalName: "Bench Press",
      reason: "Placement A",
      alternatives: [{ id: "push-up", name: "Push-Up", score: 0.9 }],
    },
    {
      placementId: "bench-b",
      originalExerciseId: "bench-press",
      originalName: "Bench Press",
      reason: "Placement B",
      alternatives: [{ id: "dip", name: "Dip", score: 0.9 }],
    },
  ] as never;
  return response;
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

  it("regenerates a preview substitution before saving bodyweight semantics without stale load", async () => {
    const initial = makeTemplateGenerationResponse();
    initial.workout.mainLifts[0] = {
      ...initial.workout.mainLifts[0],
      exercise: { id: "bench-press", name: "Bench Press", equipment: ["barbell"] },
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
      sets: [{ setIndex: 1, targetReps: 8, targetLoad: 185, targetRpe: 8 }],
    } as never;
    initial.substitutions = [{
      placementId: "workout-exercise-1",
      originalExerciseId: "bench-press",
      originalName: "Bench Press",
      reason: "Equipment unavailable",
      alternatives: [{ id: "push-up", name: "Push-Up", score: 0.9 }],
    }] as never;

    const replacement = makeTemplateGenerationResponse();
    replacement.workout.id = "workout-2";
    replacement.workout.mainLifts[0] = {
      ...replacement.workout.mainLifts[0],
      id: "replacement-placement",
      exercise: {
        id: "push-up",
        name: "Push-Up",
        equipment: ["bodyweight"],
      },
      measurement: {
        profile: "REPS_BODYWEIGHT",
        repBasis: "TOTAL",
      },
      sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
    } as never;
    replacement.substitutions = [];
    replacement.selectionMetadata.selectedExerciseIds = ["push-up"];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => initial })
      .mockResolvedValueOnce({ ok: true, json: async () => replacement })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workoutId: "workout-2" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("Push-Up");
    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      templateId: "template-1",
      exerciseReplacements: [{
        placementId: "workout-exercise-1",
        orderIndex: 0,
        originalExerciseId: "bench-press",
        replacementExerciseId: "push-up",
      }],
    });
    const savePayload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(savePayload.exercises).toEqual([
      expect.objectContaining({
        placementId: "replacement-placement",
        exerciseId: "push-up",
        measurement: {
          profile: "REPS_BODYWEIGHT",
          repBasis: "TOTAL",
        },
        sets: [expect.not.objectContaining({ targetLoad: expect.anything() })],
      }),
    ]);
    expect(JSON.stringify(savePayload)).not.toContain("BARBELL_TOTAL");
    expect(JSON.stringify(savePayload)).not.toContain("185");
  });

  it("keeps only the latest overlapping regeneration authoritative", async () => {
    const requestB = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const requestC = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const stale = makeDuplicateSuggestionResponse();
    stale.workout.mainLifts[0] = {
      ...stale.workout.mainLifts[0]!,
      exercise: { id: "push-up", name: "Stale Preview B" },
    };
    const newest = makeDuplicateSuggestionResponse();
    newest.workout.id = "workout-c";
    newest.workout.mainLifts = [
      { ...newest.workout.mainLifts[0]!, exercise: { id: "push-up", name: "Push-Up" } },
      { ...newest.workout.mainLifts[1]!, exercise: { id: "dip", name: "Newest Preview C" } },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeDuplicateSuggestionResponse() })
      .mockImplementationOnce(() => requestB.promise)
      .mockImplementationOnce(() => requestC.promise)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workoutId: "workout-c" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Placement A:");
    const applyButtons = screen.getAllByRole("button", { name: "Apply" });
    fireEvent.click(applyButtons[0]!);
    fireEvent.click(applyButtons[1]!);

    await act(async () => {
      requestC.resolve({ ok: true, json: async () => newest });
    });
    expect(await screen.findByText("Newest Preview C")).toBeInTheDocument();
    await act(async () => {
      requestB.resolve({ ok: true, json: async () => stale });
    });

    expect(screen.queryByText("Stale Preview B")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Apply" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const savePayload = JSON.parse(fetchMock.mock.calls[3]![1].body as string);
    expect(savePayload.workoutId).toBe("workout-c");
    expect(savePayload.exercises.map((entry: { exerciseId: string }) => entry.exerciseId)).toEqual([
      "push-up",
      "dip",
    ]);
  });

  it("ignores a stale failure after a newer regeneration succeeds", async () => {
    const staleRequest = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const newestRequest = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const newest = makeDuplicateSuggestionResponse();
    newest.workout.mainLifts[1] = {
      ...newest.workout.mainLifts[1]!,
      exercise: { id: "dip", name: "Newest Preview C" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeDuplicateSuggestionResponse() })
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => newestRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Placement A:");
    const applyButtons = screen.getAllByRole("button", { name: "Apply" });
    fireEvent.click(applyButtons[0]!);
    fireEvent.click(applyButtons[1]!);
    await act(async () => newestRequest.resolve({ ok: true, json: async () => newest }));
    await screen.findByText("Newest Preview C");
    await act(async () => staleRequest.resolve({
      ok: false,
      json: async () => ({ error: "stale failure" }),
    }));

    expect(screen.queryByText("stale failure")).not.toBeInTheDocument();
    expect(screen.getByText("Newest Preview C")).toBeInTheDocument();
  });

  it("blocks save while regeneration is pending and saves the new canonical preview after success", async () => {
    const regeneration = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const replacement = makeTemplateGenerationResponse();
    replacement.workout.id = "workout-new";
    replacement.workout.mainLifts[0] = {
      ...replacement.workout.mainLifts[0]!,
      exercise: { id: "push-up", name: "Push-Up" },
    };
    const initial = makeTemplateGenerationResponse();
    initial.substitutions = [{
      placementId: "workout-exercise-1",
      originalExerciseId: "bench-press",
      originalName: "Bench Press",
      reason: "Equipment unavailable",
      alternatives: [{ id: "push-up", name: "Push-Up", score: 0.9 }],
    }] as never;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => initial })
      .mockImplementationOnce(() => regeneration.promise)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workoutId: "workout-new" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Bench Press");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const pendingSave = screen.getByRole("button", { name: "Regenerating..." });
    expect(pendingSave).toBeDisabled();
    fireEvent.click(pendingSave);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => regeneration.resolve({ ok: true, json: async () => replacement }));
    expect(await screen.findByText("Push-Up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string).workoutId).toBe("workout-new");
  });

  it("retains the last canonical preview and unapplied state after regeneration failure", async () => {
    const initial = makeDuplicateSuggestionResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => initial })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "regeneration failed" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workoutId: "workout-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Placement A:");
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]!);
    expect(await screen.findByText("regeneration failed")).toBeInTheDocument();
    expect(screen.getAllByText("Bench Press")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save Workout" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const savePayload = JSON.parse(fetchMock.mock.calls[2]![1].body as string);
    expect(savePayload.workoutId).toBe("workout-1");
    expect(savePayload.exercises.every((entry: { exerciseId: string }) => entry.exerciseId === "bench-press")).toBe(true);
  });

  it("keys duplicate suggestion dismiss and apply actions independently by placement", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeDuplicateSuggestionResponse() });
    vi.stubGlobal("fetch", fetchMock);

    render(<GenerateFromTemplateCard templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Workout" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("Placement A:");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("Placement A:")).not.toBeInTheDocument();
    expect(screen.getByText("Placement B:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({
      templateId: "template-1",
      exerciseReplacements: [{
        placementId: "bench-b",
        orderIndex: 1,
        originalExerciseId: "bench-press",
        replacementExerciseId: "dip",
      }],
    });
  });
});
