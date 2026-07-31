import { createHash } from "node:crypto";

export const FINISHER_PRINCIPAL_AUDIT_SCHEMA =
  "trainer-finisher-principal-audit-record";
export const FINISHER_PRINCIPAL_AUDIT_VERSION = 2;
export const FINISHER_PRINCIPAL_VERIFIER = "ops:finisher-principals";
export const FINISHER_RUNTIME_PASSWORD_VARIABLE =
  "TRAINER_APP_RUNTIME_PASSWORD";
export const FINISHER_TARGET_MIGRATION =
  "20260728120000_add_finishers_phase_1" as const;

export type FinisherPrincipalPhase =
  | "prerequisite"
  | "migration_capable"
  | "terminal";

export const FINISHER_PRINCIPAL_CONTRACT = [
  {
    name: "trainer_app_runtime",
    canLogin: true,
    inherit: true,
    credential: "runtime_password_required",
  },
  {
    name: "trainer_finisher_owner",
    canLogin: false,
    inherit: false,
    credential: "forbidden",
  },
  {
    name: "trainer_finisher_cleanup",
    canLogin: false,
    inherit: false,
    credential: "forbidden",
  },
] as const;

export type FinisherPrincipalName =
  (typeof FINISHER_PRINCIPAL_CONTRACT)[number]["name"];

export type FinisherPrincipalEvidenceRole = {
  name: FinisherPrincipalName;
  canLogin: boolean;
  inherit: boolean;
  superuser: boolean;
  createDb: boolean;
  createRole: boolean;
  replication: boolean;
  bypassRls: boolean;
  publicSchemaCreate: boolean;
  credential:
    | "verified_matching"
    | "configured_unverified"
    | "not_applicable"
    | "authentication_failed";
  defaultPrivilegeCount: number;
};

export type FinisherRoleMembership = {
  grantedRole: string;
  memberRole: string;
  grantorRole: string;
  grantorIsBootstrapSuperuser: boolean;
  admin: boolean;
  inherit: boolean;
  set: boolean;
};

export type FinisherPrincipalAdministrator = {
  currentRole: string;
  sessionRole: string;
  canLogin: boolean;
  superuser: boolean;
  createRole: boolean;
  createroleSelfGrant: string;
};

export type FinisherPrincipalSnapshot = {
  phase: FinisherPrincipalPhase;
  serverVersionNumber: number;
  administrator: FinisherPrincipalAdministrator;
  roles: FinisherPrincipalEvidenceRole[];
  memberships: FinisherRoleMembership[];
  finisherObjectCount: number;
  finisherObjectCapabilityCount: number;
};

export type FinisherPrincipalBinding = {
  repositoryHead: string;
  requiredApplicationCommit: string;
  targetMigration: typeof FINISHER_TARGET_MIGRATION;
  environment: "production" | "disposable";
  targetClassification: "remote" | "disposable";
  targetFingerprint: string;
  projectFingerprint: string;
  database: string;
};

export type FinisherPrincipalAuditRecord = {
  schema: typeof FINISHER_PRINCIPAL_AUDIT_SCHEMA;
  version: typeof FINISHER_PRINCIPAL_AUDIT_VERSION;
  verifier: typeof FINISHER_PRINCIPAL_VERIFIER;
  authority: "sanitized_audit_record_only";
  binding: FinisherPrincipalBinding;
  operation: "provision" | "verify";
  startedAt: string;
  completedAt: string;
  readOnlyTransaction: boolean;
  databaseWrites: number;
  createdPrincipals: FinisherPrincipalName[];
  credentialConfigured: boolean;
  liveState: FinisherPrincipalSnapshot;
};

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

export function canonicalEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function projectFingerprint(projectReference: string): string {
  return sha256Hex(`supabase-project:${projectReference}`).slice(0, 16);
}

export function targetFingerprint(hostname: string): string {
  return sha256Hex(hostname.toLowerCase()).slice(0, 12);
}

export function isFullCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function expectedSchemaCreate(
  phase: FinisherPrincipalPhase,
  role: FinisherPrincipalName,
): boolean {
  return (
    phase === "migration_capable" &&
    (role === "trainer_finisher_owner" ||
      role === "trainer_finisher_cleanup")
  );
}

function roleReasons(
  snapshot: FinisherPrincipalSnapshot,
  requireCredentialProof: boolean,
): string[] {
  const reasons: string[] = [];
  const expectedNames = FINISHER_PRINCIPAL_CONTRACT.map((role) => role.name);
  if (
    snapshot.roles.length !== expectedNames.length ||
    snapshot.roles.some((role, index) => role.name !== expectedNames[index])
  ) {
    reasons.push("role_set_mismatch");
    return reasons;
  }

  for (const expected of FINISHER_PRINCIPAL_CONTRACT) {
    const actual = snapshot.roles.find((role) => role.name === expected.name);
    if (!actual) continue;
    if (
      actual.canLogin !== expected.canLogin ||
      actual.inherit !== expected.inherit ||
      actual.superuser ||
      actual.createDb ||
      actual.createRole ||
      actual.replication ||
      actual.bypassRls
    ) {
      reasons.push(`unsafe_attributes:${expected.name}`);
    }
    if (
      actual.publicSchemaCreate !==
      expectedSchemaCreate(snapshot.phase, expected.name)
    ) {
      reasons.push(`schema_create_mismatch:${expected.name}`);
    }
    if (actual.defaultPrivilegeCount !== 0) {
      reasons.push(`default_privileges:${expected.name}`);
    }
    if (
      expected.credential === "runtime_password_required" &&
      requireCredentialProof &&
      actual.credential !== "verified_matching"
    ) {
      reasons.push("runtime_credential_not_verified");
    }
    if (
      expected.credential === "forbidden" &&
      actual.credential !== "not_applicable"
    ) {
      reasons.push(`unexpected_credential_state:${expected.name}`);
    }
  }
  return reasons;
}

function membershipKey(membership: FinisherRoleMembership): string {
  return [
    membership.grantedRole,
    membership.memberRole,
    membership.grantorRole,
    membership.grantorIsBootstrapSuperuser,
    membership.admin,
    membership.inherit,
    membership.set,
  ].join("|");
}

function membershipReasons(snapshot: FinisherPrincipalSnapshot): string[] {
  const reasons: string[] = [];
  const administrator = snapshot.administrator.sessionRole;
  const automatic = FINISHER_PRINCIPAL_CONTRACT.map((role) => ({
    grantedRole: role.name,
    memberRole: administrator,
    grantorRole: snapshot.memberships.find(
      (membership) =>
        membership.grantedRole === role.name &&
        membership.memberRole === administrator &&
        membership.grantorIsBootstrapSuperuser,
    )?.grantorRole ?? "",
    grantorIsBootstrapSuperuser: true,
    admin: true,
    inherit: false,
    set: false,
  }));
  const supplemental =
    snapshot.phase === "migration_capable"
      ? (["trainer_finisher_owner", "trainer_finisher_cleanup"] as const).map(
          (grantedRole) => ({
            grantedRole,
            memberRole: administrator,
            grantorRole: administrator,
            grantorIsBootstrapSuperuser: false,
            admin: false,
            inherit: false,
            set: true,
          }),
        )
      : [];
  const expected = [...automatic, ...supplemental].map(membershipKey).sort();
  const actual = snapshot.memberships.map(membershipKey).sort();
  if (canonicalEvidenceJson(actual) !== canonicalEvidenceJson(expected)) {
    reasons.push("membership_mismatch");
  }
  if (automatic.some((membership) => !membership.grantorRole)) {
    reasons.push("automatic_membership_grantor_mismatch");
  }
  return reasons;
}

export function principalSnapshotContractReasons(
  snapshot: FinisherPrincipalSnapshot,
  options: { requireCredentialProof?: boolean } = {},
): string[] {
  const reasons: string[] = [];
  if (
    snapshot.serverVersionNumber < 160000 ||
    snapshot.serverVersionNumber >= 170000
  ) {
    reasons.push("postgres_version_not_16");
  }
  if (
    snapshot.administrator.currentRole !==
      snapshot.administrator.sessionRole ||
    !snapshot.administrator.canLogin ||
    snapshot.administrator.superuser ||
    !snapshot.administrator.createRole
  ) {
    reasons.push("administrator_identity_or_attributes_mismatch");
  }
  if (snapshot.administrator.createroleSelfGrant !== "") {
    reasons.push("createrole_self_grant_not_empty");
  }
  reasons.push(
    ...roleReasons(snapshot, options.requireCredentialProof ?? true),
    ...membershipReasons(snapshot),
  );
  if (
    snapshot.phase !== "terminal" &&
    (snapshot.finisherObjectCount !== 0 ||
      snapshot.finisherObjectCapabilityCount !== 0)
  ) {
    reasons.push("pre_migration_finisher_objects_or_capabilities_present");
  }
  return [...new Set(reasons)];
}

export function principalSnapshotMatchesContract(
  snapshot: FinisherPrincipalSnapshot,
  options: { requireCredentialProof?: boolean } = {},
): boolean {
  return principalSnapshotContractReasons(snapshot, options).length === 0;
}
