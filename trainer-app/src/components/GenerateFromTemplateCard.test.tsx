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
});
