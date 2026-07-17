import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTED_MIGRATION_CHAIN, type CheckedInMigration } from "./migration-integrity";
import {
  assertReadinessIntegrityReadOnlySql,
  inspectReadinessIntegrityDatabase,
} from "./readiness-integrity-postgres";

function checkedIn(): CheckedInMigration[] {
  return EXPECTED_MIGRATION_CHAIN.map((name, index) => ({
    name,
    checksum: `checksum-${index}`,
    sqlPath: `prisma/migrations/${name}/migration.sql`,
  }));
}

describe("readiness integrity PostgreSQL adapter", () => {
  it.each([
    "INSERT INTO x VALUES (1)",
    "UPDATE x SET y = 1",
    "DELETE FROM x",
    "CREATE TEMP TABLE x(id int)",
    "ALTER TABLE x ADD COLUMN y int",
    "DROP TABLE x",
    "WITH changed AS (DELETE FROM x RETURNING *) SELECT * FROM changed",
    "SELECT 1; DELETE FROM x",
  ])("rejects mutation-capable SQL: %s", (sql) => {
    expect(() => assertReadinessIntegrityReadOnlySql(sql)).toThrow(
      "READINESS_INTEGRITY_MUTATING_QUERY_BLOCKED",
    );
  });

  it("uses a repeatable-read read-only transaction and never selects future fields in pre-migration mode", async () => {
    const statements: string[] = [];
    const client = {
      query: async <R extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
        statements.push(sql);
        let rows: unknown[] = [];
        if (/SHOW transaction_read_only/i.test(sql)) rows = [{ transaction_read_only: "on" }];
        if (/FROM pg_catalog\.pg_class c/i.test(sql) && !/pg_attribute/i.test(sql)) {
          rows = [
            { name: "Mesocycle" },
            { name: "PreSessionReadinessSnapshot" },
            { name: "Workout" },
          ];
        }
        if (/FROM pg_catalog\.pg_attribute/i.test(sql)) {
          rows = ["expiresAt", "invalidatedAt", "invalidatedReason"].map((column_name) => ({
            table_name: "PreSessionReadinessSnapshot",
            column_name,
          }));
        }
        if (/FROM public\._prisma_migrations/i.test(sql)) {
          rows = checkedIn().slice(0, 10).map((migration, index) => ({
            id: `ledger-${index}`,
            migration_name: migration.name,
            checksum: migration.checksum,
            finished_at: "2026-07-01 00:00:00+00",
            rolled_back_at: null,
            logs: null,
            applied_steps_count: 1,
          }));
        }
        return { rows: rows as R[], rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
      },
    };

    const result = await inspectReadinessIntegrityDatabase(client, checkedIn());
    expect(result).toMatchObject({ transactionReadOnly: true, writes: 0 });
    expect(result.fingerprintBefore).toBe(result.fingerprintAfter);
    expect(statements[0]).toMatch(/BEGIN.*REPEATABLE READ READ ONLY/i);
    expect(statements.at(-1)).toBe("COMMIT");
    const dataStatements = statements.filter((statement) =>
      /FROM "PreSessionReadinessSnapshot" s/i.test(statement),
    );
    expect(dataStatements).toHaveLength(2);
    expect(dataStatements.join("\n")).not.toMatch(/identityStatus|identityJson|currentSeedRevisionId/);
    expect(statements.every((statement) => {
      expect(() => assertReadinessIntegrityReadOnlySql(statement)).not.toThrow();
      return true;
    })).toBe(true);
  });

  it("has no Prisma dependency in the pre-migration PostgreSQL adapter", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/operations/readiness-integrity-postgres.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@prisma|prisma\./i);
  });
});
