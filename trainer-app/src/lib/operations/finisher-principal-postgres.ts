import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { Client, type QueryResult, type QueryResultRow } from "pg";
import {
  FINISHER_PRINCIPAL_CONTRACT,
  type FinisherPrincipalEvidenceRole,
  type FinisherPrincipalName,
  type FinisherPrincipalPhase,
  type FinisherPrincipalSnapshot,
  type FinisherRoleMembership,
  principalSnapshotContractReasons,
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
  default_privilege_count: string | number;
};

type MembershipRow = {
  granted_role: string;
  member_role: string;
  grantor_role: string;
  grantor_is_bootstrap_superuser: boolean;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
};

type AdministratorRow = {
  current_role: string;
  session_role: string;
  can_login: boolean;
  is_superuser: boolean;
  can_create_role: boolean;
  createrole_self_grant: string;
  server_version_number: string | number;
};

const PRINCIPAL_NAMES = FINISHER_PRINCIPAL_CONTRACT.map(
  (principal) => principal.name,
);

const FINISHER_ENUM_NAMES = [
  "WorkoutPhasePlacement",
  "WorkoutPhaseKind",
  "WorkoutPhaseProtocol",
  "FinisherCategory",
  "FinisherDifficulty",
  "FinisherDemand",
  "FinisherPublicationState",
  "FinisherExecutionState",
  "FinisherTimerSegment",
  "FinisherStepStatus",
  "FinisherExecutionAction",
  "FinisherDecisionAction",
] as const;

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
    (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_default_acl defaults
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
      WHERE defaults.defaclrole = role.oid OR privilege.grantee = role.oid
    ) AS default_privilege_count
  FROM pg_catalog.pg_roles role
  WHERE role.rolname = ANY($1::text[])
  ORDER BY pg_catalog.array_position($1::text[], role.rolname)
`;

const MEMBERSHIP_SQL = `
  SELECT granted.rolname AS granted_role,
    member.rolname AS member_role,
    grantor.rolname AS grantor_role,
    grantor.oid = 10 AND grantor.rolsuper AS grantor_is_bootstrap_superuser,
    membership.admin_option,
    membership.inherit_option,
    membership.set_option
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
  JOIN pg_catalog.pg_roles member ON member.oid = membership.member
  JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
  WHERE granted.rolname = ANY($1::text[])
     OR member.rolname = ANY($1::text[])
  ORDER BY granted.rolname, member.rolname, grantor.rolname
`;

const ADMINISTRATOR_SQL = `
  SELECT current_user AS current_role,
    session_user AS session_role,
    role.rolcanlogin AS can_login,
    role.rolsuper AS is_superuser,
    role.rolcreaterole AS can_create_role,
    pg_catalog.current_setting('createrole_self_grant') AS createrole_self_grant,
    pg_catalog.current_setting('server_version_num')::integer
      AS server_version_number
  FROM pg_catalog.pg_roles role
  WHERE role.rolname = session_user
`;

const OBJECT_STATE_SQL = `
  WITH protected_roles AS (
    SELECT oid
    FROM pg_catalog.pg_roles
    WHERE rolname = ANY($1::text[])
  ),
  named_objects AS (
    SELECT c.oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'Finisher%'
    UNION ALL
    SELECT p.oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%finisher%'
    UNION ALL
    SELECT t.oid
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ANY($2::text[])
  ),
  capabilities AS (
    SELECT c.oid
    FROM pg_catalog.pg_class c
    WHERE c.relowner IN (SELECT oid FROM protected_roles)
    UNION ALL
    SELECT c.oid
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) privilege
    WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
    UNION ALL
    SELECT p.oid
    FROM pg_catalog.pg_proc p
    WHERE p.proowner IN (SELECT oid FROM protected_roles)
    UNION ALL
    SELECT p.oid
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) privilege
    WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
    UNION ALL
    SELECT t.oid
    FROM pg_catalog.pg_type t
    WHERE t.typowner IN (SELECT oid FROM protected_roles)
    UNION ALL
    SELECT t.oid
    FROM pg_catalog.pg_type t
    CROSS JOIN LATERAL pg_catalog.aclexplode(t.typacl) privilege
    WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM named_objects) AS object_count,
    (SELECT pg_catalog.count(*) FROM capabilities) AS capability_count
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

export async function verifyRuntimeCredentialReadOnly(options: {
  directUrl: string;
  expectedDatabase: string;
  password: string;
}): Promise<boolean> {
  const url = new URL(options.directUrl);
  url.username = "trainer_app_runtime";
  url.password = options.password;
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const result = await client.query<{
      database_name: string;
      current_role: string;
      read_only: string;
    }>(
      "SELECT current_database() AS database_name, current_user AS current_role, current_setting('transaction_read_only') AS read_only",
    );
    await client.query("COMMIT");
    const observed = result.rows[0];
    return Boolean(
      observed &&
        observed.database_name === options.expectedDatabase &&
        observed.current_role === "trainer_app_runtime" &&
        observed.read_only === "on",
    );
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function inspectFinisherPrincipals(
  client: PrincipalClient,
  options: {
    phase: FinisherPrincipalPhase;
    runtimeCredentialVerified: boolean;
  },
): Promise<FinisherPrincipalSnapshot> {
  const [roleResult, membershipResult, administratorResult, objectStateResult] =
    await Promise.all([
      client.query<PrincipalRow>(INSPECT_SQL, [PRINCIPAL_NAMES]),
      client.query<MembershipRow>(MEMBERSHIP_SQL, [PRINCIPAL_NAMES]),
      client.query<AdministratorRow>(ADMINISTRATOR_SQL),
      client.query<{ object_count: string; capability_count: string }>(
        OBJECT_STATE_SQL,
        [PRINCIPAL_NAMES, FINISHER_ENUM_NAMES],
      ),
    ]);
  const administrator = administratorResult.rows[0];
  if (!administrator) {
    throw new Error("FINISHER_PRINCIPAL_ADMINISTRATOR_NOT_FOUND");
  }
  const roles: FinisherPrincipalEvidenceRole[] = roleResult.rows.map((row) => ({
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
        ? options.runtimeCredentialVerified
          ? "verified_matching"
          : "authentication_failed"
        : "not_applicable",
    defaultPrivilegeCount: Number(row.default_privilege_count),
  }));
  const memberships: FinisherRoleMembership[] = membershipResult.rows.map(
    (row) => ({
      grantedRole: row.granted_role,
      memberRole: row.member_role,
      grantorRole: row.grantor_role,
      grantorIsBootstrapSuperuser: row.grantor_is_bootstrap_superuser,
      admin: row.admin_option,
      inherit: row.inherit_option,
      set: row.set_option,
    }),
  );
  const objectState = objectStateResult.rows[0];
  return {
    phase: options.phase,
    serverVersionNumber: Number(administrator.server_version_number),
    administrator: {
      currentRole: administrator.current_role,
      sessionRole: administrator.session_role,
      canLogin: administrator.can_login,
      superuser: administrator.is_superuser,
      createRole: administrator.can_create_role,
      createroleSelfGrant: administrator.createrole_self_grant,
    },
    roles,
    memberships,
    finisherObjectCount: Number(objectState?.object_count ?? 0),
    finisherObjectCapabilityCount: Number(objectState?.capability_count ?? 0),
  };
}

function unsafePartialStateReasons(snapshot: FinisherPrincipalSnapshot): string[] {
  const reasons: string[] = [];
  if (
    snapshot.serverVersionNumber < 160000 ||
    snapshot.serverVersionNumber >= 170000 ||
    snapshot.administrator.currentRole !== snapshot.administrator.sessionRole ||
    !snapshot.administrator.canLogin ||
    snapshot.administrator.superuser ||
    !snapshot.administrator.createRole ||
    snapshot.administrator.createroleSelfGrant !== ""
  ) {
    reasons.push("administrator_or_postgres_contract");
  }
  if (
    snapshot.finisherObjectCount !== 0 ||
    snapshot.finisherObjectCapabilityCount !== 0
  ) {
    reasons.push("pre_migration_objects_or_capabilities");
  }
  const administrator = snapshot.administrator.sessionRole;
  for (const role of snapshot.roles) {
    const expected = FINISHER_PRINCIPAL_CONTRACT.find(
      (candidate) => candidate.name === role.name,
    );
    if (
      !expected ||
      role.canLogin !== expected.canLogin ||
      role.inherit !== expected.inherit ||
      role.superuser ||
      role.createDb ||
      role.createRole ||
      role.replication ||
      role.bypassRls ||
      role.defaultPrivilegeCount !== 0 ||
      (role.name === "trainer_app_runtime" && role.publicSchemaCreate)
    ) {
      reasons.push(`unsafe_role:${role.name}`);
    }
  }
  for (const membership of snapshot.memberships) {
    const automatic =
      PRINCIPAL_NAMES.includes(membership.grantedRole as FinisherPrincipalName) &&
      membership.memberRole === administrator &&
      membership.grantorIsBootstrapSuperuser &&
      membership.admin &&
      !membership.inherit &&
      !membership.set;
    const supplemental =
      (membership.grantedRole === "trainer_finisher_owner" ||
        membership.grantedRole === "trainer_finisher_cleanup") &&
      membership.memberRole === administrator &&
      membership.grantorRole === administrator &&
      !membership.grantorIsBootstrapSuperuser &&
      !membership.admin &&
      !membership.inherit &&
      membership.set;
    if (!automatic && !supplemental) {
      reasons.push(
        `unsafe_membership:${membership.grantedRole}:${membership.memberRole}`,
      );
    }
  }
  for (const role of snapshot.roles) {
    const automaticCount = snapshot.memberships.filter(
      (membership) =>
        membership.grantedRole === role.name &&
        membership.memberRole === administrator &&
        membership.grantorIsBootstrapSuperuser &&
        membership.admin &&
        !membership.inherit &&
        !membership.set,
    ).length;
    if (automaticCount !== 1) {
      reasons.push(`automatic_membership:${role.name}`);
    }
  }
  return [...new Set(reasons)];
}

export async function provisionFinisherPrincipals(
  client: PrincipalClient,
  options: {
    runtimePassword: string;
    existingRuntimeCredentialVerified: boolean;
  },
): Promise<{
  createdPrincipals: FinisherPrincipalName[];
  credentialConfigured: boolean;
  databaseWrites: number;
  liveState: FinisherPrincipalSnapshot;
}> {
  if (!options.runtimePassword) {
    throw new Error("The runtime principal credential is required for provisioning.");
  }
  await client.query("BEGIN");
  try {
    const before = await inspectFinisherPrincipals(client, {
      phase: "prerequisite",
      runtimeCredentialVerified: options.existingRuntimeCredentialVerified,
    });
    const unsafe = unsafePartialStateReasons(before);
    if (unsafe.length > 0) {
      throw new Error(
        `FINISHER_PRINCIPAL_UNSAFE_EXISTING_STATE:${unsafe.join(",")}`,
      );
    }

    const existingNames = new Set(before.roles.map((role) => role.name));
    if (
      existingNames.has("trainer_app_runtime") &&
      !options.existingRuntimeCredentialVerified
    ) {
      throw new Error("FINISHER_PRINCIPAL_RUNTIME_CREDENTIAL_MISMATCH");
    }
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

    const credentialConfigured = !existingNames.has("trainer_app_runtime");
    if (credentialConfigured) {
      const verifier = postgresScramVerifier(options.runtimePassword);
      await client.query(
        `ALTER ROLE ${quoteIdentifier("trainer_app_runtime")} PASSWORD '${verifier}'`,
      );
      databaseWrites += 1;
    }

    const administrator = before.administrator.sessionRole;
    const afterCreation = await inspectFinisherPrincipals(client, {
      phase: "prerequisite",
      runtimeCredentialVerified:
        credentialConfigured || options.existingRuntimeCredentialVerified,
    });
    for (const role of [
      "trainer_finisher_owner",
      "trainer_finisher_cleanup",
    ] as const) {
      const supplementalExists = afterCreation.memberships.some(
        (membership) =>
          membership.grantedRole === role &&
          membership.memberRole === administrator &&
          membership.grantorRole === administrator &&
          !membership.admin &&
          !membership.inherit &&
          membership.set,
      );
      if (!supplementalExists) {
        await client.query(
          `GRANT ${quoteIdentifier(role)} TO ${quoteIdentifier(administrator)} ` +
            "WITH INHERIT FALSE, SET TRUE",
        );
        databaseWrites += 1;
      }
      const roleState = afterCreation.roles.find(
        (candidate) => candidate.name === role,
      );
      if (!roleState?.publicSchemaCreate) {
        await client.query(
          `GRANT CREATE ON SCHEMA public TO ${quoteIdentifier(role)}`,
        );
        databaseWrites += 1;
      }
    }

    const liveState = await inspectFinisherPrincipals(client, {
      phase: "migration_capable",
      runtimeCredentialVerified:
        credentialConfigured || options.existingRuntimeCredentialVerified,
    });
    const reasons = principalSnapshotContractReasons(liveState);
    if (reasons.length > 0) {
      throw new Error(
        `FINISHER_PRINCIPAL_FINAL_STATE_MISMATCH:${reasons.join(",")}`,
      );
    }
    await client.query("COMMIT");
    return {
      createdPrincipals,
      credentialConfigured,
      databaseWrites,
      liveState,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function verifyFinisherPrincipalsReadOnly(
  client: PrincipalClient,
  options: {
    phase: FinisherPrincipalPhase;
    runtimeCredentialVerified: boolean;
  },
): Promise<FinisherPrincipalSnapshot> {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    const snapshot = await inspectFinisherPrincipals(client, options);
    const reasons = principalSnapshotContractReasons(snapshot);
    if (reasons.length > 0) {
      throw new Error(
        `FINISHER_PRINCIPAL_VERIFICATION_MISMATCH:${reasons.join(",")}`,
      );
    }
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
