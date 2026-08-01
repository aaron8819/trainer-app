import { describe, expect, it } from "vitest";
import {
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
  `trainer-write-pause:${expected.projectId}:${COMMIT}`;

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
} = {}) {
  return async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/v2/user") return json({ user: { username: "operator" } });
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
    if (path.startsWith("/v13/deployments/")) {
      return json({
        id: options.deploymentId ?? "dpl_current",
        projectId: expected.projectId,
        name: expected.projectName,
        target: options.target ?? "production",
        readyState: "READY",
        createdAt: Date.parse("2026-07-31T17:30:00.000Z"),
        ready: Date.parse("2026-07-31T17:31:00.000Z"),
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
        meta: { githubCommitSha: options.commit ?? COMMIT },
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
    teamId: expected.teamId,
    teamSlug: expected.teamSlug,
    projectId: expected.projectId,
    projectName: expected.projectName,
    environment: "production",
    alias: expected.productionAlias,
    deploymentId: "dpl_current",
    state: "READY",
    sourceProvider: "github",
    sourceRepository: "aaron8819/trainer-app",
    sourceBranch: "master",
    sourceCommit: COMMIT,
    createdAt: "2026-07-31T17:30:00.000Z",
    readyAt: "2026-07-31T17:31:00.000Z",
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
  it("authenticates exact project backup inventory but fails closed on creation capability", async () => {
    const fetcher = async (url: string) =>
      new URL(url).pathname.endsWith("/database/backups")
        ? json({ backups: [{ id: 42, status: "COMPLETED", inserted_at: "2026-07-31T17:40:00.000Z" }] })
        : json({ ref: "p".repeat(20), organization_id: "org_trainer" });
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      token: "token",
      fetcher,
      now: () => NOW,
    })).resolves.toMatchObject({
      resourceId: "42",
      state: "COMPLETED",
      creationCapability: "unavailable_no_authoritative_creation_api",
      verified: false,
    });
  });

  it("rejects a backup attached to the wrong project/account", async () => {
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "postgres",
      token: "token",
      fetcher: async () => json({ ref: "q".repeat(20), organization_id: "org_other" }),
    })).rejects.toMatchObject({ code: "wrong_identity" });
  });

  it("rejects a caller-selected non-production database before provider access", async () => {
    let requests = 0;
    await expect(inspectSupabaseRecoveryCapability({
      organizationId: "org_trainer",
      projectRef: "p".repeat(20),
      database: "other",
      token: "token",
      fetcher: async () => {
        requests += 1;
        return json({});
      },
    })).rejects.toMatchObject({ code: "wrong_identity" });
    expect(requests).toBe(0);
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

  it("combines authenticated deployment identity with effective runtime enforcement", async () => {
    await expect(verifyProductionWritePause({
      deployment: deployment(),
      now: () => NOW,
      fetcher: async () => json({
        schema: "trainer-production-write-status",
        version: 2,
        environment: "production",
        commitSha: COMMIT,
        deploymentId: "dpl_current",
        pauseOperationId: PAUSE_OPERATION_ID,
        status: "PAUSED",
        enforcement: "application_all_classified_write_paths",
        enforcementContractVersion: 2,
      }),
    })).resolves.toMatchObject({
      verified: true,
      bypassPaths: [],
      initiationCapability:
        "unavailable_requires_authorized_environment_update_and_redeployment",
      initiationAuthorizedAt: null,
      initiationOperationId: null,
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
        fetcher: async () => json(body),
      }),
    ).rejects.toMatchObject({ code: "not_ready" });
  });

  it("rejects configuration intent when runtime enforcement is not active", async () => {
    await expect(verifyProductionWritePause({
      deployment: deployment(),
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
    })).rejects.toMatchObject({ code: "not_ready" });
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
