import { describe, expect, it } from "vitest";
import {
  assessFinisherProviderVerification,
  FINISHER_DISPOSABLE_WORKFLOW,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
  FINISHER_PROVIDER_CONTRACT_VERSION,
  FINISHER_PROVIDER_EVIDENCE_SCHEMA,
  FINISHER_PROVIDER_EVIDENCE_VERSION,
  FINISHER_PROVIDER_TOOL_VERSION,
  migrationInventorySha256,
  type FinisherProviderVerification,
  type ProviderVerificationExpectation,
} from "./finisher-provider-verification";

const COMMIT = "a".repeat(40);
const MIGRATION_SHA = "b".repeat(64);
const INVENTORY = ["20260222_baseline", "20260728120000_add_finishers_phase_1"];
const INVENTORY_SHA = migrationInventorySha256(INVENTORY);
const EVALUATED_AT = "2026-07-31T18:00:00.000Z";

function evidence(): FinisherProviderVerification {
  const migration = {
    path: FINISHER_MIGRATION_PATH,
    sha256: MIGRATION_SHA,
    gitBlob: FINISHER_MIGRATION_GIT_BLOB,
    inventorySha256: INVENTORY_SHA,
    inventory: INVENTORY,
  } as const;
  return {
    schema: FINISHER_PROVIDER_EVIDENCE_SCHEMA,
    version: FINISHER_PROVIDER_EVIDENCE_VERSION,
    contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
    toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
    authority: "canonical_live_provider_verification",
    requiredApplicationCommit: COMMIT,
    migration,
    target: {
      environment: "production",
      githubOwner: "aaron8819",
      githubRepository: "trainer-app",
      vercelTeamId: "team_trainer",
      vercelTeamSlug: "trainer-team",
      vercelProjectId: "prj_trainer",
      vercelProjectName: "trainer-app",
      productionAlias: "trainer.example.com",
      supabaseOrganizationId: "org_trainer",
      supabaseProjectRef: "p".repeat(20),
      database: "postgres",
    },
    applicationCompatibilityState: "compatible_with_write_boundary",
    deployment: {
      provider: "vercel",
      authenticated: true,
      account: "operator",
      teamId: "team_trainer",
      teamSlug: "trainer-team",
      projectId: "prj_trainer",
      projectName: "trainer-app",
      environment: "production",
      alias: "trainer.example.com",
      deploymentId: "dpl_current",
      state: "READY",
      sourceProvider: "github",
      sourceRepository: "aaron8819/trainer-app",
      sourceBranch: "master",
      sourceCommit: COMMIT,
      createdAt: "2026-07-31T17:30:00.000Z",
      readyAt: "2026-07-31T17:31:00.000Z",
      aliasObservedAt: "2026-07-31T17:31:30.000Z",
      verifiedAt: "2026-07-31T17:31:30.000Z",
      provenance: "vercel_authenticated_read_only_rest",
    },
    disposable: {
      schema: "trainer-finisher-disposable-verification",
      version: 1,
      contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
      toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
      authority: "github_actions_exact_head_artifact",
      repository: "aaron8819/trainer-app",
      workflow: FINISHER_DISPOSABLE_WORKFLOW,
      workflowRunId: "100",
      workflowRunAttempt: 1,
      commitSha: COMMIT,
      ref: "refs/heads/master",
      event: "workflow_dispatch",
      environment: "disposable",
      postgresMajor: 16,
      sourceClean: true,
      migration,
      preMigrationState: {
        checkedIn: 2,
        applied: 1,
        pending: ["20260728120000_add_finishers_phase_1"],
      },
      terminalState: {
        migrationApplied: true,
        exactSchemaVerified: true,
        exactCatalogVerified: true,
      restrictedAdministratorWorkflowVerified: true,
      principalTerminalStateVerified: true,
      productionWritePathCoverageVerified: true,
      databaseWritesOutsideDisposable: 0,
      },
      startedAt: "2026-07-31T17:32:00.000Z",
      completedAt: "2026-07-31T17:38:00.000Z",
      authenticated: true,
      artifactId: "200",
      artifactDigest: "c".repeat(64),
      verifiedAt: "2026-07-31T17:38:30.000Z",
      provenance: "github_authenticated_actions_artifact",
    },
    recoveryPoint: {
      provider: "supabase",
      authenticated: true,
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      creationCapability: "provider_operation",
      creationAuthorizedAt: "2026-07-31T17:39:00.000Z",
      operationId: "op_backup",
      resourceId: "backup_1",
      state: "COMPLETED",
      recoveryRequirement: "fresh_completed_physical_backup",
      checkpointAt: "2026-07-31T17:39:00.000Z",
      providerCreatedAt: "2026-07-31T17:40:00.000Z",
      verifiedAt: "2026-07-31T17:45:00.000Z",
      verified: true,
      provenance: "supabase_authenticated_management_api",
      limitation: null,
    },
    writePause: {
      provider: "vercel_application",
      authenticatedProvider: true,
      teamId: "team_trainer",
      projectId: "prj_trainer",
      environment: "production",
      deploymentId: "dpl_current",
      commitSha: COMMIT,
      pauseOperationId: `trainer-write-pause:prj_trainer:${COMMIT}`,
      enforcement: "application_all_classified_write_paths",
      initiationCapability: "provider_operation",
      initiationAuthorizedAt: "2026-07-31T17:46:00.000Z",
      initiationOperationId: `trainer-write-pause:prj_trainer:${COMMIT}`,
      initiationObservedAt: "2026-07-31T17:46:30.000Z",
      establishedAt: "2026-07-31T17:47:00.000Z",
      runtimeStatus: "PAUSED",
      runtimeContractVersion: 2,
      enforcementContractVersion: 2,
      mutationCoverageVerified: true,
      bypassPaths: [],
      verifiedAt: "2026-07-31T17:50:00.000Z",
      verified: true,
      provenance: "vercel_authenticated_deployment_plus_runtime_read_only",
    },
    verifiedAt: "2026-07-31T17:55:00.000Z",
    failureDetails: [],
  };
}

function expectation(): ProviderVerificationExpectation {
  return {
    evaluatedAt: EVALUATED_AT,
    repositoryHead: COMMIT,
    requiredApplicationCommit: COMMIT,
    migrationPath: FINISHER_MIGRATION_PATH,
    migrationGitBlob: FINISHER_MIGRATION_GIT_BLOB,
    migrationSha256: MIGRATION_SHA,
    migrationInventorySha256: INVENTORY_SHA,
    target: evidence().target,
  };
}

describe("Finisher provider verification contract", () => {
  it("accepts the exact authenticated operational sequence", () => {
    expect(assessFinisherProviderVerification(evidence(), expectation())).toEqual({
      valid: true,
      reasons: [],
      evidence: evidence(),
    });
  });

  it("rejects caller-shaped unknown fields and unsupported versions", () => {
    const withUnknown = { ...evidence(), claimedReady: true };
    expect(assessFinisherProviderVerification(withUnknown, expectation()).reasons).toEqual([
      "provider_evidence_schema_invalid",
    ]);
    expect(
      assessFinisherProviderVerification({ ...evidence(), version: 99 }, expectation()).reasons,
    ).toEqual(["provider_evidence_schema_invalid"]);
  });

  it.each([
    ["wrong commit with matching migration", (value: FinisherProviderVerification) => {
      value.requiredApplicationCommit = "d".repeat(40);
    }, "provider_evidence_required_commit_mismatch"],
    ["correct commit with wrong migration bytes", (value: FinisherProviderVerification) => {
      value.migration.sha256 = "e".repeat(64);
    }, "provider_evidence_migration_identity_mismatch"],
    ["rejected feature-head replay", (value: FinisherProviderVerification) => {
      value.disposable.commitSha = "f".repeat(40);
    }, "provider_evidence_cross_commit_replay"],
    ["cross-project replay", (value: FinisherProviderVerification) => {
      value.target.vercelProjectId = "prj_other";
    }, "provider_evidence_target_identity_mismatch"],
    ["cross-environment replay", (value: FinisherProviderVerification) => {
      (value.target as { environment: string }).environment = "preview";
    }, "provider_evidence_schema_invalid"],
    ["one write path bypass", (value: FinisherProviderVerification) => {
      (value.writePause.bypassPaths as string[]).push("scripts/unsafe-write.ts");
    }, "provider_evidence_schema_invalid"],
  ] as const)("rejects %s", (_label, mutate, reason) => {
    const value = structuredClone(evidence());
    mutate(value);
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(reason);
  });

  it("rejects expired evidence", () => {
    const expected = { ...expectation(), evaluatedAt: "2026-07-31T19:00:00.000Z" };
    expect(assessFinisherProviderVerification(evidence(), expected).reasons).toContain(
      "provider_evidence_expired_or_future",
    );
  });

  it("rejects future-dated verification evidence", () => {
    const value = evidence();
    value.verifiedAt = "2026-07-31T18:00:01.000Z";
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_evidence_expired_or_future",
    );
  });

  it("rejects a stale recovery resource even when it was read recently", () => {
    const value = evidence();
    value.recoveryPoint.providerCreatedAt = "2026-07-31T16:00:00.000Z";
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_evidence_expired_or_future",
    );
  });

  it("rejects request acceptance without a completed recovery resource", () => {
    const value = evidence();
    value.recoveryPoint.state = "PENDING";
    value.recoveryPoint.verified = false;
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toEqual(
      expect.arrayContaining([
        "provider_recovery_point_incomplete",
        "provider_recovery_point_unverified",
      ]),
    );
  });

  it("rejects unsupported recovery-point creation capability", () => {
    const value = evidence();
    value.recoveryPoint.creationCapability = "unavailable_no_authoritative_creation_api";
    value.recoveryPoint.creationAuthorizedAt = null;
    value.recoveryPoint.operationId = null;
    value.recoveryPoint.verified = false;
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_recovery_point_creation_capability_unavailable",
    );
  });

  it("rejects effective pause evidence when initiation capability is unavailable", () => {
    const value = evidence();
    value.writePause.initiationCapability =
      "unavailable_requires_authorized_environment_update_and_redeployment";
    value.writePause.initiationAuthorizedAt = null;
    value.writePause.initiationOperationId = null;
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toEqual(
      expect.arrayContaining([
        "provider_write_pause_initiation_capability_unavailable",
        "provider_write_pause_initiation_unverified",
      ]),
    );
  });

  it("rejects runtime pause evidence bound to a different pause operation", () => {
    const value = evidence();
    value.writePause.pauseOperationId = "trainer-write-pause:prj_trainer:wrong";
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_evidence_pause_operation_mismatch",
    );
  });

  it("rejects evidence produced before the corresponding action and out of order", () => {
    const value = evidence();
    value.recoveryPoint.creationAuthorizedAt = "2026-07-31T17:20:00.000Z";
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_evidence_operational_order_invalid",
    );
  });

  it("rejects wrong provider database identity", () => {
    const value = evidence();
    (value.recoveryPoint as { database: string }).database = "other";
    expect(assessFinisherProviderVerification(value, expectation()).reasons).toContain(
      "provider_evidence_schema_invalid",
    );
  });

  it("hashes a deterministic exact migration inventory", () => {
    expect(migrationInventorySha256(["b", "a"])).toBe(migrationInventorySha256(["a", "b"]));
    expect(migrationInventorySha256(["a", "b"])).not.toBe(
      migrationInventorySha256(["a", "c"]),
    );
  });
});
