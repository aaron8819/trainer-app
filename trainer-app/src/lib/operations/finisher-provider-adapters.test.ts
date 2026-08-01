import { describe, expect, it } from "vitest";
import {
  initiateVercelProductionWritePause,
  inspectSupabaseRecoveryCapability,
  ProviderVerificationError,
  verifyGitHubDisposableEvidence,
  verifyProductionWritePause,
  verifyProductionWriteRestoration,
  verifyVercelProductionDeployment,
  type GitHubDisposableClient,
} from "./finisher-provider-adapters";
import {
  FINISHER_DISPOSABLE_WORKFLOW,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
  FINISHER_PROVIDER_CONTRACT_VERSION,
  FINISHER_PROVIDER_TOOL_VERSION,
  type FinisherProviderVerification,
} from "./finisher-provider-verification";

const COMMIT = "a".repeat(40);
const NOW = "2026-07-31T18:00:00.000Z";
const expected = {
  githubOwner: "aaron8819",
  githubRepository: "trainer-app",
  teamId: "team_trainer",
  teamSlug: "trainer-team",
  projectId: "prj_trainer",
  projectName: "trainer-app",
  productionAlias: "trainer.example.com",
};
const PAUSE_OPERATION_ID =
  `trainer-write-pause:${expected.projectId}:production:${COMMIT}:dpl_current`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function vercelFetcher(options: {
  commit?: string;
  missingSource?: boolean;
  sourceBranch?: string;
  sourceOwner?: string;
  sourceRepository?: string;
  target?: string;
  aliasDeploymentId?: string;
  deploymentId?: string;
  createdAt?: string;
  creatorId?: string;
  environmentTarget?: string;
  postDeploymentId?: string;
} = {}) {
  return async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v2/user") {
      return json({ user: { id: "user_operator", username: "operator" } });
    }
    if (path === "/v2/teams") return json({ teams: [{ id: expected.teamId }] });
    if (path === `/v2/teams/${expected.teamId}`) {
      return json({ id: expected.teamId, slug: expected.teamSlug });
    }
    if (path === `/v9/projects/${expected.projectId}`) {
      return json({
        id: expected.projectId,
        name: expected.projectName,
        accountId: expected.teamId,
        link: {
          type: "github",
          org: options.sourceOwner ?? expected.githubOwner,
          repo: options.sourceRepository ?? expected.githubRepository,
          repoId: 123,
          productionBranch: options.sourceBranch ?? "master",
        },
        targets: {
          production: { id: options.aliasDeploymentId ?? "dpl_current" },
        },
      });
    }
    if (path === `/v4/aliases/${expected.productionAlias}`) {
      return json({
        alias: expected.productionAlias,
        projectId: expected.projectId,
        deploymentId: options.aliasDeploymentId ?? "dpl_current",
      });
    }
    if (path === `/v9/projects/${expected.projectId}/env`) {
      return json({
        envs: [{
          id: "env_write_pause",
          key: "TRAINER_WRITE_PAUSE",
          type: "encrypted",
          target: [options.environmentTarget ?? "production"],
          gitBranch: null,
          updatedAt: Date.parse("2026-07-31T17:46:00.000Z"),
          lastUpdatedBy: options.creatorId ?? "user_operator",
        }],
        pagination: { next: null },
      });
    }
    if (path === `/v9/projects/${expected.projectId}/env/env_write_pause`) {
      return json({
        id: "env_write_pause",
        key: "TRAINER_WRITE_PAUSE",
        type: "encrypted",
        target: [options.environmentTarget ?? "production"],
        gitBranch: null,
        updatedAt: Date.parse("2026-07-31T17:46:00.000Z"),
        lastUpdatedBy: options.creatorId ?? "user_operator",
      });
    }
    if (path === "/v13/deployments" && init?.method === "POST") {
      return json({
        id: options.postDeploymentId ?? "dpl_initiated",
        projectId: expected.projectId,
        name: expected.projectName,
        target: options.target ?? "production",
        gitSource: {
          type: "github",
          repoId: 123,
          ref: options.sourceBranch ?? "master",
          sha: options.commit ?? COMMIT,
        },
        creator: { uid: options.creatorId ?? "user_operator" },
        createdAt: Date.parse(options.createdAt ?? "2026-07-31T17:46:30.000Z"),
        meta: {
          trainerWritePauseAuthorizationId: "env_write_pause",
          trainerWritePauseAuthorizedBy: "user_operator",
          trainerWritePauseAuthorizedAt: "2026-07-31T17:46:00.000Z",
          trainerWritePauseContractVersion: "2",
        },
      }, 201);
    }
    if (path.startsWith("/v13/deployments/")) {
      return json({
        id: options.deploymentId ?? "dpl_current",
        projectId: expected.projectId,
        name: expected.projectName,
        target: options.target ?? "production",
        readyState: "READY",
        creator: { uid: options.creatorId ?? "user_operator" },
        createdAt: Date.parse(options.createdAt ?? "2026-07-31T17:46:30.000Z"),
        ready: Date.parse("2026-07-31T17:47:00.000Z"),
        ...(options.missingSource
          ? {}
          : {
              gitSource: {
                type: "github",
                repoId: 123,
                ref: options.sourceBranch ?? "master",
                sha: options.commit ?? COMMIT,
              },
            }),
        meta: {
          githubCommitSha: options.commit ?? COMMIT,
          trainerWritePauseAuthorizationId: "env_write_pause",
          trainerWritePauseAuthorizedBy: options.creatorId ?? "user_operator",
          trainerWritePauseAuthorizedAt: "2026-07-31T17:46:00.000Z",
          trainerWritePauseContractVersion: "2",
        },
      });
    }
    return json({}, 404);
  };
}

function deployment(): FinisherProviderVerification["deployment"] {
  return {
    provider: "vercel",
    authenticated: true,
    account: "operator",
    accountId: "user_operator",
    teamId: expected.teamId,
    teamSlug: expected.teamSlug,
    projectId: expected.projectId,
    projectName: expected.projectName,
    environment: "production",
    alias: expected.productionAlias,
    deploymentId: "dpl_current",
    creatorId: "user_operator",
    writePauseAuthorizationId: "env_write_pause",
    writePauseAuthorizedBy: "user_operator",
    writePauseAuthorizedAt: "2026-07-31T17:46:00.000Z",
    state: "READY",
    sourceProvider: "github",
    sourceRepository: "aaron8819/trainer-app",
    sourceBranch: "master",
    sourceCommit: COMMIT,
    createdAt: "2026-07-31T17:46:30.000Z",
    readyAt: "2026-07-31T17:47:00.000Z",
    aliasObservedAt: NOW,
    verifiedAt: NOW,
    provenance: "vercel_authenticated_read_only_rest",
  };
}

function artifactEvidence() {
  return {
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
    migration: {
      path: FINISHER_MIGRATION_PATH,
      sha256: "b".repeat(64),
      gitBlob: FINISHER_MIGRATION_GIT_BLOB,
      inventorySha256: "c".repeat(64),
      inventory: ["20260222_baseline", "20260728120000_add_finishers_phase_1"],
    },
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
    completedAt: "2026-07-31T17:40:00.000Z",
  };
}

function githubClient(overrides: Partial<GitHubDisposableClient> = {}): GitHubDisposableClient {
  return {
    getRepository: async () => ({
      full_name: "aaron8819/trainer-app",
      default_branch: "master",
    }),
    getRun: async () => ({
      id: 100,
      path: FINISHER_DISPOSABLE_WORKFLOW,
      event: "workflow_dispatch",
      head_branch: "master",
      head_sha: COMMIT,
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    }),
    getDefaultBranch: async () => ({ commit: { sha: COMMIT } }),
    getArtifacts: async () => ({
      artifacts: [{
        id: 200,
        name: "finisher-disposable-evidence",
        expired: false,
        size_in_bytes: 4096,
        digest: `sha256:${"d".repeat(64)}`,
        workflow_run: { id: 100, head_sha: COMMIT },
      }],
    }),
    downloadEvidence: async () => artifactEvidence(),
    ...overrides,
  };
}

describe("Vercel production deployment adapter", () => {
  it("accepts the exact active READY production alias and commit", async () => {
    await expect(verifyVercelProductionDeployment({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      fetcher: vercelFetcher(),
      now: () => NOW,
    })).resolves.toMatchObject({
      deploymentId: "dpl_current",
      sourceCommit: COMMIT,
      state: "READY",
      environment: "production",
    });
  });

  it.each([
    ["preview deployment", { target: "preview" }, "stale_alias"],
    ["READY wrong commit", { commit: "b".repeat(40) }, "wrong_commit"],
    ["wrong source owner", { sourceOwner: "other-owner" }, "wrong_identity"],
    ["wrong source repository", { sourceRepository: "other-app" }, "wrong_identity"],
    ["wrong source branch", { sourceBranch: "feature" }, "wrong_identity"],
    ["missing source binding", { missingSource: true }, "source_binding_unavailable"],
    ["stale alias", { deploymentId: "dpl_other" }, "stale_alias"],
  ])("rejects %s", async (_label, options, code) => {
    await expect(verifyVercelProductionDeployment({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      fetcher: vercelFetcher(options),
    })).rejects.toMatchObject({ code });
  });

  it("rejects an alias that is not the project's active production target", async () => {
    const base = vercelFetcher();
    await expect(verifyVercelProductionDeployment({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      fetcher: async (url) => {
        if (new URL(url).pathname === `/v9/projects/${expected.projectId}`) {
          return json({
            id: expected.projectId,
            name: expected.projectName,
            accountId: expected.teamId,
            link: {
              type: "github",
              org: expected.githubOwner,
              repo: expected.githubRepository,
              repoId: 123,
              productionBranch: "master",
            },
            targets: { production: { id: "dpl_newer" } },
          });
        }
        return base(url);
      },
    })).rejects.toMatchObject({ code: "stale_alias" });
  });

  it("rejects the wrong authenticated Vercel project identity", async () => {
    const base = vercelFetcher();
    await expect(verifyVercelProductionDeployment({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      fetcher: async (url) =>
        new URL(url).pathname === `/v9/projects/${expected.projectId}`
          ? json({
              id: "prj_other",
              name: expected.projectName,
              accountId: expected.teamId,
              link: {
                type: "github",
                org: expected.githubOwner,
                repo: expected.githubRepository,
                repoId: 123,
                productionBranch: "master",
              },
              targets: { production: { id: "dpl_current" } },
            })
          : base(url),
    })).rejects.toMatchObject({ code: "wrong_identity" });
  });

  it.each([
    [undefined, 200, "credentials_unavailable"],
    ["token", 401, "authentication_failed"],
    ["token", 403, "authorization_failed"],
    ["token", 404, "resource_missing"],
    ["token", 429, "rate_limited"],
    ["token", 500, "network_failure"],
  ])("classifies credential/provider failure token=%s status=%s", async (token, status, code) => {
    await expect(verifyVercelProductionDeployment({
      expectedCommit: COMMIT,
      expected,
      token,
      fetcher: async () => json({ secret: "must-not-leak" }, status),
    })).rejects.toMatchObject({ code });
  });

  it("never retains token or provider response secrets in failures", async () => {
    const token = "token-must-not-leak";
    try {
      await verifyVercelProductionDeployment({
        expectedCommit: COMMIT,
        expected,
        token,
        fetcher: async () => json({ secret: "response-must-not-leak" }, 500),
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(String(error)).toBe("ProviderVerificationError: network_failure");
      expect(JSON.stringify(error)).not.toContain(token);
      expect(JSON.stringify(error)).not.toContain("response-must-not-leak");
    }
  });
});

describe("GitHub exact-head disposable adapter", () => {
  it("accepts one authenticated exact-head workflow artifact", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient(),
      now: () => NOW,
    })).resolves.toMatchObject({
      authenticated: true,
      artifactId: "200",
      commitSha: COMMIT,
    });
  });

  it("rejects a rejected PR head even when migration bytes match", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({
        getRun: async () => ({
          id: 100,
          path: FINISHER_DISPOSABLE_WORKFLOW,
          event: "pull_request",
          head_branch: "feature",
          head_sha: COMMIT,
          status: "completed",
          conclusion: "success",
          run_attempt: 1,
        }),
      }),
    })).rejects.toMatchObject({ code: "wrong_commit" });
  });

  it("rejects a different repository or default branch", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({
        getRepository: async () => ({
          full_name: "attacker/trainer-app",
          default_branch: "main",
        }),
      }),
    })).rejects.toMatchObject({ code: "wrong_identity" });
  });

  it("rejects the wrong workflow and unsuccessful run conclusion", async () => {
    for (const [run, code] of [
      [{
        id: 100,
        path: ".github/workflows/other.yml",
        event: "workflow_dispatch",
        head_branch: "master",
        head_sha: COMMIT,
        status: "completed",
        conclusion: "success",
        run_attempt: 1,
      }, "wrong_commit"],
      [{
        id: 100,
        path: FINISHER_DISPOSABLE_WORKFLOW,
        event: "workflow_dispatch",
        head_branch: "master",
        head_sha: COMMIT,
        status: "completed",
        conclusion: "failure",
        run_attempt: 1,
      }, "not_ready"],
    ] as const) {
      await expect(verifyGitHubDisposableEvidence({
        runId: "100",
        expectedCommit: COMMIT,
        client: githubClient({ getRun: async () => run }),
      })).rejects.toMatchObject({ code });
    }
  });

  it("rejects expired artifacts", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({
        getArtifacts: async () => ({
          artifacts: [{
            id: 200,
            name: "finisher-disposable-evidence",
            expired: true,
            size_in_bytes: 4096,
            digest: `sha256:${"d".repeat(64)}`,
            workflow_run: { id: 100, head_sha: COMMIT },
          }],
        }),
      }),
    })).rejects.toMatchObject({ code: "resource_missing" });
  });

  it("rejects duplicate artifacts", async () => {
    const duplicate = {
      id: 200,
      name: "finisher-disposable-evidence",
      expired: false,
      size_in_bytes: 4096,
      digest: `sha256:${"d".repeat(64)}`,
      workflow_run: { id: 100, head_sha: COMMIT },
    };
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({ getArtifacts: async () => ({ artifacts: [duplicate, duplicate] }) }),
    })).rejects.toMatchObject({ code: "resource_missing" });
  });

  it("rejects malformed caller-authored artifact content", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({ downloadEvidence: async () => ({ ...artifactEvidence(), claimedSuccess: true }) }),
    })).rejects.toMatchObject({ code: "malformed_provider_response" });
  });

  it("rejects stale attempts and oversized artifacts", async () => {
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({
        getRun: async () => ({
          id: 100,
          path: FINISHER_DISPOSABLE_WORKFLOW,
          event: "workflow_dispatch",
          head_branch: "master",
          head_sha: COMMIT,
          status: "completed",
          conclusion: "success",
          run_attempt: 2,
        }),
      }),
    })).rejects.toMatchObject({ code: "wrong_commit" });

    const oversized = {
      id: 200,
      name: "finisher-disposable-evidence",
      expired: false,
      size_in_bytes: 64 * 1024 + 1,
      digest: `sha256:${"d".repeat(64)}`,
      workflow_run: { id: 100, head_sha: COMMIT },
    };
    await expect(verifyGitHubDisposableEvidence({
      runId: "100",
      expectedCommit: COMMIT,
      client: githubClient({ getArtifacts: async () => ({ artifacts: [oversized] }) }),
    })).rejects.toMatchObject({ code: "malformed_provider_response" });
  });
});

describe("Supabase recovery capability adapter", () => {
  const requiredRecoveryAt = "2026-07-31T17:47:00.000Z";
  const unix = (value: string) => Date.parse(value) / 1_000;
  const inventory = (overrides: Record<string, unknown> = {}) => ({
    region: "us-east-1",
    walg_enabled: true,
    pitr_enabled: true,
    backups: [],
    physical_backup_data: {
      earliest_physical_backup_date_unix: unix("2026-07-31T17:00:00.000Z"),
      latest_physical_backup_date_unix: unix("2026-07-31T17:50:00.000Z"),
    },
    ...overrides,
  });
  const fetcher = (backupInventory: Record<string, unknown>) =>
    async (url: string) =>
      new URL(url).pathname.endsWith("/database/backups")
        ? json(backupInventory)
        : json({ ref: "p".repeat(20), organization_id: "org_trainer" });

  it("accepts authenticated PITR coverage for the exact production project", async () => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory()),
      now: () => NOW,
    })).resolves.toMatchObject({
      pitrEnabled: true,
      earliestRecoveryAt: "2026-07-31T17:00:00.000Z",
      latestRecoveryAt: "2026-07-31T17:50:00.000Z",
      requiredRecoveryAt,
      retentionMarginMinutes: 47,
      coversRequiredRecoveryAt: true,
      coversRollout: true,
      verified: true,
    });
  });

  it.each([
    ["project", "q".repeat(20), "org_trainer"],
    ["organization", "p".repeat(20), "org_other"],
  ])("rejects provider identity from the wrong %s", async (_label, ref, organizationId) => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: async () => json({ ref, organization_id: organizationId }),
    })).rejects.toMatchObject({ code: "wrong_identity" });
  });

  it("rejects a caller-selected non-production database before provider access", async () => {
    let requests = 0;
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "other",
      requiredRecoveryAt,
      token: "token",
      fetcher: async () => {
        requests += 1;
        return json({});
      },
    })).rejects.toMatchObject({ code: "wrong_identity" });
    expect(requests).toBe(0);
  });

  it("reports daily-backup age and fails closed when PITR is disabled", async () => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({
        pitr_enabled: false,
        backups: [{
          id: 42,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-07-31T12:00:00.000Z",
        }],
      })),
      now: () => NOW,
    })).resolves.toMatchObject({
      pitrEnabled: false,
      walgEnabled: true,
      coversRequiredRecoveryAt: false,
      coversRollout: false,
      latestDailyBackupAt: "2026-07-31T12:00:00.000Z",
      dailyBackupAgeSeconds: 21_600,
      dailyBackupImplication:
        "restore_to_daily_snapshot_with_post_snapshot_write_loss",
      verified: false,
    });
  });

  it("does not treat a physical daily backup as PITR", async () => {
    const result = await inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({
        pitr_enabled: false,
        backups: [{
          id: 42,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-07-31T17:40:00.000Z",
        }],
      })),
      now: () => NOW,
    });
    expect(result).toMatchObject({ pitrEnabled: false, verified: false });
  });

  it("fails closed when the PITR window misses the required time", async () => {
    const result = await inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({
        physical_backup_data: {
          earliest_physical_backup_date_unix: unix("2026-07-31T17:00:00.000Z"),
          latest_physical_backup_date_unix: unix("2026-07-31T17:46:59.000Z"),
        },
      })),
      now: () => NOW,
    });
    expect(result).toMatchObject({
      coversRequiredRecoveryAt: false,
      coversRollout: false,
      verified: false,
    });
  });

  it("fails closed when coverage can expire before Gate A evidence", async () => {
    const result = await inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({
        physical_backup_data: {
          earliest_physical_backup_date_unix: unix("2026-07-31T17:30:00.000Z"),
          latest_physical_backup_date_unix: unix("2026-07-31T17:50:00.000Z"),
        },
      })),
      now: () => NOW,
    });
    expect(result).toMatchObject({
      retentionMarginMinutes: 17,
      coversRequiredRecoveryAt: true,
      coversRollout: false,
      verified: false,
    });
  });

  it("fails closed when the required pre-migration time has expired", async () => {
    const result = await inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({
        physical_backup_data: {
          earliest_physical_backup_date_unix: unix("2026-07-31T17:48:00.000Z"),
          latest_physical_backup_date_unix: unix("2026-07-31T17:50:00.000Z"),
        },
      })),
      now: () => NOW,
    });
    expect(result).toMatchObject({
      retentionMarginMinutes: 0,
      coversRequiredRecoveryAt: false,
      coversRollout: false,
      verified: false,
    });
  });

  it.each([
    [undefined, 200, "credentials_unavailable"],
    ["token", 401, "authentication_failed"],
    ["token", 403, "authorization_failed"],
    ["token", 500, "network_failure"],
  ] as const)("fails closed for provider access failure %#", async (token, status, code) => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token,
      fetcher: async () => json({}, status),
    })).rejects.toMatchObject({ code });
  });

  it("fails closed on a provider network failure", async () => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: async () => {
        throw new Error("offline");
      },
    })).rejects.toMatchObject({ code: "network_failure" });
  });

  it("rejects malformed provider recovery data", async () => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      requiredRecoveryAt,
      token: "token",
      fetcher: fetcher(inventory({ pitr_enabled: "yes" })),
    })).rejects.toMatchObject({ code: "malformed_provider_response" });
  });
});

describe("canonical Vercel write-pause initiation", () => {
  it("turns exact authorization into authenticated configuration and deployment operations", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const base = vercelFetcher();
    const result = await initiateVercelProductionWritePause({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      now: () => NOW,
      fetcher: async (url, init) => {
        requests.push({ url: new URL(url), init });
        return base(url, init);
      },
    });

    expect(result).toEqual({
      provider: "vercel",
      authenticated: true,
      teamId: expected.teamId,
      projectId: expected.projectId,
      environment: "production",
      commitSha: COMMIT,
      initiationAuthorizationId: "env_write_pause",
      initiationAuthorizedBy: "user_operator",
      initiationAuthorizedAt: "2026-07-31T17:46:00.000Z",
      initiationOperationId: "dpl_initiated",
      initiatedAt: "2026-07-31T17:46:30.000Z",
      mutationAttempted: true,
      provenance: "vercel_authenticated_mutation_responses",
    });
    const patchRequest = requests.find(({ init }) => init?.method === "PATCH");
    expect(patchRequest?.url.pathname).toBe(
      `/v9/projects/${expected.projectId}/env/env_write_pause`,
    );
    expect(JSON.parse(String(patchRequest?.init?.body))).toEqual({
      key: "TRAINER_WRITE_PAUSE",
      value: "enabled",
      type: "encrypted",
      target: ["production"],
    });
    const deploymentRequest = requests.find(({ init }) => init?.method === "POST");
    expect(deploymentRequest?.url.pathname).toBe("/v13/deployments");
    expect(deploymentRequest?.url.searchParams.get("teamId")).toBe(expected.teamId);
    expect(deploymentRequest?.url.searchParams.get("forceNew")).toBe("1");
    expect(JSON.parse(String(deploymentRequest?.init?.body))).toMatchObject({
      project: expected.projectId,
      target: "production",
      gitSource: { type: "github", repoId: "123", ref: "master", sha: COMMIT },
      meta: {
        trainerWritePauseAuthorizationId: "env_write_pause",
        trainerWritePauseAuthorizedBy: "user_operator",
        trainerWritePauseAuthorizedAt: "2026-07-31T17:46:00.000Z",
        trainerWritePauseContractVersion: "2",
      },
    });
  });

  it.each([
    ["synthetic operation ID", { postDeploymentId: "pause-operation" }, "malformed_provider_response"],
    ["wrong environment", { target: "preview" }, "wrong_identity"],
    ["future deployment", { createdAt: "2026-07-31T17:45:59.000Z" }, "wrong_identity"],
  ] as const)("rejects %s and restores the configuration intent", async (_label, options, code) => {
    const patchedValues: string[] = [];
    const base = vercelFetcher(options);
    await expect(initiateVercelProductionWritePause({
      expectedCommit: COMMIT,
      expected,
      token: "token",
      fetcher: async (url, init) => {
        if (init?.method === "PATCH") {
          patchedValues.push(JSON.parse(String(init.body)).value);
        }
        return base(url, init);
      },
    })).rejects.toMatchObject({ code });
    expect(patchedValues).toEqual(["enabled", "disabled"]);
  });
});

describe("production write-pause verifier", () => {
  function runtimeStatusBody() {
    return {
      schema: "trainer-production-write-status",
      version: 2,
      environment: "production",
      commitSha: COMMIT,
      deploymentId: "dpl_current",
      pauseOperationId: PAUSE_OPERATION_ID,
      status: "PAUSED",
      enforcement: "application_all_classified_write_paths",
      enforcementContractVersion: 2,
    };
  }

  function writePauseFetcher(
    body: ReturnType<typeof runtimeStatusBody>,
    configuration: Record<string, unknown> = {},
  ) {
    return async (url: string) =>
      new URL(url).host === "api.vercel.com"
        ? json({
            envs: [{
              id: "env_write_pause",
              key: "TRAINER_WRITE_PAUSE",
              type: "encrypted",
              target: ["production"],
              gitBranch: null,
              updatedAt: Date.parse("2026-07-31T17:46:00.000Z"),
              lastUpdatedBy: "user_operator",
              ...configuration,
            }],
            pagination: { next: null },
          })
        : json(body);
  }

  it("combines authenticated deployment identity with effective runtime enforcement", async () => {
    await expect(verifyProductionWritePause({
      deployment: deployment(),
      token: "token",
      now: () => NOW,
      fetcher: writePauseFetcher(runtimeStatusBody()),
    })).resolves.toMatchObject({
      verified: true,
      bypassPaths: [],
      initiationCapability: "provider_operation",
      initiationAuthorizationId: "env_write_pause",
      initiationAuthorizedBy: "user_operator",
      initiationAuthorizedAt: "2026-07-31T17:46:00.000Z",
      initiationOperationId: "dpl_current",
      establishedAt: NOW,
      verifiedAt: NOW,
    });
  });

  it.each([
    ["deployment", (body: ReturnType<typeof runtimeStatusBody>) => {
      body.deploymentId = "dpl_wrong";
    }],
    ["environment", (body: ReturnType<typeof runtimeStatusBody>) => {
      body.environment = "preview";
    }],
    ["commit", (body: ReturnType<typeof runtimeStatusBody>) => {
      body.commitSha = "b".repeat(40);
    }],
    ["pause operation", (body: ReturnType<typeof runtimeStatusBody>) => {
      body.pauseOperationId = "pause-wrong";
    }],
    ["enforcement version", (body: ReturnType<typeof runtimeStatusBody>) => {
      body.enforcementContractVersion = 1;
    }],
  ])("rejects wrong runtime %s evidence", async (_label, mutate) => {
    const body = runtimeStatusBody();
    mutate(body);
    await expect(
      verifyProductionWritePause({
        deployment: deployment(),
        token: "token",
        fetcher: writePauseFetcher(body),
      }),
    ).rejects.toMatchObject({ code: "not_ready" });
  });

  it("rejects configuration intent when runtime enforcement is not active", async () => {
    await expect(verifyProductionWritePause({
      deployment: deployment(),
      token: "token",
      fetcher: writePauseFetcher({
        ...runtimeStatusBody(),
        status: "ENABLED",
      }),
    })).rejects.toMatchObject({ code: "not_ready" });
  });

  it.each([
    ["missing authorization ID", { id: "" }, "malformed_provider_response"],
    ["wrong environment", { target: ["preview"] }, "wrong_identity"],
    ["different author", { lastUpdatedBy: "user_other" }, "wrong_identity"],
    ["stale authorization", { updatedAt: Date.parse("2026-07-31T17:00:00.000Z") }, "wrong_identity"],
  ])("rejects %s", async (_label, configuration, code) => {
    await expect(verifyProductionWritePause({
      deployment: deployment(),
      token: "token",
      fetcher: writePauseFetcher(runtimeStatusBody(), configuration),
    })).rejects.toMatchObject({ code });
  });

  it("verifies later restoration without authorizing it", async () => {
    await expect(verifyProductionWriteRestoration({
      deployment: deployment(),
      now: () => NOW,
      fetcher: async () => json({
        schema: "trainer-production-write-status",
        version: 2,
        environment: "production",
        commitSha: COMMIT,
        deploymentId: "dpl_current",
        pauseOperationId: PAUSE_OPERATION_ID,
        status: "ENABLED",
        enforcement: "application_all_classified_write_paths",
        enforcementContractVersion: 2,
      }),
    })).resolves.toMatchObject({
      runtimeStatus: "ENABLED",
      verified: true,
      authorizesRestoration: false,
    });
  });
});

it("uses fixed sanitized provider error codes", () => {
  expect(new ProviderVerificationError("authorization_failed").message).toBe("authorization_failed");
});
