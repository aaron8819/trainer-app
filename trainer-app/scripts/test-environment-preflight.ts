import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildImportOnlyPlaceholderEnvironment,
  buildTestEnvironmentPreflight,
  compareTestSuiteEnvironmentManifests,
  DATABASE_TARGET_ENV_VARS,
  IMPORT_ONLY_PLACEHOLDER_URL,
  inspectDependencyFilesystem,
  inspectPrismaClientFilesystem,
  parseVitestSummary,
  sanitizeDatabaseTargetEnvironment,
  selectTestSuitesByEnvironment,
  validateImportOnlyPlaceholderEnvironment,
  validateTestSuiteEnvironmentManifest,
  type CapabilityStatus,
  type DatabaseTargetEnvironment,
  type TestCommandRegistryEntry,
  type TestSuiteEnvironmentManifest,
  type VitestSummaryCounts,
} from "../src/lib/operations/test-environment-preflight";
import { IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV } from "../src/lib/operations/import-only-placeholder-guard";

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

function validateDependencyInstallation(projectRoot: string): boolean {
  const npmCli = resolveNpmCli();
  if (!npmCli) return false;
  const result = spawnSync(process.execPath, [npmCli, "ls", "--all", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
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
  const env = sanitizeDatabaseTargetEnvironment(process.env);
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

function runVitestPhase(input: {
  vitestCli: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
}): {
  status: number;
  summary: VitestSummaryCounts | null;
  termination: string | null;
} {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), "trainer-vitest-output-"));
  const stdoutPath = path.join(outputDirectory, "stdout.log");
  const stderrPath = path.join(outputDirectory, "stderr.log");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const result = (() => {
    try {
      return spawnSync(process.execPath, [input.vitestCli, "run", ...input.args], {
        cwd: process.cwd(),
        env: input.environment,
        windowsHide: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
  })();
  const { stdout, stderr } = (() => {
    try {
      return {
        stdout: readFileSync(stdoutPath, "utf8"),
        stderr: readFileSync(stderrPath, "utf8"),
      };
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  })();
  const termination = result.error
    ? `${result.error.name}: ${result.error.message}`
    : result.signal
      ? `signal ${result.signal}`
      : null;
  if (process.env.CI !== "true") {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } else if (result.status !== 0 || termination) {
    const failureTailLimit = 256 * 1024;
    console.error("Vitest failure output (bounded tail):");
    process.stderr.write(`${stdout}\n${stderr}`.slice(-failureTailLimit));
  }
  if (termination) {
    console.error(`Vitest process terminated abnormally: ${termination}`);
  }
  const status = result.status ?? 1;
  return {
    status,
    summary: parseVitestSummary(stdout),
    termination,
  };
}

function printPhaseSummary(
  label: string,
  selectedFiles: number,
  result: {
    status: number;
    summary: VitestSummaryCounts | null;
    termination: string | null;
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
  console.log(`- abnormal process termination: ${result.termination ?? "none"}`);
}

function runCredentialFreeInventory(input: {
  projectRoot: string;
  vitestCli: string;
}): number {
  const ciVitestArgs =
    process.env.CI === "true"
      ? ["--maxWorkers", "1", "--reporter", "json"]
      : [];
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
  const manifest = readJson<TestSuiteEnvironmentManifest>(manifestPath);
  const policy = readJson<{ commandRegistry: TestCommandRegistryEntry[] }>(policyPath);
  const discoveredTestFiles = discoverVitestFiles(input.projectRoot);
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
    return 1;
  }
  const baseRef = baseRefFromArgs();
  let baseManifest: TestSuiteEnvironmentManifest | undefined;
  if (baseRef) {
    const baseResult = readBaseManifest(input.projectRoot, baseRef);
    if (baseResult.error) {
      console.error("Unexpected branch/base comparison failure:");
      console.error(`- ${baseResult.error}`);
      return 1;
    }
    baseManifest = baseResult.manifest;
  }

  const selection = selectTestSuitesByEnvironment({
    manifest,
    discoveredTestFiles,
  });
  const excludedPaths = manifest.suites.map((entry) => entry.path);

  console.log("Credential-free inventory classification");
  console.log(`- total test files discovered: ${discoveredTestFiles.length}`);
  console.log(`- credential-free files selected: ${selection.credentialFree.length}`);
  console.log(
    `- import-only placeholder files selected: ${selection.importOnlyPlaceholder.length}`
  );
  console.log(`- DB-required files excluded: ${selection.databaseRequired.length}`);
  console.log(
    `- Vitest worker limit: ${ciVitestArgs.length > 0 ? "1 (CI)" : "runner default"}`
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

  const credentialFreeResult = runVitestPhase({
    vitestCli: input.vitestCli,
    args: [
      ...excludedPaths.flatMap((testFile) => ["--exclude", testFile]),
      ...ciVitestArgs,
    ],
    environment: credentialFreeEnvironment(),
  });

  const placeholderEnvironment = buildImportOnlyPlaceholderEnvironment(process.env);
  const placeholderErrors =
    validateImportOnlyPlaceholderEnvironment(placeholderEnvironment);
  if (placeholderErrors.length > 0) {
    console.error("Import-only placeholder environment validation failed.");
    for (const error of placeholderErrors) console.error(`- ${error}`);
    return 1;
  }
  const markerDirectory = mkdtempSync(
    path.join(tmpdir(), "trainer-import-only-connection-")
  );
  const attemptMarker = path.join(markerDirectory, "attempted");
  placeholderEnvironment[IMPORT_ONLY_CONNECTION_ATTEMPT_MARKER_ENV] = attemptMarker;
  let importOnlyResult: {
    status: number;
    summary: VitestSummaryCounts | null;
    termination: string | null;
  };
  let placeholderConnectionAttempted = false;
  try {
    importOnlyResult =
      selection.importOnlyPlaceholder.length === 0
        ? {
            status: 0,
            summary: {
              files: { total: 0, passed: 0, failed: 0, skipped: 0 },
              tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
            },
            termination: null,
          }
        : runVitestPhase({
            vitestCli: input.vitestCli,
            args: [
              ...selection.importOnlyPlaceholder.map((entry) => entry.path),
              ...ciVitestArgs,
            ],
            environment: placeholderEnvironment,
          });
    if (existsSync(attemptMarker)) {
      placeholderConnectionAttempted = true;
      console.error(
        "Unexpected import-only placeholder connection attempt was blocked."
      );
      importOnlyResult.status = 1;
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
  const credentialFreeFailure = credentialFreeResult.status !== 0;
  const importOnlyFailure = importOnlyResult.status !== 0;
  const malformedResult =
    !credentialFreeResult.summary || !importOnlyResult.summary;
  console.log("Unexpected failure status:");
  console.log(
    `- credential-free collection, setup, import, or test failure: ${credentialFreeFailure ? "present" : "none"}`
  );
  console.log(
    `- import-only collection, setup, import, or test failure: ${importOnlyFailure ? "present" : "none"}`
  );
  console.log(
    `- malformed or incomplete Vitest result: ${malformedResult ? "present" : "none"}`
  );
  console.log("- manifest or classification failure: none");
  console.log(`- branch/base comparison failure: ${baseRef ? "none" : "not requested"}`);
  const unexpectedFailure =
    credentialFreeFailure || importOnlyFailure || malformedResult;

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

  return unexpectedFailure ? 1 : 0;
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
  const env = sanitizeDatabaseTargetEnvironment(process.env);
  env.TRAINER_CREDENTIAL_FREE_TEST = "1";
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
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Trainer test environment preflight");
  console.log(
    `- dependencies: ${report.capabilities.dependencyInstallation} (${report.capabilities.dependencyArrangement})`
  );
  console.log(
    `- dependency link policy: ${report.capabilities.dependencyLinkAllowed ? "allowed" : "not-allowed"}`
  );
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

if (!report.success) {
  process.exitCode = 1;
} else if (process.argv.includes("--run-credential-free-inventory")) {
  process.exitCode = runCredentialFreeInventory({
    projectRoot,
    vitestCli: path.join(nodeModulesPath, "vitest", "vitest.mjs"),
  });
} else if (process.argv.includes("--run-verify-gate")) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) {
    console.error("blocker: npm CLI path is unavailable.");
    process.exitCode = 1;
  } else {
    process.exitCode = runSanitized(process.execPath, [npmCli, "run", "verify"]);
  }
}
