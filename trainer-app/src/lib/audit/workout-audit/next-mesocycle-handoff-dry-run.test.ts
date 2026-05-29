import { describe, expect, it, vi } from "vitest";
import { buildMesocycleSlotSequence } from "@/lib/api/mesocycle-slot-contract";
import { buildMesocycleSlotPlanSeed } from "@/lib/api/mesocycle-handoff-slot-plan-projection.seed-serialization";
import { buildNextMesocycleHandoffDryRunAuditPayload } from "./next-mesocycle-handoff-dry-run";

type PreparedHandoffFixture = {
  slotPlanSeed: ReturnType<typeof buildMesocycleSlotPlanSeed>;
};

function makeReader(state: string, nextSeedDraftJson: unknown = null) {
  const mesocycleCreate = vi.fn();
  const transaction = vi.fn();
  return {
    mesocycleCreate,
    transaction,
    reader: {
      $transaction: transaction,
      mesocycle: {
        findFirst: vi.fn(async () => ({
          id: "source-1",
          state,
          nextSeedDraftJson,
        })),
        create: mesocycleCreate,
      },
      exercise: {
        findMany: vi.fn(async () => [
          { id: "bench", name: "Bench Press" },
          { id: "row", name: "Chest-Supported Row" },
        ]),
      },
    },
  };
}

function makeDraftWithAcceptedSeed(
  seed = makePreparedHandoff("v2_materialized_seed").slotPlanSeed,
) {
  return {
    version: 1,
    sourceMesocycleId: "source-1",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:05:00.000Z",
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 2,
      daysPerWeek: 2,
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "upper_b", intent: "UPPER" },
      ],
    },
    startingPoint: {
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
    },
    carryForwardSelections: [],
    acceptedSeedDraft: {
      version: 1,
      source: "v2_materialized_seed",
      refreshedAt: "2026-05-29T12:05:00.000Z",
      slotPlanSeedJson: seed,
      provenance: {
        basePlanValidationStatus: "pass_with_warnings",
        materializerStatus: "materialized",
        promotionReadinessStatus: "eligible_for_guarded_write",
        productionGatesMissing: [],
        serializer: "buildMesocycleSlotPlanSeed",
        runtimeReplayUnchanged: true,
      },
    },
  };
}

function makeLegacyDraftWithoutAcceptedSeed() {
  const legacyDraft = { ...makeDraftWithAcceptedSeed() };
  delete (legacyDraft as { acceptedSeedDraft?: unknown }).acceptedSeedDraft;
  return legacyDraft;
}

function makePreparedHandoff(
  seedSource: "handoff_slot_plan_projection" | "v2_materialized_seed" =
    "handoff_slot_plan_projection",
): PreparedHandoffFixture {
  const slotSequence = buildMesocycleSlotSequence([
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "upper_b", intent: "UPPER" },
  ]);
  const slotPlanSeed = buildMesocycleSlotPlanSeed({
    slotSequence,
    source: seedSource,
    slotPlans: [
      {
        slotId: "upper_a",
        intent: "UPPER",
        exercises: [
          {
            exerciseId: "bench",
            name: "Bench Press",
            role: "CORE_COMPOUND",
            setCount: 3,
          },
        ],
      },
      {
        slotId: "upper_b",
        intent: "UPPER",
        exercises: [
          {
            exerciseId: "row",
            name: "Chest-Supported Row",
            role: "CORE_COMPOUND",
            setCount: 4,
          },
        ],
      },
    ],
  });

  return {
    userId: "user-1",
    source: { id: "source-1", macroCycle: { userId: "user-1" } },
    pendingRow: { id: "source-1", state: "AWAITING_HANDOFF" },
    draftFingerprint: "fingerprint",
    projection: {
      mesocycle: {
        slotSequence,
      },
      trainingBlocks: [{ blockNumber: 1 }, { blockNumber: 2 }],
      carriedForwardRoles: [{ exerciseId: "bench" }],
    },
    slotPlanSeed,
    seedPersistenceProvenance: {
      source: "legacy_projection_seed",
    },
  } as unknown as PreparedHandoffFixture;
}

describe("next-mesocycle handoff dry-run audit", () => {
  it("reports ACTIVE_DELOAD sources as not ready without preparing or writing", async () => {
    const { reader, mesocycleCreate, transaction } = makeReader("ACTIVE_DELOAD");
    const prepareHandoff = vi.fn();

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(payload.summary).toMatchObject({
      writes: "no",
      sourceState: "ACTIVE_DELOAD",
      candidateAvailable: false,
      handoffReady: false,
      blockingReason: "source_not_awaiting_handoff",
      preparationPath: "not_called_source_not_awaiting_handoff",
    });
    expect(payload.candidateIdentity.status).toBe(
      "not_available_until_handoff",
    );
    expect(payload.seedShapeSummary.serializerPath).toBe(
      "buildMesocycleSlotPlanSeed",
    );
    expect(payload.safety).toMatchObject({
      dbMutated: false,
      mesocycleCreated: false,
      transactionExecuted: false,
    });
    expect(prepareHandoff).not.toHaveBeenCalled();
    expect(mesocycleCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("calls the real handoff preparation seam for AWAITING_HANDOFF and emits would-write facts with writes=no", async () => {
    const { reader, mesocycleCreate, transaction } =
      makeReader("AWAITING_HANDOFF");
    const prepareHandoff = vi.fn(async () => makePreparedHandoff());

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(prepareHandoff).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "source-1",
    });
    expect(payload.summary).toMatchObject({
      writes: "no",
      sourceState: "AWAITING_HANDOFF",
      candidateAvailable: true,
      handoffReady: true,
      blockingReason: null,
      preparationPath: "prepareMesocycleHandoffAcceptance",
      transactionStatus: "not_started",
    });
    expect(payload.wouldPrepareWriteSummary).toMatchObject({
      successorSource: "prepared_handoff_projection",
      slotSequence: "upper_a > upper_b",
      trainingBlocksCount: 2,
      carriedRolesCount: 1,
      constraintsAction: "would_upsert_constraints",
      sourceCompletionAction: "would_mark_source_completed",
      noDbWritesOccur: true,
    });
    expect(payload.persistedDraftTruth).toMatchObject({
      status: "not_available",
      source: null,
      exerciseCount: 0,
    });
    expect(payload.safety.writes).toBe("no");
    expect(mesocycleCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("uses the accept-preparation seed serializer shape and keeps executable rows minimal", async () => {
    const { reader } = makeReader("AWAITING_HANDOFF");
    const prepareHandoff = vi.fn(async () => makePreparedHandoff());

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(payload.seedShapeSummary).toMatchObject({
      slotPlanSeedJson: "would_be_built",
      truthBasis: "prepared_acceptance_seed",
      wouldBeBuilt: true,
      minimalExecutableRowsOnly: true,
      executableFields: ["exerciseId", "role", "setCount"],
      serializerPath: "buildMesocycleSlotPlanSeed",
      parserCompatible: true,
      seedSource: "handoff_slot_plan_projection",
    });
    expect(payload.candidateIdentity.rows).toEqual([
      {
        slotId: "upper_a",
        laneOrRole: "CORE_COMPOUND",
        exerciseId: "bench",
        exerciseName: "Bench Press",
        setCount: 3,
        source: "prepared_slotPlanSeedJson",
      },
      {
        slotId: "upper_b",
        laneOrRole: "CORE_COMPOUND",
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        setCount: 4,
        source: "prepared_slotPlanSeedJson",
      },
    ]);
  });

  it("reports a refreshed persisted V2 draft as candidate truth when present", async () => {
    const v2Prepared = makePreparedHandoff("v2_materialized_seed");
    const { reader } = makeReader(
      "AWAITING_HANDOFF",
      makeDraftWithAcceptedSeed(v2Prepared.slotPlanSeed),
    );
    const prepareHandoff = vi.fn(async () => v2Prepared);

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    if (!payload.wouldPrepareWriteSummary) {
      throw new Error("expected handoff preparation summary");
    }
    expect(payload.wouldPrepareWriteSummary.slotPlanSeedSource).toBe(
      "v2_materialized_seed",
    );
    expect(payload.persistedDraftTruth).toMatchObject({
      status: "available",
      source: "v2_materialized_seed",
      exerciseCount: 2,
      slotCount: 2,
      parserCompatible: true,
      minimalExecutableRowsOnly: true,
    });
    expect(payload.seedShapeSummary).toMatchObject({
      slotPlanSeedJson: "persisted_draft_available",
      truthBasis: "persisted_draft",
      seedSource: "v2_materialized_seed",
      parserCompatible: true,
      minimalExecutableRowsOnly: true,
    });
    expect(payload.candidateIdentity.rows.map((row) => row.source)).toEqual([
      "persisted_nextSeedDraftJson.acceptedSeedDraft",
      "persisted_nextSeedDraftJson.acceptedSeedDraft",
    ]);
  });

  it("distinguishes persisted V2 draft truth from a freshly prepared legacy projection", async () => {
    const persistedV2 = makePreparedHandoff("v2_materialized_seed");
    const { reader } = makeReader(
      "AWAITING_HANDOFF",
      makeDraftWithAcceptedSeed(persistedV2.slotPlanSeed),
    );
    const prepareHandoff = vi.fn(async () => makePreparedHandoff());

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(payload.persistedDraftTruth).toMatchObject({
      status: "available",
      source: "v2_materialized_seed",
      exerciseCount: 2,
    });
    expect(payload.wouldPrepareWriteSummary?.slotPlanSeedSource).toBe(
      "handoff_slot_plan_projection",
    );
    expect(payload.seedShapeSummary).toMatchObject({
      truthBasis: "persisted_draft",
      seedSource: "v2_materialized_seed",
      exerciseCount: 2,
    });
    expect(payload.candidateIdentity.rows.map((row) => row.source)).toEqual([
      "persisted_nextSeedDraftJson.acceptedSeedDraft",
      "persisted_nextSeedDraftJson.acceptedSeedDraft",
    ]);
  });

  it("keeps legacy unrefreshed drafts on the prepared legacy projection source", async () => {
    const { reader } = makeReader(
      "AWAITING_HANDOFF",
      makeLegacyDraftWithoutAcceptedSeed(),
    );
    const prepareHandoff = vi.fn(async () => makePreparedHandoff());

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(payload.persistedDraftTruth).toMatchObject({
      status: "not_available",
      source: null,
      exerciseCount: 0,
    });
    expect(payload.seedShapeSummary).toMatchObject({
      truthBasis: "prepared_acceptance_seed",
      seedSource: "handoff_slot_plan_projection",
    });
  });

  it("does not treat diagnostic preview as candidate truth and reports gate readiness limits", async () => {
    const { reader } = makeReader("AWAITING_HANDOFF");
    const prepareHandoff = vi.fn(async () => makePreparedHandoff());

    const payload = await buildNextMesocycleHandoffDryRunAuditPayload({
      userId: "user-1",
      sourceMesocycleId: "source-1",
      dependencies: {
        reader: reader as never,
        prepareHandoff: prepareHandoff as never,
      },
    });

    expect(payload.modeComparison).toContainEqual(
      expect.objectContaining({
        mode: "mesocycle-explain",
        distinction: expect.stringContaining("diagnostic preview only"),
      }),
    );
    expect(payload.weeklyVolumeFloorCapSummary.status).toBe("not_available");
    expect(payload.acceptanceGatePayloadSummary.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "candidate identity gate",
          enoughData: true,
        }),
        expect.objectContaining({
          check: "seed/runtime contract gate",
          enoughData: true,
        }),
        expect.objectContaining({
          check: "volume floors/caps",
          enoughData: false,
        }),
      ]),
    );
    expect(payload.weekOneRuntimeReplayPreview).toMatchObject({
      status: "seed_order_preview_only",
      runtimeReplayInstantiated: false,
    });
  });
});
