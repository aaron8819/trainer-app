import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import {
  postgresScramVerifier,
  verifyFinisherPrincipalsReadOnly,
} from "./finisher-principal-postgres";

const ROLE_ROWS = [
  {
    name: "trainer_app_runtime",
    can_login: true,
    inherits_privileges: true,
    is_superuser: false,
    can_create_role: false,
    can_create_db: false,
    can_replicate: false,
    bypasses_rls: false,
    public_schema_create: false,
    password_state: "scram_sha_256_configured",
  },
  ...["trainer_finisher_owner", "trainer_finisher_cleanup"].map((name) => ({
    name,
    can_login: false,
    inherits_privileges: false,
    is_superuser: false,
    can_create_role: false,
    can_create_db: false,
    can_replicate: false,
    bypasses_rls: false,
    public_schema_create: false,
    password_state: "not_configured",
  })),
];

function result(rows: unknown[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("Finisher principal PostgreSQL adapter", () => {
  it("derives a PostgreSQL SCRAM verifier without embedding the clear credential", () => {
    const password = "unique-runtime-password";
    const verifier = postgresScramVerifier(password);
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(verifier).not.toContain(password);
  });

  it("runs verification in an explicit read-only transaction", async () => {
    const statements: string[] = [];
    const client = {
      async query<R extends QueryResultRow>(
        sql: string,
      ): Promise<QueryResult<R>> {
        statements.push(sql.trim());
        const rows = sql.includes("FROM pg_catalog.pg_roles")
          ? ROLE_ROWS
          : [];
        return result(rows) as QueryResult<R>;
      },
    };

    const roles = await verifyFinisherPrincipalsReadOnly(client);
    expect(roles).toHaveLength(3);
    expect(statements[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(statements.at(-1)).toBe("COMMIT");
    expect(
      statements.some((statement) =>
        /^(?:CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP)\b/i.test(
          statement,
        ),
      ),
    ).toBe(false);
  });
});
