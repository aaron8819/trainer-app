import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPreSessionReadinessGymCardDto,
} from "./pre-session-readiness-gym-card";
import type {
  PreSessionReadinessContract,
} from "./pre-session-readiness-contract";

const mocks = vi.hoisted(() => {
  const snapshotCreate = vi.fn();
  const snapshotFindFirst = vi.fn();
  const snapshotUpdateMany = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const workoutFindFirst = vi.fn();
  const loadNextWorkoutContext = vi.fn();

  return {
    snapshotCreate,
    snapshotFindFirst,
    snapshotUpdateMany,
    mesocycleFindFirst,
    workoutFindFirst,
    loadNextWorkoutContext,
    prisma: {
      preSessionReadinessSnapshot: {
        create: snapshotCreate,
        findFirst: snapshotFindFirst,
        updateMany: snapshotUpdateMany,
      },
      mesocycle: {
        findFirst: mesocycleFindFirst,
      },
      workout: {
        findFirst: workoutFindFirst,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) =>
    mocks.loadNextWorkoutContext(...args),
}));

import {
  invalidatePreSessionReadinessSnapshotsForIdentity,
  loadLatestPreSessionReadinessSnapshotCandidate,
  savePreSessionReadinessSnapshot,
} from "./pre-session-readiness-snapshot";
import {
  loadLatestHomePreSessionReadinessContractCandidate,
} from "./home-pre-session-readiness";

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
      affectsScoringOrGeneration: false,
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
      addOnState: {
        status: "none",
        reason: "No add-ons.",
      },
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

  return {
    ...contract,
    ...overrides,
  };
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  const contract =
    (overrides.contractJson as PreSessionReadinessContract | undefined) ??
    makeContract();

  return {
    id: "snapshot-1",
    userId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 2,
    sessionInWeek: 2,
    slotId: "lower_a",
    slotIntent: "lower",
    plannedWorkoutId: null,
    plannedWorkoutRevision: null,
    contractVersion: 1,
    contractJson: contract,
    sourceStateHash: null,
    slotPlanSeedHash: null,
    slotSequenceHash: null,
    createdAt: new Date("2026-06-02T12:00:00.000Z"),
    expiresAt: null,
    invalidatedAt: null,
    invalidatedReason: null,
    ...overrides,
  };
}

function makeSaveInput(contract = makeContract()) {
  return {
    userId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION" as const,
    weekInMeso: 2,
    sessionInWeek: 2,
    slotId: "lower_a",
    slotIntent: "lower",
    plannedWorkoutId: null,
    plannedWorkoutRevision: null,
    contractVersion: 1,
    contract,
  };
}

describe("pre-session readiness snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      slotPlanSeedJson: { source: "seed", slots: [] },
      slotSequenceJson: { source: "sequence", slots: [] },
    });
    mocks.workoutFindFirst.mockResolvedValue(null);
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      slotSequenceIndex: 1,
      slotSequenceLength: 4,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 2,
      derivationTrace: [],
      selectedIncompleteStatus: null,
      selectedIncompleteReadiness: null,
    });
    mocks.snapshotCreate.mockImplementation(async ({ data }) => ({
      id: "snapshot-created",
      createdAt: new Date("2026-06-02T12:00:00.000Z"),
      invalidatedAt: null,
      invalidatedReason: null,
      ...data,
    }));
    mocks.snapshotFindFirst.mockResolvedValue(null);
    mocks.snapshotUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("saves and loads a valid snapshot", async () => {
    const saved = await savePreSessionReadinessSnapshot(makeSaveInput());
    mocks.snapshotFindFirst.mockResolvedValue(saved);

    const loaded = await loadLatestPreSessionReadinessSnapshotCandidate("user-1");

    expect(saved.contractJson).toMatchObject({ contractVersion: 1 });
    expect(saved.sourceStateHash).toEqual(expect.any(String));
    expect(loaded).toEqual(saved);
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeMesocycleId: "meso-1",
          contractVersion: 1,
          slotId: "lower_a",
        }),
      })
    );
  });

  it("Home candidate loader returns a contract for a valid snapshot", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(makeSnapshot());

    const candidate =
      await loadLatestHomePreSessionReadinessContractCandidate("user-1");

    expect(candidate).toMatchObject({
      source: "persisted_snapshot",
      contract: {
        contractVersion: 1,
        nextSessionIdentity: {
          activeMesocycleId: "meso-1",
          nextSlotId: "lower_a",
        },
      },
    });
  });

  it("returns null for no snapshot", async () => {
    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for the wrong user", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        userId: "other-user",
        contractJson: makeContract({
          nextSessionIdentity: {
            ...makeContract().nextSessionIdentity,
            userId: "other-user",
          },
        }),
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for the wrong active mesocycle", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        activeMesocycleId: "meso-2",
        contractJson: makeContract({
          nextSessionIdentity: {
            ...makeContract().nextSessionIdentity,
            activeMesocycleId: "meso-2",
          },
        }),
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for the wrong week or session", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        weekInMeso: 3,
        contractJson: makeContract({
          nextSessionIdentity: {
            ...makeContract().nextSessionIdentity,
            currentWeek: 3,
          },
        }),
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for the wrong slot", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        slotId: "upper_b",
        contractJson: makeContract({
          nextSessionIdentity: {
            ...makeContract().nextSessionIdentity,
            nextSlotId: "upper_b",
          },
        }),
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for an expired snapshot", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({ expiresAt: new Date("2026-06-02T11:59:00.000Z") })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for an invalidated snapshot", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        invalidatedAt: new Date("2026-06-02T11:00:00.000Z"),
        invalidatedReason: "source_changed",
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for an invalid contract shape", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({ contractJson: { contractVersion: 1 } })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("returns null for a planned workout mismatch", async () => {
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      existingWorkoutId: "planned-1",
      isExisting: true,
      source: "existing_incomplete",
      weekInMeso: 2,
      sessionInWeek: 2,
      derivationTrace: [],
      selectedIncompleteStatus: "planned",
    });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "planned-1",
      revision: 7,
    });
    mocks.snapshotFindFirst.mockResolvedValue(
      makeSnapshot({
        plannedWorkoutId: "planned-1",
        plannedWorkoutRevision: 6,
        contractJson: makeContract({
          nextSessionIdentity: {
            ...makeContract().nextSessionIdentity,
            existingWorkoutId: "planned-1",
          },
        }),
      })
    );

    await expect(
      loadLatestHomePreSessionReadinessContractCandidate("user-1")
    ).resolves.toBeNull();
  });

  it("loads a blocked contract when identity and freshness are valid", async () => {
    const blocked = makeContract({
      startability: {
        status: "blocked",
        safeToTrain: false,
        normalStartCoachingAllowed: false,
        action: "resolve_blocker_first",
        reasons: ["Resolve closeout first."],
        blockerSummary: "Closeout pending.",
      },
      projectedWeekStatus: {
        ...makeContract().projectedWeekStatus,
        status: "blocked",
      },
      sessionLocalCoaching: {
        ...makeContract().sessionLocalCoaching,
        addOnState: {
          status: "blocked",
          reason: "Blocked until closeout is resolved.",
        },
      },
    });
    mocks.snapshotFindFirst.mockResolvedValue(makeSnapshot({ contractJson: blocked }));

    const candidate =
      await loadLatestHomePreSessionReadinessContractCandidate("user-1");

    expect(candidate?.contract).toMatchObject({
      startability: {
        status: "blocked",
        safeToTrain: false,
      },
    });
  });

  it("Home DTO still maps through the app-safe gym-card adapter", async () => {
    mocks.snapshotFindFirst.mockResolvedValue(makeSnapshot());

    const candidate =
      await loadLatestHomePreSessionReadinessContractCandidate("user-1");
    const dto = candidate
      ? buildPreSessionReadinessGymCardDto(
          candidate.contract as PreSessionReadinessContract
        )
      : null;

    expect(dto).toMatchObject({
      source: {
        kind: "typed_pre_session_readiness_contract",
        ownerSeam: "api/pre-session-readiness-contract",
        producerMode: "persisted_snapshot",
      },
      action: "start",
    });
  });

  it("does not introduce CLI or audit artifact dependencies", () => {
    const source = readFileSync(
      "src/lib/api/pre-session-readiness-snapshot.ts",
      "utf8"
    );

    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toContain("artifacts/audits");
  });

  it("invalidates snapshots for a matching identity", async () => {
    await expect(
      invalidatePreSessionReadinessSnapshotsForIdentity({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        weekInMeso: 2,
        sessionInWeek: 2,
        slotId: "lower_a",
        slotIntent: "lower",
        invalidatedReason: "source_changed",
      })
    ).resolves.toEqual({ count: 1 });

    expect(mocks.snapshotUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invalidatedAt: null,
          slotIntent: "lower",
        }),
        data: expect.objectContaining({
          invalidatedReason: "source_changed",
        }),
      })
    );
  });
});
