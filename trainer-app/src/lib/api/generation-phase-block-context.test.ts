import { describe, expect, it } from "vitest";

import type { MacroCycle } from "@/lib/engine/periodization/types";

import { resolveGenerationPhaseBlockContext } from "./generation-phase-block-context";

const macroCycle: MacroCycle = {
  id: "macro-1",
  userId: "user-1",
  startDate: new Date("2026-03-01T00:00:00.000Z"),
  endDate: new Date("2026-04-05T00:00:00.000Z"),
  durationWeeks: 5,
  trainingAge: "intermediate",
  primaryGoal: "hypertrophy",
  mesocycles: [
    {
      id: "meso-1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "high",
      intensityBias: "hypertrophy",
      blocks: [
        {
          id: "block-1",
          mesocycleId: "meso-1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        {
          id: "block-2",
          mesocycleId: "meso-1",
          blockNumber: 2,
          blockType: "intensification",
          startWeek: 2,
          durationWeeks: 2,
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        {
          id: "block-3",
          mesocycleId: "meso-1",
          blockNumber: 3,
          blockType: "deload",
          startWeek: 4,
          durationWeeks: 1,
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          adaptationType: "recovery",
        },
      ],
    },
  ],
};

describe("generation phase/block context", () => {
  it("derives the active training block for the requested mesocycle week", () => {
    const result = resolveGenerationPhaseBlockContext({
      macroCycle,
      activeMesocycle: {
        id: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        durationWeeks: 5,
        accumulationSessionsCompleted: 6,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: 3,
      },
      weekInMeso: 3,
    });

    expect(result.blockContext).not.toBeNull();
    expect(result.blockContext?.block.blockType).toBe("intensification");
    expect(result.weekInMeso).toBe(3);
    expect(result.weekInBlock).toBe(1);
    expect(result.profile).toEqual({
      blockType: "intensification",
      weekInBlock: 1,
      blockDurationWeeks: 2,
      isDeload: false,
    });
    expect(result.cycleContext).toEqual({
      weekInMeso: 3,
      weekInBlock: 1,
      mesocycleLength: 5,
      phase: "intensification",
      blockType: "intensification",
      isDeload: false,
      source: "computed",
    });
  });

  it("falls back to lifecycle semantics when block definitions are unavailable", () => {
    const result = resolveGenerationPhaseBlockContext({
      activeMesocycle: {
        id: "meso-1",
        state: "ACTIVE_DELOAD",
        durationWeeks: 5,
        accumulationSessionsCompleted: 12,
        deloadSessionsCompleted: 1,
        sessionsPerWeek: 3,
      },
      weekInMeso: 5,
    });

    expect(result.blockContext).toBeNull();
    expect(result.profile).toEqual({
      blockType: "deload",
      weekInBlock: 1,
      blockDurationWeeks: 1,
      isDeload: true,
    });
    expect(result.cycleContext).toEqual({
      weekInMeso: 5,
      weekInBlock: 1,
      mesocycleLength: 5,
      phase: "deload",
      blockType: "deload",
      isDeload: true,
      source: "fallback",
    });
  });
});
