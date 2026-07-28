import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIED_SCHEMA_EXPECTATIONS,
  BASELINE_UNIQUENESS_EXPECTATIONS,
  buildMigrationIntegrityReport,
  checksumMigrationSql,
  EXPECTED_GATE_A_PENDING,
  EXPECTED_MIGRATION_CHAIN,
  migrationChecksumMatches,
  MIGRATION_AUTHORIZATION_POLICY,
  PENDING_ARCHITECTURE_MANIFEST,
  prismaCompatibleMigrationSqlChecksums,
  type CatalogSnapshot,
  type CheckedInMigration,
  type LedgerRow,
  type MigrationAuthorizationEvidence,
} from "./migration-integrity";

const REPOSITORY_HEAD = "b".repeat(40);
const EVALUATED_AT = "2026-07-26T18:00:00.000Z";
const VERIFIED_AT = "2026-07-26T17:50:00.000Z";
const TARGET_FINGERPRINT = "5952f3ffb454";
const PENDING_MANIFEST_INDEX = PENDING_ARCHITECTURE_MANIFEST.length - 1;

function checkedIn(): CheckedInMigration[] {
  return EXPECTED_MIGRATION_CHAIN.map((name) => ({
    name,
    checksum: checksumMigrationSql(Buffer.from(name)),
    sqlPath: `prisma/migrations/${name}/migration.sql`,
  }));
}

function successfulRow(migration: CheckedInMigration, index: number): LedgerRow {
  return {
    id: `ledger-${index}`,
    migrationName: migration.name,
    checksum: migration.checksum,
    finishedAt: "2026-07-01 00:00:00+00",
    rolledBackAt: null,
    logs: null,
    appliedStepsCount: 1,
  };
}

function appliedPrefix(count = EXPECTED_MIGRATION_CHAIN.length - 1): LedgerRow[] {
  return checkedIn().slice(0, count).map(successfulRow);
}

function addCompatibleManifestObject(
  catalog: CatalogSnapshot,
  migrationIndex: number,
  objectIndex: number,
): void {
  const object = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects[objectIndex];
  if (!object) return;
  if (object.kind === "table") catalog.tables.push(object.name);
  if (object.kind === "column") {
    catalog.columns.push({
      table: object.table!,
      name: object.name,
      ...object.column!,
    });
  }
  if (object.kind === "index") {
    catalog.indexes.push({
      table: object.table!,
      name: object.name,
      ...object.index!,
      valid: true,
      ready: true,
      live: true,
    });
  }
  if (object.kind === "constraint") {
    catalog.constraints.push({
      table: object.table!,
      name: object.name,
      type: object.constraint?.type ?? "f",
      definition:
        object.constraint?.definition ??
        object.definitionIncludes?.join(" ") ??
        "",
    });
  }
  if (object.kind === "trigger") {
    catalog.triggers.push({
      table: object.table!,
      name: object.name,
      definition: object.definitionIncludes?.join(" ") ?? "",
    });
  }
  if (object.kind === "function") {
    catalog.functions.push({
      name: object.name,
      definition: object.definitionIncludes?.join(" ") ?? "",
    });
  }
}

function cleanCatalog(
  appliedCount = EXPECTED_MIGRATION_CHAIN.length - 1,
): CatalogSnapshot {
  const catalog: CatalogSnapshot = {
    tables: [], columns: [], enums: [], indexes: [], constraints: [], triggers: [], functions: [],
  };
  for (const expectation of APPLIED_SCHEMA_EXPECTATIONS) {
    if (expectation.kind === "table") catalog.tables.push(expectation.name);
    if (expectation.kind === "column") catalog.columns.push({ ...expectation });
    if (expectation.kind === "enum") catalog.enums.push({ name: expectation.name, values: [...expectation.values] });
    if (expectation.kind === "index") catalog.indexes.push({ ...expectation, columns: [...expectation.columns] });
    if (expectation.kind === "constraint") catalog.constraints.push({ ...expectation });
  }
  for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
    if (!catalog.tables.includes(expectation.table)) catalog.tables.push(expectation.table);
    catalog.indexes.push({
      table: expectation.table,
      name: expectation.name,
      unique: true,
      columns: [...expectation.columns],
      predicate: expectation.predicate,
      nullsNotDistinct: expectation.nullsNotDistinct,
      valid: true,
      ready: true,
      constraintName: null,
      constraintType: null,
    });
  }
  for (
    let migrationIndex = 0;
    migrationIndex < PENDING_ARCHITECTURE_MANIFEST.length;
    migrationIndex += 1
  ) {
    const migration = PENDING_ARCHITECTURE_MANIFEST[migrationIndex];
    const chainIndex = EXPECTED_MIGRATION_CHAIN.indexOf(
      migration.migration as (typeof EXPECTED_MIGRATION_CHAIN)[number],
    );
    if (chainIndex >= appliedCount) continue;
    for (
      let objectIndex = 0;
      objectIndex < migration.objects.length;
      objectIndex += 1
    ) {
      addCompatibleManifestObject(catalog, migrationIndex, objectIndex);
    }
  }
  return catalog;
}

function fullEvidence(
  overrides: Partial<MigrationAuthorizationEvidence> = {},
): MigrationAuthorizationEvidence {
  return {
    repositoryHead: REPOSITORY_HEAD,
    productionDeploymentCommit:
      MIGRATION_AUTHORIZATION_POLICY.compatibleProductionDeploymentCommits[0],
    requiredApplicationCommit: REPOSITORY_HEAD,
    dataPreflight: {
      valid: true,
      verifiedAt: VERIFIED_AT,
      targetFingerprint: TARGET_FINGERPRINT,
    },
    disposablePostgres: {
      valid: true,
      verifiedAt: VERIFIED_AT,
      repositoryHead: REPOSITORY_HEAD,
    },
    recoveryPoint: {
      verified: true,
      providerProjectIdentity: "supabase:trainer-production",
      databaseIdentity: "postgres:primary",
      recoveryTimestamp: VERIFIED_AT,
      retentionConfirmed: true,
      recoverabilityConfirmed: true,
      freshForExecution: true,
      operatorVerifiedAt: VERIFIED_AT,
    },
    writeBoundary: {
      ready: true,
      mechanism: "production-write-gate",
      verifiedAt: VERIFIED_AT,
    },
    applicationCompatibilityState: "compatible_with_write_boundary",
    deploymentVerifiedAt: VERIFIED_AT,
    evaluatedAt: EVALUATED_AT,
    ...overrides,
  };
}

function report(overrides: Partial<Parameters<typeof buildMigrationIntegrityReport>[0]> = {}) {
  return buildMigrationIntegrityReport({
    target: { classification: "remote", fingerprint: TARGET_FINGERPRINT },
    checkedIn: checkedIn(),
    ledgerRows: appliedPrefix(),
    catalog: cleanCatalog(),
    writes: 0,
    authorizationEvidence: fullEvidence(),
    ...overrides,
  });
}

function addPendingObject(catalog: CatalogSnapshot, migrationIndex: number, objectIndex: number): void {
  const object = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects[objectIndex];
  if (!object) return;
  if (object.kind === "table") catalog.tables.push(object.name);
  if (object.kind === "column") catalog.columns.push({ table: object.table!, name: object.name, type: "text", nullable: true, default: null });
  if (object.kind === "index") catalog.indexes.push({ table: object.table!, name: object.name, unique: false, columns: [], predicate: null });
  if (object.kind === "constraint") catalog.constraints.push({ table: object.table!, name: object.name, type: "f", definition: "fixture" });
  if (object.kind === "trigger") catalog.triggers.push({ table: object.table!, name: object.name, definition: "fixture" });
  if (object.kind === "function") catalog.functions.push({ name: object.name, definition: "fixture" });
}

function pendingObjectIndex(migrationIndex: number, kind: string): number {
  const index = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects.findIndex((object) => object.kind === kind);
  if (index < 0) throw new Error(`Missing ${kind} fixture for pending migration ${migrationIndex}`);
  return index;
}

describe("migration integrity", () => {
  it("declares the checked-in migration directories in exact filesystem order", () => {
    const directories = readdirSync(resolve("prisma/migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual([...EXPECTED_MIGRATION_CHAIN]);
  });

  it("accepts the applied prefix and the exact expected pending migration", () => {
    const result = report();
    expect(result.chain).toMatchObject({
      checkedIn: EXPECTED_MIGRATION_CHAIN.length,
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: EXPECTED_GATE_A_PENDING.length,
      pendingNames: EXPECTED_GATE_A_PENDING,
    });
    expect(result.checksums).toMatchObject({
      matched: EXPECTED_MIGRATION_CHAIN.length - 1,
      mismatched: [],
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.migrationAuthorizationReady).toBe(true);
    expect(result.executionAuthorized).toBe(false);
  });

  it("treats clean zero-step baseline and hotfix resolutions as applied without breaking the prefix", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], appliedStepsCount: 0 };
    rows[9] = { ...rows[9], appliedStepsCount: 0 };
    const result = report({ ledgerRows: rows });

    expect(result.chain).toMatchObject({
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: EXPECTED_GATE_A_PENDING.length,
      pendingNames: EXPECTED_GATE_A_PENDING,
    });
    expect(result.ledger.successful).toHaveLength(
      EXPECTED_MIGRATION_CHAIN.length - 1,
    );
    expect(result.ledger.resolvedApplied).toEqual([
      EXPECTED_MIGRATION_CHAIN[0],
      EXPECTED_MIGRATION_CHAIN[9],
    ]);
    expect(result.ledger.successfulDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ migrationName: EXPECTED_MIGRATION_CHAIN[0], appliedMode: "resolved_applied", appliedStepsCount: 0 }),
      expect.objectContaining({ migrationName: EXPECTED_MIGRATION_CHAIN[1], appliedMode: "executed", appliedStepsCount: 1 }),
    ]));
    expect(result.ledger.incomplete).toEqual([]);
    expect(result.ledger.orderViolations).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it("hashes the exact migration bytes written to the Prisma ledger", () => {
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).not.toBe(
      checksumMigrationSql(Buffer.from("SELECT 1;\r\n")),
    );
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).toHaveLength(64);
  });

  it("matches Prisma's exact, LF, and CRLF checksum variants", () => {
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    expect(prismaCompatibleMigrationSqlChecksums(lf)).toEqual(
      expect.arrayContaining([
        checksumMigrationSql(lf),
        checksumMigrationSql(crlf),
      ]),
    );
    expect(prismaCompatibleMigrationSqlChecksums(crlf)).toEqual(
      expect.arrayContaining([
        checksumMigrationSql(crlf),
        checksumMigrationSql(lf),
      ]),
    );
    const migration = {
      name: "test",
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
      sqlPath: "migration.sql",
    };
    expect(migrationChecksumMatches(migration, checksumMigrationSql(crlf))).toBe(true);
    expect(migrationChecksumMatches(migration, checksumMigrationSql(lf))).toBe(true);
  });

  it("does not normalize standalone carriage returns or genuine SQL drift", () => {
    const checksums = prismaCompatibleMigrationSqlChecksums(
      Buffer.from("SELECT 1;\r"),
    );
    expect(checksums).not.toContain(
      checksumMigrationSql(Buffer.from("SELECT 1;\n")),
    );
    expect(checksums).not.toContain(
      checksumMigrationSql(Buffer.from("SELECT 2;\r\n")),
    );
  });

  it("accepts a raw CRLF ledger checksum for a CRLF working-tree file", () => {
    const migrations = checkedIn();
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    migrations[0] = {
      ...migrations[0],
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
    };
    const rows = migrations.slice(0, -1).map(successfulRow);
    const result = report({ checkedIn: migrations, ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([]);
    expect(result.checksums.lineEndingCompatibilityUsed).toEqual([]);
    expect(result.migrationChecksumsValid).toBe(true);
    expect(migrations[0].checksum).toBe(checksumMigrationSql(crlf));
    expect(migrations[0].compatibleChecksums).toContain(
      checksumMigrationSql(lf),
    );
  });

  it("accepts an LF ledger checksum for a CRLF working-tree file", () => {
    const migrations = checkedIn();
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    migrations[0] = {
      ...migrations[0],
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
    };
    const rows = migrations.slice(0, -1).map(successfulRow);
    rows[0] = {
      ...rows[0],
      checksum: checksumMigrationSql(lf),
      appliedStepsCount: 0,
    };
    const result = report({ checkedIn: migrations, ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([]);
    expect(result.checksums.lineEndingCompatibilityUsed).toEqual([
      migrations[0].name,
    ]);
    expect(result.migrationChecksumsValid).toBe(true);
    expect(result.ledger.successfulDetails).toContainEqual({
      migrationName: migrations[0].name,
      appliedMode: "resolved_applied",
      appliedStepsCount: 0,
    });
  });

  it("blocks a checksum mismatch and a missing ledger checksum", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], checksum: "changed" };
    rows[1] = { ...rows[1], checksum: null };
    const result = report({ ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.checksums.missingLedgerChecksum).toEqual([EXPECTED_MIGRATION_CHAIN[1]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("reports an applied migration missing from the checked-in chain", () => {
    const migrations = checkedIn().slice(1);
    const result = report({ checkedIn: migrations, ledgerRows: appliedPrefix() });
    expect(result.checksums.missingCheckedIn).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.ledger.unknown).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it.each([
    ["failed", { finishedAt: null, logs: "database error" }, "failed"],
    ["rolled back", { finishedAt: null, rolledBackAt: "2026-07-01 01:00:00+00" }, "rolledBack"],
    ["unfinished", { finishedAt: null }, "incomplete"],
  ] as const)("blocks a %s ledger entry", (_label, change, field) => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], ...change };
    const result = report({ ledgerRows: rows });
    expect(result.ledger[field]).toContain(EXPECTED_MIGRATION_CHAIN[0]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks duplicate ledger rows", () => {
    const rows = appliedPrefix();
    rows.push({ ...rows[0], id: "duplicate" });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.duplicates).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("accepts exactly one clean replacement after rolled-back history", () => {
    const rows = appliedPrefix();
    rows.push({
      ...rows[0],
      id: "rolled-back-history",
      finishedAt: null,
      rolledBackAt: "2026-06-30 00:00:00+00",
      logs: "prior failure",
      appliedStepsCount: 0,
    });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.rolledBackHistory).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.ledger.rolledBack).toEqual([]);
    expect(result.ledger.duplicates).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it("blocks contradictory and ambiguous ledger groups", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], rolledBackAt: "2026-07-02 00:00:00+00" };
    rows.push({ ...rows[1], id: "second-success" });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.incomplete).toEqual(expect.arrayContaining([
      EXPECTED_MIGRATION_CHAIN[0],
      EXPECTED_MIGRATION_CHAIN[1],
    ]));
    expect(result.ledger.duplicates).toContain(EXPECTED_MIGRATION_CHAIN[1]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks an applied migration after a pending predecessor", () => {
    const rows = appliedPrefix().filter((row) => row.migrationName !== EXPECTED_MIGRATION_CHAIN[4]);
    const result = report({ ledgerRows: rows });
    expect(result.ledger.orderViolations).toContain(EXPECTED_MIGRATION_CHAIN[5]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("keeps later clean migrations ordered behind zero-step successful predecessors", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], appliedStepsCount: 0 };
    rows[4] = { ...rows[4], appliedStepsCount: 0 };
    const result = report({ ledgerRows: rows });
    expect(result.ledger.orderViolations).toEqual([]);
    expect(result.chain.applied).toBe(EXPECTED_MIGRATION_CHAIN.length - 1);
  });

  it("blocks an unknown ledger migration", () => {
    const rows = appliedPrefix();
    rows.push(successfulRow({ name: "unknown_migration", checksum: "abc", sqlPath: "missing" }, 99));
    const result = report({ ledgerRows: rows });
    expect(result.ledger.unknown).toEqual(["unknown_migration"]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("passes when every target-migration object is absent", () => {
    const result = report();
    expect(result.partialObjects.partiallyPresent).toEqual([]);
    expect(result.partialObjects.unexpectedPresent).toEqual([]);
    expect(result.partialObjects.commentsOnly).toEqual([]);
  });

  it.each([
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "column"),
      "target column",
    ],
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "index"),
      "target index",
    ],
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "constraint"),
      "target constraint",
    ],
  ])("blocks one unexpectedly present %s/%s %s", (migrationIndex, objectIndex) => {
    const catalog = cleanCatalog();
    addPendingObject(catalog, migrationIndex, objectIndex);
    const result = report({ catalog });
    expect([
      ...result.partialObjects.partiallyPresent,
      ...result.partialObjects.unexpectedPresent,
      ...result.partialObjects.incompatible,
    ]).not.toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks a missing object from an already-applied architecture migration", () => {
    const catalog = cleanCatalog();
    catalog.columns = catalog.columns.filter(
      (column) =>
        !(
          column.table === "WorkoutExercise" &&
          column.name === "stimulusAccountingSnapshot"
        ),
    );
    const result = report({ catalog });
    expect(result.schemaPreflightValid).toBe(false);
    expect(result.definitions.appliedManifestMissing).toEqual([
      expect.stringContaining("stimulusAccountingSnapshot"),
    ]);
  });

  it("derives readiness from an explicit pending sequence instead of a fixed count", () => {
    const expectedPendingMigrations = EXPECTED_MIGRATION_CHAIN.slice(-2);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length - 2),
      catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length - 2),
      authorizationEvidence: fullEvidence({
        expectedPendingMigrations: [...expectedPendingMigrations],
      }),
    });
    expect(result.pendingMigrations).toEqual(expectedPendingMigrations);
    expect(result.technicalMigrationReady).toBe(true);
  });

  it("rejects an unexpected second pending migration", () => {
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length - 2),
      catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length - 2),
    });
    expect(result.pendingMigrations).toHaveLength(2);
    expect(result.unexpectedMigrations).toEqual([
      EXPECTED_MIGRATION_CHAIN.at(-2),
    ]);
    expect(result.technicalMigrationReady).toBe(false);
  });

  it("requires clean data preflight but does not treat it as authorization", () => {
    const withoutData = report({
      authorizationEvidence: fullEvidence({ dataPreflight: undefined }),
    });
    expect(withoutData.technicalMigrationReady).toBe(false);

    const technicalOnly = report({
      authorizationEvidence: fullEvidence({
        recoveryPoint: undefined,
        writeBoundary: undefined,
      }),
    });
    expect(technicalOnly.dataPreflightValid).toBe(true);
    expect(technicalOnly.technicalMigrationReady).toBe(true);
    expect(technicalOnly.migrationAuthorizationReady).toBe(false);
  });

  it("requires recovery-point evidence for authorization readiness", () => {
    const result = report({
      authorizationEvidence: fullEvidence({ recoveryPoint: undefined }),
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.recoveryPointVerified).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("requires the write boundary for authorization readiness", () => {
    const result = report({
      authorizationEvidence: fullEvidence({ writeBoundary: undefined }),
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.writeBoundaryReady).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("models the captured production shape without granting execution", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        recoveryPoint: undefined,
        writeBoundary: undefined,
      }),
    });
    expect(result).toMatchObject({
      appliedMigrations: expect.arrayContaining([
        EXPECTED_MIGRATION_CHAIN[0],
        EXPECTED_MIGRATION_CHAIN[14],
      ]),
      pendingMigrations: [MIGRATION_AUTHORIZATION_POLICY.targetMigration],
      schemaPreflightValid: true,
      dataPreflightValid: true,
      technicalMigrationReady: true,
      migrationAuthorizationReady: false,
      executionAuthorized: false,
    });
  });

  it("can become authorization-ready with complete evidence but never execution-authorized in preparation mode", () => {
    const result = report();
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.migrationAuthorizationReady).toBe(true);
    expect(result.executionAuthorized).toBe(false);
  });

  it("requires the operator to identify the exact post-migration application commit", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        requiredApplicationCommit: undefined,
      }),
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.evidence.requiredApplicationCommitIdentified).toBe(false);
    expect(result.blockingReasons).toContain(
      "required_application_commit_not_identified",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks an incompatible applied definition and an unverifiable catalog category", () => {
    const catalog = cleanCatalog();
    catalog.columns.find((item) => item.table === "SetLog" && item.name === "setIntent")!.type = "text";
    catalog.unableToVerify = ["functions"];
    const result = report({ catalog });
    expect(result.definitions.incompatible).toContain("column:SetLog.setIntent:incompatible");
    expect(result.partialObjects.unableToVerify).toEqual(["functions"]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("warns without blocking for semantically equivalent unique constraints", () => {
    const catalog = cleanCatalog();
    for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
      const index = catalog.indexes.find((candidate) => candidate.name === expectation.name)!;
      index.constraintName = expectation.name;
      index.constraintType = "u";
    }
    const result = report({ catalog });
    expect(result.schemaIntegrity.semanticDriftBlocking).toBe(0);
    expect(result.schemaIntegrity.representationWarningCount).toBe(2);
    expect(result.schemaIntegrity.representationWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectName: "ExerciseAlias_alias_key",
        semanticEquivalent: true,
        actualRepresentation: "unique_constraint_backed_index",
        pendingMigrationDependsOnDistinction: false,
      }),
      expect.objectContaining({
        objectName: "WorkoutTemplateExercise_templateId_orderIndex_key",
        semanticEquivalent: true,
        actualRepresentation: "unique_constraint_backed_index",
        pendingMigrationDependsOnDistinction: false,
      }),
    ]));
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it.each([
    ["missing", (catalog: CatalogSnapshot) => { catalog.indexes = catalog.indexes.filter((index) => index.name !== "ExerciseAlias_alias_key"); }],
    ["wrong order", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "WorkoutTemplateExercise_templateId_orderIndex_key")!.columns.reverse(); }],
    ["non-unique", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.unique = false; }],
    ["different predicate", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.predicate = "(alias IS NOT NULL)"; }],
    ["different null semantics", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.nullsNotDistinct = true; }],
    ["conflicting same-name constraint", (catalog: CatalogSnapshot) => { catalog.constraints.push({ table: "ExerciseAlias", name: "ExerciseAlias_alias_key", type: "u", definition: "UNIQUE (different_column)" }); }],
  ] as const)("blocks baseline uniqueness when it is %s", (_label, mutate) => {
    const catalog = cleanCatalog();
    mutate(catalog);
    const result = report({ catalog });
    expect(result.schemaIntegrity.semanticDriftBlocking).toBeGreaterThan(0);
    expect(result.schemaIntegrity.blockingDifferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "baseline_uniqueness" }),
    ]));
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("reports a fully migrated state as clean but not Gate A applicable", () => {
    const catalog = cleanCatalog(EXPECTED_MIGRATION_CHAIN.length);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length),
      catalog,
    });
    expect(result.chain).toMatchObject({
      applied: EXPECTED_MIGRATION_CHAIN.length,
      pending: 0,
      gateAApplicable: false,
    });
    expect(result.partialObjects.partiallyPresent).toEqual([]);
    expect(result.partialObjects.unexpectedPresent).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("is deterministic and does not serialize connection secrets", () => {
    const first = JSON.stringify(report());
    const second = JSON.stringify(report());
    expect(first).toBe(second);
    expect(first).not.toContain("postgresql://");
    expect(first).not.toContain("password");
  });
});
