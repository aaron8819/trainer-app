import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const serviceMocks = vi.hoisted(() => ({
  enterMesocycleHandoffInTransaction: vi.fn(),
}));
vi.mock("./mesocycle-handoff", () => ({
  enterMesocycleHandoffInTransaction:
    serviceMocks.enterMesocycleHandoffInTransaction,
}));
import { buildV4CustomPlanReferenceAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";
import { buildAcceptedCompatibilityProjections } from "@/lib/engine/hypertrophy-plan-authoring";
import { normalizeAcceptedHypertrophySeedV4 } from "./mesocycle-seed-revision";
import {
  attachServerAuthoredV4ScheduledSlotReceipt,
  buildScheduledSlotReceipt,
  resolveV4ScheduleAuthority,
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
  const seed = buildV4CustomPlanReferenceAcceptedSeed();
  seed.slots = [seed.slots[1]!, seed.slots[0]!, seed.slots[3]!, seed.slots[2]!];
  const normalized = normalizeAcceptedHypertrophySeedV4(seed);
  const projections = buildAcceptedCompatibilityProjections(seed);
  const resolution = resolveV4ScheduleAuthority({
    id: "meso-v4",
    durationWeeks: 5,
    sessionsPerWeek: 4,
    slotSequenceJson: projections.slotSequenceJson,
    currentSeedRevisionId: "revision-v4",
    currentSeedRevision: {
      id: "revision-v4",
      revision: 1,
      seedPayload: seed,
      payloadHash: normalized.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
  });
  if (resolution.status !== "available") {
    throw new Error(`fixture authority unavailable: ${resolution.status}`);
  }
  return resolution.authority;
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
    mesoSessionSnapshot: slot.sequenceIndex + 1,
    advancesSplit: input.advancesSplit ?? true,
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

describe("V4 scheduled-slot resolution", () => {
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

  it("keeps missing rows unresolved and ignores non-advancing supplemental rows", () => {
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
      resolvedSlotCount: 0,
      completedSlotCount: 0,
      nextUnresolvedSlot: { slotId: first.slotId, weekInMeso: 1 },
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
    "closes the final deload slot as %s through the shared handoff owner",
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
      serviceMocks.enterMesocycleHandoffInTransaction.mockReset();
      serviceMocks.enterMesocycleHandoffInTransaction.mockResolvedValue({
        id: source.mesocycleId,
        state: "AWAITING_HANDOFF",
      });

      const result = await applyV4TerminalScheduleResolution(tx as never, {
        resolvedMesocycle: {
          id: source.mesocycleId,
          state: "ACTIVE_DELOAD",
          durationWeeks: 5,
          accumulationSessionsCompleted: 16,
          deloadSessionsCompleted: 3,
          sessionsPerWeek: 4,
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
      expect(serviceMocks.enterMesocycleHandoffInTransaction).toHaveBeenCalledTimes(1);
      expect(serviceMocks.enterMesocycleHandoffInTransaction).toHaveBeenCalledWith(
        tx,
        source.mesocycleId,
      );
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
    serviceMocks.enterMesocycleHandoffInTransaction.mockReset();

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
    ).rejects.toThrow("V4_SCHEDULE_RESOLUTION_BLOCKED");
    expect(serviceMocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
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
    serviceMocks.enterMesocycleHandoffInTransaction.mockReset();
    serviceMocks.enterMesocycleHandoffInTransaction.mockRejectedValue(
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
