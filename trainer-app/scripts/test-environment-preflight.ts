import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildImportOnlyPlaceholderEnvironment,
  buildCredentialSafeVerificationEnvironment,
  buildTestEnvironmentPreflight,
  collectSensitiveVerificationEnvironmentValues,
  compareTestSuiteEnvironmentManifests,
  DATABASE_TARGET_ENV_VARS,
  evaluateCredentialFreeInventoryOutcome,
  IMPORT_ONLY_PLACEHOLDER_URL,
  inspectCriticalDependencyIntegrity,
  inspectDependencyFilesystem,
  inspectPrismaClientFilesystem,
  selectTestSuitesByEnvironment,
  validateImportOnlyPlaceholderEnvironment,
  validateTestSuiteEnvironmentManifest,
  type CapabilityStatus,
  type CriticalDependencyIntegrityReport,
  type DatabaseTargetEnvironment,
  type TestCommandRegistryEntry,
  type TestSuiteEnvironmentManifest,
  type VitestSummaryCounts,
} from "../src/lib/operations/test-environment-preflight";
import { IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV } from "../src/lib/operations/import-only-placeholder-guard";
import {
  formatElapsed,
  formatVitestPhaseFailure,
  redactSensitiveValues,
  runVitestPhase,
  type VitestPhaseResult,
} from "../src/lib/operations/credential-free-inventory-runner";
import {
  CREDENTIAL_FREE_SHARD_COUNT,
  CREDENTIAL_SAFE_PROFILE,
  buildCredentialFreeShardVitestArgs,
  buildImportSafetyVitestArgs,
  createCredentialFreeShardSummary,
  createImportSafetySummary,
  validateCredentialFreeAggregate,
  type AggregateValidationExpectation,
  type InventoryComponentIdentity,
} from "../src/lib/operations/credential-free-inventory-sharding";
import {
  computeClassificationHash,
  computeVerificationDefinition,
  createCredentialFreeVerificationEvidence,
  createShardedCredentialFreeVerificationEvidence,
  publishCredentialFreeVerificationEvidence,
  readCurrentRepositoryState,
  type CredentialFreeEvidenceRunInput,
} from "../src/lib/operations/exact-tree-verification-evidence";

function capability(available: boolean): CapabilityStatus {
  return available ? "available" : "missing";
}

function readOptional(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function registeredWorktreeRoots(projectRoot: string): string[] {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectRoot,
    env: credentialFreeEnvironment(),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.normalize(line.slice("worktree ".length)));
}

function resolveNpmCli(): string | undefined {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  );
}

let dependencyIntegrity: CriticalDependencyIntegrityReport | undefined;
const restrictedLauncherEnvironment = "TRAINER_RESTRICTED_VERIFICATION_LAUNCHER";

function launcherSensitiveValues(): string[] {
  if (process.env[restrictedLauncherEnvironment] !== "1") {
    return collectSensitiveVerificationEnvironmentValues(process.env);
  }
  try {
    const values = JSON.parse(readFileSync(0, "utf8")) as unknown;
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.filter(
          (value): value is string =>
            typeof value === "string" && value.length >= 8
        )
      ),
    ].sort((left, right) => right.length - left.length);
  } catch {
    return [];
  }
}

const sensitiveVerificationValues = launcherSensitiveValues();

function validateDependencyInstallation(projectRoot: string): boolean {
  const npmCli = resolveNpmCli();
  if (!npmCli) {
    dependencyIntegrity = inspectCriticalDependencyIntegrity({
      projectRoot,
      npmLsSucceeded: false,
    });
    return false;
  }
  const result = spawnSync(process.execPath, [npmCli, "ls", "--all", "--json"], {
    cwd: projectRoot,
    env: credentialFreeEnvironment(),
    encoding: "utf8",
    windowsHide: true,
  });
  dependencyIntegrity = inspectCriticalDependencyIntegrity({
    projectRoot,
    npmLsSucceeded: result.status === 0,
  });
  return dependencyIntegrity.success;
}

function databaseTargets(): DatabaseTargetEnvironment {
  return Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, process.env[name]])
  ) as DatabaseTargetEnvironment;
}

function runSanitized(command: string, args: string[]): number {
  const env = credentialFreeEnvironment();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return result.status ?? 1;
}

function credentialFreeEnvironment(): NodeJS.ProcessEnv {
  const env = buildCredentialSafeVerificationEnvironment(process.env);
  env.TRAINER_CREDENTIAL_FREE_TEST = "1";
  return env;
}

function discoverVitestFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.test\.tsx?$/.test(entry.name)) {
        files.push(path.relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  }
  visit(path.join(root, "src"));
  return files.sort();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function baseRefFromArgs(): string | undefined {
  const index = process.argv.indexOf("--base-ref");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadInventoryClassification(projectRoot: string) {
  const manifest = readJson<TestSuiteEnvironmentManifest>(
    path.join(projectRoot, "scripts", "test-suite-environments.json")
  );
  const policy = readJson<{ commandRegistry: TestCommandRegistryEntry[] }>(
    path.join(projectRoot, "..", "scripts", "codex", "trainer-policy.v1.json")
  );
  const discoveredTestFiles = discoverVitestFiles(projectRoot);
  const validationErrors = validateTestSuiteEnvironmentManifest({
    manifest,
    discoveredTestFiles,
    commandRegistry: policy.commandRegistry,
  });
  if (validationErrors.length > 0) {
    throw new Error(
      validationErrors.map((error) => `${error.code}: ${error.message}`).join(" | ")
    );
  }
  return {
    manifest,
    discoveredTestFiles,
    selection: selectTestSuitesByEnvironment({ manifest, discoveredTestFiles }),
  };
}

function inventoryComponentIdentity(input: {
  projectRoot: string;
  manifest: TestSuiteEnvironmentManifest;
  job: string;
}): InventoryComponentIdentity {
  const repositoryRoot = path.resolve(input.projectRoot, "..");
  const state = readCurrentRepositoryState(repositoryRoot);
  const definition = computeVerificationDefinition({
    projectRoot: input.projectRoot,
    classificationManifest: input.manifest,
  });
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const job = process.env.GITHUB_JOB;
  const workflow = process.env.GITHUB_WORKFLOW;
  if (!runId || !runAttempt || !job || !workflow || job !== input.job) {
    throw new Error(
      `CI component identity is incomplete or unexpected; expected job ${input.job}.`
    );
  }
  const vitestVersion = readJson<{ version: string }>(
    path.join(input.projectRoot, "node_modules", "vitest", "package.json")
  ).version;
  return {
    treeSha: state.treeSha,
    checkedOutCommitSha: state.commitSha,
    verificationDefinitionHash: definition.hash,
    classificationHash: computeClassificationHash(input.manifest),
    lockfileHash: definition.lockfileHash,
    workflow,
    workflowRunId: runId,
    runAttempt,
    job,
    execution: {
      nodeVersion: process.version,
      vitestVersion,
      pool: "forks",
      isolation: true,
      workerCount: 1,
      timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    security: {
      profile: CREDENTIAL_SAFE_PROFILE,
      credentialStripping: true,
      databaseTargetsRemoved: [...DATABASE_TARGET_ENV_VARS].sort(),
      dotenvSuppressed: true,
    },
  };
}

function componentSummaryPath(projectRoot: string, fileName: string): string {
  const directory = path.join(
    projectRoot,
    "artifacts",
    "credential-free-inventory",
    "components"
  );
  mkdirSync(directory, { recursive: true });
  return path.join(directory, fileName);
}

function writeComponentSummary(
  projectRoot: string,
  fileName: string,
  summary: unknown
): string {
  const filePath = componentSummaryPath(projectRoot, fileName);
  writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return filePath;
}

function readBaseManifest(
  projectRoot: string,
  baseRef: string
):
  | { manifest: TestSuiteEnvironmentManifest; error?: never }
  | { manifest?: never; error: string } {
  const result = spawnSync(
    "git",
    ["show", `${baseRef}:trainer-app/scripts/test-suite-environments.json`],
    {
      cwd: projectRoot,
      env: credentialFreeEnvironment(),
      encoding: "utf8",
      windowsHide: true,
    }
  );
  if (result.status !== 0) {
    return {
      error: `The requested base ref ${baseRef} does not contain the test-suite environment manifest.`,
    };
  }
  try {
    const manifest = JSON.parse(result.stdout) as Partial<TestSuiteEnvironmentManifest>;
    if (
      manifest.schema !== "trainer-test-suite-environments" ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.suites)
    ) {
      return {
        error: `The test-suite environment manifest at ${baseRef} is malformed or unsupported.`,
      };
    }
    return { manifest: manifest as TestSuiteEnvironmentManifest };
  } catch {
    return {
      error: `The test-suite environment manifest at ${baseRef} is malformed or unsupported.`,
    };
  }
}

function printPhaseSummary(
  label: string,
  selectedFiles: number,
  result: {
    status: number;
    summary: VitestSummaryCounts | null;
    durationMs: number;
    failureKind: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }
): void {
  const summary = result.summary;
  console.log(`${label}:`);
  console.log(`- files selected: ${selectedFiles}`);
  console.log(`- files passed: ${summary?.files.passed ?? 0}`);
  console.log(`- files skipped: ${summary?.files.skipped ?? 0}`);
  console.log(`- files failed: ${summary?.files.failed ?? (result.status === 0 ? 0 : 1)}`);
  console.log(`- tests collected: ${summary?.tests.total ?? 0}`);
  console.log(`- tests passed: ${summary?.tests.passed ?? 0}`);
  console.log(`- tests skipped: ${summary?.tests.skipped ?? 0}`);
  console.log(`- tests failed: ${summary?.tests.failed ?? (result.status === 0 ? 0 : 1)}`);
  console.log(`- elapsed: ${formatElapsed(result.durationMs)}`);
  console.log(`- failure classification: ${result.failureKind}`);
  console.log(`- exit code: ${result.exitCode ?? "none"}`);
  console.log(`- terminating signal: ${result.signal ?? "none"}`);
}

async function runCredentialFreeInventory(input: {
  projectRoot: string;
  vitestCli: string;
}): Promise<Omit<CredentialFreeEvidenceRunInput, "projectRoot" | "environment" | "completedAt">> {
  const totalStartedAt = Date.now();
  let manifest: TestSuiteEnvironmentManifest = {
    schema: "trainer-test-suite-environments",
    version: 1,
    suites: [],
  };
  let filesDiscovered = 0;
  let credentialFreeSelected = 0;
  let importOnlySelected = 0;
  let databaseRequiredExcluded = 0;
  let credentialFreeResult: VitestPhaseResult | null = null;
  let importOnlyResult: VitestPhaseResult | null = null;
  let placeholderConnectionAttempted = false;
  const finish = (
    exitCode: number,
    failure?: {
      stage: "classification" | "dependency-readiness" | "unexpected";
      message: string;
    }
  ): Omit<CredentialFreeEvidenceRunInput, "projectRoot" | "environment" | "completedAt"> => ({
    manifest,
    filesDiscovered,
    credentialFreeSelected,
    importOnlySelected,
    databaseRequiredExcluded,
    credentialFreeResult,
    importOnlyResult,
    placeholderConnectionAttempted,
    exitCode,
    failureStage: failure?.stage,
    failureMessage: failure?.message,
    qualification: null,
    totalDurationMs: Date.now() - totalStartedAt,
    baseRef: baseRefFromArgs(),
  });
  try {
    const vitestArgs = ["--maxWorkers", "1"];
    const manifestPath = path.join(
      input.projectRoot,
      "scripts",
      "test-suite-environments.json"
    );
    const policyPath = path.join(
      input.projectRoot,
      "..",
      "scripts",
      "codex",
      "trainer-policy.v1.json"
    );
    manifest = readJson<TestSuiteEnvironmentManifest>(manifestPath);
    const policy = readJson<{ commandRegistry: TestCommandRegistryEntry[] }>(policyPath);
    const discoveredTestFiles = discoverVitestFiles(input.projectRoot);
    filesDiscovered = discoveredTestFiles.length;
    const validationErrors = validateTestSuiteEnvironmentManifest({
      manifest,
      discoveredTestFiles,
      commandRegistry: policy.commandRegistry,
    });
    if (validationErrors.length > 0) {
      console.error("Unexpected suite environment classification failures:");
      for (const error of validationErrors) {
        console.error(`- ${error.code}: ${error.message}`);
      }
      return finish(1, {
        stage: "classification",
        message: validationErrors.map((error) => `${error.code}: ${error.message}`).join(" | "),
      });
    }
    const baseRef = baseRefFromArgs();
    let baseManifest: TestSuiteEnvironmentManifest | undefined;
    if (baseRef) {
      const baseResult = readBaseManifest(input.projectRoot, baseRef);
      if (baseResult.error) {
        console.error("Unexpected branch/base comparison failure:");
        console.error(`- ${baseResult.error}`);
        return finish(1, {
          stage: "classification",
          message: baseResult.error,
        });
      }
      baseManifest = baseResult.manifest;
    }

  const selection = selectTestSuitesByEnvironment({
    manifest,
    discoveredTestFiles,
  });
  credentialFreeSelected = selection.credentialFree.length;
  importOnlySelected = selection.importOnlyPlaceholder.length;
  databaseRequiredExcluded = selection.databaseRequired.length;
  const excludedPaths = manifest.suites.map((entry) => entry.path);

  console.log("Credential-free inventory classification");
  console.log(`- total test files discovered: ${discoveredTestFiles.length}`);
  console.log(`- credential-free files selected: ${selection.credentialFree.length}`);
  console.log(
    `- import-only placeholder files selected: ${selection.importOnlyPlaceholder.length}`
  );
  console.log(`- DB-required files excluded: ${selection.databaseRequired.length}`);
  console.log(
    "- Vitest worker limit: 1"
  );
  console.log("DB-required suites excluded:");
  for (const entry of selection.databaseRequired) {
    const command = policy.commandRegistry.find(
      (candidate) => candidate.id === entry.commandId
    );
    console.log(
      `- ${entry.path} | owner=${entry.owner} | environment-profile=${command?.profile ?? "missing"} | command-id=${entry.commandId ?? "missing"} | command=npm run ${entry.packageScript} -- --confirm-disposable | reason=${entry.reason}`
    );
  }
  console.log(
    "Disposable DB suites are intentionally excluded and must be run through their separately authorized command."
  );
  console.log("Import-only placeholder suites:");
  for (const entry of selection.importOnlyPlaceholder) {
    console.log(
      `- ${entry.path} | owner=${entry.owner} | placeholder=${IMPORT_ONLY_PLACEHOLDER_URL} | connection-guard=required | reason=${entry.reason}`
    );
  }

  credentialFreeResult = await runVitestPhase({
    phase: "credential-free suites",
    projectRoot: input.projectRoot,
    vitestCli: input.vitestCli,
    args: [
      ...excludedPaths.flatMap((testFile) => ["--exclude", testFile]),
      ...vitestArgs,
    ],
    environment: credentialFreeEnvironment(),
    sensitiveValues: sensitiveVerificationValues,
  });

  const placeholderEnvironment = buildImportOnlyPlaceholderEnvironment(process.env);
  const placeholderErrors =
    validateImportOnlyPlaceholderEnvironment(placeholderEnvironment);
  if (placeholderErrors.length > 0) {
    console.error("Import-only placeholder environment validation failed.");
    for (const error of placeholderErrors) console.error(`- ${error}`);
    return finish(1, {
      stage: "classification",
      message: placeholderErrors.join(" | "),
    });
  }
  const markerDirectory = mkdtempSync(
    path.join(tmpdir(), "trainer-import-only-connection-")
  );
  const attemptMarker = path.join(markerDirectory, "attempted");
  placeholderEnvironment[IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV] = attemptMarker;
  try {
    importOnlyResult =
      selection.importOnlyPlaceholder.length === 0
        ? {
            status: 0,
            summary: {
              files: { total: 0, passed: 0, failed: 0, skipped: 0 },
              tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
            },
            phase: "import-only placeholder suites",
            success: true,
            exitCode: 0,
            signal: null,
            abnormalTermination: false,
            terminationError: null,
            externalFailure: null,
            durationMs: 0,
            reporterState: "available",
            failureKind: "none",
            failures: [],
            artifactDiagnostics: [],
            artifacts: {
              root: "not-created",
              directory: "not-created",
              stdout: "not-created",
              stderr: "not-created",
              reporter: "not-created",
              metadata: "not-created",
            },
            artifactsRetained: false,
          }
        : await runVitestPhase({
            phase: "import-only placeholder suites",
            projectRoot: input.projectRoot,
            vitestCli: input.vitestCli,
            args: [
              ...selection.importOnlyPlaceholder.map((entry) => entry.path),
              ...vitestArgs,
            ],
            environment: placeholderEnvironment,
            sensitiveValues: sensitiveVerificationValues,
            postRunFailure: () =>
              existsSync(attemptMarker)
                ? "Import-only placeholder connection attempt was blocked."
                : null,
          });
    if (existsSync(attemptMarker)) {
      placeholderConnectionAttempted = true;
      console.error(
        "Unexpected import-only placeholder connection attempt was blocked."
      );
    }
  } finally {
    rmSync(markerDirectory, { recursive: true, force: true });
  }

  console.log("Credential-free inventory summary");
  printPhaseSummary(
    "Credential-free suites",
    selection.credentialFree.length,
    credentialFreeResult
  );
  for (const result of [credentialFreeResult, importOnlyResult]) {
    for (const line of formatVitestPhaseFailure(result)) console.error(line);
  }
  printPhaseSummary(
    "Import-only placeholder suites",
    selection.importOnlyPlaceholder.length,
    importOnlyResult
  );
  console.log(
    `DB-required suites excluded: ${selection.databaseRequired.length} (not run; DB coverage is separate)`
  );
  console.log("Import-only placeholder safeguards:");
  console.log(`- exact guarded TEST-NET URL: ${IMPORT_ONLY_PLACEHOLDER_URL}`);
  console.log(
    `- socket connection attempt: ${placeholderConnectionAttempted ? "detected and failed" : "none observed"}`
  );
  const outcome = evaluateCredentialFreeInventoryOutcome({
    credentialFreeResult,
    importOnlyResult,
    placeholderConnectionAttempted,
  });
  console.log("Unexpected failure status:");
  console.log(
    `- credential-free collection, setup, import, or test failure: ${outcome.credentialFreeFailure ? "present" : "none"}`
  );
  console.log(
    `- import-only collection, setup, import, or test failure: ${outcome.importOnlyFailure ? "present" : "none"}`
  );
  console.log(
    `- malformed or incomplete Vitest result: ${outcome.malformedResult ? "present" : "none"}`
  );
  console.log("- manifest or classification failure: none");
  console.log(`- branch/base comparison failure: ${baseRef ? "none" : "not requested"}`);
  if (baseRef) {
    const delta = compareTestSuiteEnvironmentManifests(baseManifest, manifest);
    console.log(`Branch/base classification delta (${baseRef}):`);
    console.log("- base manifest: available and valid");
    console.log(`- added: ${delta.added.length}`);
    console.log(`- removed: ${delta.removed.length}`);
    console.log(`- changed: ${delta.changed.length}`);
    for (const entry of delta.added) {
      console.log(`  + ${entry.path} (${entry.environment})`);
    }
    for (const entry of delta.removed) {
      console.log(`  - ${entry.path} (${entry.environment})`);
    }
    for (const entry of delta.changed) {
      console.log(
        `  ~ ${entry.after.path} (${entry.before.environment} -> ${entry.after.environment})`
      );
    }
  } else {
    console.log("Branch/base classification delta: not requested (use --base-ref <git-ref>)");
  }

  return finish(outcome.exitCode);
  } catch (error) {
    const message = redactSensitiveValues(
      error instanceof Error ? `${error.name}: ${error.message}` : "Unknown inventory runner error.",
      sensitiveVerificationValues
    );
    console.error(`Credential-free inventory failed unexpectedly: ${message}`);
    return finish(1, { stage: "unexpected", message });
  } finally {
    console.log(
      `Credential-free inventory total elapsed: ${formatElapsed(Date.now() - totalStartedAt)}`
    );
  }
}

function discoverVitestFilesAtGitRef(
  projectRoot: string,
  baseRef: string
): string[] {
  const result = spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", baseRef, "--", "trainer-app/src"],
    {
      cwd: projectRoot,
      env: credentialFreeEnvironment(),
      encoding: "utf8",
      windowsHide: true,
    }
  );
  if (result.status !== 0) {
    throw new Error(`Unable to discover released test files at ${baseRef}.`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((file) => /^trainer-app\/src\/.+\.test\.tsx?$/.test(file))
    .map((file) => file.slice("trainer-app/".length))
    .sort();
}

function parseShardArgument(): { index: number; count: number; value: string } {
  const value = argumentValue("--shard");
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("Credential-free shard must use N/4 syntax.");
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (
    count !== CREDENTIAL_FREE_SHARD_COUNT ||
    index < 1 ||
    index > CREDENTIAL_FREE_SHARD_COUNT
  ) {
    throw new Error("Credential-free shard must be one of 1/4, 2/4, 3/4, or 4/4.");
  }
  return { index, count, value: `${index}/${count}` };
}

async function runCredentialFreeShard(input: {
  projectRoot: string;
  vitestCli: string;
}): Promise<number> {
  const shard = parseShardArgument();
  const classification = loadInventoryClassification(input.projectRoot);
  const excludedPaths = classification.manifest.suites.map((entry) => entry.path);
  const result = await runVitestPhase({
    phase: `credential-free shard ${shard.value}`,
    projectRoot: input.projectRoot,
    vitestCli: input.vitestCli,
    args: buildCredentialFreeShardVitestArgs({
      excludedFiles: excludedPaths,
      shardIndex: shard.index,
      shardCount: shard.count,
    }),
    environment: credentialFreeEnvironment(),
    sensitiveValues: sensitiveVerificationValues,
  });
  const summary = createCredentialFreeShardSummary({
    projectRoot: input.projectRoot,
    identity: inventoryComponentIdentity({
      projectRoot: input.projectRoot,
      manifest: classification.manifest,
      job: "credential-free-shard",
    }),
    shardIndex: shard.index,
    shardCount: shard.count,
    result,
  });
  const summaryPath = writeComponentSummary(
    input.projectRoot,
    `credential-free-shard-${shard.index}-of-${shard.count}-summary.json`,
    summary
  );
  printPhaseSummary(
    `Credential-free shard ${shard.value}`,
    summary.counts.selectedFiles,
    result
  );
  for (const line of formatVitestPhaseFailure(result)) console.error(line);
  console.log(`Credential-free shard summary: ${summaryPath}`);
  return summary.status === "pass" ? 0 : 1;
}

function emptyImportOnlyPhaseResult(): VitestPhaseResult {
  return {
    status: 0,
    summary: {
      files: { total: 0, passed: 0, failed: 0, skipped: 0 },
      tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
    },
    executedFiles: [],
    phase: "import-only placeholder suites",
    success: true,
    exitCode: 0,
    signal: null,
    abnormalTermination: false,
    terminationError: null,
    externalFailure: null,
    durationMs: 0,
    reporterState: "available",
    failureKind: "none",
    failures: [],
    artifactDiagnostics: [],
    artifacts: {
      root: "not-created",
      directory: "not-created",
      stdout: "not-created",
      stderr: "not-created",
      reporter: "not-created",
      metadata: "not-created",
    },
    artifactsRetained: false,
  };
}

async function runImportSafety(input: {
  projectRoot: string;
  vitestCli: string;
}): Promise<number> {
  const classification = loadInventoryClassification(input.projectRoot);
  const placeholderEnvironment = buildImportOnlyPlaceholderEnvironment(process.env);
  const placeholderErrors =
    validateImportOnlyPlaceholderEnvironment(placeholderEnvironment);
  const placeholderValidationPassed = placeholderErrors.length === 0;
  if (!placeholderValidationPassed) {
    throw new Error(`Import-only placeholder validation failed: ${placeholderErrors.join(" | ")}`);
  }
  const markerDirectory = mkdtempSync(
    path.join(tmpdir(), "trainer-import-only-connection-")
  );
  const attemptMarker = path.join(markerDirectory, "attempted");
  placeholderEnvironment[IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV] = attemptMarker;
  let result: VitestPhaseResult;
  let connectionAttempted = false;
  let socketGuardCompleted = false;
  try {
    result =
      classification.selection.importOnlyPlaceholder.length === 0
        ? emptyImportOnlyPhaseResult()
        : await runVitestPhase({
            phase: "import-only placeholder suites",
            projectRoot: input.projectRoot,
            vitestCli: input.vitestCli,
            args: buildImportSafetyVitestArgs(
              classification.selection.importOnlyPlaceholder.map(
                (entry) => entry.path
              )
            ),
            environment: placeholderEnvironment,
            sensitiveValues: sensitiveVerificationValues,
            postRunFailure: () =>
              existsSync(attemptMarker)
                ? "Import-only placeholder connection attempt was blocked."
                : null,
          });
    connectionAttempted = existsSync(attemptMarker);
    socketGuardCompleted = true;
    const summary = createImportSafetySummary({
      projectRoot: input.projectRoot,
      identity: inventoryComponentIdentity({
        projectRoot: input.projectRoot,
        manifest: classification.manifest,
        job: "import-safety",
      }),
      result,
      placeholderValidationPassed,
      socketGuardCompleted,
      connectionAttempted,
    });
    const summaryPath = writeComponentSummary(
      input.projectRoot,
      "import-safety-summary.json",
      summary
    );
    printPhaseSummary(
      "Import-only placeholder suites",
      classification.selection.importOnlyPlaceholder.length,
      result
    );
    for (const line of formatVitestPhaseFailure(result)) console.error(line);
    console.log(`Import-safety summary: ${summaryPath}`);
    console.log(
      `Import-only socket attempt: ${connectionAttempted ? "detected and blocked" : "none observed"}`
    );
    return summary.status === "pass" && !connectionAttempted ? 0 : 1;
  } finally {
    rmSync(markerDirectory, { recursive: true, force: true });
  }
}

function collectDownloadedComponentJson(projectRoot: string): unknown[] {
  const root = path.join(
    projectRoot,
    "artifacts",
    "credential-free-inventory",
    "downloaded-components"
  );
  if (!existsSync(root)) return [];
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files.sort().map((file) => {
    if (path.extname(file) !== ".json") {
      return { malformedComponentArtifact: path.basename(file) };
    }
    try {
      return JSON.parse(readFileSync(file, "utf8")) as unknown;
    } catch {
      return null;
    }
  });
}

function runCredentialFreeAggregateValidation(input: {
  projectRoot: string;
}): ReturnType<typeof validateCredentialFreeAggregate> {
  const aggregateStartedAt = Date.now();
  const classification = loadInventoryClassification(input.projectRoot);
  const baseRef = baseRefFromArgs();
  const baselineErrors: string[] = [];
  if (!baseRef) {
    baselineErrors.push("released baseline ref is missing");
  } else {
    const baseManifest = readBaseManifest(input.projectRoot, baseRef);
    if (!baseManifest.manifest) {
      baselineErrors.push(
        baseManifest.error ?? `Released baseline ${baseRef} is unavailable.`
      );
    } else {
      const baseSelection = selectTestSuitesByEnvironment({
        manifest: baseManifest.manifest,
        discoveredTestFiles: discoverVitestFilesAtGitRef(
          input.projectRoot,
          baseRef
        ),
      });
      for (const [label, releasedFiles, candidateFiles] of [
        [
          "credential-free",
          baseSelection.credentialFree,
          classification.selection.credentialFree,
        ],
        [
          "import-only",
          baseSelection.importOnlyPlaceholder.map((entry) => entry.path),
          classification.selection.importOnlyPlaceholder.map((entry) => entry.path),
        ],
        [
          "database-required",
          baseSelection.databaseRequired.map((entry) => entry.path),
          classification.selection.databaseRequired.map((entry) => entry.path),
        ],
      ] as const) {
        const candidateSet = new Set(candidateFiles);
        for (const file of releasedFiles) {
          if (!candidateSet.has(file)) {
            baselineErrors.push(
              `released ${label} file is missing or reclassified: ${file}`
            );
          }
        }
      }
      console.log(
        `Released baseline parity (${baseRef}): ${baseSelection.credentialFree.length} credential-free, ${baseSelection.importOnlyPlaceholder.length} import-only, ${baseSelection.databaseRequired.length} database-required files retained.`
      );
    }
  }
  const identity = inventoryComponentIdentity({
    projectRoot: input.projectRoot,
    manifest: classification.manifest,
    job: "credential-free-inventory",
  });
  const expected: AggregateValidationExpectation = {
    ...identity,
    credentialFreeFiles: classification.selection.credentialFree,
    importOnlyFiles: classification.selection.importOnlyPlaceholder.map(
      (entry) => entry.path
    ),
    databaseRequiredFiles: classification.selection.databaseRequired.map(
      (entry) => entry.path
    ),
    dependencyResults: {
      credentialShards:
        argumentValue("--credential-shards-result") ?? "missing",
      importSafety: argumentValue("--import-safety-result") ?? "missing",
    },
  };
  let validation = validateCredentialFreeAggregate({
    untrustedComponents: collectDownloadedComponentJson(input.projectRoot),
    expected,
  });
  if (baselineErrors.length > 0) {
    validation = {
      valid: false,
      errors: [
        ...(validation.valid ? [] : validation.errors),
        ...baselineErrors,
      ],
    };
  }
  const aggregateDirectory = path.join(
    input.projectRoot,
    "artifacts",
    "credential-free-inventory",
    "aggregate"
  );
  mkdirSync(aggregateDirectory, { recursive: true });
  writeFileSync(
    path.join(aggregateDirectory, "aggregate-validation.json"),
    `${JSON.stringify(validation, null, 2)}\n`,
    "utf8"
  );
  if (!validation.valid) {
    console.error("Credential-free aggregate validation failed:");
    for (const error of validation.errors) console.error(`- ${error}`);
  } else {
    const evidence = createShardedCredentialFreeVerificationEvidence({
      projectRoot: input.projectRoot,
      manifest: classification.manifest,
      aggregate: validation.aggregate,
      aggregateDurationMs: Date.now() - aggregateStartedAt,
      environment: process.env,
    });
    const evidencePath = publishCredentialFreeVerificationEvidence({
      projectRoot: input.projectRoot,
      evidence,
      environment: process.env,
    });
    console.log(`Credential-free verification evidence: ${evidencePath}`);
    console.log(`Credential-free tested tree: ${evidence.treeSha}`);
    console.log(
      `Credential-free verification definition: ${evidence.verificationDefinitionHash}`
    );
    console.log(`Credential-free classification: ${evidence.classificationHash}`);
    console.log("Credential-free sharded aggregate status: pass");
  }
  return validation;
}

function expectedPrismaModels(schema: string | undefined): string[] {
  return schema
    ? [
        ...schema.matchAll(
          /\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm
        ),
      ]
        .filter((match) => !match[2].includes("@@ignore"))
        .map((match) => match[1])
    : [];
}

function probeGeneratedPrismaClient(
  clientForwarder: string,
  expectedModels: readonly string[]
): { importSucceeded: boolean; expectedModelsAvailable: boolean } {
  const probe = [
    "const client=require(process.argv[1]);",
    "const expected=JSON.parse(process.argv[2]);",
    "const models=client.Prisma?.dmmf?.datamodel?.models?.map((model)=>model.name);",
    "if(typeof client.PrismaClient!==\"function\"||!Array.isArray(models))process.exit(1);",
    "if(!expected.every((name)=>models.includes(name)))process.exit(2);",
  ].join("");
  const env = credentialFreeEnvironment();
  const result = spawnSync(
    process.execPath,
    ["-e", probe, clientForwarder, JSON.stringify(expectedModels)],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      windowsHide: true,
    }
  );
  return {
    importSucceeded: result.status === 0 || result.status === 2,
    expectedModelsAvailable: result.status === 0,
  };
}

const projectRoot = process.cwd();
const dependency = inspectDependencyFilesystem({
  currentProjectRoot: projectRoot,
  registeredWorktreeRoots: registeredWorktreeRoots(projectRoot),
  platform: process.platform,
  validateInstallation: validateDependencyInstallation,
});
const nodeModulesPath = dependency.dependencyRoot;
const checkedInSchema = readOptional(path.join(projectRoot, "prisma", "schema.prisma"));
const probe =
  existsSync(path.join(nodeModulesPath, "@prisma", "client", "default.js"))
    ? probeGeneratedPrismaClient(
        path.join(nodeModulesPath, "@prisma", "client", "default.js"),
        expectedPrismaModels(checkedInSchema)
      )
    : { importSucceeded: false, expectedModelsAvailable: false };
const prismaReadiness = inspectPrismaClientFilesystem({
  checkedInSchemaPath: path.join(projectRoot, "prisma", "schema.prisma"),
  dependencyRoot: nodeModulesPath,
  dependenciesAvailable: dependency.installation === "available",
  importProbeSucceeded: probe.importSucceeded,
  expectedModelMetadataAvailable: probe.expectedModelsAvailable,
});
const dockerProbe = spawnSync("docker", ["--version"], {
  env: credentialFreeEnvironment(),
  encoding: "utf8",
  windowsHide: true,
  timeout: 5_000,
});

const report = buildTestEnvironmentPreflight({
  databaseTargets: databaseTargets(),
  dependencyInstallation: dependency.installation,
  dependencyArrangement: dependency.arrangement,
  dependencyLinkAllowed: dependency.linkAllowed,
  prismaReadiness,
  docker: capability(dockerProbe.status === 0),
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...report, dependencyIntegrity }, null, 2));
} else {
  console.log("Trainer test environment preflight");
  console.log(
    `- dependencies: ${report.capabilities.dependencyInstallation} (${report.capabilities.dependencyArrangement})`
  );
  console.log(
    `- dependency link policy: ${report.capabilities.dependencyLinkAllowed ? "allowed" : "not-allowed"}`
  );
  if (dependencyIntegrity && !dependencyIntegrity.success) {
    console.error("Dependency-readiness failure: critical exact-lock integrity did not pass.");
    for (const issue of dependencyIntegrity.issues) {
      console.error(
        `- package=${issue.packageName}; locked=${issue.lockedVersion ?? "missing"}; installed=${issue.installedVersion ?? "missing"}; check=${issue.check}; ${issue.detail}`
      );
    }
    console.error(`- recovery: ${dependencyIntegrity.recovery}`);
  }
  console.log(`- Prisma readiness: ${report.capabilities.prismaReadiness}`);
  for (const name of DATABASE_TARGET_ENV_VARS) {
    console.log(`- ${name}: ${report.databaseTargets[name]}`);
  }
  console.log(`- Docker CLI: ${report.capabilities.docker}`);
  for (const group of Object.values(report.groups)) {
    console.log(`- ${group.command}: ${group.status} — ${group.reason}`);
  }
  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  for (const blocker of report.blockers) console.error(`blocker: ${blocker}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--run-credential-free-shard")) {
    process.exitCode = report.success
      ? await runCredentialFreeShard({
          projectRoot,
          vitestCli: path.join(nodeModulesPath, "vitest", "vitest.mjs"),
        })
      : 1;
  } else if (process.argv.includes("--run-import-safety")) {
    process.exitCode = report.success
      ? await runImportSafety({
          projectRoot,
          vitestCli: path.join(nodeModulesPath, "vitest", "vitest.mjs"),
        })
      : 1;
  } else if (process.argv.includes("--run-credential-free-aggregate")) {
    process.exitCode = report.success && runCredentialFreeAggregateValidation({ projectRoot }).valid
      ? 0
      : 1;
  } else if (process.argv.includes("--run-credential-free-inventory")) {
    const manifestPath = path.join(projectRoot, "scripts", "test-suite-environments.json");
    const execution = report.success
      ? await runCredentialFreeInventory({
          projectRoot,
          vitestCli: path.join(nodeModulesPath, "vitest", "vitest.mjs"),
        })
      : {
          manifest: readJson<TestSuiteEnvironmentManifest>(manifestPath),
          filesDiscovered: 0,
          credentialFreeSelected: 0,
          importOnlySelected: 0,
          databaseRequiredExcluded: 0,
          credentialFreeResult: null,
          importOnlyResult: null,
          placeholderConnectionAttempted: false,
          exitCode: 1,
          failureStage: "dependency-readiness" as const,
          failureMessage: "Dependency readiness preflight did not pass.",
          qualification: null,
          totalDurationMs: 0,
          baseRef: baseRefFromArgs(),
        };
    process.exitCode = execution.exitCode;
    try {
      const evidence = createCredentialFreeVerificationEvidence({
        projectRoot,
        ...execution,
        environment: process.env,
      });
      const evidencePath = publishCredentialFreeVerificationEvidence({
        projectRoot,
        evidence,
        environment: process.env,
      });
      console.log(`Credential-free verification evidence: ${evidencePath}`);
      console.log(`Credential-free tested tree: ${evidence.treeSha}`);
      console.log(`Credential-free verification definition: ${evidence.verificationDefinitionHash}`);
      console.log(`Credential-free classification: ${evidence.classificationHash}`);
      console.log(`Credential-free evidence status: ${evidence.status}`);
    } catch (error) {
      const message = redactSensitiveValues(
        error instanceof Error ? `${error.name}: ${error.message}` : "Unknown evidence publication error.",
        sensitiveVerificationValues
      );
      console.error(`Credential-free evidence publication failed: ${message}`);
      process.exitCode = 1;
    }
  } else if (!report.success) {
    process.exitCode = 1;
  } else if (process.argv.includes("--run-verify-gate")) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli || !existsSync(npmCli)) {
      console.error("blocker: npm CLI path is unavailable.");
      process.exitCode = 1;
    } else {
      process.exitCode = runSanitized(process.execPath, [npmCli, "run", "verify"]);
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    `Credential-free runner failed unexpectedly: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`
  );
  process.exitCode = 1;
});
