import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";
import {
  FINISHER_PRINCIPAL_CONTRACT,
  type FinisherPrincipalEvidenceRole,
  type FinisherPrincipalName,
  principalRolesMatchContract,
} from "./finisher-principal-contract";

type PrincipalClient = {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type PrincipalRow = {
  name: string;
  can_login: boolean;
  inherits_privileges: boolean;
  is_superuser: boolean;
  can_create_role: boolean;
  can_create_db: boolean;
  can_replicate: boolean;
  bypasses_rls: boolean;
  public_schema_create: boolean;
  password_state: "scram_sha_256_configured" | "not_configured" | "other";
};

type MembershipRow = {
  role_name: string;
  member_name: string;
};

type DefaultPrivilegeRow = {
  owner_name: string;
  grantee_name: string;
};

const PRINCIPAL_NAMES = FINISHER_PRINCIPAL_CONTRACT.map(
  (principal) => principal.name,
);

const INSPECT_SQL = `
  SELECT role.rolname AS name,
    role.rolcanlogin AS can_login,
    role.rolinherit AS inherits_privileges,
    role.rolsuper AS is_superuser,
    role.rolcreaterole AS can_create_role,
    role.rolcreatedb AS can_create_db,
    role.rolreplication AS can_replicate,
    role.rolbypassrls AS bypasses_rls,
    pg_catalog.has_schema_privilege(role.rolname, 'public', 'CREATE')
      AS public_schema_create,
    CASE
      WHEN auth.rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram_sha_256_configured'
      WHEN auth.rolpassword IS NULL THEN 'not_configured'
      ELSE 'other'
    END AS password_state
  FROM pg_catalog.pg_roles role
  JOIN pg_catalog.pg_authid auth ON auth.oid = role.oid
  WHERE role.rolname = ANY($1::text[])
  ORDER BY role.rolname
`;

const MEMBERSHIP_SQL = `
  SELECT granted.rolname AS role_name, member.rolname AS member_name
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
  JOIN pg_catalog.pg_roles member ON member.oid = membership.member
  WHERE granted.rolname = ANY($1::text[])
     OR member.rolname = ANY($1::text[])
  ORDER BY granted.rolname, member.rolname
`;

const DEFAULT_PRIVILEGE_SQL = `
  SELECT owner.rolname AS owner_name,
    COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name
  FROM pg_catalog.pg_default_acl defaults
  JOIN pg_catalog.pg_roles owner ON owner.oid = defaults.defaclrole
  CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
  WHERE owner.rolname = ANY($1::text[])
     OR grantee.rolname = ANY($1::text[])
`;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function postgresScramVerifier(password: string): string {
  const salt = randomBytes(16);
  const iterations = 4096;
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export async function inspectFinisherPrincipals(
  client: PrincipalClient,
): Promise<FinisherPrincipalEvidenceRole[]> {
  const [roleResult, membershipResult, defaultPrivilegeResult] =
    await Promise.all([
      client.query<PrincipalRow>(INSPECT_SQL, [PRINCIPAL_NAMES]),
      client.query<MembershipRow>(MEMBERSHIP_SQL, [PRINCIPAL_NAMES]),
      client.query<DefaultPrivilegeRow>(DEFAULT_PRIVILEGE_SQL, [PRINCIPAL_NAMES]),
    ]);

  return roleResult.rows
    .map((row) => ({
      name: row.name as FinisherPrincipalName,
      canLogin: row.can_login,
      inherit: row.inherits_privileges,
      superuser: row.is_superuser,
      createDb: row.can_create_db,
      createRole: row.can_create_role,
      replication: row.can_replicate,
      bypassRls: row.bypasses_rls,
      publicSchemaCreate: row.public_schema_create,
      credential:
        row.name === "trainer_app_runtime"
          ? row.password_state === "scram_sha_256_configured"
            ? ("scram_sha_256_configured" as const)
            : row.password_state === "not_configured"
              ? ("not_configured" as const)
              : ("unsupported" as const)
          : row.password_state === "not_configured"
            ? ("not_applicable" as const)
            : ("unsupported" as const),
      membershipsGranted: membershipResult.rows
        .filter((membership) => membership.member_name === row.name)
        .map((membership) => membership.role_name)
        .sort(),
      membershipsReceived: membershipResult.rows
        .filter((membership) => membership.role_name === row.name)
        .map((membership) => membership.member_name)
        .sort(),
      defaultPrivilegeCount: defaultPrivilegeResult.rows.filter(
        (privilege) =>
          privilege.owner_name === row.name ||
          privilege.grantee_name === row.name,
      ).length,
    }))
    .sort(
      (left, right) =>
        PRINCIPAL_NAMES.indexOf(left.name) - PRINCIPAL_NAMES.indexOf(right.name),
    );
}

function unsafeExistingPrincipalReasons(
  roles: FinisherPrincipalEvidenceRole[],
): string[] {
  const reasons: string[] = [];
  for (const role of roles) {
    const expected = FINISHER_PRINCIPAL_CONTRACT.find(
      (principal) => principal.name === role.name,
    );
    if (!expected) {
      reasons.push(`unexpected-principal:${role.name}`);
      continue;
    }
    for (const attribute of [
      "canLogin",
      "inherit",
      "superuser",
      "createDb",
      "createRole",
      "replication",
      "bypassRls",
      "publicSchemaCreate",
    ] as const) {
      if (role[attribute] !== expected[attribute]) {
        reasons.push(`unsafe-attribute:${role.name}:${attribute}`);
      }
    }
    if (
      role.membershipsGranted.length > 0 ||
      role.membershipsReceived.length > 0
    ) {
      reasons.push(`unsafe-membership:${role.name}`);
    }
    if (role.defaultPrivilegeCount > 0) {
      reasons.push(`unsafe-default-privilege:${role.name}`);
    }
    if (
      expected.credential === "forbidden" &&
      role.credential !== "not_applicable"
    ) {
      reasons.push(`unsafe-credential:${role.name}`);
    }
  }
  return reasons;
}

export async function provisionFinisherPrincipals(
  client: PrincipalClient,
  runtimePassword: string,
): Promise<{
  createdPrincipals: FinisherPrincipalName[];
  credentialConfigured: boolean;
  databaseWrites: number;
}> {
  if (!runtimePassword) {
    throw new Error("The runtime principal credential is required for provisioning.");
  }
  await client.query("BEGIN");
  try {
    const before = await inspectFinisherPrincipals(client);
    const unsafe = unsafeExistingPrincipalReasons(before);
    if (unsafe.length > 0) {
      throw new Error(`FINISHER_PRINCIPAL_UNSAFE_EXISTING_STATE:${unsafe.join(",")}`);
    }

    const existingNames = new Set(before.map((role) => role.name));
    const createdPrincipals: FinisherPrincipalName[] = [];
    let databaseWrites = 0;
    for (const principal of FINISHER_PRINCIPAL_CONTRACT) {
      if (existingNames.has(principal.name)) continue;
      const login = principal.canLogin ? "LOGIN" : "NOLOGIN";
      const inherit = principal.inherit ? "INHERIT" : "NOINHERIT";
      await client.query(
        `CREATE ROLE ${quoteIdentifier(principal.name)} ${login} ${inherit} ` +
          "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
      );
      createdPrincipals.push(principal.name);
      databaseWrites += 1;
    }

    const runtimeBefore = before.find(
      (role) => role.name === "trainer_app_runtime",
    );
    const credentialConfigured =
      !runtimeBefore ||
      runtimeBefore.credential !== "scram_sha_256_configured";
    if (credentialConfigured) {
      const verifier = postgresScramVerifier(runtimePassword);
      await client.query(
        `ALTER ROLE ${quoteIdentifier("trainer_app_runtime")} PASSWORD '${verifier}'`,
      );
      databaseWrites += 1;
    }

    const after = await inspectFinisherPrincipals(client);
    if (!principalRolesMatchContract(after)) {
      throw new Error("FINISHER_PRINCIPAL_FINAL_STATE_MISMATCH");
    }
    await client.query("COMMIT");
    return { createdPrincipals, credentialConfigured, databaseWrites };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function verifyFinisherPrincipalsReadOnly(
  client: PrincipalClient,
): Promise<FinisherPrincipalEvidenceRole[]> {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    const roles = await inspectFinisherPrincipals(client);
    if (!principalRolesMatchContract(roles)) {
      throw new Error("FINISHER_PRINCIPAL_VERIFICATION_MISMATCH");
    }
    await client.query("COMMIT");
    return roles;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
