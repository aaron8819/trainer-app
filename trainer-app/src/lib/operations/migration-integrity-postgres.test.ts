import { describe, expect, it } from "vitest";
import { assertReadOnlyStatement, inspectMigrationDatabase } from "./migration-integrity-postgres";

describe("migration integrity PostgreSQL adapter", () => {
  it.each([
    "INSERT INTO x VALUES (1)",
    "UPDATE x SET y = 1",
    "DELETE FROM x",
    "CREATE TEMP TABLE x(id int)",
    "ALTER TABLE x ADD COLUMN y int",
    "DROP TABLE x",
  ])("rejects mutation-capable SQL: %s", (sql) => {
    expect(() => assertReadOnlyStatement(sql)).toThrow("MIGRATION_INTEGRITY_MUTATING_QUERY_BLOCKED");
  });

  it("issues only read-only transaction and catalog statements", async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      },
    };
    const result = await inspectMigrationDatabase(client);
    expect(result.writes).toBe(0);
    expect(statements[0]).toMatch(/BEGIN.*READ ONLY/i);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.join("\n")).toMatch(/indnullsnotdistinct/);
    expect(statements.join("\n")).toMatch(/con\.conindid = i\.indexrelid/);
    for (const statement of statements) expect(() => assertReadOnlyStatement(statement)).not.toThrow();
  });
});
