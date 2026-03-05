import { beforeEach, describe, expect, it, vi } from "vitest";

const deriveCurrentMesocycleSessionMock = vi.fn();

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  deriveCurrentMesocycleSession: (...args: unknown[]) => deriveCurrentMesocycleSessionMock(...args),
}));

import {
  buildPerformedLifecycleCounterUpdate,
  deriveSaveRouteMesoSnapshot,
} from "./lifecycle-contract";

describe("save lifecycle contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the save snapshot from the canonical lifecycle helper", () => {
    deriveCurrentMesocycleSessionMock.mockReturnValue({
      week: 4,
      session: 2,
      phase: "ACCUMULATION",
    });

    expect(
      deriveSaveRouteMesoSnapshot({
        id: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        durationWeeks: 5,
        accumulationSessionsCompleted: 10,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: 3,
      })
    ).toEqual({
      week: 4,
      session: 2,
      phase: "ACCUMULATION",
    });

    expect(deriveCurrentMesocycleSessionMock).toHaveBeenCalledWith({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 10,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
  });

  it("increments only the accumulation lifecycle counter for accumulation saves", () => {
    expect(buildPerformedLifecycleCounterUpdate("ACTIVE_ACCUMULATION")).toEqual({
      completedSessions: { increment: 1 },
      accumulationSessionsCompleted: { increment: 1 },
    });
  });

  it("increments only the deload lifecycle counter for deload saves", () => {
    expect(buildPerformedLifecycleCounterUpdate("ACTIVE_DELOAD")).toEqual({
      completedSessions: { increment: 1 },
      deloadSessionsCompleted: { increment: 1 },
    });
  });

  it("derives deterministic save snapshots for identical mesocycle inputs", () => {
    deriveCurrentMesocycleSessionMock.mockReturnValue({
      week: 3,
      session: 1,
      phase: "ACCUMULATION",
    });

    const mesocycle = {
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    };

    const first = deriveSaveRouteMesoSnapshot(mesocycle);
    const second = deriveSaveRouteMesoSnapshot(mesocycle);

    expect(first).toEqual(second);
    expect(deriveCurrentMesocycleSessionMock).toHaveBeenCalledTimes(2);
  });
});
