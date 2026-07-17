import { describe, expect, it } from "vitest";
import {
  APPLIED_SCHEMA_EXPECTATIONS,
  BASELINE_UNIQUENESS_EXPECTATIONS,
  buildMigrationIntegrityReport,
  checksumMigrationSql,
  EXPECTED_GATE_A_PENDING,
  EXPECTED_MIGRATION_CHAIN,
  PENDING_ARCHITECTURE_MANIFEST,
  type CatalogSnapshot,
  type CheckedInMigration,
  type LedgerRow,
} from "./migration-integrity";

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

function appliedPrefix(count = 10): LedgerRow[] {
  return checkedIn().slice(0, count).map(successfulRow);
}

function cleanCatalog(): CatalogSnapshot {
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
  return catalog;
}

function report(overrides: Partial<Parameters<typeof buildMigrationIntegrityReport>[0]> = {}) {
  return buildMigrationIntegrityReport({
    target: { classification: "remote", fingerprint: "5952f3ffb454" },
    checkedIn: checkedIn(),
    ledgerRows: appliedPrefix(),
    catalog: cleanCatalog(),
    writes: 0,
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
  it("accepts the exact clean 10-applied/5-pending Gate A state", () => {
    const result = report();
    expect(result.chain).toMatchObject({ checkedIn: 15, applied: 10, pending: 5, pendingNames: EXPECTED_GATE_A_PENDING });
    expect(result.checksums).toMatchObject({ matched: 10, mismatched: [] });
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it("treats clean zero-step baseline and hotfix resolutions as applied without breaking the prefix", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], appliedStepsCount: 0 };
    rows[9] = { ...rows[9], appliedStepsCount: 0 };
    const result = report({ ledgerRows: rows });

    expect(result.chain).toMatchObject({ applied: 10, pending: 5, pendingNames: EXPECTED_GATE_A_PENDING });
    expect(result.ledger.successful).toHaveLength(10);
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

  it("hashes exact migration bytes with SHA-256", () => {
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).not.toBe(checksumMigrationSql(Buffer.from("SELECT 1;\r\n")));
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).toHaveLength(64);
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
    expect(result.chain.applied).toBe(10);
  });

  it("blocks an unknown ledger migration", () => {
    const rows = appliedPrefix();
    rows.push(successfulRow({ name: "unknown_migration", checksum: "abc", sqlPath: "missing" }, 99));
    const result = report({ ledgerRows: rows });
    expect(result.ledger.unknown).toEqual(["unknown_migration"]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("passes when every pending architecture object is absent and documents the comments-only retirement", () => {
    const result = report();
    expect(result.partialObjects.partiallyPresent).toEqual([]);
    expect(result.partialObjects.unexpectedPresent).toEqual([]);
    expect(result.partialObjects.commentsOnly).toEqual([
      "20260714120000_retire_exercise_exposure_projection:retains:ExerciseExposure",
    ]);
  });

  it.each([
    [0, pendingObjectIndex(0, "table"), "future table"],
    [0, pendingObjectIndex(0, "column"), "future column"],
    [0, pendingObjectIndex(0, "index"), "future index"],
    [0, pendingObjectIndex(0, "constraint"), "future constraint"],
    [0, pendingObjectIndex(0, "function"), "future function"],
    [0, pendingObjectIndex(0, "trigger"), "future trigger"],
    [1, 0, "stimulus column"],
    [3, 0, "post-session table"],
    [4, pendingObjectIndex(4, "column"), "readiness column"],
    [4, pendingObjectIndex(4, "constraint"), "readiness constraint"],
    [4, pendingObjectIndex(4, "index"), "readiness partial index"],
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
    const catalog = cleanCatalog();
    for (let migrationIndex = 0; migrationIndex < PENDING_ARCHITECTURE_MANIFEST.length; migrationIndex += 1) {
      for (let objectIndex = 0; objectIndex < PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects.length; objectIndex += 1) {
        addPendingObject(catalog, migrationIndex, objectIndex);
      }
    }
    const result = report({ ledgerRows: appliedPrefix(15), catalog });
    expect(result.chain).toMatchObject({ applied: 15, pending: 0, gateAApplicable: false });
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
