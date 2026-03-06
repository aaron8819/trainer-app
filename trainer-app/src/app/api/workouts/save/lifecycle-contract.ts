import { deriveCurrentMesocycleSession } from "@/lib/api/mesocycle-lifecycle-math";

export type SaveRouteMesocycleState = "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";

export type SaveRouteMesocycle = {
  id: string;
  state: SaveRouteMesocycleState;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
};

export type SaveRouteMesoSnapshot = {
  week: number;
  phase: "ACCUMULATION" | "DELOAD";
  session: number;
};

export function deriveSaveRouteMesoSnapshot(
  mesocycle: SaveRouteMesocycle
): SaveRouteMesoSnapshot {
  // Save semantics are receipt-first: stamp the canonical slot being performed
  // from the pre-increment lifecycle counters, then advance counters afterward.
  const session = deriveCurrentMesocycleSession(mesocycle);
  return {
    week: session.week,
    phase: session.phase,
    session: session.session,
  };
}

export function buildPerformedLifecycleCounterUpdate(
  state: SaveRouteMesocycleState
): {
  completedSessions: { increment: 1 };
  accumulationSessionsCompleted?: { increment: 1 };
  deloadSessionsCompleted?: { increment: 1 };
} {
  return state === "ACTIVE_DELOAD"
    ? {
        completedSessions: { increment: 1 },
        deloadSessionsCompleted: { increment: 1 },
      }
    : {
      completedSessions: { increment: 1 },
      accumulationSessionsCompleted: { increment: 1 },
    };
}

export function shouldAdvanceLifecycleForPerformedTransition(
  advancesSplit: boolean | null | undefined
): boolean {
  // `advancesSplit=false` explicitly opts out of lifecycle advancement.
  // Missing/null values preserve historical default behavior (advance).
  return advancesSplit !== false;
}

export function resolvePersistedAdvancesSplit(input: {
  persistedAdvancesSplit: boolean | null | undefined;
  requestAdvancesSplit: boolean | null | undefined;
}): boolean | undefined {
  // Persisted value is immutable once set; request can only initialize when persisted is absent.
  if (input.persistedAdvancesSplit != null) {
    return input.persistedAdvancesSplit;
  }
  return input.requestAdvancesSplit ?? undefined;
}
