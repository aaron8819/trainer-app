import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const FINISHER_PRINCIPAL_EVIDENCE_SCHEMA =
  "trainer-finisher-principal-evidence";
export const FINISHER_PRINCIPAL_PROVISION_SCHEMA =
  "trainer-finisher-principal-provision-evidence";
export const FINISHER_PRINCIPAL_EVIDENCE_VERSION = 1;
export const FINISHER_PRINCIPAL_VERIFIER = "ops:finisher-principals";
export const FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE =
  "TRAINER_FINISHER_PRINCIPAL_EVIDENCE_KEY";
export const FINISHER_RUNTIME_PASSWORD_VARIABLE =
  "TRAINER_APP_RUNTIME_PASSWORD";

export const FINISHER_PRINCIPAL_CONTRACT = [
  {
    name: "trainer_app_runtime",
    canLogin: true,
    inherit: true,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false,
    bypassRls: false,
    publicSchemaCreate: false,
    credential: "scram_sha_256_required",
  },
  {
    name: "trainer_finisher_owner",
    canLogin: false,
    inherit: false,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false,
    bypassRls: false,
    publicSchemaCreate: false,
    credential: "forbidden",
  },
  {
    name: "trainer_finisher_cleanup",
    canLogin: false,
    inherit: false,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false,
    bypassRls: false,
    publicSchemaCreate: false,
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
    | "scram_sha_256_configured"
    | "not_configured"
    | "not_applicable"
    | "unsupported";
  membershipsGranted: string[];
  membershipsReceived: string[];
  defaultPrivilegeCount: number;
};

export type FinisherPrincipalBinding = {
  repositoryHead: string;
  requiredApplicationCommit: string;
  targetMigration: "20260728120000_add_finishers_phase_1";
  environment: "production" | "disposable";
  targetClassification: "remote" | "disposable";
  targetFingerprint: string;
  projectFingerprint: string;
  database: string;
  authorizationContext: string;
};

export type FinisherPrincipalProvisionEvidence = {
  schema: typeof FINISHER_PRINCIPAL_PROVISION_SCHEMA;
  version: typeof FINISHER_PRINCIPAL_EVIDENCE_VERSION;
  verifier: typeof FINISHER_PRINCIPAL_VERIFIER;
  binding: FinisherPrincipalBinding;
  startedAt: string;
  completedAt: string;
  databaseWrites: number;
  createdPrincipals: FinisherPrincipalName[];
  credentialConfigured: boolean;
  signature: string;
};

export type FinisherPrincipalVerificationEvidence = {
  schema: typeof FINISHER_PRINCIPAL_EVIDENCE_SCHEMA;
  version: typeof FINISHER_PRINCIPAL_EVIDENCE_VERSION;
  verifier: typeof FINISHER_PRINCIPAL_VERIFIER;
  binding: FinisherPrincipalBinding;
  provisioningEvidenceHash: string;
  provisioningCompletedAt: string;
  verificationStartedAt: string;
  verifiedAt: string;
  readOnlyTransaction: true;
  databaseWrites: 0;
  roles: FinisherPrincipalEvidenceRole[];
  signature: string;
};

function canonicalValue(value: unknown): unknown {
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

export function authorizationContext(
  binding: Omit<FinisherPrincipalBinding, "authorizationContext">,
): string {
  return sha256Hex(canonicalEvidenceJson(binding));
}

export function evidenceSignature(
  evidence: Record<string, unknown>,
  key: string,
): string {
  if (key.length < 32) {
    throw new Error(
      `${FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE} must contain at least 32 characters.`,
    );
  }
  const unsigned = { ...evidence };
  delete unsigned.signature;
  return createHmac("sha256", key)
    .update(canonicalEvidenceJson(unsigned))
    .digest("hex");
}

export function evidenceSignatureMatches(
  evidence: Record<string, unknown>,
  key: string,
): boolean {
  const signature = evidence.signature;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  let expected: string;
  try {
    expected = evidenceSignature(evidence, key);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function isFullCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

export function expectedEvidenceRoles(): FinisherPrincipalEvidenceRole[] {
  return FINISHER_PRINCIPAL_CONTRACT.map((principal) => ({
    name: principal.name,
    canLogin: principal.canLogin,
    inherit: principal.inherit,
    superuser: principal.superuser,
    createDb: principal.createDb,
    createRole: principal.createRole,
    replication: principal.replication,
    bypassRls: principal.bypassRls,
    publicSchemaCreate: principal.publicSchemaCreate,
    credential:
      principal.credential === "scram_sha_256_required"
        ? "scram_sha_256_configured"
        : "not_applicable",
    membershipsGranted: [],
    membershipsReceived: [],
    defaultPrivilegeCount: 0,
  }));
}

export function principalRolesMatchContract(
  roles: FinisherPrincipalEvidenceRole[],
): boolean {
  return (
    canonicalEvidenceJson(roles) === canonicalEvidenceJson(expectedEvidenceRoles())
  );
}

export function parsePrincipalVerificationEvidence(
  value: unknown,
): FinisherPrincipalVerificationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Finisher principal evidence must be a JSON object.");
  }
  return value as FinisherPrincipalVerificationEvidence;
}

export function parsePrincipalProvisionEvidence(
  value: unknown,
): FinisherPrincipalProvisionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Finisher principal provisioning evidence must be a JSON object.");
  }
  return value as FinisherPrincipalProvisionEvidence;
}

export function verifyPrincipalEvidenceForGate(options: {
  evidence: FinisherPrincipalVerificationEvidence | undefined;
  signingKey: string | undefined;
  repositoryHead: string;
  requiredApplicationCommit: string;
  target: {
    classification: "local" | "disposable" | "remote";
    fingerprint: string;
    projectFingerprint?: string;
    database?: string;
  };
  evaluatedAt: string;
  maxAgeMinutes: number;
}): { valid: boolean; reasons: string[] } {
  const evidence = options.evidence;
  const reasons: string[] = [];
  if (!evidence) return { valid: false, reasons: ["missing"] };
  if (
    evidence.schema !== FINISHER_PRINCIPAL_EVIDENCE_SCHEMA ||
    evidence.version !== FINISHER_PRINCIPAL_EVIDENCE_VERSION ||
    evidence.verifier !== FINISHER_PRINCIPAL_VERIFIER
  ) {
    reasons.push("malformed");
  }
  if (
    !options.signingKey ||
    !evidenceSignatureMatches(
      evidence as unknown as Record<string, unknown>,
      options.signingKey,
    )
  ) {
    reasons.push("signature_invalid");
  }
  if (
    evidence.binding.repositoryHead !== options.repositoryHead ||
    evidence.binding.requiredApplicationCommit !==
      options.requiredApplicationCommit
  ) {
    reasons.push("authorization_context_mismatch");
  }
  const unsignedBinding = {
    repositoryHead: evidence.binding.repositoryHead,
    requiredApplicationCommit: evidence.binding.requiredApplicationCommit,
    targetMigration: evidence.binding.targetMigration,
    environment: evidence.binding.environment,
    targetClassification: evidence.binding.targetClassification,
    targetFingerprint: evidence.binding.targetFingerprint,
    projectFingerprint: evidence.binding.projectFingerprint,
    database: evidence.binding.database,
  };
  if (
    evidence.binding.authorizationContext !==
    authorizationContext(unsignedBinding)
  ) {
    reasons.push("authorization_context_invalid");
  }
  if (
    evidence.binding.targetFingerprint !== options.target.fingerprint ||
    evidence.binding.targetClassification !== options.target.classification ||
    (options.target.projectFingerprint != null &&
      evidence.binding.projectFingerprint !==
        options.target.projectFingerprint) ||
    (options.target.database != null &&
      evidence.binding.database !== options.target.database)
  ) {
    reasons.push("target_mismatch");
  }
  if (
    options.target.classification === "remote" &&
    evidence.binding.environment !== "production"
  ) {
    reasons.push("environment_mismatch");
  }
  const verifiedAt = Date.parse(evidence.verifiedAt);
  const evaluatedAt = Date.parse(options.evaluatedAt);
  const verificationStartedAt = Date.parse(evidence.verificationStartedAt);
  const provisioningCompletedAt = Date.parse(
    evidence.provisioningCompletedAt,
  );
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(evaluatedAt) ||
    verifiedAt > evaluatedAt ||
    evaluatedAt - verifiedAt > options.maxAgeMinutes * 60_000
  ) {
    reasons.push("stale_or_invalid_timestamp");
  }
  if (
    !Number.isFinite(verificationStartedAt) ||
    !Number.isFinite(provisioningCompletedAt) ||
    verificationStartedAt < provisioningCompletedAt ||
    verifiedAt < verificationStartedAt
  ) {
    reasons.push("verification_order_invalid");
  }
  if (
    evidence.readOnlyTransaction !== true ||
    evidence.databaseWrites !== 0
  ) {
    reasons.push("writes_reported");
  }
  if (!principalRolesMatchContract(evidence.roles)) {
    reasons.push("principal_contract_mismatch");
  }
  if (!/^[0-9a-f]{64}$/.test(evidence.provisioningEvidenceHash)) {
    reasons.push("provisioning_binding_invalid");
  }
  return { valid: reasons.length === 0, reasons };
}
