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
import type { TestSuiteEnvironmentManifest } from "./test-environment-preflight";
import type {
  VitestFailureKind,
  VitestPhaseResult,
} from "./credential-free-inventory-runner";

export const CREDENTIAL_FREE_CHECK_ID = "credential-free-inventory" as const;
export const VERIFICATION_EVIDENCE_SCHEMA = "trainer-verification-evidence" as const;
export const VERIFICATION_EVIDENCE_VERSION = 1 as const;
export const CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH =
  "artifacts/credential-free-inventory/evidence/credential-free-inventory-evidence.json";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

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
};

export type CredentialFreeVerificationEvidence = {
  schema: typeof VERIFICATION_EVIDENCE_SCHEMA;
  schemaVersion: typeof VERIFICATION_EVIDENCE_VERSION;
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

export type EvidenceReuseRequest = {
  checkId: string;
  treeSha: string;
  verificationDefinitionHash: string;
  classificationHash: string;
  lockfileHash: string;
  hermetic: boolean;
  allowQualifiedPass: boolean;
};

export type EvidenceReuseDecision = {
  reusable: boolean;
  reason:
    | "reusable"
    | "non-hermetic-check"
    | "incomplete-evidence"
    | "check-mismatch"
    | "tree-mismatch"
    | "definition-mismatch"
    | "classification-mismatch"
    | "lockfile-mismatch"
    | "failed-evidence"
    | "qualification-not-permitted"
    | "qualification-invalid";
};

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
        .sort(([left], [right]) => left.localeCompare(right))
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
  return hashCanonicalValue({
    schema: manifest.schema,
    version: manifest.version,
    suites: [...manifest.suites].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
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

function gitWorktreeClean(repositoryRoot: string): boolean {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    }
  );
  return result.status === 0 && result.stdout.trim().length === 0;
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

export function computeVerificationDefinition(input: {
  projectRoot: string;
  classificationManifest: TestSuiteEnvironmentManifest;
}): VerificationDefinition & { lockfileHash: string } {
  const repositoryRoot = path.resolve(input.projectRoot, "..");
  const policyPath = path.join(repositoryRoot, "scripts", "codex", "trainer-policy.v1.json");
  const policy = readJson<{
    verification?: {
      exactTreeEvidence?: {
        checks?: Array<{
          id?: string;
          definition?: {
            packageScript?: string;
            nodeMajor?: number;
            workers?: number;
            files?: string[];
            registryCommandIds?: string[];
          };
        }>;
      };
    };
    commandRegistry?: Array<Record<string, unknown> & { id?: string }>;
  }>(policyPath);
  const packageJson = readJson<{ scripts?: Record<string, string> }>(
    path.join(input.projectRoot, "package.json")
  );
  const checkPolicy = policy.verification?.exactTreeEvidence?.checks?.find(
    (check) => check.id === CREDENTIAL_FREE_CHECK_ID
  );
  const packageScriptName = checkPolicy?.definition?.packageScript;
  const definitionPaths = checkPolicy?.definition?.files;
  const nodeMajor = checkPolicy?.definition?.nodeMajor;
  const workers = checkPolicy?.definition?.workers;
  if (
    !packageScriptName ||
    !Array.isArray(definitionPaths) ||
    definitionPaths.length === 0 ||
    !Number.isInteger(nodeMajor) ||
    !Number.isInteger(workers)
  ) {
    throw new Error("Credential-free exact-tree policy definition is missing or invalid.");
  }
  const verifiedNodeMajor = nodeMajor as number;
  const verifiedWorkers = workers as number;
  const packageScript = packageJson.scripts?.[packageScriptName];
  if (!packageScript) throw new Error("Credential-free inventory package script is missing.");
  const inputs = definitionPaths.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readFileSync(path.join(repositoryRoot, relativePath))),
  }));
  const lockfileHash = sha256(
    readFileSync(path.join(input.projectRoot, "package-lock.json"))
  );
  const relevantCommandIds = new Set([
    ...(checkPolicy.definition?.registryCommandIds ?? []),
    ...input.classificationManifest.suites
      .map((suite) => suite.commandId)
      .filter((id): id is string => Boolean(id)),
  ]);
  const relevantRegistry = (policy.commandRegistry ?? [])
    .filter((entry) => typeof entry.id === "string" && relevantCommandIds.has(entry.id))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const policyDefinition = canonicalize({
    exactTreeEvidence: policy.verification?.exactTreeEvidence ?? null,
    relevantRegistry,
  });
  const definition = {
    packageScript,
    nodeMajor: verifiedNodeMajor,
    workers: verifiedWorkers,
    inputs,
    policy: policyDefinition,
    lockfileHash,
  };
  return {
    hash: hashCanonicalValue(definition),
    packageScript,
    nodeMajor: verifiedNodeMajor,
    workers: verifiedWorkers,
    inputs,
    policy: policyDefinition,
    lockfileHash,
  };
}

function emptyCounts() {
  return { files: { total: 0, passed: 0, failed: 0, skipped: 0 }, tests: { total: 0, passed: 0, failed: 0, skipped: 0 } };
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
  const definition = computeVerificationDefinition({
    projectRoot: input.projectRoot,
    classificationManifest: input.manifest,
  });
  const checkedOutCommitSha = gitValue(repositoryRoot, "HEAD^{commit}");
  const treeSha = gitValue(repositoryRoot, "HEAD^{tree}");
  if (!checkedOutCommitSha || !treeSha) throw new Error("Unable to resolve checked-out Git commit and tree.");
  const event = eventMetadata(environment);
  const prHeadTreeSha = event.prHeadSha
    ? gitValue(repositoryRoot, `${event.prHeadSha}^{tree}`)
    : null;
  const isMergeRef = /^refs\/pull\/\d+\/merge$/.test(environment.GITHUB_REF ?? "");
  const mergeRefSha = isMergeRef ? environment.GITHUB_SHA ?? checkedOutCommitSha : null;
  const mergeRefTreeSha = mergeRefSha
    ? gitValue(repositoryRoot, `${mergeRefSha}^{tree}`)
    : null;
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
  const runUrl = repository && runId && serverUrl
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;
  let vitestVersion = "unknown";
  try {
    vitestVersion = readJson<{ version: string }>(
      path.join(input.projectRoot, "node_modules", "vitest", "package.json")
    ).version;
  } catch {
    // Dependency readiness failures still publish evidence without inventing a version.
  }

  return {
    schema: VERIFICATION_EVIDENCE_SCHEMA,
    schemaVersion: VERIFICATION_EVIDENCE_VERSION,
    checkId: CREDENTIAL_FREE_CHECK_ID,
    hermetic: true,
    checkedOutCommitSha,
    treeSha,
    repositoryState: {
      worktreeClean: gitWorktreeClean(repositoryRoot),
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
    classificationHash: computeClassificationHash(input.manifest),
    lockfileHash: definition.lockfileHash,
    status,
    qualification,
    counts: {
      filesDiscovered: input.filesDiscovered,
      filesSelected: input.credentialFreeSelected + input.importOnlySelected,
      filesExecuted: credential.files.total + importOnly.files.total,
      filesPassed: credential.files.passed + importOnly.files.passed,
      filesSkipped: credential.files.skipped + importOnly.files.skipped,
      filesFailed: credential.files.failed + importOnly.files.failed,
      testsCollected: credential.tests.total + importOnly.tests.total,
      testsPassed: credential.tests.passed + importOnly.tests.passed,
      testsSkipped: credential.tests.skipped + importOnly.tests.skipped,
      testsFailed: credential.tests.failed + importOnly.tests.failed,
      databaseRequiredExcluded: input.databaseRequiredExcluded,
    },
    durations: {
      totalMs: Math.max(0, input.totalDurationMs),
      credentialFreeMs: input.credentialFreeResult?.durationMs ?? null,
      importOnlyMs: input.importOnlyResult?.durationMs ?? null,
    },
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
      workflow: environment.GITHUB_WORKFLOW ?? null,
      runId,
      runAttempt: environment.GITHUB_RUN_ATTEMPT ?? null,
      job: environment.GITHUB_JOB ?? null,
      url: runUrl,
    },
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

export function assessExactTreeEvidenceReuse(
  evidence: CredentialFreeVerificationEvidence,
  request: EvidenceReuseRequest
): EvidenceReuseDecision {
  if (!request.hermetic || !evidence.hermetic) {
    return { reusable: false, reason: "non-hermetic-check" };
  }
  if (
    evidence.schema !== VERIFICATION_EVIDENCE_SCHEMA ||
    evidence.schemaVersion !== VERIFICATION_EVIDENCE_VERSION ||
    !validSha(evidence.checkedOutCommitSha) ||
    !validSha(evidence.treeSha) ||
    !evidence.completedAt ||
    !evidence.repositoryState.worktreeClean ||
    !evidence.run.url ||
    !evidence.run.runId ||
    !evidence.verificationDefinitionHash ||
    !evidence.classificationHash ||
    !evidence.lockfileHash ||
    evidence.counts.filesExecuted !== evidence.counts.filesSelected ||
    evidence.importSafety.status !== "pass"
  ) {
    return { reusable: false, reason: "incomplete-evidence" };
  }
  if (evidence.checkId !== request.checkId) return { reusable: false, reason: "check-mismatch" };
  if (evidence.treeSha !== request.treeSha) return { reusable: false, reason: "tree-mismatch" };
  if (evidence.verificationDefinitionHash !== request.verificationDefinitionHash) {
    return { reusable: false, reason: "definition-mismatch" };
  }
  if (evidence.classificationHash !== request.classificationHash) {
    return { reusable: false, reason: "classification-mismatch" };
  }
  if (evidence.lockfileHash !== request.lockfileHash) {
    return { reusable: false, reason: "lockfile-mismatch" };
  }
  if (evidence.status === "fail") return { reusable: false, reason: "failed-evidence" };
  if (evidence.status === "qualified_pass") {
    if (!request.allowQualifiedPass) {
      return { reusable: false, reason: "qualification-not-permitted" };
    }
    const qualification = evidence.qualification;
    if (
      !qualification ||
      qualification.kind !== "single-isolated-timeout" ||
      !qualification.originalFailure.reporterComplete ||
      qualification.retry.status !== "pass" ||
      qualification.retry.treeSha !== evidence.treeSha ||
      qualification.recurrence.blocked ||
      qualification.recurrence.sameTestOccurrences !== 1
    ) {
      return { reusable: false, reason: "qualification-invalid" };
    }
  }
  return { reusable: true, reason: "reusable" };
}

export function renderCredentialFreeEvidenceSummary(
  evidence: CredentialFreeVerificationEvidence
): string {
  const qualification = evidence.qualification?.kind ?? "none";
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
    `- Verification definition: \`${evidence.verificationDefinitionHash}\``,
    `- Classification: \`${evidence.classificationHash}\``,
    `- Lockfile: \`${evidence.lockfileHash}\``,
    `- Qualification: ${qualification}`,
    `- Files: ${evidence.counts.filesExecuted}/${evidence.counts.filesSelected} executed; ${evidence.counts.filesPassed} passed; ${evidence.counts.filesSkipped} skipped; ${evidence.counts.filesFailed} failed`,
    `- Tests: ${evidence.counts.testsPassed} passed; ${evidence.counts.testsSkipped} skipped; ${evidence.counts.testsFailed} failed`,
    `- Import safety: ${evidence.importSafety.status}; socket attempt: ${evidence.importSafety.connectionAttempted ? "detected" : "none"}`,
    `- Duration: ${(evidence.durations.totalMs / 1000).toFixed(1)}s`,
    `- Run: ${evidence.run.url ?? "local run"}`,
    `- Machine evidence: \`${CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH}\``,
  ];
  if (evidence.failure) {
    lines.push(
      `- Failure: phase=${evidence.failure.phase}; kind=${evidence.failure.kind}; reporter-complete=${evidence.failure.reporterComplete}; selected-coverage-complete=${evidence.failure.selectedCoverageCompleted}`,
      `- Targeted retry eligible: ${evidence.failure.retryEligibility.eligible}; ${evidence.failure.retryEligibility.reason}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function publishCredentialFreeVerificationEvidence(input: {
  projectRoot: string;
  evidence: CredentialFreeVerificationEvidence;
  environment?: NodeJS.ProcessEnv;
}): string {
  const evidencePath = path.join(input.projectRoot, CREDENTIAL_FREE_EVIDENCE_RELATIVE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(input.evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  const summaryPath = (input.environment ?? process.env).GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, renderCredentialFreeEvidenceSummary(input.evidence), "utf8");
  }
  return evidencePath;
}
