import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLIED_SCHEMA_EXPECTATIONS,
  BASELINE_UNIQUENESS_EXPECTATIONS,
  buildMigrationIntegrityReport,
  checksumMigrationSql,
  EXPECTED_MIGRATION_CHAIN,
  loadCheckedInMigrations,
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
  if (object.kind === "enum_value") {
    const existing = catalog.enums.find((entry) => entry.name === object.enumName);
    if (existing) {
      existing.values.push(object.name);
    } else {
      catalog.enums.push({ name: object.enumName!, values: [object.name] });
    }
  }
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
  it.each(['missing', 'changed'])('rejects a %s current-week helper in a fully applied ledger', variant => {
    const catalog = cleanCatalog(EXPECTED_MIGRATION_CHAIN.length);
    if (variant === 'missing') catalog.functions = catalog.functions.filter(f => f.name !== 'trainer2_current_week_eligible');
    else catalog.functions.find(f => f.name === 'trainer2_current_week_eligible')!.definition = 'SELECT true';
    const result = report({ ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length), catalog });
    expect(result.migrationIntegrityValid).toBe(false);
    expect(result.blockingReasons).toContain('schema_drift_detected');
    expect(variant === 'missing' ? result.definitions.appliedManifestMissing : result.definitions.appliedManifestIncompatible)
      .toEqual([expect.stringContaining('trainer2_current_week_eligible')]);
  });
  it("keeps the canonical chain aligned with checked-in migration directories", () => {
    expect(loadCheckedInMigrations().map((migration) => migration.name)).toEqual(
      EXPECTED_MIGRATION_CHAIN,
    );
  });

  it("accepts the conventional chain with current-week selection pending", () => {
    const result = report();

    expect(EXPECTED_MIGRATION_CHAIN.at(-1)).toBe(
      "20261004010000_trainer2_current_week_selection",
    );
    expect(result.chain).toMatchObject({
      checkedIn: EXPECTED_MIGRATION_CHAIN.length,
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: 1,
      pendingNames: ["20261004010000_trainer2_current_week_selection"],
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

  it("accepts only the evidenced swap bytes for unchanged canonical SQL", () => {
    const name = "20260930010000_trainer2_exercise_swap";
    const canonical = readFileSync(
      join(process.cwd(), "prisma", "migrations", name, "migration.sql"),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const appliedHash = "7eb597895c8c9655a353fbac25ac252288589b4c3a6da4fb79fcaec1f72219b9";
    // CRLF ranges captured from the retained 25,551-byte release file.
    const crlfRanges = [[72, 78], [87, 115], [121, 122], [124, 128],
      [137, 152], [154, 171], [173, 187], [189, 197], [199, 212],
      [214, 260], [263, 288]];
    const applied = canonical.split("\n").map((line, index, lines) =>
      index === lines.length - 1 ? line : line +
        (crlfRanges.some(([start, end]) => index + 1 >= start && index + 1 <= end)
          ? "\r\n" : "\n"),
    ).join("");
    expect(Buffer.byteLength(applied)).toBe(25551);
    expect(checksumMigrationSql(Buffer.from(applied))).toBe(appliedHash);

    const root = mkdtempSync(join(tmpdir(), "trainer-swap-checksum-"));
    function load(sql: string, migrationName = name) {
      const folder = join(root, migrationName);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "migration.sql"), sql);
      return loadCheckedInMigrations(root).find((m) => m.name === migrationName)!;
    }
    try {
      for (const sql of [canonical, canonical.replaceAll("\n", "\r\n"), applied]) {
        const migration = load(sql);
        expect(migrationChecksumMatches(migration, appliedHash)).toBe(true);
        // Another mixed ending layout is not an approved ledger variant.
        expect(migrationChecksumMatches(migration,
          checksumMigrationSql(Buffer.from(canonical.replace("\n", "\r\n"))),
        )).toBe(false);
      }
      expect(migrationChecksumMatches(load(canonical, "other_migration"), appliedHash)).toBe(false);
      expect(migrationChecksumMatches(load(canonical + "-- changed source\n"), appliedHash)).toBe(false);
      expect(migrationChecksumMatches(load(canonical.replace('"version">0', '"version">=0')), appliedHash)).toBe(false);
      expect(migrationChecksumMatches(load("\uFEFF" + canonical), appliedHash)).toBe(false);
      expect(migrationChecksumMatches(load(canonical), null)).toBe(false);

      const migrations = checkedIn();
      const index = migrations.findIndex((m) => m.name === name);
      migrations[index] = load(canonical);
      const ledger = migrations.map(successfulRow);
      ledger[index].checksum = appliedHash;
      const input = { checkedIn: migrations, ledgerRows: ledger,
        catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length) };
      const accepted = report(input);
      expect(accepted.migrationChecksumsValid).toBe(true);
      expect(accepted.checksums.lineEndingCompatibilityUsed).toContain(name);
      expect(accepted.warnings).toContain(`line_ending_compatible_checksum:${name}`);
      ledger[index].finishedAt = null;
      expect(report(input).migrationIntegrityValid).toBe(false);
      ledger[index].finishedAt = "2026-09-30 15:14:09+00";
      ledger[index].checksum = "0".repeat(64);
      expect(report(input).migrationChecksumsValid).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
