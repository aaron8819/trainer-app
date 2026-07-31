import { lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  disposableEvidenceSchema,
  FINISHER_DISPOSABLE_ARTIFACT,
  FINISHER_DISPOSABLE_WORKFLOW,
  FINISHER_PRODUCTION_DATABASE,
  type FinisherProviderVerification,
} from "./finisher-provider-verification";
import {
  FINISHER_PROVIDER_CONTRACT_VERSION,
  FINISHER_PROVIDER_EVIDENCE_SCHEMA,
  FINISHER_PROVIDER_EVIDENCE_VERSION,
  FINISHER_PROVIDER_TOOL_VERSION,
} from "./finisher-provider-verification";

const MAX_DISPOSABLE_ARTIFACT_BYTES = 64 * 1024;

export type ProviderFailureCode =
  | "credentials_unavailable"
  | "authentication_failed"
  | "authorization_failed"
  | "rate_limited"
  | "network_failure"
  | "resource_missing"
  | "wrong_identity"
  | "wrong_commit"
  | "source_binding_unavailable"
  | "not_ready"
  | "stale_alias"
  | "malformed_provider_response"
  | "capability_unavailable";

export class ProviderVerificationError extends Error {
  constructor(readonly code: ProviderFailureCode) {
    super(code);
    this.name = "ProviderVerificationError";
  }
}

type JsonFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  return value;
}

function sourceString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderVerificationError("source_binding_unavailable");
  }
  return value;
}

function sourceIdentifier(value: unknown): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !String(value).trim()
  ) {
    throw new ProviderVerificationError("source_binding_unavailable");
  }
  return String(value);
}

function timestamp(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const parsed = typeof value === "string" ? Date.parse(value) : numeric;
  if (!Number.isFinite(parsed)) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  return new Date(parsed).toISOString();
}

async function providerJson(input: {
  url: URL;
  token: string | undefined;
  fetcher: JsonFetcher;
}): Promise<Record<string, unknown>> {
  if (!input.token) throw new ProviderVerificationError("credentials_unavailable");
  let response: Response;
  try {
    response = await input.fetcher(input.url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.token}`,
      },
    });
  } catch {
    throw new ProviderVerificationError("network_failure");
  }
  if (response.status === 401) throw new ProviderVerificationError("authentication_failed");
  if (response.status === 403) throw new ProviderVerificationError("authorization_failed");
  if (response.status === 404) throw new ProviderVerificationError("resource_missing");
  if (response.status === 429) throw new ProviderVerificationError("rate_limited");
  if (response.status >= 500) throw new ProviderVerificationError("network_failure");
  if (response.status !== 200) throw new ProviderVerificationError("malformed_provider_response");
  try {
    return object(await response.json());
  } catch (error) {
    if (error instanceof ProviderVerificationError) throw error;
    throw new ProviderVerificationError("malformed_provider_response");
  }
}

function vercelUrl(path: string, query: Record<string, string> = {}): URL {
  const url = new URL(path, "https://api.vercel.com");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

export async function verifyVercelProductionDeployment(input: {
  expectedCommit: string;
  expected: {
    githubOwner: string;
    githubRepository: string;
    teamId: string;
    teamSlug: string;
    projectId: string;
    projectName: string;
    productionAlias: string;
  };
  token?: string;
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<FinisherProviderVerification["deployment"]> {
  const fetcher = input.fetcher ?? fetch;
  const request = (url: URL) => providerJson({ url, token: input.token, fetcher });
  const userResponse = await request(vercelUrl("/v2/user"));
  const user = object(userResponse.user ?? userResponse);
  const account = string(user.username ?? user.name);
  const teamsResponse = await request(vercelUrl("/v2/teams", { limit: "100" }));
  const teams = teamsResponse.teams;
  if (!Array.isArray(teams)) throw new ProviderVerificationError("malformed_provider_response");
  const teamMatches = teams.filter((item) => object(item).id === input.expected.teamId);
  if (teamMatches.length !== 1) throw new ProviderVerificationError("wrong_identity");
  const team = await request(vercelUrl(`/v2/teams/${input.expected.teamId}`));
  if (team.id !== input.expected.teamId || team.slug !== input.expected.teamSlug) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const project = await request(
    vercelUrl(`/v9/projects/${input.expected.projectId}`, {
      teamId: input.expected.teamId,
    }),
  );
  if (
    project.id !== input.expected.projectId ||
    project.name !== input.expected.projectName ||
    project.accountId !== input.expected.teamId
  ) {
    throw new ProviderVerificationError("wrong_identity");
  }
  if (project.link == null) {
    throw new ProviderVerificationError("source_binding_unavailable");
  }
  const projectLink = object(project.link);
  const linkedRepositoryId = sourceIdentifier(projectLink.repoId);
  const linkedOwner = sourceString(projectLink.org);
  const linkedRepository = sourceString(projectLink.repo);
  const linkedProductionBranch = sourceString(projectLink.productionBranch);
  if (
    projectLink.type !== "github" ||
    linkedOwner !== input.expected.githubOwner ||
    linkedRepository !== input.expected.githubRepository ||
    linkedProductionBranch !== "master"
  ) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const targets = object(project.targets);
  const productionTarget = object(targets.production);
  const alias = await request(
    vercelUrl(`/v4/aliases/${input.expected.productionAlias}`, {
      projectId: input.expected.projectId,
      teamId: input.expected.teamId,
    }),
  );
  if (alias.alias !== input.expected.productionAlias || alias.projectId !== input.expected.projectId) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const deploymentId = string(alias.deploymentId);
  if (productionTarget.id !== deploymentId) {
    throw new ProviderVerificationError("stale_alias");
  }
  const deployment = await request(
    vercelUrl(`/v13/deployments/${deploymentId}`, {
      teamId: input.expected.teamId,
    }),
  );
  const observedDeploymentId = string(deployment.id ?? deployment.uid);
  if (
    observedDeploymentId !== deploymentId ||
    deployment.projectId !== input.expected.projectId ||
    deployment.name !== input.expected.projectName ||
    deployment.target !== "production"
  ) {
    throw new ProviderVerificationError("stale_alias");
  }
  if ((deployment.readyState ?? deployment.state) !== "READY") {
    throw new ProviderVerificationError("not_ready");
  }
  if (deployment.gitSource == null || deployment.meta == null) {
    throw new ProviderVerificationError("source_binding_unavailable");
  }
  const gitSource = object(deployment.gitSource);
  const sourceCommit = sourceString(gitSource.sha).toLowerCase();
  const sourceProvider = sourceString(gitSource.type);
  const sourceBranch = sourceString(gitSource.ref);
  if (
    sourceProvider !== "github" ||
    sourceIdentifier(gitSource.repoId) !== linkedRepositoryId ||
    sourceBranch !== "master"
  ) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const meta = object(deployment.meta);
  const metadataCommit = sourceString(meta.githubCommitSha).toLowerCase();
  if (sourceCommit !== input.expectedCommit || metadataCommit !== sourceCommit) {
    throw new ProviderVerificationError("wrong_commit");
  }
  return {
    provider: "vercel",
    authenticated: true,
    account,
    teamId: input.expected.teamId,
    teamSlug: input.expected.teamSlug,
    projectId: input.expected.projectId,
    projectName: input.expected.projectName,
    environment: "production",
    alias: input.expected.productionAlias,
    deploymentId,
    state: "READY",
    sourceProvider: "github",
    sourceRepository: `${input.expected.githubOwner}/${input.expected.githubRepository}`,
    sourceBranch: "master",
    sourceCommit,
    createdAt: timestamp(deployment.createdAt ?? deployment.created),
    readyAt: timestamp(deployment.ready),
    aliasObservedAt: input.now?.() ?? new Date().toISOString(),
    verifiedAt: input.now?.() ?? new Date().toISOString(),
    provenance: "vercel_authenticated_read_only_rest",
  };
}

export interface GitHubDisposableClient {
  getRepository(): Promise<unknown>;
  getRun(runId: string): Promise<unknown>;
  getDefaultBranch(): Promise<unknown>;
  getArtifacts(runId: string): Promise<unknown>;
  downloadEvidence(runId: string, artifactName: string): Promise<unknown>;
}

export async function verifyGitHubDisposableEvidence(input: {
  runId: string;
  expectedCommit: string;
  client: GitHubDisposableClient;
  now?: () => string;
}): Promise<FinisherProviderVerification["disposable"]> {
  if (!/^[1-9][0-9]*$/.test(input.runId)) {
    throw new ProviderVerificationError("resource_missing");
  }
  const repository = object(await input.client.getRepository());
  if (
    repository.full_name !== "aaron8819/trainer-app" ||
    repository.default_branch !== "master"
  ) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const run = object(await input.client.getRun(input.runId));
  const defaultBranch = object(await input.client.getDefaultBranch());
  const branchCommit = object(defaultBranch.commit);
  if (
    run.id?.toString() !== input.runId ||
    run.path !== FINISHER_DISPOSABLE_WORKFLOW ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "master" ||
    run.head_sha !== input.expectedCommit ||
    branchCommit.sha !== input.expectedCommit
  ) {
    throw new ProviderVerificationError("wrong_commit");
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new ProviderVerificationError("not_ready");
  }
  const artifactsResponse = object(await input.client.getArtifacts(input.runId));
  const artifacts = artifactsResponse.artifacts;
  if (!Array.isArray(artifacts)) throw new ProviderVerificationError("malformed_provider_response");
  const matches = artifacts.filter((item) => object(item).name === FINISHER_DISPOSABLE_ARTIFACT);
  if (matches.length !== 1) throw new ProviderVerificationError("resource_missing");
  const artifact = object(matches[0]);
  if (artifact.expired === true || artifact.workflow_run == null) {
    throw new ProviderVerificationError("resource_missing");
  }
  const artifactSize = Number(artifact.size_in_bytes);
  if (
    !Number.isSafeInteger(artifactSize) ||
    artifactSize <= 0 ||
    artifactSize > MAX_DISPOSABLE_ARTIFACT_BYTES
  ) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  const workflowRun = object(artifact.workflow_run);
  if (workflowRun.id?.toString() !== input.runId || workflowRun.head_sha !== input.expectedCommit) {
    throw new ProviderVerificationError("wrong_commit");
  }
  const digest = string(artifact.digest).replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  const evidence = disposableEvidenceSchema.safeParse(
    await input.client.downloadEvidence(input.runId, FINISHER_DISPOSABLE_ARTIFACT),
  );
  if (!evidence.success) throw new ProviderVerificationError("malformed_provider_response");
  if (
    evidence.data.workflowRunId !== input.runId ||
    evidence.data.workflowRunAttempt !== run.run_attempt ||
    evidence.data.commitSha !== input.expectedCommit
  ) {
    throw new ProviderVerificationError("wrong_commit");
  }
  return {
    ...evidence.data,
    authenticated: true,
    artifactId: string(artifact.id?.toString()),
    artifactDigest: digest,
    verifiedAt: input.now?.() ?? new Date().toISOString(),
    provenance: "github_authenticated_actions_artifact",
  };
}

export function createGhDisposableClient(): GitHubDisposableClient {
  const ghJson = (args: string[]): unknown => {
    const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
    if ((result.status ?? 1) !== 0) {
      const stderr = result.stderr ?? "";
      if (/authentication|not logged|401/i.test(stderr)) {
        throw new ProviderVerificationError("authentication_failed");
      }
      if (/403|forbidden/i.test(stderr)) {
        throw new ProviderVerificationError("authorization_failed");
      }
      if (/429|rate limit/i.test(stderr)) {
        throw new ProviderVerificationError("rate_limited");
      }
      throw new ProviderVerificationError("network_failure");
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new ProviderVerificationError("malformed_provider_response");
    }
  };
  return {
    getRepository: async () => ghJson(["api", "repos/aaron8819/trainer-app"]),
    getRun: async (runId) => ghJson(["api", `repos/aaron8819/trainer-app/actions/runs/${runId}`]),
    getDefaultBranch: async () => ghJson(["api", "repos/aaron8819/trainer-app/branches/master"]),
    getArtifacts: (runId) =>
      Promise.resolve(ghJson(["api", `repos/aaron8819/trainer-app/actions/runs/${runId}/artifacts`])),
    downloadEvidence: async (runId, artifactName) => {
      const directory = join(tmpdir(), `trainer-finisher-artifact-${randomUUID()}`);
      try {
        const result = spawnSync(
          "gh",
          ["run", "download", runId, "--repo", "aaron8819/trainer-app", "--name", artifactName, "--dir", directory],
          { encoding: "utf8", windowsHide: true },
        );
        if ((result.status ?? 1) !== 0) throw new ProviderVerificationError("network_failure");
        const files = readdirSync(directory);
        if (files.length !== 1 || files[0] !== "finisher-disposable-evidence.json") {
          throw new ProviderVerificationError("malformed_provider_response");
        }
        const evidencePath = join(directory, files[0]);
        const evidenceFile = lstatSync(evidencePath);
        if (
          !evidenceFile.isFile() ||
          evidenceFile.size <= 0 ||
          evidenceFile.size > MAX_DISPOSABLE_ARTIFACT_BYTES
        ) {
          throw new ProviderVerificationError("malformed_provider_response");
        }
        return JSON.parse(readFileSync(evidencePath, "utf8"));
      } catch (error) {
        if (error instanceof ProviderVerificationError) throw error;
        throw new ProviderVerificationError("malformed_provider_response");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

export async function inspectSupabaseRecoveryCapability(input: {
  organizationId: string;
  projectRef: string;
  database: string;
  token?: string;
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<FinisherProviderVerification["recoveryPoint"]> {
  if (input.database !== FINISHER_PRODUCTION_DATABASE) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const fetcher = input.fetcher ?? fetch;
  const request = (path: string) =>
    providerJson({
      url: new URL(path, "https://api.supabase.com"),
      token: input.token,
      fetcher,
    });
  const project = await request(`/v1/projects/${input.projectRef}`);
  if (
    (project.ref ?? project.id) !== input.projectRef ||
    project.organization_id !== input.organizationId
  ) {
    throw new ProviderVerificationError("wrong_identity");
  }
  const backupInventory = await request(
    `/v1/projects/${input.projectRef}/database/backups`,
  );
  const backups = backupInventory.backups;
  if (!Array.isArray(backups)) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  const completed = backups
    .map((entry) => object(entry))
    .filter((entry) => entry.status === "COMPLETED" && entry.id != null)
    .sort((left, right) =>
      Date.parse(string(right.inserted_at)) - Date.parse(string(left.inserted_at)),
    );
  const latest = completed[0];
  return {
    provider: "supabase",
    authenticated: true,
    organizationId: input.organizationId,
    projectRef: input.projectRef,
    database: FINISHER_PRODUCTION_DATABASE,
    creationCapability: "unavailable_no_authoritative_creation_api",
    creationAuthorizedAt: null,
    operationId: null,
    resourceId: latest ? string(String(latest.id)) : null,
    state: latest ? "COMPLETED" : "UNAVAILABLE",
    recoveryRequirement: "unproven",
    checkpointAt: null,
    providerCreatedAt: latest ? timestamp(latest.inserted_at) : null,
    verifiedAt: input.now?.() ?? new Date().toISOString(),
    verified: false,
    provenance: "supabase_authenticated_management_api",
    limitation:
      "Supabase exposes authenticated backup inventory and restore operations, but no authoritative on-demand recovery-point creation operation.",
  };
}

async function readProductionWriteStatus(input: {
  deployment: FinisherProviderVerification["deployment"];
  expectedStatus: "PAUSED" | "ENABLED";
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<{ verifiedAt: string }> {
  const fetcher = input.fetcher ?? fetch;
  const url = new URL(
    "/api/operations/write-status",
    `https://${input.deployment.alias}`,
  );
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ProviderVerificationError("network_failure");
  }
  if (response.status !== 200) throw new ProviderVerificationError("not_ready");
  let body: Record<string, unknown>;
  try {
    body = object(await response.json());
  } catch (error) {
    if (error instanceof ProviderVerificationError) throw error;
    throw new ProviderVerificationError("malformed_provider_response");
  }
  const exactKeys = [
    "commitSha",
    "enforcement",
    "environment",
    "schema",
    "status",
    "version",
  ];
  if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(exactKeys)) {
    throw new ProviderVerificationError("malformed_provider_response");
  }
  if (
    body.schema !== "trainer-production-write-status" ||
    body.version !== 1 ||
    body.environment !== "production" ||
    body.commitSha !== input.deployment.sourceCommit ||
    body.status !== input.expectedStatus ||
    body.enforcement !== "application_all_classified_write_paths"
  ) {
    throw new ProviderVerificationError("not_ready");
  }
  return { verifiedAt: input.now?.() ?? new Date().toISOString() };
}

export async function verifyProductionWritePause(input: {
  deployment: FinisherProviderVerification["deployment"];
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<FinisherProviderVerification["writePause"]> {
  const { verifiedAt } = await readProductionWriteStatus({
    ...input,
    expectedStatus: "PAUSED",
  });
  return {
    provider: "vercel_application",
    authenticatedProvider: true,
    teamId: input.deployment.teamId,
    projectId: input.deployment.projectId,
    environment: "production",
    deploymentId: input.deployment.deploymentId,
    commitSha: input.deployment.sourceCommit,
    enforcement: "application_all_classified_write_paths",
    initiationCapability:
      "unavailable_requires_authorized_environment_update_and_redeployment",
    initiationAuthorizedAt: null,
    initiationOperationId: null,
    initiationObservedAt: input.deployment.createdAt,
    establishedAt: input.deployment.readyAt,
    runtimeStatus: "PAUSED",
    runtimeContractVersion: 1,
    mutationCoverageVerified: true,
    bypassPaths: [],
    verifiedAt,
    verified: true,
    provenance: "vercel_authenticated_deployment_plus_runtime_read_only",
  };
}

export type ProductionWriteRestorationVerification = {
  provider: "vercel_application";
  authenticatedProvider: true;
  teamId: string;
  projectId: string;
  environment: "production";
  deploymentId: string;
  commitSha: string;
  runtimeStatus: "ENABLED";
  verifiedAt: string;
  verified: true;
  authorizesRestoration: false;
  provenance: "vercel_authenticated_deployment_plus_runtime_read_only";
};

export async function verifyProductionWriteRestoration(input: {
  deployment: FinisherProviderVerification["deployment"];
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<ProductionWriteRestorationVerification> {
  const { verifiedAt } = await readProductionWriteStatus({
    ...input,
    expectedStatus: "ENABLED",
  });
  return {
    provider: "vercel_application",
    authenticatedProvider: true,
    teamId: input.deployment.teamId,
    projectId: input.deployment.projectId,
    environment: "production",
    deploymentId: input.deployment.deploymentId,
    commitSha: input.deployment.sourceCommit,
    runtimeStatus: "ENABLED",
    verifiedAt,
    verified: true,
    authorizesRestoration: false,
    provenance: "vercel_authenticated_deployment_plus_runtime_read_only",
  };
}

export async function collectFinisherProviderVerification(input: {
  requiredApplicationCommit: string;
  disposableRunId: string;
  target: FinisherProviderVerification["target"];
  vercelToken?: string;
  supabaseToken?: string;
  githubClient?: GitHubDisposableClient;
  fetcher?: JsonFetcher;
  now?: () => string;
}): Promise<FinisherProviderVerification> {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? (() => new Date().toISOString());
  const deployment = await verifyVercelProductionDeployment({
    expectedCommit: input.requiredApplicationCommit,
    expected: {
      githubOwner: input.target.githubOwner,
      githubRepository: input.target.githubRepository,
      teamId: input.target.vercelTeamId,
      teamSlug: input.target.vercelTeamSlug,
      projectId: input.target.vercelProjectId,
      projectName: input.target.vercelProjectName,
      productionAlias: input.target.productionAlias,
    },
    token: input.vercelToken,
    fetcher,
    now,
  });
  const disposable = await verifyGitHubDisposableEvidence({
    runId: input.disposableRunId,
    expectedCommit: input.requiredApplicationCommit,
    client: input.githubClient ?? createGhDisposableClient(),
    now,
  });
  const recoveryPoint = await inspectSupabaseRecoveryCapability({
    organizationId: input.target.supabaseOrganizationId,
    projectRef: input.target.supabaseProjectRef,
    database: input.target.database,
    token: input.supabaseToken,
    fetcher,
    now,
  });
  const writePause = await verifyProductionWritePause({ deployment, fetcher, now });
  return {
    schema: FINISHER_PROVIDER_EVIDENCE_SCHEMA,
    version: FINISHER_PROVIDER_EVIDENCE_VERSION,
    contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
    toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
    authority: "canonical_live_provider_verification",
    requiredApplicationCommit: input.requiredApplicationCommit,
    migration: disposable.migration,
    target: input.target,
    applicationCompatibilityState: "compatible_with_write_boundary",
    deployment,
    disposable,
    recoveryPoint,
    writePause,
    verifiedAt: now(),
    failureDetails: recoveryPoint.limitation ? [recoveryPoint.limitation] : [],
  };
}
