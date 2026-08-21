import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const serviceMocks = vi.hoisted(() => ({
  enterMesocycleHandoffInTransaction: vi.fn(),
  completeOrEnterHandoffInTransaction: vi.fn(),
}));
vi.mock("./mesocycle-handoff", () => ({
  enterMesocycleHandoffInTransaction:
    serviceMocks.enterMesocycleHandoffInTransaction,
}));
vi.mock("./mesocycle-lifecycle-state", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mesocycle-lifecycle-state")>();
  return {
    ...original,
    completeOrEnterHandoffInTransaction:
      serviceMocks.completeOrEnterHandoffInTransaction,
  };
});
import {
  attachServerAuthoredV4ScheduledSlotReceipt,
  buildScheduledSlotReceipt,
  resolveV4RequiredSlotFromPersistedWorkoutEvidence,
  resolveV4ScheduledSlots,
  type V4RequiredSlot,
  type V4ScheduleAuthority,
  type V4ScheduleWorkoutEvidence,
} from "./v4-scheduled-slot-resolution";
import { resolveV4NextWorkoutContext } from "./next-session";
import {
  applyV4TerminalScheduleResolution,
  resolveV4ScheduleBeforeWorkoutCreation,
} from "./save-workout/lifecycle";
import { persistWorkoutRow } from "./save-workout/persistence";

function authority(): V4ScheduleAuthority {
  const weeklySlots = [
    { slotId: "lower-a", intent: "lower" },
    { slotId: "upper-a", intent: "upper" },
    { slotId: "lower-b", intent: "lower" },
    { slotId: "upper-b", intent: "upper" },
  ] as const;
  const weeks = [
    { weekInMeso: 1, phase: "ACCUMULATION" },
    { weekInMeso: 2, phase: "ACCUMULATION" },
    { weekInMeso: 3, phase: "ACCUMULATION" },
    { weekInMeso: 4, phase: "ACCUMULATION" },
    { weekInMeso: 5, phase: "DELOAD" },
  ] as const;
  return {
    mesocycleId: "meso-v4",
    revisionId: "revision-v4",
    revisionNumber: 1,
    revisionHash: "3d4e807cbafdb89bd52dc0fb475842b8c18761e2212967614e41acf5e22913b9",
    slotsPerWeek: 4,
    requiredSlots: weeks.flatMap((week) =>
      weeklySlots.map((slot, sequenceIndex) => ({
        ...week,
        ...slot,
        sequenceIndex,
        sequenceLength: 4,
      })),
    ),
  };
}

function workout(input: {
  authority: V4ScheduleAuthority;
  slot: V4RequiredSlot;
  id?: string;
  status?: string;
  advancesSplit?: boolean | null;
}): V4ScheduleWorkoutEvidence {
  const { authority: source, slot } = input;
  return {
    id: input.id ?? `workout-${slot.weekInMeso}-${slot.slotId}`,
    status: input.status ?? "PLANNED",
    mesocycleId: source.mesocycleId,
    mesocycleWeekSnapshot: slot.weekInMeso,
    mesocyclePhaseSnapshot: slot.phase,
    mesoSessionSnapshot: slot.sequenceIndex + 1,
    advancesSplit: input.advancesSplit ?? true,
    selectionMode: "AUTO",
    sessionIntent: slot.intent.toUpperCase(),
    seedRevisionId: source.revisionId,
    seedRevisionNumber: source.revisionNumber,
    seedPayloadHash: source.revisionHash,
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 2,
        cycleContext: {
          weekInMeso: slot.weekInMeso,
          weekInBlock: slot.phase === "DELOAD" ? 1 : slot.weekInMeso,
          mesocycleLength: 5,
          phase: slot.phase === "DELOAD" ? "deload" : "accumulation",
          blockType: slot.phase === "DELOAD" ? "deload" : "accumulation",
          isDeload: slot.phase === "DELOAD",
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: source.mesocycleId,
          compositionSource:
            slot.phase === "DELOAD"
              ? "deload_seed_replay"
              : "persisted_slot_plan_seed",
          seedProvenance: {
            revisionId: source.revisionId,
            revision: source.revisionNumber,
            hash: source.revisionHash,
          },
        },
        sessionSlot: {
          slotId: slot.slotId,
          intent: slot.intent,
          sequenceIndex: slot.sequenceIndex,
          sequenceLength: slot.sequenceLength,
          source: "mesocycle_slot_sequence",
        },
        scheduledSlotReceipt: buildScheduledSlotReceipt(source, slot),
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: slot.phase === "DELOAD" ? "scheduled" : "none",
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

function releasedWorkoutWithoutScheduledReceipt(input: {
  authority: V4ScheduleAuthority;
  slot: V4RequiredSlot;
}): V4ScheduleWorkoutEvidence {
  const { authority: source, slot } = input;
  return {
    id: `released-${slot.weekInMeso}-${slot.slotId}`,
    status: "PLANNED",
    mesocycleId: source.mesocycleId,
    mesocycleWeekSnapshot: slot.weekInMeso,
    mesocyclePhaseSnapshot: slot.phase,
    mesoSessionSnapshot: slot.sequenceIndex + 1,
    advancesSplit: false,
    selectionMode: "AUTO",
    sessionIntent: null,
    seedRevisionId: source.revisionId,
    seedRevisionNumber: source.revisionNumber,
    seedPayloadHash: source.revisionHash,
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 2,
        cycleContext: {
          weekInMeso: slot.weekInMeso,
          weekInBlock: slot.weekInMeso,
          mesocycleLength: 5,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: source.mesocycleId,
          compositionSource: "persisted_slot_plan_seed",
          seedProvenance: {
            revisionId: source.revisionId,
            revision: source.revisionNumber,
            hash: source.revisionHash,
          },
        },
        sessionSlot: {
          slotId: slot.slotId,
          intent: slot.intent,
          sequenceIndex: slot.sequenceIndex,
          sequenceLength: slot.sequenceLength,
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

describe("V4 scheduled-slot resolution", () => {
  it("promotes the released pre-receipt shape only from complete persisted slot facts", () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const released = releasedWorkoutWithoutScheduledReceipt({ authority: source, slot });

    expect(
      resolveV4RequiredSlotFromPersistedWorkoutEvidence({
        authority: source,
        workout: released,
      }),
    ).toEqual({ requiredSlot: slot });
    expect(
      resolveV4ScheduledSlots({ authority: source, workouts: [released] }),
    ).toEqual({
      status: "blocked",
      reason: `scheduled_slot_receipt_missing_compat:${released.id}`,
    });
    const promoted = attachServerAuthoredV4ScheduledSlotReceipt({
      authority: source,
      requiredSlot: slot,
      selectionMetadata: released.selectionMetadata,
      incomingSelectionMetadata: null,
      persistedSelectionMetadata: released.selectionMetadata,
      persistedWorkoutEvidence: released,
    });
    expect(
      (promoted.sessionDecisionReceipt as Record<string, unknown>)
        .scheduledSlotReceipt,
    ).toEqual({
      version: 1,
      mesocycleId: source.mesocycleId,
      acceptedRevisionId: source.revisionId,
      acceptedRevisionNumber: source.revisionNumber,
      acceptedRevisionHash: source.revisionHash,
      weekInMeso: slot.weekInMeso,
      slotId: slot.slotId,
      sequenceIndex: slot.sequenceIndex,
      sequenceLength: slot.sequenceLength,
    });
    expect(
      resolveV4ScheduledSlots({
        authority: source,
        workouts: [
          {
            ...released,
            advancesSplit: true,
            sessionIntent: slot.intent.toUpperCase(),
            selectionMetadata: promoted,
          },
        ],
      }),
    ).toMatchObject({
      status: "available",
      claims: [{ workoutId: released.id, requiredSlot: slot }],
    });

    const conflicted = { ...released, mesocyclePhaseSnapshot: "DELOAD" };
    expect(
      resolveV4RequiredSlotFromPersistedWorkoutEvidence({
        authority: source,
        workout: conflicted,
      }),
    ).toEqual({ reason: "persisted_slot_identity_conflict" });
    expect(() =>
      attachServerAuthoredV4ScheduledSlotReceipt({
        authority: source,
        requiredSlot: slot,
        selectionMetadata: released.selectionMetadata,
        incomingSelectionMetadata: released.selectionMetadata,
        persistedSelectionMetadata: released.selectionMetadata,
        persistedWorkoutEvidence: released,
      }),
    ).toThrow("V4_SCHEDULE_RECEIPT_CLIENT_AUTHORED");
  });
  it("builds 20 unique week + slot obligations for repeated lower/upper slots", () => {
    const resolved = authority();
    const originalAuthority = structuredClone(resolved);
    expect(resolved.requiredSlots).toHaveLength(20);
    expect(
      resolved.requiredSlots.slice(0, 4).map((slot) => slot.intent),
    ).toEqual(["lower", "upper", "lower", "upper"]);
    expect(
      new Set(
        resolved.requiredSlots.map(
          (slot) => `${slot.weekInMeso}:${slot.slotId}`,
        ),
    ).size,
    ).toBe(20);
    resolveV4ScheduledSlots({ authority: resolved, workouts: [] });
    expect(resolved).toEqual(originalAuthority);
  });

  it("preserves the server receipt and rejects a conflicting client replacement", () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const persisted = workout({ authority: source, slot }).selectionMetadata;
    const persistedReceipt = structuredClone(
      (persisted as { sessionDecisionReceipt: { scheduledSlotReceipt: unknown } })
        .sessionDecisionReceipt.scheduledSlotReceipt,
    );

    const preserved = attachServerAuthoredV4ScheduledSlotReceipt({
      authority: source,
      requiredSlot: slot,
      selectionMetadata: persisted,
      incomingSelectionMetadata: {},
      persistedSelectionMetadata: persisted,
    });
    expect(
      (preserved.sessionDecisionReceipt as { scheduledSlotReceipt: unknown })
        .scheduledSlotReceipt,
    ).toEqual(persistedReceipt);

    const conflicting = structuredClone(persisted) as {
      sessionDecisionReceipt: { scheduledSlotReceipt: { slotId: string } };
    };
    conflicting.sessionDecisionReceipt.scheduledSlotReceipt.slotId = "client-slot";
    expect(() =>
      attachServerAuthoredV4ScheduledSlotReceipt({
        authority: source,
        requiredSlot: slot,
        selectionMetadata: persisted,
        incomingSelectionMetadata: conflicting,
        persistedSelectionMetadata: persisted,
      }),
    ).toThrow("V4_SCHEDULE_RECEIPT_CONFLICT");

    expect(() =>
      attachServerAuthoredV4ScheduledSlotReceipt({
        authority: source,
        requiredSlot: slot,
        selectionMetadata: persisted,
        incomingSelectionMetadata: persisted,
      }),
    ).toThrow("V4_SCHEDULE_RECEIPT_CLIENT_AUTHORED");
  });

  it.each([
    ["COMPLETED", 1, 1, true],
    ["SKIPPED", 1, 0, true],
    ["PARTIAL", 0, 0, false],
  ])(
    "%s has the canonical resolved/completed meaning",
    (status, resolvedCount, completedCount, firstResolved) => {
      const source = authority();
      const first = source.requiredSlots[0]!;
      const result = resolveV4ScheduledSlots({
        authority: source,
        workouts: [workout({ authority: source, slot: first, status })],
      });
      expect(result).toMatchObject({
        status: "available",
        resolvedSlotCount: resolvedCount,
        completedSlotCount: completedCount,
      });
      if (result.status === "available") {
        expect(result.nextUnresolvedSlot?.slotId === first.slotId).toBe(
          !firstResolved,
        );
      }
    },
  );

  it("does not let advancesSplit=false hide an exact required slot", () => {
    const source = authority();
    const first = source.requiredSlots[0]!;
    const result = resolveV4ScheduledSlots({
      authority: source,
      workouts: [
        workout({
          authority: source,
          slot: first,
          status: "COMPLETED",
          advancesSplit: false,
        }),
      ],
    });
    expect(result).toMatchObject({
      status: "available",
      resolvedSlotCount: 1,
      completedSlotCount: 1,
      nextUnresolvedSlot: {
        slotId: source.requiredSlots[1]!.slotId,
        weekInMeso: 1,
      },
    });
  });

  it("excludes only a strictly recognized optional row without consuming a required slot", () => {
    const source = authority();
    const result = resolveV4ScheduledSlots({
      authority: source,
      workouts: [
        {
          id: "optional-gap-fill",
          status: "COMPLETED",
          mesocycleId: source.mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesocyclePhaseSnapshot: "ACCUMULATION",
          mesoSessionSnapshot: null,
          advancesSplit: false,
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          selectionMetadata: {
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
              exceptions: [
                { code: "optional_gap_fill", message: "Server-authored optional session." },
              ],
            },
          },
          seedRevisionId: null,
          seedRevisionNumber: null,
          seedPayloadHash: null,
        },
      ],
    });

    expect(result).toMatchObject({
      status: "available",
      claims: [],
      resolvedSlotCount: 0,
      nextUnresolvedSlot: source.requiredSlots[0],
    });
  });

  it.each([
    ["cross-week", (row: V4ScheduleWorkoutEvidence) => ({ ...row, mesocycleWeekSnapshot: 2 })],
    ["cross-mesocycle", (row: V4ScheduleWorkoutEvidence) => ({ ...row, mesocycleId: "other" })],
    ["stale-revision", (row: V4ScheduleWorkoutEvidence) => ({ ...row, seedRevisionId: "stale" })],
    ["missing-identity", (row: V4ScheduleWorkoutEvidence) => ({ ...row, selectionMetadata: {} })],
  ])("fails closed for %s evidence", (_label, mutate) => {
    const source = authority();
    const row = workout({ authority: source, slot: source.requiredSlots[0]! });
    expect(
      resolveV4ScheduledSlots({ authority: source, workouts: [mutate(row)] }),
    ).toMatchObject({ status: "blocked" });
  });

  it("rejects duplicate and conflicting terminal claims instead of choosing a winner", () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const result = resolveV4ScheduledSlots({
      authority: source,
      workouts: [
        workout({ authority: source, slot, id: "complete", status: "COMPLETED" }),
        workout({ authority: source, slot, id: "skip", status: "SKIPPED" }),
      ],
    });
    expect(result).toEqual({
      status: "blocked",
      reason: `duplicate_required_slot_claim:1:${slot.slotId}`,
    });
  });

  it("rejects a second materialization for an unresolved slot already owned by a workout", async () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const tx = {
      workout: {
        findMany: vi.fn().mockResolvedValue([
          workout({ authority: source, slot, status: "PLANNED" }),
        ]),
      },
    };

    await expect(
      resolveV4ScheduleBeforeWorkoutCreation(tx as never, {
        authority: source,
        requiredSlot: slot,
      }),
    ).rejects.toThrow("V4_SCHEDULE_SLOT_ALREADY_MATERIALIZED");
  });

  it("blocks duplicate materialization while a released receiptless owner awaits canonical save", async () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const tx = {
      workout: {
        findMany: vi.fn().mockResolvedValue([
          releasedWorkoutWithoutScheduledReceipt({ authority: source, slot }),
        ]),
      },
    };

    await expect(
      resolveV4ScheduleBeforeWorkoutCreation(tx as never, {
        authority: source,
        requiredSlot: slot,
      }),
    ).rejects.toThrow("V4_SCHEDULE_RESOLUTION_BLOCKED");
  });

  it("fails safely for unknown workout statuses", () => {
    const source = authority();
    expect(
      resolveV4ScheduledSlots({
        authority: source,
        workouts: [
          workout({
            authority: source,
            slot: source.requiredSlots[0]!,
            status: "FUTURE_STATUS",
          }),
        ],
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("selects the next exact slot after a skipped nonfinal slot", () => {
    const source = authority();
    const context = resolveV4NextWorkoutContext({
      authority: source,
      workouts: [
        workout({
          authority: source,
          slot: source.requiredSlots[0]!,
          status: "SKIPPED",
        }),
      ],
    });
    expect(context).toMatchObject({
      source: "rotation",
      weekInMeso: 1,
      slotId: source.requiredSlots[1]!.slotId,
      sessionInWeek: 2,
    });
    expect(context.eligibleSlotSnapshots?.map((slot) => slot.slotId)).not.toContain(
      source.requiredSlots[0]!.slotId,
    );
  });

  it("returns a recoverable blocker for ambiguous slot evidence", () => {
    const source = authority();
    const slot = source.requiredSlots[0]!;
    const context = resolveV4NextWorkoutContext({
      authority: source,
      workouts: [
        workout({ authority: source, slot, id: "one", status: "COMPLETED" }),
        workout({ authority: source, slot, id: "two", status: "SKIPPED" }),
      ],
    });
    expect(context).toMatchObject({
      source: "schedule_resolution_blocked",
      lifecycleBlocker: { code: "V4_SCHEDULE_RESOLUTION_BLOCKED" },
    });
  });

  it("does not recommend a slot after the final required slot is skipped", () => {
    const source = authority();
    const finalIndex = source.requiredSlots.length - 1;
    const context = resolveV4NextWorkoutContext({
      authority: source,
      workouts: source.requiredSlots.map((slot, index) =>
        workout({
          authority: source,
          slot,
          status: index === finalIndex ? "SKIPPED" : "COMPLETED",
        }),
      ),
    });
    expect(context).toMatchObject({
      source: "schedule_resolution_blocked",
      lifecycleBlocker: {
        code: "V4_SCHEDULE_RESOLUTION_BLOCKED",
        reason: "resolved_schedule_transition_pending",
      },
    });
  });

  it.each([
    ["SKIPPED", 19, 0],
    ["COMPLETED", 20, 1],
  ] as const)(
    "closes the final deload slot as %s through the shared lifecycle owner",
    async (finalStatus, completedCount, expectedCounterUpdates) => {
      const source = authority();
      const rows = source.requiredSlots.map((slot, index) =>
        workout({
          authority: source,
          slot,
          status:
            index === source.requiredSlots.length - 1
              ? finalStatus
              : "COMPLETED",
        }),
      );
      const tx = {
        workout: { findMany: vi.fn().mockResolvedValue(rows) },
        mesocycle: {
          update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      serviceMocks.completeOrEnterHandoffInTransaction.mockReset();
      serviceMocks.completeOrEnterHandoffInTransaction.mockResolvedValue({
        id: source.mesocycleId,
        state: "COMPLETED",
      });

      const result = await applyV4TerminalScheduleResolution(tx as never, {
        resolvedMesocycle: {
          id: source.mesocycleId,
          state: "ACTIVE_DELOAD",
          durationWeeks: 5,
          accumulationSessionsCompleted: 16,
          deloadSessionsCompleted: 3,
          sessionsPerWeek: 4,
          currentSeedRevision: {
            id: source.revisionId,
            mesocycleId: source.mesocycleId,
            revision: source.revisionNumber,
            seedPayload: { version: 4 },
            payloadHash: source.revisionHash,
            hashAlgorithm: "sha256",
            provenanceStatus: "exact",
          },
        },
        authority: source,
        finalStatus,
      });

      expect(result).toMatchObject({
        status: "available",
        allResolved: true,
        completedSlotCount: completedCount,
        resolvedSlotCount: 20,
      });
      expect(tx.mesocycle.update).toHaveBeenCalledTimes(expectedCounterUpdates);
      expect(serviceMocks.completeOrEnterHandoffInTransaction).toHaveBeenCalledTimes(1);
      expect(serviceMocks.completeOrEnterHandoffInTransaction).toHaveBeenCalledWith(tx, {
        id: source.mesocycleId,
        state: "ACTIVE_DELOAD",
        macroCycle: undefined,
        currentSeedRevision: {
          id: source.revisionId,
          mesocycleId: source.mesocycleId,
          revision: source.revisionNumber,
          seedPayload: { version: 4 },
          payloadHash: source.revisionHash,
          hashAlgorithm: "sha256",
          provenanceStatus: "exact",
        },
      });
    },
  );

  it("does not close on a duplicate completed claim while another slot is unresolved", async () => {
    const source = authority();
    const rows = source.requiredSlots.slice(0, 19).map((slot) =>
      workout({ authority: source, slot, status: "COMPLETED" }),
    );
    rows.push(
      workout({
        authority: source,
        slot: source.requiredSlots[0]!,
        id: "duplicate",
        status: "COMPLETED",
      }),
    );
    const tx = {
      workout: { findMany: vi.fn().mockResolvedValue(rows) },
      mesocycle: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    serviceMocks.completeOrEnterHandoffInTransaction.mockReset();

    await expect(
      applyV4TerminalScheduleResolution(tx as never, {
        resolvedMesocycle: {
          id: source.mesocycleId,
          state: "ACTIVE_DELOAD",
          durationWeeks: 5,
          accumulationSessionsCompleted: 16,
          deloadSessionsCompleted: 3,
          sessionsPerWeek: 4,
          currentSeedRevision: {
            id: source.revisionId,
            mesocycleId: source.mesocycleId,
            revision: source.revisionNumber,
            seedPayload: { version: 4 },
            payloadHash: source.revisionHash,
            hashAlgorithm: "sha256",
            provenanceStatus: "exact",
          },
        },
        authority: source,
        finalStatus: "COMPLETED",
      }),
    ).rejects.toThrow("V4_SCHEDULE_RESOLUTION_BLOCKED");
    expect(serviceMocks.completeOrEnterHandoffInTransaction).not.toHaveBeenCalled();
  });

  it("propagates a final-slot handoff failure so the enclosing transaction can roll back", async () => {
    const source = authority();
    const rows = source.requiredSlots.map((slot) =>
      workout({ authority: source, slot, status: "COMPLETED" }),
    );
    const tx = {
      workout: { findMany: vi.fn().mockResolvedValue(rows) },
      mesocycle: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    serviceMocks.completeOrEnterHandoffInTransaction.mockReset();
    serviceMocks.completeOrEnterHandoffInTransaction.mockRejectedValue(
      new Error("forced_handoff_failure"),
    );

    await expect(
      applyV4TerminalScheduleResolution(tx as never, {
        resolvedMesocycle: {
          id: source.mesocycleId,
          state: "ACTIVE_DELOAD",
          durationWeeks: 5,
          accumulationSessionsCompleted: 16,
          deloadSessionsCompleted: 3,
          sessionsPerWeek: 4,
        },
        authority: source,
        finalStatus: "COMPLETED",
      }),
    ).rejects.toThrow("forced_handoff_failure");
  });

  it("lets only one concurrent complete-or-skip CAS win", async () => {
    const state = {
      id: "workout-cas",
      userId: "user-cas",
      revision: 7,
      status: "PLANNED",
      mesocycleId: "meso-v4",
    };
    const tx = {
      workout: {
        updateMany: vi.fn(async ({ where, data }) => {
          if (
            state.id !== where.id ||
            state.userId !== where.userId ||
            state.revision !== where.revision ||
            state.status !== where.status
          ) {
            return { count: 0 };
          }
          state.revision += 1;
          state.status = data.status;
          return { count: 1 };
        }),
        findFirst: vi.fn(async ({ where, select }) => {
          if (state.id !== where.id || state.userId !== where.userId) return null;
          return select.revision
            ? { id: state.id, revision: state.revision, mesocycleId: state.mesocycleId }
            : { id: state.id };
        }),
      },
    };
    const existingWorkout = { id: state.id, revision: 7, status: "PLANNED" };
    const attempt = (status: "COMPLETED" | "SKIPPED") =>
      persistWorkoutRow(tx as never, {
        workoutId: state.id,
        existingWorkout,
        userId: state.userId,
        expectedRevision: 7,
        shouldAdvanceLifecycleTransition: true,
        resolvedMesocycleId: state.mesocycleId,
        workoutUpdateData: { status },
        workoutCreateData: {},
      });

    const results = await Promise.allSettled([
      attempt("COMPLETED"),
      attempt("SKIPPED"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: new Error("REVISION_CONFLICT") });
    expect(["COMPLETED", "SKIPPED"]).toContain(state.status);
    expect(state.revision).toBe(8);
  });
});
