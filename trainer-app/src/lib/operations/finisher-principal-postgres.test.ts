import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import {
  postgresScramVerifier,
  provisionFinisherPrincipals,
  verifyFinisherPrincipalsReadOnly,
} from "./finisher-principal-postgres";

const ADMINISTRATOR = "migration_admin";
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
    default_privilege_count: "0",
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
    public_schema_create: true,
    default_privilege_count: "0",
  })),
];

const MEMBERSHIPS = [
  ...ROLE_ROWS.map((role) => ({
    granted_role: role.name,
    member_role: ADMINISTRATOR,
    grantor_role: "postgres",
    grantor_is_bootstrap_superuser: true,
    admin_option: true,
    inherit_option: false,
    set_option: false,
  })),
  ...["trainer_finisher_owner", "trainer_finisher_cleanup"].map(
    (grantedRole) => ({
      granted_role: grantedRole,
      member_role: ADMINISTRATOR,
      grantor_role: ADMINISTRATOR,
      grantor_is_bootstrap_superuser: false,
      admin_option: false,
      inherit_option: false,
      set_option: true,
    }),
  ),
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

  it("runs complete migration-capable verification in an explicit read-only transaction", async () => {
    const statements: string[] = [];
    const client = {
      async query<R extends QueryResultRow>(
        sql: string,
      ): Promise<QueryResult<R>> {
        statements.push(sql.trim());
        let rows: unknown[] = [];
        if (sql.includes("WHERE role.rolname = ANY")) rows = ROLE_ROWS;
        else if (sql.includes("FROM pg_catalog.pg_auth_members")) {
          rows = MEMBERSHIPS;
        } else if (sql.includes("AS current_role")) {
          rows = [
            {
              current_role: ADMINISTRATOR,
              session_role: ADMINISTRATOR,
              can_login: true,
              is_superuser: false,
              can_create_role: true,
              createrole_self_grant: "",
              server_version_number: 160010,
            },
          ];
        } else if (sql.includes("WITH protected_roles AS")) {
          rows = [{ object_count: "0", capability_count: "0" }];
        }
        return result(rows) as QueryResult<R>;
      },
    };

    const snapshot = await verifyFinisherPrincipalsReadOnly(client, {
      phase: "migration_capable",
      runtimeCredentialVerified: true,
    });
    expect(snapshot.roles).toHaveLength(3);
    expect(snapshot.memberships).toHaveLength(5);
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

  it("rolls back the provisioning transaction after an injected mid-operation failure", async () => {
    const statements: string[] = [];
    const client = {
      async query<R extends QueryResultRow>(
        sql: string,
      ): Promise<QueryResult<R>> {
        const statement = sql.trim();
        statements.push(statement);
        if (statement.startsWith("CREATE ROLE")) {
          throw new Error("INJECTED_PROVISIONING_FAILURE");
        }
        let rows: unknown[] = [];
        if (sql.includes("AS current_role")) {
          rows = [
            {
              current_role: ADMINISTRATOR,
              session_role: ADMINISTRATOR,
              can_login: true,
              is_superuser: false,
              can_create_role: true,
              createrole_self_grant: "",
              server_version_number: 160010,
            },
          ];
        } else if (sql.includes("WITH protected_roles AS")) {
          rows = [{ object_count: "0", capability_count: "0" }];
        }
        return result(rows) as QueryResult<R>;
      },
    };

    await expect(
      provisionFinisherPrincipals(client, {
        runtimePassword: "unique-runtime-password",
        existingRuntimeCredentialVerified: false,
      }),
    ).rejects.toThrow("INJECTED_PROVISIONING_FAILURE");
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});
