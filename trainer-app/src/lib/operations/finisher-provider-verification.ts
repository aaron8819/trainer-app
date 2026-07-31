import { createHash } from "node:crypto";
import { z } from "zod";

export const FINISHER_PROVIDER_EVIDENCE_SCHEMA =
  "trainer-finisher-provider-verification" as const;
export const FINISHER_PROVIDER_EVIDENCE_VERSION = 1 as const;
export const FINISHER_PROVIDER_CONTRACT_VERSION = 1 as const;
export const FINISHER_PROVIDER_TOOL_VERSION = "1.0.0" as const;
export const FINISHER_MIGRATION_PATH =
  "trainer-app/prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql" as const;
export const FINISHER_MIGRATION_GIT_BLOB =
  "55985a32851d9de042b43db3880b5cb857373313" as const;
export const FINISHER_PRODUCTION_DATABASE = "postgres" as const;
export const FINISHER_DISPOSABLE_WORKFLOW =
  ".github/workflows/finisher-disposable-verification.yml" as const;
export const FINISHER_DISPOSABLE_ARTIFACT =
  "finisher-disposable-evidence" as const;
export const PROVIDER_EVIDENCE_MAX_AGE_MINUTES = 30;

const fullSha = z.string().regex(/^[0-9a-f]{40}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1).max(512);
const timestamp = z.string().datetime({ offset: true });

const migrationIdentitySchema = z
  .object({
    path: z.literal(FINISHER_MIGRATION_PATH),
    sha256,
    gitBlob: z.literal(FINISHER_MIGRATION_GIT_BLOB),
    inventorySha256: sha256,
    inventory: z.array(nonEmpty).min(1),
  })
  .strict();

const targetIdentitySchema = z
  .object({
    environment: z.literal("production"),
    githubOwner: nonEmpty,
    githubRepository: nonEmpty,
    vercelTeamId: nonEmpty,
    vercelTeamSlug: nonEmpty,
    vercelProjectId: nonEmpty,
    vercelProjectName: nonEmpty,
    productionAlias: nonEmpty,
    supabaseOrganizationId: nonEmpty,
    supabaseProjectRef: z.string().regex(/^[a-z0-9]{20}$/),
    database: z.literal(FINISHER_PRODUCTION_DATABASE),
  })
  .strict();

const deploymentSchema = z
  .object({
    provider: z.literal("vercel"),
    authenticated: z.literal(true),
    account: nonEmpty,
    teamId: nonEmpty,
    teamSlug: nonEmpty,
    projectId: nonEmpty,
    projectName: nonEmpty,
    environment: z.literal("production"),
    alias: nonEmpty,
    deploymentId: nonEmpty,
    state: z.literal("READY"),
    sourceProvider: z.literal("github"),
    sourceRepository: nonEmpty,
    sourceBranch: z.literal("master"),
    sourceCommit: fullSha,
    createdAt: timestamp,
    readyAt: timestamp,
    aliasObservedAt: timestamp,
    verifiedAt: timestamp,
    provenance: z.literal("vercel_authenticated_read_only_rest"),
  })
  .strict();

export const disposableEvidenceSchema = z
  .object({
    schema: z.literal("trainer-finisher-disposable-verification"),
    version: z.literal(1),
    contractVersion: z.literal(FINISHER_PROVIDER_CONTRACT_VERSION),
    toolVersion: z.literal(FINISHER_PROVIDER_TOOL_VERSION),
    authority: z.literal("github_actions_exact_head_artifact"),
    repository: z.literal("aaron8819/trainer-app"),
    workflow: z.literal(FINISHER_DISPOSABLE_WORKFLOW),
    workflowRunId: z.string().regex(/^[1-9][0-9]*$/),
    workflowRunAttempt: z.number().int().positive(),
    commitSha: fullSha,
    ref: z.literal("refs/heads/master"),
    event: z.literal("workflow_dispatch"),
    environment: z.literal("disposable"),
    postgresMajor: z.literal(16),
    sourceClean: z.literal(true),
    migration: migrationIdentitySchema,
    preMigrationState: z
      .object({
        checkedIn: z.number().int().positive(),
        applied: z.number().int().nonnegative(),
        pending: z.array(nonEmpty).min(1),
      })
      .strict(),
    terminalState: z
      .object({
        migrationApplied: z.literal(true),
        exactSchemaVerified: z.literal(true),
        exactCatalogVerified: z.literal(true),
        restrictedAdministratorWorkflowVerified: z.literal(true),
        principalTerminalStateVerified: z.literal(true),
        productionWritePathCoverageVerified: z.literal(true),
        databaseWritesOutsideDisposable: z.literal(0),
      })
      .strict(),
    startedAt: timestamp,
    completedAt: timestamp,
  })
  .strict();

const disposableSchema = disposableEvidenceSchema.extend({
  authenticated: z.literal(true),
  artifactId: z.string().regex(/^[1-9][0-9]*$/),
  artifactDigest: sha256,
  verifiedAt: timestamp,
  provenance: z.literal("github_authenticated_actions_artifact"),
}).strict();

const recoveryPointSchema = z
  .object({
    provider: z.literal("supabase"),
    authenticated: z.literal(true),
    organizationId: nonEmpty,
    projectRef: z.string().regex(/^[a-z0-9]{20}$/),
    database: z.literal(FINISHER_PRODUCTION_DATABASE),
    creationCapability: z.enum([
      "provider_operation",
      "unavailable_no_authoritative_creation_api",
    ]),
    creationAuthorizedAt: timestamp.nullable(),
    operationId: nonEmpty.nullable(),
    resourceId: nonEmpty.nullable(),
    state: z.enum(["COMPLETED", "PENDING", "FAILED", "UNAVAILABLE"]),
    recoveryRequirement: z.enum([
      "fresh_completed_physical_backup",
      "pitr_window_covers_checkpoint",
      "unproven",
    ]),
    checkpointAt: timestamp.nullable(),
    providerCreatedAt: timestamp.nullable(),
    verifiedAt: timestamp,
    verified: z.boolean(),
    provenance: z.literal("supabase_authenticated_management_api"),
    limitation: z.string().max(512).nullable(),
  })
  .strict();

const writePauseSchema = z
  .object({
    provider: z.literal("vercel_application"),
    authenticatedProvider: z.literal(true),
    teamId: nonEmpty,
    projectId: nonEmpty,
    environment: z.literal("production"),
    deploymentId: nonEmpty,
    commitSha: fullSha,
    enforcement: z.literal("application_all_classified_write_paths"),
    initiationCapability: z.enum([
      "provider_operation",
      "unavailable_requires_authorized_environment_update_and_redeployment",
    ]),
    initiationAuthorizedAt: timestamp.nullable(),
    initiationOperationId: nonEmpty.nullable(),
    initiationObservedAt: timestamp,
    establishedAt: timestamp,
    runtimeStatus: z.literal("PAUSED"),
    runtimeContractVersion: z.literal(1),
    mutationCoverageVerified: z.literal(true),
    bypassPaths: z.array(nonEmpty).max(0),
    verifiedAt: timestamp,
    verified: z.literal(true),
    provenance: z.literal("vercel_authenticated_deployment_plus_runtime_read_only"),
  })
  .strict();

export const finisherProviderVerificationSchema = z
  .object({
    schema: z.literal(FINISHER_PROVIDER_EVIDENCE_SCHEMA),
    version: z.literal(FINISHER_PROVIDER_EVIDENCE_VERSION),
    contractVersion: z.literal(FINISHER_PROVIDER_CONTRACT_VERSION),
    toolVersion: z.literal(FINISHER_PROVIDER_TOOL_VERSION),
    authority: z.literal("canonical_live_provider_verification"),
    requiredApplicationCommit: fullSha,
    migration: migrationIdentitySchema,
    target: targetIdentitySchema,
    applicationCompatibilityState: z.literal("compatible_with_write_boundary"),
    deployment: deploymentSchema,
    disposable: disposableSchema,
    recoveryPoint: recoveryPointSchema,
    writePause: writePauseSchema,
    verifiedAt: timestamp,
    failureDetails: z.array(z.string().max(512)),
  })
  .strict();

export type DisposableVerificationEvidence = z.infer<
  typeof disposableEvidenceSchema
>;
export type FinisherProviderVerification = z.infer<
  typeof finisherProviderVerificationSchema
>;

export type ProviderVerificationExpectation = {
  evaluatedAt: string;
  repositoryHead: string;
  requiredApplicationCommit: string;
  migrationPath: typeof FINISHER_MIGRATION_PATH;
  migrationGitBlob: typeof FINISHER_MIGRATION_GIT_BLOB;
  migrationSha256: string;
  migrationInventorySha256: string;
  target: FinisherProviderVerification["target"];
};

export type ProviderVerificationAssessment = {
  valid: boolean;
  reasons: string[];
  evidence: FinisherProviderVerification | null;
};

function parsedTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fresh(value: string, evaluatedAt: string): boolean {
  const observed = parsedTime(value);
  const evaluated = parsedTime(evaluatedAt);
  if (observed === null || evaluated === null) return false;
  const age = evaluated - observed;
  return (
    age >= 0 &&
    age <= PROVIDER_EVIDENCE_MAX_AGE_MINUTES * 60 * 1_000
  );
}

function ordered(...values: Array<string | null>): boolean {
  const parsed = values.map((value) => (value === null ? null : parsedTime(value)));
  return parsed.every((value) => value !== null) &&
    parsed.every((value, index) => index === 0 || value! >= parsed[index - 1]!);
}

function sameTarget(
  actual: FinisherProviderVerification["target"],
  expected: FinisherProviderVerification["target"],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function assessFinisherProviderVerification(
  value: unknown,
  expected: ProviderVerificationExpectation,
): ProviderVerificationAssessment {
  const parsed = finisherProviderVerificationSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      reasons: ["provider_evidence_schema_invalid"],
      evidence: null,
    };
  }
  const evidence = parsed.data;
  const reasons: string[] = [];
  if (evidence.requiredApplicationCommit !== expected.requiredApplicationCommit) {
    reasons.push("provider_evidence_required_commit_mismatch");
  }
  if (evidence.requiredApplicationCommit !== expected.repositoryHead) {
    reasons.push("provider_evidence_repository_head_mismatch");
  }
  if (
    evidence.migration.path !== expected.migrationPath ||
    evidence.migration.gitBlob !== expected.migrationGitBlob ||
    evidence.migration.sha256 !== expected.migrationSha256 ||
    evidence.migration.inventorySha256 !== expected.migrationInventorySha256
  ) {
    reasons.push("provider_evidence_migration_identity_mismatch");
  }
  if (!sameTarget(evidence.target, expected.target)) {
    reasons.push("provider_evidence_target_identity_mismatch");
  }
  if (
    evidence.deployment.sourceCommit !== expected.requiredApplicationCommit ||
    evidence.disposable.commitSha !== expected.requiredApplicationCommit ||
    evidence.writePause.commitSha !== expected.requiredApplicationCommit
  ) {
    reasons.push("provider_evidence_cross_commit_replay");
  }
  if (
    evidence.disposable.migration.sha256 !== evidence.migration.sha256 ||
    evidence.disposable.migration.gitBlob !== evidence.migration.gitBlob ||
    evidence.disposable.migration.inventorySha256 !== evidence.migration.inventorySha256
  ) {
    reasons.push("provider_evidence_disposable_migration_mismatch");
  }
  if (
    evidence.deployment.teamId !== evidence.target.vercelTeamId ||
    evidence.deployment.teamSlug !== evidence.target.vercelTeamSlug ||
    evidence.deployment.projectId !== evidence.target.vercelProjectId ||
    evidence.deployment.projectName !== evidence.target.vercelProjectName ||
    evidence.deployment.alias !== evidence.target.productionAlias ||
    evidence.deployment.sourceRepository !==
      `${evidence.target.githubOwner}/${evidence.target.githubRepository}` ||
    evidence.deployment.sourceBranch !== "master" ||
    evidence.writePause.teamId !== evidence.target.vercelTeamId ||
    evidence.writePause.projectId !== evidence.target.vercelProjectId ||
    evidence.recoveryPoint.organizationId !== evidence.target.supabaseOrganizationId ||
    evidence.recoveryPoint.projectRef !== evidence.target.supabaseProjectRef ||
    evidence.recoveryPoint.database !== evidence.target.database
  ) {
    reasons.push("provider_evidence_internal_target_conflict");
  }
  if (!evidence.recoveryPoint.verified) {
    reasons.push("provider_recovery_point_unverified");
  }
  if (evidence.recoveryPoint.creationCapability !== "provider_operation") {
    reasons.push("provider_recovery_point_creation_capability_unavailable");
  }
  if (
    evidence.recoveryPoint.operationId === null ||
    evidence.recoveryPoint.resourceId === null ||
    evidence.recoveryPoint.state !== "COMPLETED" ||
    evidence.recoveryPoint.recoveryRequirement === "unproven"
  ) {
    reasons.push("provider_recovery_point_incomplete");
  }
  if (evidence.writePause.initiationCapability !== "provider_operation") {
    reasons.push("provider_write_pause_initiation_capability_unavailable");
  }
  if (
    evidence.writePause.initiationAuthorizedAt === null ||
    evidence.writePause.initiationOperationId === null
  ) {
    reasons.push("provider_write_pause_initiation_unverified");
  }
  for (const observedAt of [
    evidence.deployment.createdAt,
    evidence.deployment.readyAt,
    evidence.deployment.aliasObservedAt,
    evidence.deployment.verifiedAt,
    evidence.disposable.startedAt,
    evidence.disposable.completedAt,
    evidence.disposable.verifiedAt,
    evidence.recoveryPoint.creationAuthorizedAt,
    evidence.recoveryPoint.providerCreatedAt,
    evidence.recoveryPoint.checkpointAt,
    evidence.recoveryPoint.verifiedAt,
    evidence.writePause.initiationAuthorizedAt,
    evidence.writePause.initiationObservedAt,
    evidence.writePause.establishedAt,
    evidence.writePause.verifiedAt,
    evidence.verifiedAt,
  ].filter((value): value is string => value !== null)) {
    if (!fresh(observedAt, expected.evaluatedAt)) {
      reasons.push("provider_evidence_expired_or_future");
      break;
    }
  }
  if (
    !ordered(
      evidence.deployment.readyAt,
      evidence.disposable.completedAt,
      evidence.recoveryPoint.creationAuthorizedAt,
      evidence.recoveryPoint.providerCreatedAt,
      evidence.recoveryPoint.verifiedAt,
      evidence.writePause.initiationAuthorizedAt,
      evidence.writePause.initiationObservedAt,
      evidence.writePause.establishedAt,
      evidence.writePause.verifiedAt,
      evidence.verifiedAt,
    )
  ) {
    reasons.push("provider_evidence_operational_order_invalid");
  }
  if (
    !ordered(
      evidence.deployment.verifiedAt,
      evidence.disposable.verifiedAt,
      evidence.recoveryPoint.verifiedAt,
      evidence.writePause.verifiedAt,
      evidence.verifiedAt,
    )
  ) {
    reasons.push("provider_evidence_verification_order_invalid");
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)].sort(), evidence };
}

export function migrationInventorySha256(inventory: string[]): string {
  return createHash("sha256")
    .update(`${[...inventory].sort().join("\n")}\n`, "utf8")
    .digest("hex");
}
