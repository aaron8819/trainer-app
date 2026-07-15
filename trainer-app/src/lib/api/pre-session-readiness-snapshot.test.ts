import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreSessionReadinessContract } from "./pre-session-readiness-contract";
import { hashPreSessionReadinessValue } from "./pre-session-readiness-identity";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const snapshotCreate = vi.fn();
  const snapshotFindFirst = vi.fn();
  const snapshotFindMany = vi.fn();
  const snapshotUpdateMany = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const readinessFindFirst = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const prisma = {
    $transaction: transaction,
    preSessionReadinessSnapshot: {
      create: snapshotCreate,
      findFirst: snapshotFindFirst,
      findMany: snapshotFindMany,
      updateMany: snapshotUpdateMany,
    },
    mesocycle: { findFirst: mesocycleFindFirst },
    workout: { findFirst: workoutFindFirst, findMany: workoutFindMany },
    readinessSignal: { findFirst: readinessFindFirst },
  };
  return {
    transaction,
    snapshotCreate,
    snapshotFindFirst,
    snapshotFindMany,
    snapshotUpdateMany,
    mesocycleFindFirst,
    workoutFindFirst,
    workoutFindMany,
    readinessFindFirst,
    loadNextWorkoutContext,
    prisma,
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) =>
    mocks.loadNextWorkoutContext(...args),
}));

import {
  activatePreSessionReadinessSnapshot,
  loadCurrentPreSessionReadinessSnapshot,
  loadCurrentPreSessionReadinessSnapshotIdentity,
  loadPreSessionReadinessSnapshotAuditDiagnostics,
  PreSessionReadinessSnapshotConflictError,
} from "./pre-session-readiness-snapshot";

function makeContract(
  overrides: Partial<PreSessionReadinessContract> = {}
): PreSessionReadinessContract {
  const contract: PreSessionReadinessContract = {
    contractVersion: 1,
    scope: {
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      source: {
        producerMode: "persisted_snapshot",
        producer: "pre_session_readiness_snapshot",
        provenance: "app_read_model",
      },
      readOnly: true,
      auditOnly: false,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
    },
    nextSessionIdentity: {
      userId: "user-1",
      activeMesocycleId: "meso-1",
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 2,
      currentSession: 2,
      nextSlotId: "lower_a",
      nextIntent: "lower",
      existingWorkoutId: null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
    },
    startability: {
      status: "startable",
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed",
      reasons: ["ready"],
      blockerSummary: "none",
    },
    seedRuntimeProof: {
      status: "valid",
      compositionSource: "persisted_slot_plan_seed",
      receiptMesocycleId: "meso-1",
      seedSource: "handoff_slot_plan_projection",
      seedExecutableShape: "set_aware",
      seedOrderSetCountsRespected: true,
      readOnlyEvidenceOnly: true,
      seedRuntimeChanged: false,
      proofLines: ["seed proof"],
    },
    projectedWeekStatus: {
      status: "no_further_action",
      currentWeek: 2,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason: "No add-ons.",
    },
    doseClosure: {
      heading: "Dose Closure",
      priority: [],
      optional: [],
      monitor: [],
      suppress: [],
      guardrails: [],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Run seed as prescribed.",
      floorBufferOpportunities: [],
      prescriptionConfidenceWatches: [],
      fatigueCautions: [],
      safeOptionalAddOns: [],
      suppressAvoid: [],
      addOnState: { status: "none", reason: "No add-ons." },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    consistencyChecks: [
      {
        id: "seed_runtime_proof_read_only",
        status: "pass",
        severity: "info",
        message: "Read-only seed proof.",
        evidence: [],
      },
    ],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: ["read-only snapshot"],
    },
  };
  return { ...contract, ...overrides };
}

function makeMesocycle(overrides: Record<string, unknown> = {}) {
  const seedPayload = { version: 1, slots: [] };
  return {
    id: "meso-1",
    state: "ACTIVE_ACCUMULATION",
    completedSessions: 4,
    accumulationSessionsCompleted: 4,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: 3,
    slotPlanSeedJson: seedPayload,
    slotSequenceJson: { version: 1, slots: ["lower_a"] },
    currentSeedRevisionId: "seed-rev-2",
    currentSeedRevision: {
      id: "seed-rev-2",
      revision: 2,
      seedPayload,
      payloadHash: hashPreSessionReadinessValue(seedPayload),
      provenanceStatus: "exact",
    },
    weekCloses: [],
    ...overrides,
  };
}

function makeExactSnapshot(
  identity: NonNullable<
    Awaited<ReturnType<typeof loadCurrentPreSessionReadinessSnapshotIdentity>>
  >,
  contract = makeContract(),
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "snapshot-1",
    userId: identity.userId,
    activeMesocycleId: identity.activeMesocycleId,
    mesocycleState: identity.mesocycleState,
    weekInMeso: identity.weekInMeso,
    sessionInWeek: identity.sessionInWeek,
    slotId: identity.slotId,
    slotIntent: identity.slotIntent,
    plannedWorkoutId: identity.plannedWorkoutId,
    plannedWorkoutRevision: identity.plannedWorkoutRevision,
    contractVersion: 1,
    contractJson: contract,
    identityStatus: "EXACT",
    identityContractVersion: 1,
    identityJson: identity.identity,
    identityHash: identity.identityHash,
    targetHash: identity.targetHash,
    payloadHash: hashPreSessionReadinessValue(contract),
    readinessEvidenceFingerprint: identity.readinessEvidenceFingerprint,
    projectionFingerprint: identity.projectionFingerprint,
    seedRevisionId: identity.seedRevisionId,
    seedRevisionNumber: identity.seedRevisionNumber,
    seedPayloadHash: identity.seedPayloadHash,
    prescriptionFingerprint: identity.prescriptionFingerprint,
    sourceStateHash: identity.identityHash,
    slotPlanSeedHash: identity.slotPlanSeedHash,
    slotSequenceHash: identity.slotSequenceHash,
    createdAt: new Date("2026-07-14T12:00:00.000Z"),
    expiresAt: null,
    invalidatedAt: null,
    invalidatedReason: null,
    ...overrides,
  };
}

describe("pre-session readiness snapshot persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      existingWorkoutId: null,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 2,
    });
    mocks.mesocycleFindFirst.mockResolvedValue(makeMesocycle());
    mocks.workoutFindFirst.mockResolvedValue(null);
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.readinessFindFirst.mockResolvedValue(null);
    mocks.snapshotFindFirst.mockResolvedValue(null);
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.snapshotUpdateMany.mockResolvedValue({ count: 1 });
    mocks.snapshotCreate.mockImplementation(async ({ data }) => ({
      id: "snapshot-created",
      createdAt: new Date("2026-07-14T12:00:00.000Z"),
      invalidatedAt: null,
      invalidatedReason: null,
      ...data,
    }));
    mocks.transaction.mockImplementation(async (callback) =>
      callback(mocks.prisma)
    );
  });

  it("derives a versioned future-slot identity from exact seed and persisted evidence", async () => {
    const identity = await loadCurrentPreSessionReadinessSnapshotIdentity("user-1");
    expect(identity).toMatchObject({
      identity: {
        identityContractVersion: 1,
        target: {
          kind: "future_slot",
          seedRevision: {
            status: "exact_revision",
            revisionId: "seed-rev-2",
            revision: 2,
          },
        },
      },
      identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      projectionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("uses workout revision and prescription fingerprint for a materialized target", async () => {
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      existingWorkoutId: "workout-1",
      source: "existing_incomplete",
      weekInMeso: 2,
      sessionInWeek: 2,
    });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      revision: 7,
      status: "PLANNED",
      sessionIntent: "LOWER",
      selectionMode: "AUTO",
      selectionMetadata: {},
      exercises: [],
    });
    const identity = await loadCurrentPreSessionReadinessSnapshotIdentity("user-1");
    expect(identity?.identity.target).toMatchObject({
      kind: "materialized_workout",
      workoutId: "workout-1",
      workoutRevision: 7,
      prescriptionFingerprint: expect.any(String),
    });
  });

  it("atomically supersedes the active logical target and inserts the replacement", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    const result = await activatePreSessionReadinessSnapshot({
      preparedIdentity: identity,
      contract: makeContract(),
    });
    expect(result).toMatchObject({ outcome: "created", invalidatedSnapshotCount: 1 });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted",
    });
    expect(mocks.snapshotUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetHash: identity.targetHash }),
      })
    );
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityStatus: "EXACT",
          identityHash: identity.identityHash,
          payloadHash: hashPreSessionReadinessValue(makeContract()),
        }),
      })
    );
  });

  it("reuses an equivalent active exact snapshot without changing timestamps", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    const existing = makeExactSnapshot(identity);
    mocks.snapshotFindFirst.mockResolvedValue(existing);
    const result = await activatePreSessionReadinessSnapshot({
      preparedIdentity: identity,
      contract: makeContract(),
    });
    expect(result).toMatchObject({ outcome: "reused", snapshot: existing });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("rejects the same identity with a different payload and leaves the active row authoritative", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.snapshotFindFirst.mockResolvedValue(
      makeExactSnapshot(identity, makeContract({
        projectedWeekStatus: {
          ...makeContract().projectedWeekStatus,
          projectionNotes: ["different"],
        },
      }))
    );
    await expect(
      activatePreSessionReadinessSnapshot({
        preparedIdentity: identity,
        contract: makeContract(),
      })
    ).rejects.toMatchObject({ code: "PAYLOAD_INTEGRITY_CONFLICT" });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("rejects a stale readiness signal before lifecycle mutation", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.readinessFindFirst.mockResolvedValue({
      id: "signal-new",
      userId: "user-1",
      timestamp: new Date(),
      subjectiveReadiness: 5,
    });
    await expect(
      activatePreSessionReadinessSnapshot({
        preparedIdentity: identity,
        contract: makeContract(),
      })
    ).rejects.toBeInstanceOf(PreSessionReadinessSnapshotConflictError);
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("rejects a seed revision change before activation", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    const changedSeed = { version: 1, slots: [{ slotId: "lower_a" }] };
    mocks.mesocycleFindFirst.mockResolvedValue(
      makeMesocycle({
        slotPlanSeedJson: changedSeed,
        currentSeedRevisionId: "seed-rev-3",
        currentSeedRevision: {
          id: "seed-rev-3",
          revision: 3,
          seedPayload: changedSeed,
          payloadHash: hashPreSessionReadinessValue(changedSeed),
          provenanceStatus: "exact",
        },
      })
    );
    await expect(
      activatePreSessionReadinessSnapshot({ preparedIdentity: identity, contract: makeContract() })
    ).rejects.toMatchObject({ code: "STALE_PREPARATION" });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a changed persisted projection before activation", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "partial-1",
        revision: 2,
        status: "IN_PROGRESS",
        scheduledDate: new Date(),
        completedAt: null,
        mesocycleWeekSnapshot: 2,
        mesoSessionSnapshot: 2,
        advancesSplit: true,
        sessionIntent: "LOWER",
        selectionMode: "AUTO",
        selectionMetadata: {},
        seedRevisionId: "seed-rev-2",
        seedRevisionNumber: 2,
        seedPayloadHash: "seed-hash",
        exercises: [],
      },
    ]);
    await expect(
      activatePreSessionReadinessSnapshot({ preparedIdentity: identity, contract: makeContract() })
    ).rejects.toMatchObject({ code: "STALE_PREPARATION" });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a materialized workout revision change before activation", async () => {
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      existingWorkoutId: "workout-1",
      source: "existing_incomplete",
      weekInMeso: 2,
      sessionInWeek: 2,
    });
    const workout = {
      id: "workout-1",
      revision: 7,
      status: "PLANNED",
      sessionIntent: "LOWER",
      selectionMode: "AUTO",
      selectionMetadata: {},
      exercises: [],
    };
    mocks.workoutFindFirst.mockResolvedValue(workout);
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.workoutFindFirst.mockResolvedValue({ ...workout, revision: 8 });
    const contract = makeContract({
      nextSessionIdentity: {
        ...makeContract().nextSessionIdentity,
        existingWorkoutId: "workout-1",
      },
    });
    await expect(
      activatePreSessionReadinessSnapshot({ preparedIdentity: identity, contract })
    ).rejects.toMatchObject({ code: "STALE_PREPARATION" });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
  });

  it("loads only the active exact current identity and verifies payload integrity", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.snapshotFindFirst.mockResolvedValue(makeExactSnapshot(identity));
    await expect(loadCurrentPreSessionReadinessSnapshot("user-1")).resolves.toMatchObject({
      status: "available",
      snapshot: { id: "snapshot-1" },
    });
    expect(mocks.snapshotFindFirst).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        identityStatus: "EXACT",
        identityHash: identity.identityHash,
        invalidatedAt: null,
      },
    });
  });

  it("fails explicitly for corrupt persisted payloads", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.snapshotFindFirst.mockResolvedValue(
      makeExactSnapshot(identity, makeContract(), { payloadHash: "corrupt" })
    );
    await expect(loadCurrentPreSessionReadinessSnapshot("user-1")).resolves.toEqual({
      status: "integrity_error",
      reason: "payload_hash_mismatch",
      snapshotId: "snapshot-1",
    });
  });

  it("reports legacy and supersession diagnostics without mutation", async () => {
    const identity = (await loadCurrentPreSessionReadinessSnapshotIdentity("user-1"))!;
    mocks.snapshotFindMany.mockResolvedValue([
      makeExactSnapshot(identity),
      makeExactSnapshot(identity, makeContract(), {
        id: "snapshot-old",
        invalidatedAt: new Date(),
        invalidatedReason: "superseded_by_atomic_prepare",
      }),
      { ...makeExactSnapshot(identity), id: "legacy", identityStatus: "LEGACY_UNKNOWN", identityJson: null, identityHash: null },
    ]);
    const diagnostics = await loadPreSessionReadinessSnapshotAuditDiagnostics("user-1");
    expect(diagnostics).toMatchObject({
      currentSnapshotId: "snapshot-1",
      activeSnapshotMatchesCurrentEvidence: true,
      legacyUnknownCount: 1,
      supersededSnapshotIds: ["snapshot-old"],
    });
    expect(mocks.snapshotUpdateMany).not.toHaveBeenCalled();
  });
});
