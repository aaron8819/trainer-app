import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import {
  assessClosedHandoffDeletionInTransaction,
  deriveReconciledMesocycleLifecycle,
} from "./mesocycle-lifecycle-reconciliation";

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
  const phase = input.week === 5 ? "DELOAD" : "ACCUMULATION";
  const intent = input.session === 1 || input.session === 3 ? "UPPER" : "LOWER";
  const slotIds = ["upper_a", "lower_a", "upper_b", "lower_b"];
  return {
    id: input.id ?? `workout-${input.week}-${input.session}`,
    status: input.status ?? "COMPLETED",
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: input.week,
    mesocyclePhaseSnapshot: phase,
    mesoSessionSnapshot: input.session,
    advancesSplit: input.advancesSplit ?? true,
    selectionMode: "INTENT",
    sessionIntent: intent,
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 2,
        cycleContext: {
          weekInMeso: input.week,
          weekInBlock: input.week,
          mesocycleLength: 5,
          phase: phase.toLowerCase(),
          blockType: phase.toLowerCase(),
          isDeload: phase === "DELOAD",
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: "meso-1",
          compositionSource: "runtime_selection",
        },
        sessionSlot: {
          slotId: slotIds[input.session - 1],
          intent: intent.toLowerCase(),
          sequenceIndex: input.session - 1,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: phase === "DELOAD" ? "scheduled" : "none",
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
  completedSessions: 20,
  accumulationSessionsCompleted: 16,
  deloadSessionsCompleted: 4,
  slotSequenceJson,
  currentSeedRevision: {
    seedPayload: { version: 2, source: "legacy_accepted_seed" },
  },
};

describe("legacy mesocycle lifecycle deletion reconciliation", () => {
  it("rejects closed deletion when a strict obligation becomes unresolved", async () => {
    const workouts = completeSchedule();
    workouts.pop();

    await expect(
      assessClosedHandoffDeletionInTransaction(
        txWithWorkouts(workouts),
        mesocycle,
      ),
    ).resolves.toEqual({
      safe: false,
      reason: "authored_obligation_unresolved",
    });
  });

  it("rejects closed deletion when remaining strict identity is ambiguous", async () => {
    const workouts = completeSchedule();
    workouts.push(
      workout({ week: 5, session: 4, status: "SKIPPED", id: "duplicate-final" }),
    );

    await expect(
      assessClosedHandoffDeletionInTransaction(
        txWithWorkouts(workouts),
        mesocycle,
      ),
    ).resolves.toEqual({ safe: false, reason: "strict_identity_blocked" });
  });

  it("keeps handoff closed after deleting an out-of-schedule row and preserves completion-only counters", async () => {
    const workouts = completeSchedule();
    workouts[19].status = "SKIPPED";
    workouts.push(
      workout({ week: 6, session: 1, status: "COMPLETED", id: "stale-complete" }),
      workout({
        week: 5,
        session: 4,
        status: "COMPLETED",
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

  it("fails closed on duplicate authored claims without changing strict counters", async () => {
    const workouts = completeSchedule();
    workouts.push(
      workout({ week: 5, session: 4, status: "SKIPPED", id: "duplicate-final" }),
    );

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), {
      ...mesocycle,
      state: "ACTIVE_DELOAD",
      completedSessions: 19,
      deloadSessionsCompleted: 3,
      }),
    ).resolves.toEqual({
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      state: "ACTIVE_DELOAD",
    });
  });

  it("keeps absent-topology fallback explicitly counter-based for historical compatibility", async () => {
    const workouts = completeSchedule();
    workouts[19].status = "SKIPPED";

    await expect(
      deriveReconciledMesocycleLifecycle(txWithWorkouts(workouts), {
        ...mesocycle,
        state: "ACTIVE_DELOAD",
        completedSessions: 19,
        deloadSessionsCompleted: 3,
        slotSequenceJson: null,
      }),
    ).resolves.toEqual({
      completedSessions: 19,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      state: "ACTIVE_DELOAD",
    });
  });
});
