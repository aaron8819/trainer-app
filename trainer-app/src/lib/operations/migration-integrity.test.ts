import { describe, expect, it } from "vitest";
import {
  APPLIED_SCHEMA_EXPECTATIONS,
  BASELINE_UNIQUENESS_EXPECTATIONS,
  buildMigrationIntegrityReport,
  checksumMigrationSql,
  EXPECTED_MIGRATION_CHAIN,
  migrationChecksumMatches,
  PENDING_ARCHITECTURE_MANIFEST,
  prismaCompatibleMigrationSqlChecksums,
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

function appliedPrefix(
  count = EXPECTED_MIGRATION_CHAIN.length - 1,
): LedgerRow[] {
  return checkedIn().slice(0, count).map(successfulRow);
}

function addManifestObject(
  catalog: CatalogSnapshot,
  migrationIndex: number,
  objectIndex: number,
): void {
  const object =
    PENDING_ARCHITECTURE_MANIFEST[migrationIndex]?.objects[objectIndex];
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
    tables: [],
    columns: [],
    enums: [],
    indexes: [],
    constraints: [],
    triggers: [],
    functions: [],
  };
  for (const expectation of APPLIED_SCHEMA_EXPECTATIONS) {
    if (expectation.kind === "table") catalog.tables.push(expectation.name);
    if (expectation.kind === "column") {
      catalog.columns.push({ ...expectation });
    }
    if (expectation.kind === "enum") {
      catalog.enums.push({
        name: expectation.name,
        values: [...expectation.values],
      });
    }
    if (expectation.kind === "index") {
      catalog.indexes.push({
        ...expectation,
        columns: [...expectation.columns],
      });
    }
    if (expectation.kind === "constraint") {
      catalog.constraints.push({ ...expectation });
    }
  }
  for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
    if (!catalog.tables.includes(expectation.table)) {
      catalog.tables.push(expectation.table);
    }
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
    const migration = PENDING_ARCHITECTURE_MANIFEST[migrationIndex]!;
    const chainIndex = EXPECTED_MIGRATION_CHAIN.indexOf(
      migration.migration as (typeof EXPECTED_MIGRATION_CHAIN)[number],
    );
    if (chainIndex < 0 || chainIndex >= appliedCount) continue;
    for (
      let objectIndex = 0;
      objectIndex < migration.objects.length;
      objectIndex += 1
    ) {
      addManifestObject(catalog, migrationIndex, objectIndex);
    }
  }
  return catalog;
}

function report(
  overrides: Partial<
    Parameters<typeof buildMigrationIntegrityReport>[0]
  > = {},
) {
  return buildMigrationIntegrityReport({
    target: { classification: "remote", fingerprint: "5952f3ffb454" },
    checkedIn: checkedIn(),
    ledgerRows: appliedPrefix(),
    catalog: cleanCatalog(),
    writes: 0,
    ...overrides,
  });
}

describe("migration integrity", () => {
  it("accepts the conventional chain with the Finisher migration pending", () => {
    const result = report();

    expect(EXPECTED_MIGRATION_CHAIN.at(-1)).toBe(
      "20260728120000_add_finishers_phase_1",
    );
    expect(result.chain).toMatchObject({
      checkedIn: EXPECTED_MIGRATION_CHAIN.length,
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: 1,
      pendingNames: ["20260728120000_add_finishers_phase_1"],
      exactExpectedChain: true,
    });
    expect(result.migrationIntegrityValid).toBe(true);
    expect(result.blockingReasons).toEqual([]);
  });

  it("accepts the fully migrated chain", () => {
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length),
      catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length),
    });

    expect(result.chain.pending).toBe(0);
    expect(result.migrationIntegrityValid).toBe(true);
  });

  it("matches Prisma LF and CRLF checksum variants only", () => {
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    const migration = {
      name: "test",
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
      sqlPath: "migration.sql",
    };

    expect(migrationChecksumMatches(migration, checksumMigrationSql(lf))).toBe(
      true,
    );
    expect(
      migrationChecksumMatches(
        migration,
        checksumMigrationSql(Buffer.from("SELECT 2;\n")),
      ),
    ).toBe(false);
  });

  it("blocks checksum, ledger, order, and unknown-migration drift", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0]!, checksum: "changed" };
    rows[4] = { ...rows[4]!, finishedAt: null, logs: "failed" };
    rows.push(
      successfulRow(
        { name: "unknown", checksum: "unknown", sqlPath: "unknown" },
        99,
      ),
    );

    const result = report({ ledgerRows: rows });

    expect(result.migrationIntegrityValid).toBe(false);
    expect(result.checksums.mismatched).toContain(
      EXPECTED_MIGRATION_CHAIN[0],
    );
    expect(result.ledger.failed).toContain(EXPECTED_MIGRATION_CHAIN[4]);
    expect(result.ledger.unknown).toEqual(["unknown"]);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "migration_ledger_not_clean",
        "migration_checksum_drift",
      ]),
    );
  });

  it("blocks a missing object from an applied migration", () => {
    const catalog = cleanCatalog();
    catalog.columns = catalog.columns.filter(
      (column) =>
        !(
          column.table === "WorkoutExercise" &&
          column.name === "stimulusAccountingSnapshot"
        ),
    );

    const result = report({ catalog });

    expect(result.migrationIntegrityValid).toBe(false);
    expect(result.schemaPreflightValid).toBe(false);
    expect(result.definitions.appliedManifestMissing).toEqual([
      expect.stringContaining("stimulusAccountingSnapshot"),
    ]);
  });

  it("warns for equivalent unique constraints and blocks real uniqueness drift", () => {
    const equivalent = cleanCatalog();
    for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
      const index = equivalent.indexes.find(
        (candidate) => candidate.name === expectation.name,
      )!;
      index.constraintName = expectation.name;
      index.constraintType = "u";
    }
    const warning = report({ catalog: equivalent });
    expect(warning.migrationIntegrityValid).toBe(true);
    expect(warning.schemaIntegrity.representationWarningCount).toBe(2);

    const incompatible = cleanCatalog();
    incompatible.indexes.find(
      (index) => index.name === "ExerciseAlias_alias_key",
    )!.unique = false;
    const blocked = report({ catalog: incompatible });
    expect(blocked.migrationIntegrityValid).toBe(false);
    expect(blocked.schemaIntegrity.semanticDriftBlocking).toBeGreaterThan(0);
  });

  it("is deterministic and never serializes connection secrets", () => {
    const first = JSON.stringify(report());
    const second = JSON.stringify(report());

    expect(first).toBe(second);
    expect(first).not.toContain("postgresql://");
    expect(first).not.toContain("password");
  });
});
