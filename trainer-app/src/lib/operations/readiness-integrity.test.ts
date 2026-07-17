import { describe, expect, it } from "vitest";
import {
  hashPreSessionReadinessIdentity,
  hashPreSessionReadinessTarget,
  hashPreSessionReadinessValue,
  type PreSessionReadinessIdentity,
} from "@/lib/api/pre-session-readiness-identity";
import type { PreSessionReadinessContract } from "@/lib/api/pre-session-readiness-contract";
import {
  EXPECTED_MIGRATION_CHAIN,
  type CheckedInMigration,
  type LedgerRow,
} from "./migration-integrity";
import {
  buildReadinessIntegrityReport,
  classifyReadinessSchemaStage,
  type ReadinessCatalogFacts,
  type ReadinessDatabaseRow,
} from "./readiness-integrity";

function checkedIn(): CheckedInMigration[] {
  return EXPECTED_MIGRATION_CHAIN.map((name, index) => ({
    name,
    checksum: `checksum-${index}`,
    sqlPath: `prisma/migrations/${name}/migration.sql`,
  }));
}

function ledger(count: number): LedgerRow[] {
  return checkedIn().slice(0, count).map((migration, index) => ({
    id: `ledger-${index}`,
    migrationName: migration.name,
    checksum: migration.checksum,
    finishedAt: "2026-07-01 00:00:00+00",
    rolledBackAt: null,
    logs: null,
    appliedStepsCount: 1,
  }));
}

const identityColumns = [
  "identityStatus",
  "identityContractVersion",
  "identityJson",
  "identityHash",
  "targetHash",
  "payloadHash",
  "readinessEvidenceFingerprint",
  "projectionFingerprint",
  "seedRevisionId",
  "seedRevisionNumber",
  "seedPayloadHash",
  "prescriptionFingerprint",
];

function catalog(stage: "pre" | "full"): ReadinessCatalogFacts {
  const result: ReadinessCatalogFacts = {
    tables: ["PreSessionReadinessSnapshot", "Mesocycle", "Workout"],
    columns: ["expiresAt", "invalidatedAt", "invalidatedReason"].map((name) => ({
      table: "PreSessionReadinessSnapshot",
      name,
    })),
    indexes: [],
  };
  if (stage === "full") {
    result.tables.push("MesocycleSeedRevision");
    result.columns.push({ table: "Mesocycle", name: "currentSeedRevisionId" });
    result.columns.push(
      ...identityColumns.map((name) => ({ table: "PreSessionReadinessSnapshot", name })),
    );
    for (const [name, column] of [
      ["psrs_one_active_exact_identity_uidx", "identityHash"],
      ["psrs_one_active_target_uidx", "targetHash"],
    ]) {
      result.indexes.push({
        table: "PreSessionReadinessSnapshot",
        name,
        unique: true,
        columns: ["userId", column],
        predicate: '("invalidatedAt" IS NULL AND "identityStatus" = \'EXACT\')',
        valid: true,
        ready: true,
        live: true,
      });
    }
  }
  return result;
}

function contract(overrides: Partial<PreSessionReadinessContract["nextSessionIdentity"]> = {}): PreSessionReadinessContract {
  return {
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
      currentSession: 1,
      nextSlotId: "upper_a",
      nextIntent: "upper",
      existingWorkoutId: null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
      ...overrides,
    },
    startability: {
      status: "startable",
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed",
      reasons: [],
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
      proofLines: [],
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
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
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
      addOnState: { status: "none", reason: "No optional add-ons." },
    },
    calibrationWatches: { prescriptionConfidence: [], recoveryCaveats: [], fatigue: [] },
    consistencyChecks: [],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: [],
    },
  };
}

function legacyRow(overrides: Partial<ReadinessDatabaseRow> = {}): ReadinessDatabaseRow {
  return {
    id: "snapshot-1",
    userId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 2,
    sessionInWeek: 1,
    slotId: "upper_a",
    slotIntent: "upper",
    plannedWorkoutId: null,
    plannedWorkoutRevision: null,
    contractVersion: 1,
    contractJson: contract(),
    sourceStateHash: "legacy-source",
    slotPlanSeedHash: "legacy-seed",
    slotSequenceHash: "legacy-sequence",
    createdAt: "2026-07-01 00:00:00+00",
    expiresAt: null,
    invalidatedAt: null,
    invalidatedReason: null,
    workoutExists: false,
    currentWorkoutRevision: null,
    ...overrides,
  };
}

function report(options: {
  stage: "pre" | "full";
  rows?: ReadinessDatabaseRow[];
  catalogOverride?: ReadinessCatalogFacts;
  ledgerOverride?: LedgerRow[];
}) {
  return buildReadinessIntegrityReport({
    catalog: options.catalogOverride ?? catalog(options.stage),
    ledgerRows: options.ledgerOverride ?? ledger(options.stage === "pre" ? 10 : 15),
    checkedIn: checkedIn(),
    rows: options.rows ?? [],
    fingerprintBefore: "same",
    fingerprintAfter: "same",
    transactionReadOnly: true,
  });
}

describe("readiness integrity schema-stage detection", () => {
  it("accepts clean first-10 and all-15 schemas", () => {
    expect(
      classifyReadinessSchemaStage({ catalog: catalog("pre"), ledgerRows: ledger(10), checkedIn: checkedIn() }).stage,
    ).toBe("pre_architecture_migration");
    expect(
      classifyReadinessSchemaStage({ catalog: catalog("full"), ledgerRows: ledger(15), checkedIn: checkedIn() }).stage,
    ).toBe("fully_migrated");
  });

  it("fails closed for a lone future column and a seed table without readiness migration", () => {
    const oneColumn = catalog("pre");
    oneColumn.columns.push({ table: "PreSessionReadinessSnapshot", name: "identityStatus" });
    expect(
      classifyReadinessSchemaStage({ catalog: oneColumn, ledgerRows: ledger(10), checkedIn: checkedIn() }).stage,
    ).toBe("partial_or_incompatible");

    const seedIntermediate = catalog("pre");
    seedIntermediate.tables.push("MesocycleSeedRevision");
    seedIntermediate.columns.push({ table: "Mesocycle", name: "currentSeedRevisionId" });
    expect(
      classifyReadinessSchemaStage({ catalog: seedIntermediate, ledgerRows: ledger(11), checkedIn: checkedIn() }).stage,
    ).toBe("partial_or_incompatible");
  });

  it("blocks ledger and catalog disagreement", () => {
    const result = classifyReadinessSchemaStage({
      catalog: catalog("pre"),
      ledgerRows: ledger(15),
      checkedIn: checkedIn(),
    });
    expect(result.stage).toBe("partial_or_incompatible");
    expect(result.ledger.blockers).toContain("catalog_ledger_disagreement:catalog_expected_10:ledger_15");
  });

  it("blocks a same-name partial index with the wrong ordered key columns", () => {
    const wrongIndex = catalog("full");
    wrongIndex.indexes[0].columns = ["identityHash", "userId"];
    const result = classifyReadinessSchemaStage({
      catalog: wrongIndex,
      ledgerRows: ledger(15),
      checkedIn: checkedIn(),
    });
    expect(result.stage).toBe("partial_or_incompatible");
    expect(result.checkedObjects).toContainEqual({
      object: "index:PreSessionReadinessSnapshot.psrs_one_active_exact_identity_uidx",
      present: false,
    });
  });
});

describe("pre-migration readiness integrity", () => {
  it("classifies valid active and invalidated rows without querying or claiming exact fields", () => {
    const result = report({
      stage: "pre",
      rows: [
        legacyRow(),
        legacyRow({ id: "snapshot-2", invalidatedAt: "2026-07-02", invalidatedReason: "manual" }),
      ],
    });
    expect(result.schemaStage).toBe("pre_architecture_migration");
    expect(result.snapshots).toMatchObject({ total: 2, active: 1, invalidated: 1 });
    expect(result.legacy).toMatchObject({ valid: 2, duplicate: 0, stale: 0, invalid: 0, unknown: 0 });
    expect(result.exact.applicability).toBe("not_applicable_pre_migration");
    expect(result.migrationSafety.rowsBecomingLegacyUnknown).toEqual(["snapshot-1", "snapshot-2"]);
    expect(result.migrationSafety.indexCreationWouldSucceed).toBe(true);
    expect(result.readinessIntegrityReady).toBe(true);
  });

  it("reports duplicate, stale, unsupported, malformed, missing, and ambiguous legacy evidence", () => {
    const workoutContract = contract({ existingWorkoutId: "workout-1" });
    const rows = [
      legacyRow(),
      legacyRow({ id: "duplicate", createdAt: "2026-07-02" }),
      legacyRow({
        id: "stale",
        plannedWorkoutId: "workout-1",
        plannedWorkoutRevision: 1,
        workoutExists: true,
        currentWorkoutRevision: 2,
        contractJson: workoutContract,
      }),
      legacyRow({ id: "unsupported", contractVersion: 2 }),
      legacyRow({ id: "malformed", contractJson: { contractVersion: 1 } }),
      legacyRow({
        id: "missing",
        plannedWorkoutId: "missing-workout",
        plannedWorkoutRevision: 1,
        contractJson: contract({ existingWorkoutId: "missing-workout" }),
      }),
      legacyRow({ id: "ambiguous", slotId: "", contractJson: contract({ nextSlotId: "" }) }),
    ];
    const result = report({ stage: "pre", rows });
    expect(result.legacy).toMatchObject({ duplicate: 1, stale: 1, invalid: 3, unknown: 1 });
    expect(result.legacy.unsupportedContractVersions).toEqual(["unsupported"]);
    expect(result.legacy.invalidContractPayloads).toEqual(["malformed"]);
    expect(result.snapshots.rowsReferencingMissingWorkouts).toBe(1);
    expect(result.migrationSafety.definiteUniqueConflicts).toHaveLength(1);
    expect(result.migrationSafety.ambiguousGroups).toHaveLength(1);
    expect(result.migrationSafety.readinessMigrationSafe).toBe(false);
    expect(result.migrationSafety.repairRequiredBeforeMigration).toBe(true);
    expect(result.readinessIntegrityReady).toBe(false);
  });

  it("matches migration behavior: legacy rows are excluded from exact partial indexes", () => {
    const result = report({ stage: "pre", rows: [legacyRow(), legacyRow({ id: "duplicate" })] });
    expect(result.migrationSafety.indexCreationWouldSucceed).toBe(true);
    expect(result.migrationSafety.rowsBecomingLegacyUnknown).toHaveLength(2);
    expect(result.migrationSafety.migrationBehavior).toContain("identityStatus=LEGACY_UNKNOWN");
    expect(result.migrationSafety.migrationBehavior).toContain("No exact hashes are fabricated");
  });
});

function exactFutureRow(overrides: Partial<ReadinessDatabaseRow> = {}): ReadinessDatabaseRow {
  const payload = contract();
  const identity: PreSessionReadinessIdentity = {
    identityContractVersion: 1,
    ownerId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 2,
    sessionInWeek: 1,
    target: {
      kind: "future_slot",
      mesocycleId: "meso-1",
      weekInMeso: 2,
      sessionInWeek: 1,
      slotId: "upper_a",
      slotIntent: "upper",
      seedRevision: {
        status: "exact_revision",
        revisionId: "seed-1",
        revision: 1,
        payloadHash: "seed-hash",
      },
      slotSequenceHash: "sequence-hash",
    },
    readinessEvidenceFingerprint: "readiness-hash",
    projectionFingerprint: "projection-hash",
  };
  return legacyRow({
    identityStatus: "EXACT",
    identityContractVersion: 1,
    identityJson: identity,
    identityHash: hashPreSessionReadinessIdentity(identity),
    targetHash: hashPreSessionReadinessTarget(identity),
    payloadHash: hashPreSessionReadinessValue(payload),
    readinessEvidenceFingerprint: identity.readinessEvidenceFingerprint,
    projectionFingerprint: identity.projectionFingerprint,
    seedRevisionId: "seed-1",
    seedRevisionNumber: 1,
    seedPayloadHash: "seed-hash",
    seedRevisionExists: true,
    persistedSeedRevisionNumber: 1,
    persistedSeedPayloadHash: "seed-hash",
    seedProvenanceStatus: "exact",
    currentSeedRevisionId: "seed-1",
    contractJson: payload,
    ...overrides,
  });
}

describe("fully migrated readiness integrity", () => {
  it("passes a valid exact row and does not reconstruct current readiness", () => {
    const result = report({ stage: "full", rows: [exactFutureRow()] });
    expect(result.exact).toMatchObject({
      applicability: "verified_fully_migrated",
      exactRows: 1,
      legacyRows: 0,
      currentReadinessStatus: "not_reconstructed_by_integrity_audit",
    });
    expect(result.readinessIntegrityReady).toBe(true);
  });

  it("detects corrupt hashes, fingerprints, stale seed evidence, and computed duplicates", () => {
    const first = exactFutureRow({
      identityHash: "corrupt-identity",
      payloadHash: "corrupt-payload",
      readinessEvidenceFingerprint: "wrong-readiness",
      projectionFingerprint: "wrong-projection",
      currentSeedRevisionId: "seed-2",
    });
    const second = exactFutureRow({
      id: "snapshot-2",
      identityHash: "different-persisted-hash",
      targetHash: "different-persisted-target",
    });
    const result = report({ stage: "full", rows: [first, second] });
    expect(result.exact.identityHashFailures).toHaveLength(2);
    expect(result.exact.targetHashFailures).toHaveLength(1);
    expect(result.exact.payloadHashFailures).toHaveLength(1);
    expect(result.exact.readinessEvidenceFingerprintMismatch).toHaveLength(1);
    expect(result.exact.projectionFingerprintMismatch).toHaveLength(1);
    expect(result.exact.staleSeedRevision).toHaveLength(1);
    expect(result.exact.duplicateActiveIdentity).toHaveLength(1);
    expect(result.exact.duplicateActiveTarget).toHaveLength(1);
    expect(result.readinessIntegrityReady).toBe(false);
  });

  it("retains migrated legacy rows as non-exact evidence", () => {
    const result = report({
      stage: "full",
      rows: [legacyRow({ identityStatus: "LEGACY_UNKNOWN" })],
    });
    expect(result.exact).toMatchObject({ exactRows: 0, legacyRows: 1 });
    expect(result.legacy).toMatchObject({ valid: 1, invalid: 0, unknown: 0 });
    expect(result.readinessIntegrityReady).toBe(true);
  });

  it("reports stale workout revisions and corrupt or unsupported identity contracts", () => {
    const workoutContract = contract({ existingWorkoutId: "workout-1" });
    const workoutIdentity: PreSessionReadinessIdentity = {
      identityContractVersion: 1,
      ownerId: "user-1",
      activeMesocycleId: "meso-1",
      mesocycleState: "ACTIVE_ACCUMULATION",
      weekInMeso: 2,
      sessionInWeek: 1,
      target: {
        kind: "materialized_workout",
        workoutId: "workout-1",
        workoutRevision: 1,
        prescriptionFingerprint: "prescription-hash",
      },
      readinessEvidenceFingerprint: "readiness-hash",
      projectionFingerprint: "projection-hash",
    };
    const staleWorkout = legacyRow({
      id: "stale-workout",
      plannedWorkoutId: "workout-1",
      plannedWorkoutRevision: 1,
      workoutExists: true,
      currentWorkoutRevision: 2,
      contractJson: workoutContract,
      identityStatus: "EXACT",
      identityContractVersion: 1,
      identityJson: workoutIdentity,
      identityHash: hashPreSessionReadinessIdentity(workoutIdentity),
      targetHash: hashPreSessionReadinessTarget(workoutIdentity),
      payloadHash: hashPreSessionReadinessValue(workoutContract),
      readinessEvidenceFingerprint: "readiness-hash",
      projectionFingerprint: "projection-hash",
      prescriptionFingerprint: "prescription-hash",
    });
    const malformed = exactFutureRow({
      id: "malformed-identity",
      identityContractVersion: 99,
      identityJson: { identityContractVersion: 99 },
    });
    const result = report({ stage: "full", rows: [staleWorkout, malformed] });
    expect(result.exact.staleWorkoutRevision).toHaveLength(1);
    expect(result.exact.identityContractFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ snapshotId: "malformed-identity", code: "unsupported_identity_contract_version" }),
        expect.objectContaining({ snapshotId: "malformed-identity", code: "invalid_identity_json" }),
      ]),
    );
    expect(result.readinessIntegrityReady).toBe(false);
  });

  it("fails a broken supersession chain and contradictory lifecycle fields", () => {
    const broken = exactFutureRow({
      id: "broken-superseded",
      invalidatedAt: "2026-07-03 00:00:00+00",
      invalidatedReason: "superseded_by_atomic_prepare",
    });
    const lifecycle = exactFutureRow({
      id: "bad-lifecycle",
      invalidatedReason: "superseded_by_atomic_prepare",
    });
    const result = report({ stage: "full", rows: [broken, lifecycle] });
    expect(result.exact.supersededChainFailures).toHaveLength(1);
    expect(result.exact.lifecycleFailures).toHaveLength(1);
    expect(result.readinessIntegrityReady).toBe(false);
  });

  it("produces deterministic structured output", () => {
    const first = report({ stage: "full", rows: [exactFutureRow()] });
    const second = report({ stage: "full", rows: [exactFutureRow()] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
