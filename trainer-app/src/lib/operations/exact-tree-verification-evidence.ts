import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DATABASE_TARGET_ENV_VARS,
  selectTestSuitesByEnvironment,
  type TestSuiteEnvironmentManifest,
} from "./test-environment-preflight";
import type {
  VitestFailureKind,
  VitestPhaseResult,
} from "./credential-free-inventory-runner";
import {
  CREDENTIAL_FREE_SHARD_COUNT,
  CREDENTIAL_SAFE_PROFILE,
  MAX_INVENTORY_AGGREGATE_DURATION_MS,
  MAX_INVENTORY_COMPONENT_DURATION_MS,
  isBoundedDurationMs,
  isNonNegativeSafeInteger,
  sumBoundedDurationsMs,
  sumNonNegativeSafeIntegers,
  validateCredentialFreeAggregate,
  type CredentialFreeAggregateValidation,
  type CredentialFreeShardSummary,
  type ImportSafetySummary,
} from "./credential-free-inventory-sharding";

export const CREDENTIAL_FREE_CHECK_ID = "credential-free-inventory" as const;
export const VERIFICATION_EVIDENCE_SCHEMA = "trainer-verification-evidence" as const;
export const VERIFICATION_EVIDENCE_VERSION = 1 as const;
export const SHARDED_VERIFICATION_EVIDENCE_VERSION = 2 as const;
export const CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH =
  "artifacts/credential-free-inventory/evidence/credential-free-inventory-evidence.json";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const NODE_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const TOOL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const GITHUB_RUN_NUMBER_PATTERN = /^[1-9]\d*$/;
const GITHUB_EVENT_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const GITHUB_JOB_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
// Aggregation only parses five small summaries; one day is deliberately generous
// while preventing a hostile aggregate duration from escaping into evidence.
const MAX_AGGREGATE_VALIDATION_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_SHARDED_TOTAL_DURATION_MS =
  MAX_INVENTORY_COMPONENT_DURATION_MS + MAX_AGGREGATE_VALIDATION_DURATION_MS;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type VerificationQualification = {
  kind: "single-isolated-timeout";
  originalFailure: {
    file: string;
    test: string | null;
    reporterComplete: true;
  };
  retry: {
    status: "pass";
    treeSha: string;
  };
  recurrence: {
    sameTestOccurrences: number;
    blocked: boolean;
  };
};

export type VerificationDefinition = {
  hash: string;
  packageScript: string;
  nodeMajor: number;
  workers: number;
  inputs: Array<{ path: string; sha256: string }>;
  policy: CanonicalValue;
  lockfileHash: string;
};

export type RepositoryDirtyCategory = "tracked" | "staged" | "untracked";

export type CurrentRepositoryState = {
  commitSha: string;
  treeSha: string;
  worktreeClean: boolean;
  dirtyPaths: Array<{
    path: string;
    categories: RepositoryDirtyCategory[];
  }>;
};

export type CredentialFreeVerificationEvidence = {
  schema: typeof VERIFICATION_EVIDENCE_SCHEMA;
  schemaVersion:
    | typeof VERIFICATION_EVIDENCE_VERSION
    | typeof SHARDED_VERIFICATION_EVIDENCE_VERSION;
  checkId: typeof CREDENTIAL_FREE_CHECK_ID;
  hermetic: true;
  checkedOutCommitSha: string;
  treeSha: string;
  repositoryState: {
    worktreeClean: boolean;
  };
  prHeadSha: string | null;
  prHeadTreeSha: string | null;
  prHeadTreeMatchesTestedTree: boolean | null;
  mergeRefSha: string | null;
  mergeRefTreeSha: string | null;
  baseRef: string | null;
  baseSha: string | null;
  verificationDefinitionHash: string;
  verificationDefinition: VerificationDefinition;
  classificationHash: string;
  lockfileHash: string;
  status: "pass" | "qualified_pass" | "fail";
  qualification: VerificationQualification | null;
  counts: {
    filesDiscovered: number;
    filesSelected: number;
    filesExecuted: number;
    filesPassed: number;
    filesSkipped: number;
    filesFailed: number;
    testsCollected: number;
    testsPassed: number;
    testsSkipped: number;
    testsFailed: number;
    databaseRequiredExcluded: number;
  };
  durations: {
    totalMs: number;
    credentialFreeMs: number | null;
    importOnlyMs: number | null;
    aggregateMs?: number;
    criticalPathMs?: number;
    componentTotalMs?: number;
  };
  importSafety: {
    status: "pass" | "fail" | "not_run";
    connectionAttempted: boolean;
  };
  failure: {
    phase: string;
    kind: VitestFailureKind | "classification" | "dependency-readiness" | "unexpected";
    reporterComplete: boolean;
    selectedCoverageCompleted: boolean;
    failures: Array<{ file: string; test: string | null; message: string }>;
    retryEligibility: {
      eligible: boolean;
      reason: string;
      file: string | null;
      test: string | null;
    };
  } | null;
  environment: {
    os: string;
    architecture: string;
    node: string;
    vitest: string;
    timezone: string;
    workers: 1;
    pool?: "forks";
    isolation?: true;
    runnerImage: string | null;
  };
  run: {
    repository: string | null;
    workflow: string | null;
    runId: string | null;
    runAttempt: string | null;
    job: string | null;
    url: string | null;
  };
  completedAt: string;
  executionTopology?: {
    kind: "sharded";
    credentialFree: {
      shardCount: typeof CREDENTIAL_FREE_SHARD_COUNT;
      components: CredentialFreeShardSummary[];
    };
    importSafety: ImportSafetySummary;
    coverage: CredentialFreeAggregateValidation["coverage"];
  };
};

export type CredentialFreeEvidenceRunInput = {
  projectRoot: string;
  manifest: TestSuiteEnvironmentManifest;
  filesDiscovered: number;
  credentialFreeSelected: number;
  importOnlySelected: number;
  databaseRequiredExcluded: number;
  credentialFreeResult: VitestPhaseResult | null;
  importOnlyResult: VitestPhaseResult | null;
  placeholderConnectionAttempted: boolean;
  exitCode: number;
  failureStage?: "classification" | "dependency-readiness" | "unexpected";
  failureMessage?: string;
  qualification?: VerificationQualification | null;
  totalDurationMs: number;
  baseRef?: string;
  environment?: NodeJS.ProcessEnv;
  completedAt?: string;
};

export type ShardedCredentialFreeEvidenceInput = {
  projectRoot: string;
  manifest: TestSuiteEnvironmentManifest;
  aggregate: CredentialFreeAggregateValidation;
  aggregateDurationMs: number;
  baseRef?: string;
  environment?: NodeJS.ProcessEnv;
  completedAt?: string;
};

export type EvidenceReuseRequest = {
  checkId: string;
  currentRepositoryState: CurrentRepositoryState;
  verificationDefinitionHash: string;
  classificationHash: string;
  lockfileHash: string;
  toolchain: {
    nodeMajor: number;
    vitest: string;
    workers: number;
  };
  hermetic: boolean;
  allowQualifiedPass: boolean;
  coverage?: {
    credentialFreeFiles: string[];
    importOnlyFiles: string[];
    databaseRequiredFiles: string[];
  };
};

export type EvidenceReuseDecision = {
  reusable: boolean;
  reason:
    | "reusable"
    | "non-hermetic-check"
    | "malformed-evidence"
    | "incomplete-evidence"
    | "current-repository-invalid"
    | "dirty-current-checkout"
    | "check-mismatch"
    | "tree-mismatch"
    | "definition-mismatch"
    | "classification-mismatch"
    | "lockfile-mismatch"
    | "incompatible-toolchain"
    | "failed-evidence"
    | "qualification-not-permitted"
    | "qualification-invalid";
};

export type ExactTreeEvidenceValidationResult =
  | { valid: true; evidence: CredentialFreeVerificationEvidence }
  | { valid: false; errors: string[] };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical evidence cannot hash non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  throw new Error(`Unsupported canonical evidence value: ${typeof value}.`);
}

function sha256(source: string | Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}

export function hashCanonicalValue(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function computeClassificationHash(
  manifest: TestSuiteEnvironmentManifest
): string {
  if (
    !manifest ||
    manifest.schema !== "trainer-test-suite-environments" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.suites)
  ) {
    throw new Error("Credential-free classification source is malformed.");
  }
  const seenPaths = new Set<string>();
  const suites = manifest.suites.map((suite) => {
    if (
      !suite ||
      typeof suite.path !== "string" ||
      suite.path.length === 0 ||
      suite.path !== suite.path.replaceAll("\\", "/") ||
      suite.path.startsWith("/") ||
      suite.path.split("/").includes("..") ||
      (suite.environment !== "db-required" &&
        suite.environment !== "import-only-placeholder") ||
      typeof suite.owner !== "string" ||
      suite.owner.length === 0 ||
      typeof suite.reason !== "string" ||
      suite.reason.length === 0
    ) {
      throw new Error("Credential-free classification source is malformed.");
    }
    if (seenPaths.has(suite.path)) {
      throw new Error(`Credential-free classification path is duplicated: ${suite.path}.`);
    }
    seenPaths.add(suite.path);
    if (
      suite.environment === "db-required" &&
      (typeof suite.commandId !== "string" ||
        suite.commandId.length === 0 ||
        typeof suite.packageScript !== "string" ||
        suite.packageScript.length === 0)
    ) {
      throw new Error(`Credential-free classification command is missing: ${suite.path}.`);
    }
    if (
      suite.environment === "import-only-placeholder" &&
      (suite.commandId !== undefined || suite.packageScript !== undefined)
    ) {
      throw new Error(`Import-only classification has a command: ${suite.path}.`);
    }
    return suite;
  });
  return hashCanonicalValue({
    schema: manifest.schema,
    version: manifest.version,
    suites: suites.sort((left, right) => compareText(left.path, right.path)),
  });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function gitValue(repositoryRoot: string, revision: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--verify", revision], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function normalizeRepositoryPath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("Repository path must be non-empty.");
  }
  const slashPath = relativePath.replaceAll("\\", "/");
  const normalized = path.posix.normalize(slashPath);
  if (
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Repository path is not a safe relative path: ${relativePath}.`);
  }
  return normalized;
}

function runGitBuffer(
  repositoryRoot: string,
  args: string[],
  operation: string
): Buffer {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Unable to ${operation} from committed Git state.`);
  }
  return result.stdout;
}

export function readCommittedGitBlob(
  repositoryRoot: string,
  relativePath: string,
  revision = "HEAD"
): Buffer {
  const normalizedPath = normalizeRepositoryPath(relativePath);
  const objectName = `${revision}:${normalizedPath}`;
  const objectType = runGitBuffer(
    repositoryRoot,
    ["cat-file", "-t", objectName],
    `resolve ${normalizedPath}`
  )
    .toString("utf8")
    .trim();
  if (objectType !== "blob") {
    throw new Error(`Required committed path is not a Git blob: ${normalizedPath}.`);
  }
  return runGitBuffer(
    repositoryRoot,
    ["cat-file", "blob", objectName],
    `read ${normalizedPath}`
  );
}

export function hashCommittedGitPath(
  repositoryRoot: string,
  relativePath: string,
  revision = "HEAD"
): string {
  return sha256(readCommittedGitBlob(repositoryRoot, relativePath, revision));
}

function readCommittedClassificationManifest(
  repositoryRoot: string
): TestSuiteEnvironmentManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readCommittedGitBlob(
        repositoryRoot,
        "trainer-app/scripts/test-suite-environments.json"
      ).toString("utf8")
    );
  } catch (error) {
    throw new Error("Unable to read the committed credential-free classification source.", {
      cause: error,
    });
  }
  computeClassificationHash(manifest as TestSuiteEnvironmentManifest);
  return manifest as TestSuiteEnvironmentManifest;
}

function readCommittedTestSelection(
  repositoryRoot: string,
  manifest: TestSuiteEnvironmentManifest
) {
  const discoveredTestFiles = runGitBuffer(
    repositoryRoot,
    ["ls-tree", "-r", "--name-only", "HEAD", "--", "trainer-app/src"],
    "discover committed Trainer test files"
  )
    .toString("utf8")
    .split(/\r?\n/)
    .filter((file) => /^trainer-app\/src\/.+\.test\.tsx?$/.test(file))
    .map((file) => normalizeRepositoryPath(file.slice("trainer-app/".length)))
    .sort(compareText);
  return selectTestSuitesByEnvironment({ manifest, discoveredTestFiles });
}

function parsePorcelainStatus(output: string): CurrentRepositoryState["dirtyPaths"] {
  const records = output.split("\0");
  const dirtyPaths: CurrentRepositoryState["dirtyPaths"] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Unable to parse Git worktree status.");
    }
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const categories: RepositoryDirtyCategory[] = [];
    if (indexStatus === "?" && worktreeStatus === "?") {
      categories.push("untracked");
    } else {
      if (indexStatus !== " " && indexStatus !== "!") categories.push("staged");
      if (worktreeStatus !== " " && worktreeStatus !== "!") categories.push("tracked");
    }
    const dirtyPath = normalizeRepositoryPath(record.slice(3));
    dirtyPaths.push({ path: dirtyPath, categories });
    if (indexStatus === "R" || indexStatus === "C") index += 1;
  }
  return dirtyPaths.sort((left, right) => compareText(left.path, right.path));
}

export function readCurrentRepositoryState(
  repositoryRoot: string
): CurrentRepositoryState {
  const commitSha = gitValue(repositoryRoot, "HEAD^{commit}");
  const treeSha = gitValue(repositoryRoot, "HEAD^{tree}");
  if (!commitSha || !treeSha || !GIT_SHA_PATTERN.test(commitSha) || !GIT_SHA_PATTERN.test(treeSha)) {
    throw new Error("Unable to resolve current Git commit and tree.");
  }
  const status = runGitBuffer(
    repositoryRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    "inspect current Git worktree status"
  ).toString("utf8");
  const dirtyPaths = parsePorcelainStatus(status);
  return {
    commitSha,
    treeSha,
    worktreeClean: dirtyPaths.length === 0,
    dirtyPaths,
  };
}

function eventMetadata(environment: NodeJS.ProcessEnv): {
  prHeadSha: string | null;
  baseSha: string | null;
  baseRef: string | null;
} {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) return { prHeadSha: null, baseSha: null, baseRef: null };
  try {
    const event = readJson<{
      pull_request?: {
        head?: { sha?: unknown };
        base?: { sha?: unknown; ref?: unknown };
      };
    }>(eventPath);
    return {
      prHeadSha:
        typeof event.pull_request?.head?.sha === "string"
          ? event.pull_request.head.sha
          : null,
      baseSha:
        typeof event.pull_request?.base?.sha === "string"
          ? event.pull_request.base.sha
          : null,
      baseRef:
        typeof event.pull_request?.base?.ref === "string"
          ? event.pull_request.base.ref
          : null,
    };
  } catch {
    return { prHeadSha: null, baseSha: null, baseRef: null };
  }
}

function validGitHubText(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,255}$/.test(value);
}

function validGitHubBaseRef(value: string): boolean {
  return (
    /^[A-Za-z0-9._\/-]{1,255}$/.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("//")
  );
}

function githubRunUrl(input: {
  repository: string | null;
  runId: string | null;
  serverUrl: string | null;
}): string | null {
  const values = [input.repository, input.runId, input.serverUrl];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("GitHub run URL metadata is incomplete.");
  }
  if (!GITHUB_REPOSITORY_PATTERN.test(input.repository!)) {
    throw new Error("GitHub repository identity is invalid.");
  }
  if (!GITHUB_RUN_NUMBER_PATTERN.test(input.runId!)) {
    throw new Error("GitHub run ID is invalid.");
  }
  let server: URL;
  try {
    server = new URL(input.serverUrl!);
  } catch {
    throw new Error("GitHub server URL is invalid.");
  }
  if (
    server.protocol !== "https:" ||
    server.username ||
    server.password ||
    (server.pathname !== "/" && server.pathname !== "") ||
    server.search ||
    server.hash
  ) {
    throw new Error("GitHub server URL must be an HTTPS origin.");
  }
  return `${server.origin}/${input.repository}/actions/runs/${input.runId}`;
}

function coherentGitHubRunUrl(
  url: string,
  repository: string,
  runId: string
): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === `/${repository}/actions/runs/${runId}` &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function computeVerificationDefinition(input: {
  projectRoot: string;
  classificationManifest: TestSuiteEnvironmentManifest;
}): VerificationDefinition {
  const repositoryRoot = path.resolve(input.projectRoot, "..");
  const committedClassificationManifest =
    readCommittedClassificationManifest(repositoryRoot);
  if (
    computeClassificationHash(input.classificationManifest) !==
    computeClassificationHash(committedClassificationManifest)
  ) {
    throw new Error(
      "Credential-free classification input does not match committed Git state."
    );
  }
  const policy = JSON.parse(
    readCommittedGitBlob(repositoryRoot, "scripts/codex/trainer-policy.v1.json").toString("utf8")
  ) as {
    verification?: {
      exactTreeEvidence?: {
        checks?: Array<{
          id?: string;
          definition?: {
            packageScript?: string;
            nodeMajor?: number;
            workers?: number;
            classificationOwner?: string;
            includeLockfile?: boolean;
            files?: string[];
            registryCommandIds?: string[];
          };
        }>;
      };
    };
    commandRegistry?: Array<Record<string, unknown> & { id?: string }>;
  };
  const packageJson = JSON.parse(
    readCommittedGitBlob(repositoryRoot, "trainer-app/package.json").toString("utf8")
  ) as { scripts?: Record<string, string> };
  const checkPolicy = policy.verification?.exactTreeEvidence?.checks?.find(
    (check) => check.id === CREDENTIAL_FREE_CHECK_ID
  );
  const packageScriptName = checkPolicy?.definition?.packageScript;
  const rawDefinitionPaths = checkPolicy?.definition?.files;
  const nodeMajor = checkPolicy?.definition?.nodeMajor;
  const workers = checkPolicy?.definition?.workers;
  if (
    !packageScriptName ||
    !Array.isArray(rawDefinitionPaths) ||
    rawDefinitionPaths.length === 0 ||
    !Number.isSafeInteger(nodeMajor) ||
    (nodeMajor as number) <= 0 ||
    !Number.isSafeInteger(workers) ||
    (workers as number) <= 0 ||
    checkPolicy?.definition?.classificationOwner !==
      "trainer-app/scripts/test-suite-environments.json" ||
    checkPolicy?.definition?.includeLockfile !== true
  ) {
    throw new Error("Credential-free exact-tree policy definition is missing or invalid.");
  }
  const verifiedNodeMajor = nodeMajor as number;
  const verifiedWorkers = workers as number;
  const packageScript = packageJson.scripts?.[packageScriptName];
  if (!packageScript) throw new Error("Credential-free inventory package script is missing.");
  const definitionPaths = rawDefinitionPaths
    .map(normalizeRepositoryPath)
    .sort(compareText);
  if (new Set(definitionPaths).size !== definitionPaths.length) {
    throw new Error("Credential-free verification definition contains duplicate input paths.");
  }
  const inputs = definitionPaths.map((relativePath) => ({
    path: relativePath,
    sha256: hashCommittedGitPath(repositoryRoot, relativePath),
  }));
  const lockfileHash = hashCommittedGitPath(
    repositoryRoot,
    "trainer-app/package-lock.json"
  );
  const relevantCommandIds = new Set([
    ...(checkPolicy.definition?.registryCommandIds ?? []),
    ...committedClassificationManifest.suites
      .map((suite) => suite.commandId)
      .filter((id): id is string => Boolean(id)),
  ]);
  const relevantRegistry = (policy.commandRegistry ?? [])
    .filter((entry) => typeof entry.id === "string" && relevantCommandIds.has(entry.id))
    .sort((left, right) => compareText(String(left.id), String(right.id)));
  const foundCommandIds = new Set(relevantRegistry.map((entry) => entry.id));
  for (const commandId of relevantCommandIds) {
    if (!foundCommandIds.has(commandId)) {
      throw new Error(`Credential-free classification references an unknown command: ${commandId}.`);
    }
  }
  const exactTreeEvidence = policy.verification?.exactTreeEvidence;
  const normalizedExactTreeEvidence = exactTreeEvidence
    ? {
        ...exactTreeEvidence,
        checks: [...(exactTreeEvidence.checks ?? [])]
          .map((check) => ({
            ...check,
            definition: check.definition
              ? {
                  ...check.definition,
                  files: check.definition.files
                    ?.map(normalizeRepositoryPath)
                    .sort(compareText),
                  registryCommandIds: check.definition.registryCommandIds
                    ? [...check.definition.registryCommandIds].sort(compareText)
                    : undefined,
                }
              : undefined,
          }))
          .sort((left, right) => compareText(String(left.id), String(right.id))),
      }
    : null;
  const policyDefinition = canonicalize({
    exactTreeEvidence: normalizedExactTreeEvidence,
    relevantRegistry,
  });
  const definitionPayload = {
    packageScript,
    nodeMajor: verifiedNodeMajor,
    workers: verifiedWorkers,
    inputs,
    policy: policyDefinition,
    lockfileHash,
  };
  return {
    hash: hashCanonicalValue(definitionPayload),
    ...definitionPayload,
  };
}

function emptyCounts() {
  return { files: { total: 0, passed: 0, failed: 0, skipped: 0 }, tests: { total: 0, passed: 0, failed: 0, skipped: 0 } };
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireSafeIntegerSum(values: readonly number[], label: string): number {
  const total = sumNonNegativeSafeIntegers(values);
  if (total === null) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return total;
}

function requireBoundedDuration(
  value: number,
  maximumMs: number,
  label: string
): number {
  if (!isBoundedDurationMs(value, maximumMs)) {
    throw new Error(`${label} exceeds its bounded millisecond domain.`);
  }
  return value;
}

function requireBoundedDurationSum(
  values: readonly number[],
  maximumMs: number,
  label: string
): number {
  const total = sumBoundedDurationsMs(values, maximumMs);
  if (total === null) {
    throw new Error(`${label} exceeds its bounded millisecond domain.`);
  }
  return total;
}

function phaseReporterComplete(result: VitestPhaseResult | null, selected: number): boolean {
  return Boolean(
    result &&
      result.reporterState === "available" &&
      result.summary &&
      result.summary.files.total === selected
  );
}

function buildFailure(
  input: CredentialFreeEvidenceRunInput
): CredentialFreeVerificationEvidence["failure"] {
  if (input.exitCode === 0) return null;
  if (input.failureStage) {
    return {
      phase: input.failureStage,
      kind: input.failureStage,
      reporterComplete: false,
      selectedCoverageCompleted: false,
      failures: input.failureMessage
        ? [{ file: "not-available", test: null, message: input.failureMessage }]
        : [],
      retryEligibility: {
        eligible: false,
        reason: "Only one isolated timeout with complete selected coverage is eligible.",
        file: null,
        test: null,
      },
    } as const;
  }
  const phaseInputs = [
    { result: input.credentialFreeResult, selected: input.credentialFreeSelected },
    { result: input.importOnlyResult, selected: input.importOnlySelected },
  ];
  const failed = phaseInputs.find(({ result }) => result && !result.success);
  const result = failed?.result ?? input.credentialFreeResult ?? input.importOnlyResult;
  const selectedCoverageCompleted = phaseInputs.every(({ result: phase, selected }) =>
    phaseReporterComplete(phase, selected)
  );
  const failures = result?.failures ?? [];
  const eligible = Boolean(
    result?.failureKind === "timeout" &&
      failures.length === 1 &&
      selectedCoverageCompleted &&
      !input.placeholderConnectionAttempted &&
      phaseInputs.filter(({ result: phase }) => phase && !phase.success).length === 1
  );
  return {
    phase: result?.phase ?? "inventory",
    kind: result?.failureKind ?? "unexpected",
    reporterComplete: failed
      ? phaseReporterComplete(failed.result, failed.selected)
      : false,
    selectedCoverageCompleted,
    failures: failures.map((failure) => ({
      file: failure.file,
      test: failure.test,
      message: failure.errorMessage,
    })),
    retryEligibility: {
      eligible,
      reason: eligible
        ? "One isolated timeout; reporters prove all selected files completed. Retry this exact identity once on the unchanged tree."
        : "Failure is not one isolated timeout with complete selected coverage and clean safety guards.",
      file: eligible ? failures[0].file : null,
      test: eligible ? failures[0].test : null,
    },
  };
}

export function createCredentialFreeVerificationEvidence(
  input: CredentialFreeEvidenceRunInput
): CredentialFreeVerificationEvidence {
  const environment = input.environment ?? process.env;
  const repositoryRoot = path.resolve(input.projectRoot, "..");
  const repositoryState = readCurrentRepositoryState(repositoryRoot);
  const definition = computeVerificationDefinition({
    projectRoot: input.projectRoot,
    classificationManifest: input.manifest,
  });
  const checkedOutCommitSha = repositoryState.commitSha;
  const treeSha = repositoryState.treeSha;
  const githubActions = environment.GITHUB_ACTIONS === "true";
  const eventName = environment.GITHUB_EVENT_NAME ?? null;
  const githubRef = environment.GITHUB_REF ?? null;
  const isMergeRef = /^refs\/pull\/\d+\/merge$/.test(githubRef ?? "");
  const isPullRequest = eventName === "pull_request" || isMergeRef;
  const event = isPullRequest
    ? eventMetadata(environment)
    : { prHeadSha: null, baseSha: null, baseRef: null };
  if (
    (event.prHeadSha !== null && !GIT_SHA_PATTERN.test(event.prHeadSha)) ||
    (event.baseSha !== null && !GIT_SHA_PATTERN.test(event.baseSha))
  ) {
    throw new Error("GitHub event contains an invalid commit identity.");
  }
  const prHeadTreeSha = event.prHeadSha
    ? gitValue(repositoryRoot, `${event.prHeadSha}^{tree}`)
    : null;
  if (event.prHeadSha && !prHeadTreeSha) {
    throw new Error("Unable to resolve the pull-request head tree.");
  }
  if (event.baseSha && gitValue(repositoryRoot, `${event.baseSha}^{commit}`) !== event.baseSha) {
    throw new Error("Unable to resolve the pull-request base commit.");
  }
  if (event.baseRef !== null && !validGitHubBaseRef(event.baseRef)) {
    throw new Error("GitHub event contains an invalid base ref.");
  }
  const githubSha = environment.GITHUB_SHA ?? null;
  if (githubSha !== null && !GIT_SHA_PATTERN.test(githubSha)) {
    throw new Error("GitHub checkout identity is invalid.");
  }
  if (githubSha !== null && githubSha !== checkedOutCommitSha) {
    throw new Error("GitHub checkout identity contradicts Git HEAD.");
  }
  const mergeRefSha = isMergeRef ? checkedOutCommitSha : null;
  const mergeRefTreeSha = mergeRefSha
    ? gitValue(repositoryRoot, `${mergeRefSha}^{tree}`)
    : null;
  if (mergeRefSha && !mergeRefTreeSha) {
    throw new Error("Unable to resolve the pull-request merge tree.");
  }
  const credential = input.credentialFreeResult?.summary ?? emptyCounts();
  const importOnly = input.importOnlyResult?.summary ?? emptyCounts();
  const qualification = input.qualification ?? null;
  const status = input.exitCode === 0
    ? qualification
      ? "qualified_pass"
      : "pass"
    : "fail";
  const repository = environment.GITHUB_REPOSITORY ?? null;
  const runId = environment.GITHUB_RUN_ID ?? null;
  const serverUrl = environment.GITHUB_SERVER_URL ?? null;
  const runAttempt = environment.GITHUB_RUN_ATTEMPT ?? null;
  const workflow = environment.GITHUB_WORKFLOW ?? null;
  const job = environment.GITHUB_JOB ?? null;
  const runUrl = githubRunUrl({ repository, runId, serverUrl });
  if (runAttempt !== null && !GITHUB_RUN_NUMBER_PATTERN.test(runAttempt)) {
    throw new Error("GitHub run attempt is invalid.");
  }
  if (workflow !== null && !validGitHubText(workflow)) {
    throw new Error("GitHub workflow identity is invalid.");
  }
  if (job !== null && !GITHUB_JOB_PATTERN.test(job)) {
    throw new Error("GitHub job identity is invalid.");
  }
  if (eventName !== null && !GITHUB_EVENT_NAME_PATTERN.test(eventName)) {
    throw new Error("GitHub event name is invalid.");
  }
  if (githubActions) {
    if (
      !eventName ||
      !githubRef ||
      !githubSha ||
      !repository ||
      !workflow ||
      !runId ||
      !runAttempt ||
      !job ||
      !runUrl
    ) {
      throw new Error("GitHub Actions run metadata is incomplete.");
    }
    if (!validGitHubText(githubRef)) {
      throw new Error("GitHub ref is invalid.");
    }
    if (eventName === "pull_request") {
      if (
        !isMergeRef ||
        !event.prHeadSha ||
        !event.baseSha ||
        !event.baseRef ||
        !mergeRefSha ||
        !mergeRefTreeSha
      ) {
        throw new Error("GitHub pull-request metadata is incomplete.");
      }
    }
  }
  let vitestVersion = "unknown";
  try {
    vitestVersion = readJson<{ version: string }>(
      path.join(input.projectRoot, "node_modules", "vitest", "package.json")
    ).version;
  } catch {
    // Dependency readiness failures still publish evidence without inventing a version.
  }

  const evidenceCounts = {
    filesDiscovered: requireNonNegativeSafeInteger(
      input.filesDiscovered,
      "Discovered file count"
    ),
    filesSelected: requireSafeIntegerSum(
      [input.credentialFreeSelected, input.importOnlySelected],
      "Selected file count"
    ),
    filesExecuted: requireSafeIntegerSum(
      [credential.files.total, importOnly.files.total],
      "Executed file count"
    ),
    filesPassed: requireSafeIntegerSum(
      [credential.files.passed, importOnly.files.passed],
      "Passed file count"
    ),
    filesSkipped: requireSafeIntegerSum(
      [credential.files.skipped, importOnly.files.skipped],
      "Skipped file count"
    ),
    filesFailed: requireSafeIntegerSum(
      [credential.files.failed, importOnly.files.failed],
      "Failed file count"
    ),
    testsCollected: requireSafeIntegerSum(
      [credential.tests.total, importOnly.tests.total],
      "Collected test count"
    ),
    testsPassed: requireSafeIntegerSum(
      [credential.tests.passed, importOnly.tests.passed],
      "Passed test count"
    ),
    testsSkipped: requireSafeIntegerSum(
      [credential.tests.skipped, importOnly.tests.skipped],
      "Skipped test count"
    ),
    testsFailed: requireSafeIntegerSum(
      [credential.tests.failed, importOnly.tests.failed],
      "Failed test count"
    ),
    databaseRequiredExcluded: requireNonNegativeSafeInteger(
      input.databaseRequiredExcluded,
      "Database-required exclusion count"
    ),
  };
  const evidenceDurations = {
    totalMs: requireBoundedDuration(
      input.totalDurationMs,
      MAX_INVENTORY_AGGREGATE_DURATION_MS,
      "Total evidence duration"
    ),
    credentialFreeMs:
      input.credentialFreeResult === null
        ? null
        : requireBoundedDuration(
            input.credentialFreeResult.durationMs,
            MAX_INVENTORY_AGGREGATE_DURATION_MS,
            "Credential-free duration"
          ),
    importOnlyMs:
      input.importOnlyResult === null
        ? null
        : requireBoundedDuration(
            input.importOnlyResult.durationMs,
            MAX_INVENTORY_COMPONENT_DURATION_MS,
            "Import-only duration"
          ),
  };

  return {
    schema: VERIFICATION_EVIDENCE_SCHEMA,
    schemaVersion: VERIFICATION_EVIDENCE_VERSION,
    checkId: CREDENTIAL_FREE_CHECK_ID,
    hermetic: true,
    checkedOutCommitSha,
    treeSha,
    repositoryState: {
      worktreeClean: repositoryState.worktreeClean,
    },
    prHeadSha: event.prHeadSha,
    prHeadTreeSha,
    prHeadTreeMatchesTestedTree:
      prHeadTreeSha === null ? null : prHeadTreeSha === treeSha,
    mergeRefSha,
    mergeRefTreeSha,
    baseRef: event.baseRef ?? input.baseRef ?? null,
    baseSha: event.baseSha,
    verificationDefinitionHash: definition.hash,
    verificationDefinition: definition,
    classificationHash: computeClassificationHash(
      readCommittedClassificationManifest(repositoryRoot)
    ),
    lockfileHash: definition.lockfileHash,
    status,
    qualification,
    counts: evidenceCounts,
    durations: evidenceDurations,
    importSafety: {
      status: input.importOnlyResult
        ? input.importOnlyResult.success && !input.placeholderConnectionAttempted
          ? "pass"
          : "fail"
        : "not_run",
      connectionAttempted: input.placeholderConnectionAttempted,
    },
    failure: buildFailure(input),
    environment: {
      os: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      node: process.version,
      vitest: vitestVersion,
      timezone: environment.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      workers: 1,
      runnerImage: environment.ImageOS ?? environment.RUNNER_OS ?? null,
    },
    run: {
      repository,
      workflow,
      runId,
      runAttempt,
      job,
      url: runUrl,
    },
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

function successfulAggregatePhase(input: {
  phase: string;
  files: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
}): VitestPhaseResult {
  return {
    phase: input.phase,
    success: true,
    status: 0,
    exitCode: 0,
    signal: null,
    abnormalTermination: false,
    terminationError: null,
    externalFailure: null,
    durationMs: input.durationMs,
    summary: { files: input.files, tests: input.tests },
    reporterState: "available",
    failureKind: "none",
    failures: [],
    artifactDiagnostics: [],
    artifacts: {
      root: "aggregate",
      directory: "aggregate",
      stdout: "aggregate",
      stderr: "aggregate",
      reporter: "aggregate",
      metadata: "aggregate",
    },
    artifactsRetained: false,
  };
}

export function createShardedCredentialFreeVerificationEvidence(
  input: ShardedCredentialFreeEvidenceInput
): CredentialFreeVerificationEvidence {
  const credentialComponents = input.aggregate.components.credentialFree;
  const credentialCount = (
    key: keyof CredentialFreeShardSummary["counts"],
    label: string
  ) =>
    requireSafeIntegerSum(
      credentialComponents.map((component) => component.counts[key]),
      label
    );
  const credentialCounts = {
    files: {
      total: credentialCount("executedFiles", "Credential executed file count"),
      passed: credentialCount("passedFiles", "Credential passed file count"),
      failed: credentialCount("failedFiles", "Credential failed file count"),
      skipped: credentialCount("skippedFiles", "Credential skipped file count"),
    },
    tests: {
      total: credentialCount("totalTests", "Credential collected test count"),
      passed: credentialCount("passedTests", "Credential passed test count"),
      failed: credentialCount("failedTests", "Credential failed test count"),
      skipped: credentialCount("skippedTests", "Credential skipped test count"),
    },
  };
  const importComponent = input.aggregate.components.importSafety;
  const importCounts = {
    files: {
      total: requireNonNegativeSafeInteger(
        importComponent.counts.executedFiles,
        "Import executed file count"
      ),
      passed: requireNonNegativeSafeInteger(
        importComponent.counts.passedFiles,
        "Import passed file count"
      ),
      failed: requireNonNegativeSafeInteger(
        importComponent.counts.failedFiles,
        "Import failed file count"
      ),
      skipped: requireNonNegativeSafeInteger(
        importComponent.counts.skippedFiles,
        "Import skipped file count"
      ),
    },
    tests: {
      total: requireNonNegativeSafeInteger(
        importComponent.counts.totalTests,
        "Import collected test count"
      ),
      passed: requireNonNegativeSafeInteger(
        importComponent.counts.passedTests,
        "Import passed test count"
      ),
      failed: requireNonNegativeSafeInteger(
        importComponent.counts.failedTests,
        "Import failed test count"
      ),
      skipped: requireNonNegativeSafeInteger(
        importComponent.counts.skippedTests,
        "Import skipped test count"
      ),
    },
  };
  const aggregateDurationMs = requireBoundedDuration(
    input.aggregateDurationMs,
    MAX_AGGREGATE_VALIDATION_DURATION_MS,
    "Aggregate validation duration"
  );
  const totalDurationMs = requireBoundedDurationSum(
    [input.aggregate.durations.criticalPathMs, aggregateDurationMs],
    MAX_SHARDED_TOTAL_DURATION_MS,
    "Sharded total duration"
  );
  const credentialResult = successfulAggregatePhase({
    phase: "credential-free sharded suites",
    ...credentialCounts,
    durationMs: input.aggregate.durations.credentialFreeMs,
  });
  const importOnlyResult = successfulAggregatePhase({
    phase: "import-only placeholder suites",
    ...importCounts,
    durationMs: input.aggregate.durations.importOnlyMs,
  });
  const base = createCredentialFreeVerificationEvidence({
    projectRoot: input.projectRoot,
    manifest: input.manifest,
    filesDiscovered: input.aggregate.counts.filesDiscovered,
    credentialFreeSelected:
      input.aggregate.coverage.credentialFreeExpected.length,
    importOnlySelected: input.aggregate.coverage.importOnlyExpected.length,
    databaseRequiredExcluded:
      input.aggregate.counts.databaseRequiredExcluded,
    credentialFreeResult: credentialResult,
    importOnlyResult,
    placeholderConnectionAttempted: false,
    exitCode: 0,
    qualification: null,
    totalDurationMs,
    baseRef: input.baseRef,
    environment: input.environment,
    completedAt: input.completedAt,
  });
  return {
    ...base,
    schemaVersion: SHARDED_VERIFICATION_EVIDENCE_VERSION,
    durations: {
      totalMs: totalDurationMs,
      credentialFreeMs: input.aggregate.durations.credentialFreeMs,
      importOnlyMs: input.aggregate.durations.importOnlyMs,
      aggregateMs: aggregateDurationMs,
      criticalPathMs: input.aggregate.durations.criticalPathMs,
      componentTotalMs: input.aggregate.durations.componentTotalMs,
    },
    environment: {
      ...base.environment,
      pool: "forks",
      isolation: true,
    },
    executionTopology: {
      kind: "sharded",
      credentialFree: {
        shardCount: CREDENTIAL_FREE_SHARD_COUNT,
        components: credentialComponents,
      },
      importSafety: importComponent,
      coverage: input.aggregate.coverage,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isBoundedDurationMs(value, MAX_INVENTORY_AGGREGATE_DURATION_MS);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function pushError(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function validateQualification(
  value: unknown,
  treeSha: unknown,
  errors: string[]
): value is VerificationQualification {
  if (!isRecord(value)) {
    errors.push("qualification must be an object");
    return false;
  }
  const originalFailure = value.originalFailure;
  const retry = value.retry;
  const recurrence = value.recurrence;
  pushError(errors, value.kind === "single-isolated-timeout", "qualification kind is invalid");
  if (!isRecord(originalFailure)) {
    errors.push("qualification original failure is invalid");
  } else {
    pushError(
      errors,
      typeof originalFailure.file === "string" && originalFailure.file.length > 0,
      "qualification original failure file is invalid"
    );
    pushError(
      errors,
      originalFailure.test === null || typeof originalFailure.test === "string",
      "qualification original failure test is invalid"
    );
    pushError(
      errors,
      originalFailure.reporterComplete === true,
      "qualification reporter is incomplete"
    );
  }
  if (!isRecord(retry)) {
    errors.push("qualification retry is invalid");
  } else {
    pushError(errors, retry.status === "pass", "qualification retry did not pass");
    pushError(
      errors,
      typeof retry.treeSha === "string" &&
        GIT_SHA_PATTERN.test(retry.treeSha) &&
        retry.treeSha === treeSha,
      "qualification retry tree is invalid"
    );
  }
  if (!isRecord(recurrence)) {
    errors.push("qualification recurrence is invalid");
  } else {
    pushError(
      errors,
      recurrence.sameTestOccurrences === 1,
      "qualification recurrence count is invalid"
    );
    pushError(errors, recurrence.blocked === false, "qualification is recurrence-blocked");
  }
  return errors.length === 0;
}

function validateShardedExecutionTopology(
  evidence: Record<string, unknown>,
  errors: string[]
): void {
  const topology = evidence.executionTopology;
  const environment = evidence.environment;
  const run = evidence.run;
  const counts = evidence.counts;
  const durations = evidence.durations;
  if (
    !isRecord(topology) ||
    topology.kind !== "sharded" ||
    !isRecord(topology.credentialFree) ||
    topology.credentialFree.shardCount !== CREDENTIAL_FREE_SHARD_COUNT ||
    !Array.isArray(topology.credentialFree.components) ||
    !isRecord(topology.importSafety) ||
    !isRecord(topology.coverage)
  ) {
    errors.push("sharded execution topology is malformed");
    return;
  }
  if (
    !isRecord(environment) ||
    environment.pool !== "forks" ||
    environment.isolation !== true ||
    typeof environment.node !== "string" ||
    typeof environment.vitest !== "string" ||
    environment.workers !== 1 ||
    typeof environment.timezone !== "string" ||
    !isRecord(run) ||
    typeof run.runId !== "string" ||
    typeof run.runAttempt !== "string" ||
    typeof run.workflow !== "string" ||
    run.job !== CREDENTIAL_FREE_CHECK_ID ||
    typeof evidence.treeSha !== "string" ||
    typeof evidence.checkedOutCommitSha !== "string" ||
    typeof evidence.verificationDefinitionHash !== "string" ||
    typeof evidence.classificationHash !== "string" ||
    typeof evidence.lockfileHash !== "string"
  ) {
    errors.push("sharded execution identity is incomplete");
    return;
  }
  const coverage = topology.coverage;
  const validation = validateCredentialFreeAggregate({
    untrustedComponents: [
      ...topology.credentialFree.components,
      topology.importSafety,
    ],
    expected: {
      treeSha: evidence.treeSha,
      checkedOutCommitSha: evidence.checkedOutCommitSha,
      verificationDefinitionHash: evidence.verificationDefinitionHash,
      classificationHash: evidence.classificationHash,
      lockfileHash: evidence.lockfileHash,
      workflow: run.workflow,
      workflowRunId: run.runId,
      runAttempt: run.runAttempt,
      job: CREDENTIAL_FREE_CHECK_ID,
      execution: {
        nodeVersion: environment.node,
        vitestVersion: environment.vitest,
        pool: "forks",
        isolation: true,
        workerCount: 1,
        timezone: environment.timezone,
      },
      security: {
        profile: CREDENTIAL_SAFE_PROFILE,
        credentialStripping: true,
        databaseTargetsRemoved: [...DATABASE_TARGET_ENV_VARS].sort(),
        dotenvSuppressed: true,
      },
      credentialFreeFiles: Array.isArray(coverage.credentialFreeExpected)
        ? (coverage.credentialFreeExpected as string[])
        : [],
      importOnlyFiles: Array.isArray(coverage.importOnlyExpected)
        ? (coverage.importOnlyExpected as string[])
        : [],
      databaseRequiredFiles: Array.isArray(coverage.databaseRequiredExcluded)
        ? (coverage.databaseRequiredExcluded as string[])
        : [],
      dependencyResults: {
        credentialShards: "success",
        importSafety: "success",
      },
    },
  });
  if (!validation.valid) {
    errors.push(
      ...validation.errors.map((error) => `sharded topology: ${error}`)
    );
    return;
  }
  pushError(
    errors,
    JSON.stringify(topology.coverage) ===
      JSON.stringify(validation.aggregate.coverage),
    "sharded coverage claims do not match validated topology"
  );
  if (isRecord(counts)) {
    const aggregateCounts = validation.aggregate.counts;
    for (const [evidenceName, aggregateName] of [
      ["filesDiscovered", "filesDiscovered"],
      ["filesSelected", "selectedFiles"],
      ["filesExecuted", "executedFiles"],
      ["filesPassed", "passedFiles"],
      ["filesSkipped", "skippedFiles"],
      ["filesFailed", "failedFiles"],
      ["testsCollected", "totalTests"],
      ["testsPassed", "passedTests"],
      ["testsSkipped", "skippedTests"],
      ["testsFailed", "failedTests"],
      ["databaseRequiredExcluded", "databaseRequiredExcluded"],
    ] as const) {
      pushError(
        errors,
        counts[evidenceName] === aggregateCounts[aggregateName],
        `sharded ${evidenceName} does not reconcile`
      );
    }
  }
  if (isRecord(durations)) {
    const aggregateDurations = validation.aggregate.durations;
    pushError(
      errors,
      durations.credentialFreeMs === aggregateDurations.credentialFreeMs,
      "sharded credential-free duration does not reconcile"
    );
    pushError(
      errors,
      durations.importOnlyMs === aggregateDurations.importOnlyMs,
      "sharded import-only duration does not reconcile"
    );
    pushError(
      errors,
      durations.componentTotalMs === aggregateDurations.componentTotalMs,
      "sharded component duration does not reconcile"
    );
    pushError(
      errors,
      durations.criticalPathMs === aggregateDurations.criticalPathMs,
      "sharded critical-path duration does not reconcile"
    );
    const aggregateMs = isBoundedDurationMs(
      durations.aggregateMs,
      MAX_AGGREGATE_VALIDATION_DURATION_MS
    )
      ? durations.aggregateMs
      : null;
    const recomputedTotalMs =
      aggregateMs === null
        ? null
        : sumBoundedDurationsMs(
            [aggregateDurations.criticalPathMs, aggregateMs],
            MAX_SHARDED_TOTAL_DURATION_MS
          );
    pushError(
      errors,
      recomputedTotalMs !== null && durations.totalMs === recomputedTotalMs,
      "sharded aggregate duration does not reconcile"
    );
  }
}

export function validateCredentialFreeVerificationEvidence(
  input: unknown
): ExactTreeEvidenceValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["evidence must be an object"] };
  }
  const evidence = input;
  const errors: string[] = [];
  pushError(errors, evidence.schema === VERIFICATION_EVIDENCE_SCHEMA, "schema is invalid");
  pushError(
    errors,
    evidence.schemaVersion === VERIFICATION_EVIDENCE_VERSION ||
      evidence.schemaVersion === SHARDED_VERIFICATION_EVIDENCE_VERSION,
    "schema version is invalid"
  );
  pushError(errors, evidence.checkId === CREDENTIAL_FREE_CHECK_ID, "check id is invalid");
  pushError(errors, evidence.hermetic === true, "hermetic flag is invalid");
  pushError(
    errors,
    typeof evidence.checkedOutCommitSha === "string" &&
      GIT_SHA_PATTERN.test(evidence.checkedOutCommitSha),
    "checked-out commit SHA is invalid"
  );
  pushError(
    errors,
    typeof evidence.treeSha === "string" && GIT_SHA_PATTERN.test(evidence.treeSha),
    "tree SHA is invalid"
  );
  if (!isRecord(evidence.repositoryState)) {
    errors.push("producer repository state is invalid");
  } else {
    pushError(
      errors,
      typeof evidence.repositoryState.worktreeClean === "boolean",
      "producer cleanliness is invalid"
    );
  }

  for (const field of [
    "prHeadSha",
    "prHeadTreeSha",
    "mergeRefSha",
    "mergeRefTreeSha",
    "baseSha",
  ] as const) {
    const value = evidence[field];
    pushError(
      errors,
      value === null || (typeof value === "string" && GIT_SHA_PATTERN.test(value)),
      `${field} is invalid`
    );
  }
  pushError(
    errors,
    evidence.baseRef === null ||
      (typeof evidence.baseRef === "string" && validGitHubBaseRef(evidence.baseRef)),
    "base ref is invalid"
  );
  pushError(
    errors,
    evidence.prHeadTreeMatchesTestedTree === null ||
      typeof evidence.prHeadTreeMatchesTestedTree === "boolean",
    "PR head tree relationship is invalid"
  );
  if (typeof evidence.prHeadSha === "string") {
    pushError(
      errors,
      typeof evidence.prHeadTreeSha === "string",
      "PR head tree is missing"
    );
  } else {
    pushError(
      errors,
      evidence.prHeadTreeSha === null && evidence.prHeadTreeMatchesTestedTree === null,
      "PR head tree is asserted without a PR head"
    );
  }
  if (typeof evidence.prHeadTreeSha === "string" && typeof evidence.treeSha === "string") {
    pushError(
      errors,
      evidence.prHeadTreeMatchesTestedTree ===
        (evidence.prHeadTreeSha === evidence.treeSha),
      "PR head tree relationship contradicts the tested tree"
    );
  }
  if (typeof evidence.mergeRefSha === "string") {
    pushError(errors, typeof evidence.mergeRefTreeSha === "string", "merge-ref tree is missing");
    pushError(
      errors,
      evidence.mergeRefSha === evidence.checkedOutCommitSha,
      "merge-ref commit contradicts the checked-out commit"
    );
    pushError(
      errors,
      evidence.mergeRefTreeSha === evidence.treeSha,
      "merge-ref tree contradicts the tested tree"
    );
  } else {
    pushError(errors, evidence.mergeRefTreeSha === null, "merge-ref tree is asserted without a merge ref");
  }

  pushError(
    errors,
    typeof evidence.verificationDefinitionHash === "string" &&
      SHA256_PATTERN.test(evidence.verificationDefinitionHash),
    "verification definition hash is invalid"
  );
  pushError(
    errors,
    typeof evidence.classificationHash === "string" &&
      SHA256_PATTERN.test(evidence.classificationHash),
    "classification hash is invalid"
  );
  pushError(
    errors,
    typeof evidence.lockfileHash === "string" && SHA256_PATTERN.test(evidence.lockfileHash),
    "lockfile hash is invalid"
  );

  const definition = evidence.verificationDefinition;
  if (!isRecord(definition)) {
    errors.push("verification definition is invalid");
  } else {
    pushError(
      errors,
      typeof definition.hash === "string" && SHA256_PATTERN.test(definition.hash),
      "nested definition hash is invalid"
    );
    pushError(
      errors,
      definition.hash === evidence.verificationDefinitionHash,
      "nested definition hash contradicts the top-level hash"
    );
    pushError(
      errors,
      typeof definition.packageScript === "string" && definition.packageScript.length > 0,
      "definition package script is invalid"
    );
    pushError(
      errors,
      Number.isSafeInteger(definition.nodeMajor) && (definition.nodeMajor as number) > 0,
      "definition Node major is invalid"
    );
    pushError(
      errors,
      Number.isSafeInteger(definition.workers) && (definition.workers as number) > 0,
      "definition worker count is invalid"
    );
    pushError(
      errors,
      typeof definition.lockfileHash === "string" &&
        SHA256_PATTERN.test(definition.lockfileHash),
      "nested lockfile hash is invalid"
    );
    pushError(
      errors,
      definition.lockfileHash === evidence.lockfileHash,
      "nested lockfile hash contradicts the top-level hash"
    );
    if (!Array.isArray(definition.inputs) || definition.inputs.length === 0) {
      errors.push("definition inputs are invalid");
    } else {
      const inputPaths: string[] = [];
      for (const entry of definition.inputs) {
        if (!isRecord(entry)) {
          errors.push("definition input is invalid");
          continue;
        }
        try {
          const normalized = normalizeRepositoryPath(String(entry.path));
          pushError(errors, entry.path === normalized, "definition input path is not normalized");
          inputPaths.push(normalized);
        } catch {
          errors.push("definition input path is invalid");
        }
        pushError(
          errors,
          typeof entry.sha256 === "string" && SHA256_PATTERN.test(entry.sha256),
          "definition input hash is invalid"
        );
      }
      pushError(
        errors,
        new Set(inputPaths).size === inputPaths.length,
        "definition input paths are duplicated"
      );
      pushError(
        errors,
        inputPaths.every((entry, index) => index === 0 || inputPaths[index - 1] < entry),
        "definition input paths are not stably ordered"
      );
    }
    try {
      canonicalize(definition.policy);
    } catch {
      errors.push("definition policy is not canonicalizable");
    }
    if (
      typeof definition.packageScript === "string" &&
      typeof definition.nodeMajor === "number" &&
      typeof definition.workers === "number" &&
      Array.isArray(definition.inputs) &&
      typeof definition.lockfileHash === "string"
    ) {
      try {
        const recomputed = hashCanonicalValue({
          packageScript: definition.packageScript,
          nodeMajor: definition.nodeMajor,
          workers: definition.workers,
          inputs: definition.inputs,
          policy: definition.policy,
          lockfileHash: definition.lockfileHash,
        });
        pushError(errors, recomputed === definition.hash, "definition hash does not match its contents");
      } catch {
        errors.push("definition contents cannot be hashed");
      }
    }
  }

  const status = evidence.status;
  pushError(
    errors,
    status === "pass" || status === "qualified_pass" || status === "fail",
    "status is invalid"
  );
  const counts = evidence.counts;
  const countNames = [
    "filesDiscovered",
    "filesSelected",
    "filesExecuted",
    "filesPassed",
    "filesSkipped",
    "filesFailed",
    "testsCollected",
    "testsPassed",
    "testsSkipped",
    "testsFailed",
    "databaseRequiredExcluded",
  ] as const;
  if (!isRecord(counts)) {
    errors.push("counts are invalid");
  } else {
    for (const name of countNames) {
      pushError(errors, isNonNegativeInteger(counts[name]), `${name} is invalid`);
    }
    if (countNames.every((name) => isNonNegativeInteger(counts[name]))) {
      pushError(
        errors,
        sumNonNegativeSafeIntegers([
          counts.filesSelected as number,
          counts.databaseRequiredExcluded as number,
        ]) === counts.filesDiscovered,
        "selected and excluded file counts do not reconcile with discovery"
      );
      pushError(
        errors,
        (counts.filesExecuted as number) <= (counts.filesSelected as number),
        "executed files exceed selected files"
      );
      pushError(
        errors,
        sumNonNegativeSafeIntegers([
          counts.filesPassed as number,
          counts.filesSkipped as number,
          counts.filesFailed as number,
        ]) === counts.filesExecuted,
        "file result counts do not reconcile"
      );
      pushError(
        errors,
        sumNonNegativeSafeIntegers([
          counts.testsPassed as number,
          counts.testsSkipped as number,
          counts.testsFailed as number,
        ]) === counts.testsCollected,
        "test result counts do not reconcile"
      );
      if (status === "pass" || status === "qualified_pass") {
        pushError(errors, counts.filesExecuted === counts.filesSelected, "successful evidence is incomplete");
        pushError(errors, counts.filesFailed === 0, "successful evidence has failed files");
        pushError(errors, counts.testsFailed === 0, "successful evidence has failed tests");
      }
    }
  }

  const durations = evidence.durations;
  if (!isRecord(durations)) {
    errors.push("durations are invalid");
  } else {
    pushError(errors, isNonNegativeFinite(durations.totalMs), "total duration is invalid");
    for (const name of ["credentialFreeMs", "importOnlyMs"] as const) {
      pushError(
        errors,
        durations[name] === null ||
          isBoundedDurationMs(
            durations[name],
            name === "importOnlyMs"
              ? MAX_INVENTORY_COMPONENT_DURATION_MS
              : MAX_INVENTORY_AGGREGATE_DURATION_MS
          ),
        `${name} is invalid`
      );
    }
    if (status === "pass" || status === "qualified_pass") {
      pushError(
        errors,
        isBoundedDurationMs(
          durations.credentialFreeMs,
          MAX_INVENTORY_AGGREGATE_DURATION_MS
        ) &&
          isBoundedDurationMs(
            durations.importOnlyMs,
            MAX_INVENTORY_COMPONENT_DURATION_MS
          ),
        "successful evidence has an incomplete phase duration"
      );
    }
  }

  const importSafety = evidence.importSafety;
  if (!isRecord(importSafety)) {
    errors.push("import safety is invalid");
  } else {
    pushError(
      errors,
      importSafety.status === "pass" ||
        importSafety.status === "fail" ||
        importSafety.status === "not_run",
      "import safety status is invalid"
    );
    pushError(
      errors,
      typeof importSafety.connectionAttempted === "boolean",
      "import safety connection flag is invalid"
    );
    if (status === "pass" || status === "qualified_pass") {
      pushError(
        errors,
        importSafety.status === "pass" && importSafety.connectionAttempted === false,
        "successful evidence did not complete import safety"
      );
    }
  }

  const failure = evidence.failure;
  if (failure !== null && !isRecord(failure)) {
    errors.push("failure payload is invalid");
  } else if (isRecord(failure)) {
    const allowedFailureKinds = new Set([
      "none",
      "test-assertion",
      "timeout",
      "reporter-malformed",
      "reporter-missing",
      "worker-termination",
      "safety-guard",
      "artifact-failure",
      "subprocess-exit",
      "classification",
      "dependency-readiness",
      "unexpected",
    ]);
    pushError(errors, typeof failure.phase === "string" && failure.phase.length > 0, "failure phase is invalid");
    pushError(errors, allowedFailureKinds.has(String(failure.kind)), "failure kind is invalid");
    pushError(errors, typeof failure.reporterComplete === "boolean", "failure reporter state is invalid");
    pushError(
      errors,
      typeof failure.selectedCoverageCompleted === "boolean",
      "failure coverage state is invalid"
    );
    if (!Array.isArray(failure.failures)) {
      errors.push("failure rows are invalid");
    } else {
      for (const row of failure.failures) {
        pushError(
          errors,
          isRecord(row) &&
            typeof row.file === "string" &&
            (row.test === null || typeof row.test === "string") &&
            typeof row.message === "string",
          "failure row is invalid"
        );
      }
    }
    if (!isRecord(failure.retryEligibility)) {
      errors.push("failure retry eligibility is invalid");
    } else {
      pushError(
        errors,
        typeof failure.retryEligibility.eligible === "boolean" &&
          typeof failure.retryEligibility.reason === "string" &&
          (failure.retryEligibility.file === null ||
            typeof failure.retryEligibility.file === "string") &&
          (failure.retryEligibility.test === null ||
            typeof failure.retryEligibility.test === "string"),
        "failure retry eligibility is malformed"
      );
    }
  }
  if (status === "pass" || status === "qualified_pass") {
    pushError(errors, failure === null, "successful evidence contains a failure payload");
  }
  if (status === "fail") {
    pushError(errors, isRecord(failure), "failed evidence is missing its failure payload");
  }

  if (status === "pass") {
    pushError(errors, evidence.qualification === null, "ordinary pass contains a qualification");
  } else if (status === "qualified_pass") {
    validateQualification(evidence.qualification, evidence.treeSha, errors);
  } else if (status === "fail") {
    pushError(errors, evidence.qualification === null, "failed evidence contains a qualification");
  }

  const environment = evidence.environment;
  if (!isRecord(environment)) {
    errors.push("environment is invalid");
  } else {
    pushError(errors, typeof environment.os === "string" && environment.os.length > 0, "producer OS is invalid");
    pushError(
      errors,
      typeof environment.architecture === "string" && environment.architecture.length > 0,
      "producer architecture is invalid"
    );
    pushError(
      errors,
      typeof environment.node === "string" && NODE_VERSION_PATTERN.test(environment.node),
      "producer Node version is invalid"
    );
    pushError(
      errors,
      (typeof environment.vitest === "string" && TOOL_VERSION_PATTERN.test(environment.vitest)) ||
        (status === "fail" && environment.vitest === "unknown"),
      "producer Vitest version is invalid"
    );
    pushError(
      errors,
      typeof environment.timezone === "string" && environment.timezone.length > 0,
      "producer timezone is invalid"
    );
    pushError(errors, Number.isSafeInteger(environment.workers) && (environment.workers as number) > 0, "producer workers are invalid");
    pushError(errors, isNullableString(environment.runnerImage), "producer runner image is invalid");
    const nodeMatch =
      typeof environment.node === "string" ? NODE_VERSION_PATTERN.exec(environment.node) : null;
    if (nodeMatch && isRecord(definition)) {
      pushError(
        errors,
        Number(nodeMatch[1]) === definition.nodeMajor,
        "producer Node major contradicts the definition"
      );
      pushError(
        errors,
        environment.workers === definition.workers,
        "producer worker count contradicts the definition"
      );
    }
  }

  const run = evidence.run;
  if (!isRecord(run)) {
    errors.push("run identity is invalid");
  } else {
    for (const name of ["repository", "workflow", "runId", "runAttempt", "job", "url"] as const) {
      pushError(errors, isNullableString(run[name]), `run ${name} is invalid`);
    }
    if (typeof run.repository === "string") {
      pushError(
        errors,
        GITHUB_REPOSITORY_PATTERN.test(run.repository),
        "run repository is malformed"
      );
    }
    if (typeof run.workflow === "string") {
      pushError(errors, validGitHubText(run.workflow), "run workflow is malformed");
    }
    if (typeof run.job === "string") {
      pushError(errors, GITHUB_JOB_PATTERN.test(run.job), "run job is malformed");
    }
    for (const name of ["runId", "runAttempt"] as const) {
      if (typeof run[name] === "string") {
        pushError(
          errors,
          GITHUB_RUN_NUMBER_PATTERN.test(run[name]),
          `run ${name} is malformed`
        );
      }
    }
    if (typeof run.url === "string") {
      pushError(
        errors,
        typeof run.repository === "string" &&
          typeof run.runId === "string" &&
          coherentGitHubRunUrl(run.url, run.repository, run.runId),
        "run URL is malformed or contradicts the run identity"
      );
    }
  }
  pushError(errors, validIsoTimestamp(evidence.completedAt), "completion timestamp is invalid");
  if (evidence.schemaVersion === SHARDED_VERIFICATION_EVIDENCE_VERSION) {
    validateShardedExecutionTopology(evidence, errors);
  }

  return errors.length === 0
    ? { valid: true, evidence: input as CredentialFreeVerificationEvidence }
    : { valid: false, errors };
}

export function parseCredentialFreeVerificationEvidenceJson(
  source: string
): ExactTreeEvidenceValidationResult {
  try {
    return validateCredentialFreeVerificationEvidence(JSON.parse(source));
  } catch {
    return { valid: false, errors: ["evidence JSON is malformed"] };
  }
}

function committedVitestVersion(repositoryRoot: string): string {
  const lockfile = JSON.parse(
    readCommittedGitBlob(repositoryRoot, "trainer-app/package-lock.json").toString("utf8")
  ) as { packages?: Record<string, { version?: unknown }> };
  const version = lockfile.packages?.["node_modules/vitest"]?.version;
  if (typeof version !== "string" || !TOOL_VERSION_PATTERN.test(version)) {
    throw new Error("Committed lockfile does not contain a valid Vitest version.");
  }
  return version;
}

export function createEvidenceReuseRequest(input: {
  projectRoot: string;
  allowQualifiedPass: boolean;
}): EvidenceReuseRequest {
  const repositoryRoot = path.resolve(input.projectRoot, "..");
  const classificationManifest = readCommittedClassificationManifest(repositoryRoot);
  const definition = computeVerificationDefinition({
    projectRoot: input.projectRoot,
    classificationManifest,
  });
  const selection = readCommittedTestSelection(
    repositoryRoot,
    classificationManifest
  );
  return {
    checkId: CREDENTIAL_FREE_CHECK_ID,
    currentRepositoryState: readCurrentRepositoryState(repositoryRoot),
    verificationDefinitionHash: definition.hash,
    classificationHash: computeClassificationHash(classificationManifest),
    lockfileHash: definition.lockfileHash,
    toolchain: {
      nodeMajor: definition.nodeMajor,
      vitest: committedVitestVersion(repositoryRoot),
      workers: definition.workers,
    },
    hermetic: true,
    allowQualifiedPass: input.allowQualifiedPass,
    coverage: {
      credentialFreeFiles: selection.credentialFree,
      importOnlyFiles: selection.importOnlyPlaceholder.map((entry) => entry.path),
      databaseRequiredFiles: selection.databaseRequired.map((entry) => entry.path),
    },
  };
}

function validReuseRequest(request: EvidenceReuseRequest): boolean {
  const state = request.currentRepositoryState;
  try {
    return Boolean(
      state &&
      GIT_SHA_PATTERN.test(state.commitSha) &&
      GIT_SHA_PATTERN.test(state.treeSha) &&
      typeof state.worktreeClean === "boolean" &&
      Array.isArray(state.dirtyPaths) &&
      state.dirtyPaths.every(
        (entry) =>
          typeof entry.path === "string" &&
          Array.isArray(entry.categories) &&
          entry.categories.length > 0 &&
          entry.categories.every((category) =>
            ["tracked", "staged", "untracked"].includes(category)
          )
      ) &&
      state.worktreeClean === (state.dirtyPaths.length === 0) &&
      SHA256_PATTERN.test(request.verificationDefinitionHash) &&
      SHA256_PATTERN.test(request.classificationHash) &&
      SHA256_PATTERN.test(request.lockfileHash) &&
      Number.isSafeInteger(request.toolchain.nodeMajor) &&
      request.toolchain.nodeMajor > 0 &&
      TOOL_VERSION_PATTERN.test(request.toolchain.vitest) &&
      Number.isSafeInteger(request.toolchain.workers) &&
      request.toolchain.workers > 0 &&
      (request.coverage === undefined ||
        [
          request.coverage.credentialFreeFiles,
          request.coverage.importOnlyFiles,
          request.coverage.databaseRequiredFiles,
        ].every(
          (files) =>
            Array.isArray(files) &&
            files.every(
              (file, index) =>
                typeof file === "string" &&
                normalizeRepositoryPath(file) === file &&
                (index === 0 || files[index - 1] < file)
            ) &&
            new Set(files).size === files.length
        ))
    );
  } catch {
    return false;
  }
}

export function assessExactTreeEvidenceReuse(
  untrustedEvidence: unknown,
  request: EvidenceReuseRequest
): EvidenceReuseDecision {
  const validation = validateCredentialFreeVerificationEvidence(untrustedEvidence);
  if (!validation.valid) return { reusable: false, reason: "malformed-evidence" };
  const evidence = validation.evidence;
  if (!validReuseRequest(request)) {
    return { reusable: false, reason: "current-repository-invalid" };
  }
  if (!request.currentRepositoryState.worktreeClean) {
    return { reusable: false, reason: "dirty-current-checkout" };
  }
  if (!request.hermetic || !evidence.hermetic) {
    return { reusable: false, reason: "non-hermetic-check" };
  }
  if (
    !evidence.repositoryState.worktreeClean ||
    !evidence.prHeadSha ||
    !evidence.prHeadTreeSha ||
    evidence.prHeadTreeMatchesTestedTree !== true ||
    !evidence.mergeRefSha ||
    !evidence.mergeRefTreeSha ||
    !evidence.baseRef ||
    !evidence.baseSha ||
    !evidence.run.repository ||
    !evidence.run.url ||
    !evidence.run.runId ||
    !evidence.run.runAttempt ||
    !evidence.run.workflow ||
    !evidence.run.job ||
    evidence.run.job !== evidence.checkId
  ) {
    return { reusable: false, reason: "incomplete-evidence" };
  }
  if (evidence.checkId !== request.checkId) return { reusable: false, reason: "check-mismatch" };
  if (evidence.treeSha !== request.currentRepositoryState.treeSha) {
    return { reusable: false, reason: "tree-mismatch" };
  }
  if (evidence.verificationDefinitionHash !== request.verificationDefinitionHash) {
    return { reusable: false, reason: "definition-mismatch" };
  }
  if (evidence.classificationHash !== request.classificationHash) {
    return { reusable: false, reason: "classification-mismatch" };
  }
  if (evidence.lockfileHash !== request.lockfileHash) {
    return { reusable: false, reason: "lockfile-mismatch" };
  }
  if (evidence.schemaVersion === SHARDED_VERIFICATION_EVIDENCE_VERSION) {
    const coverage = evidence.executionTopology?.coverage;
    if (!request.coverage) {
      return { reusable: false, reason: "current-repository-invalid" };
    }
    if (
      !coverage ||
      JSON.stringify(coverage.credentialFreeExpected) !==
        JSON.stringify(request.coverage.credentialFreeFiles) ||
      JSON.stringify(coverage.importOnlyExpected) !==
        JSON.stringify(request.coverage.importOnlyFiles) ||
      JSON.stringify(coverage.databaseRequiredExcluded) !==
        JSON.stringify(request.coverage.databaseRequiredFiles)
    ) {
      return { reusable: false, reason: "incomplete-evidence" };
    }
  }
  if (evidence.status === "fail") return { reusable: false, reason: "failed-evidence" };
  if (evidence.status === "qualified_pass" && !request.allowQualifiedPass) {
    return { reusable: false, reason: "qualification-not-permitted" };
  }
  if (
    evidence.environment.node.match(NODE_VERSION_PATTERN)?.[1] !==
      String(request.toolchain.nodeMajor) ||
    evidence.environment.vitest !== request.toolchain.vitest ||
    evidence.environment.workers !== request.toolchain.workers ||
    evidence.verificationDefinition.nodeMajor !== request.toolchain.nodeMajor ||
    evidence.verificationDefinition.workers !== request.toolchain.workers
  ) {
    return { reusable: false, reason: "incompatible-toolchain" };
  }
  return { reusable: true, reason: "reusable" };
}

export function credentialFreeEvidenceArtifactName(
  evidence: CredentialFreeVerificationEvidence
): string | null {
  if (!evidence.run.runId || !evidence.run.runAttempt) return null;
  return `credential-free-inventory-evidence-tree-${evidence.treeSha}-run-${evidence.run.runId}-attempt-${evidence.run.runAttempt}`;
}

export function renderCredentialFreeEvidenceSummary(
  evidence: CredentialFreeVerificationEvidence
): string {
  const qualification = evidence.qualification?.kind ?? "none";
  const artifactName = credentialFreeEvidenceArtifactName(evidence);
  const lines = [
    "## Credential-free inventory evidence",
    "",
    `- Status: **${evidence.status}**`,
    `- Tested tree: \`${evidence.treeSha}\``,
    `- Checked-out commit: \`${evidence.checkedOutCommitSha}\``,
    `- Worktree clean: ${evidence.repositoryState.worktreeClean}`,
    `- PR head: ${evidence.prHeadSha ? `\`${evidence.prHeadSha}\`` : "not applicable"}`,
    `- PR head tree matches tested tree: ${evidence.prHeadTreeMatchesTestedTree ?? "not applicable"}`,
    `- Merge ref: ${evidence.mergeRefSha ? `\`${evidence.mergeRefSha}\`` : "not applicable"}`,
    `- Base: ${evidence.baseSha ? `\`${evidence.baseSha}\`` : "not applicable"}${evidence.baseRef ? ` (${evidence.baseRef})` : ""}`,
    `- Workflow job: ${evidence.run.repository && evidence.run.workflow && evidence.run.job ? `${evidence.run.repository} / ${evidence.run.workflow} / ${evidence.run.job}` : "not applicable"}`,
    `- Verification definition: \`${evidence.verificationDefinitionHash}\``,
    `- Classification: \`${evidence.classificationHash}\``,
    `- Lockfile: \`${evidence.lockfileHash}\``,
    `- Qualification: ${qualification}`,
    `- Files: ${evidence.counts.filesExecuted}/${evidence.counts.filesSelected} executed; ${evidence.counts.filesPassed} passed; ${evidence.counts.filesSkipped} skipped; ${evidence.counts.filesFailed} failed`,
    `- Tests: ${evidence.counts.testsPassed} passed; ${evidence.counts.testsSkipped} skipped; ${evidence.counts.testsFailed} failed`,
    `- Import safety: ${evidence.importSafety.status}; socket attempt: ${evidence.importSafety.connectionAttempted ? "detected" : "none"}`,
    `- Duration: ${(evidence.durations.totalMs / 1000).toFixed(1)}s`,
    `- Run: ${evidence.run.url ?? "local run"}`,
    `- Uploaded artifact: ${artifactName ? `\`${artifactName}\`` : "not applicable"}`,
    `- Machine evidence: \`${CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH}\``,
  ];
  if (evidence.executionTopology?.kind === "sharded") {
    lines.push(
      "",
      "| Component | Files | Tests | Duration | Result |",
      "| --- | ---: | ---: | ---: | --- |"
    );
    for (const component of evidence.executionTopology.credentialFree.components) {
      lines.push(
        `| Credential ${component.shardIndex}/${component.shardCount} | ${component.counts.executedFiles} | ${component.counts.totalTests} | ${(component.durationMs / 1000).toFixed(1)}s | ${component.status.toUpperCase()} |`
      );
    }
    const importSafety = evidence.executionTopology.importSafety;
    lines.push(
      `| Import safety | ${importSafety.counts.executedFiles} | ${importSafety.counts.totalTests} | ${(importSafety.durationMs / 1000).toFixed(1)}s | ${importSafety.status.toUpperCase()} |`,
      "",
      "- Coverage union: exact",
      "- Pairwise shard overlap: empty",
      "- DB-required exclusion: exact",
      "- Import-only coverage: exact",
      `- Component critical path: ${((evidence.durations.criticalPathMs ?? 0) / 1000).toFixed(1)}s; aggregate validation: ${((evidence.durations.aggregateMs ?? 0) / 1000).toFixed(1)}s; component runner total: ${((evidence.durations.componentTotalMs ?? 0) / 1000).toFixed(1)}s`
    );
  }
  if (evidence.failure) {
    lines.push(
      `- Failure: phase=${evidence.failure.phase}; kind=${evidence.failure.kind}; reporter-complete=${evidence.failure.reporterComplete}; selected-coverage-complete=${evidence.failure.selectedCoverageCompleted}`,
      `- Targeted retry eligible: ${evidence.failure.retryEligibility.eligible}; ${evidence.failure.retryEligibility.reason}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function assertFiniteEvidenceNumbers(
  value: unknown,
  location = "evidence",
  ancestors = new WeakSet<object>()
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${location} contains a non-finite number.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) {
    throw new Error(`${location} contains a circular reference.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertFiniteEvidenceNumbers(entry, `${location}[${index}]`, ancestors)
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertFiniteEvidenceNumbers(entry, `${location}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

export function publishCredentialFreeVerificationEvidence(input: {
  projectRoot: string;
  evidence: CredentialFreeVerificationEvidence;
  environment?: NodeJS.ProcessEnv;
}): string {
  const environment = input.environment ?? process.env;
  const summaryPath = environment.GITHUB_STEP_SUMMARY;
  if (!summaryPath && environment.GITHUB_ACTIONS === "true") {
    throw new Error("GitHub job summary destination is unavailable.");
  }
  assertFiniteEvidenceNumbers(input.evidence);
  const serialized = JSON.stringify(input.evidence, null, 2);
  const validation = parseCredentialFreeVerificationEvidenceJson(serialized);
  if (!validation.valid) {
    throw new Error(
      `Canonical credential-free evidence is invalid: ${validation.errors.join("; ")}`
    );
  }
  const evidencePath = path.join(input.projectRoot, CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${serialized}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      renderCredentialFreeEvidenceSummary(validation.evidence),
      "utf8"
    );
  }
  return evidencePath;
}
