import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { deriveReconciledMesocycleLifecycle } from "./mesocycle-lifecycle-reconciliation";

const slotSequenceJson = {
  version: 1,
  source: "handoff_draft",
  sequenceMode: "ordered_flexible",
  slots: [
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "lower_a", intent: "LOWER" },
    { slotId: "upper_b", intent: "UPPER" },
    { slotId: "lower_b", intent: "LOWER" },
  ],
};

function workout(input: {
  week: number;
  session: number;
  status?: "PLANNED" | "PARTIAL" | "COMPLETED" | "SKIPPED";
  id?: string;
  advancesSplit?: boolean;
}) {
  return {
    id: input.id ?? `workout-${input.week}-${input.session}`,
    status: input.status ?? "COMPLETED",
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: input.week,
    mesocyclePhaseSnapshot: input.week === 5 ? "DELOAD" : "ACCUMULATION",
    mesoSessionSnapshot: input.session,
    advancesSplit: input.advancesSplit ?? true,
    selectionMode: "INTENT",
    sessionIntent: input.session === 1 || input.session === 3 ? "UPPER" : "LOWER",
    selectionMetadata: null,
  };
}

function completeSchedule() {
  return Array.from({ length: 5 }, (_, weekIndex) =>
    Array.from({ length: 4 }, (_, sessionIndex) =>
      workout({ week: weekIndex + 1, session: sessionIndex + 1 }),
    ),
  ).flat();
}

function txWithWorkouts(workouts: ReturnType<typeof workout>[]) {
  return {
    workout: { findMany: vi.fn(async () => workouts) },
  } as never;
}

const mesocycle = {
  id: "meso-1",
  durationWeeks: 5,
  sessionsPerWeek: 4,
  state: "AWAITING_HANDOFF" as const,
  slotSequenceJson,
  currentSeedRevision: {
    seedPayload: { version: 2, source: "legacy_accepted_seed" },
  },
};

describe("legacy mesocycle lifecycle deletion reconciliation", () => {
  it("keeps handoff closed after deleting an out-of-schedule row and preserves completion-only counters", async () => {
    const workouts = completeSchedule();
    workouts[19].status = "SKIPPED";
    workouts.push(
      workout({ week: 6, session: 1, status: "COMPLETED", id: "stale-complete" }),
      workout({
        week: 5,
        session: 4,
        status: "PLANNED",
        id: "optional-row",
        advancesSplit: false,
      }),
    );

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), mesocycle),
    ).resolves.toEqual({
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      state: "AWAITING_HANDOFF",
    });
  });

  it("reopens deload resolution when the final skipped obligation is deleted", async () => {
    const workouts = completeSchedule();
    workouts[19].status = "SKIPPED";
    workouts.pop();

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), mesocycle),
    ).resolves.toEqual({
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      state: "ACTIVE_DELOAD",
    });
  });

  it("keeps PARTIAL as performed history but not an authored-obligation resolution", async () => {
    const workouts = completeSchedule();
    workouts[19].status = "PARTIAL";

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), mesocycle),
    ).resolves.toEqual({
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      state: "ACTIVE_DELOAD",
    });
  });

  it("fails closed on duplicate authored claims while still recomputing completion-only counters", async () => {
    const workouts = completeSchedule();
    workouts.push(
      workout({ week: 5, session: 4, status: "SKIPPED", id: "duplicate-final" }),
    );

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), {
        ...mesocycle,
        state: "ACTIVE_DELOAD",
      }),
    ).resolves.toEqual({
      completedSessions: 20,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 4,
      state: "ACTIVE_DELOAD",
    });
  });
});
