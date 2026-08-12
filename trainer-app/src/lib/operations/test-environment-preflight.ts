import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

export const CRITICAL_VERIFICATION_DEPENDENCIES = [
  "vitest",
  "@vitest/coverage-v8",
  "vite",
  "@vitejs/plugin-react",
  "tsx",
  "happy-dom",
  "jsdom",
  "prisma",
  "@prisma/client",
  "@prisma/adapter-pg",
] as const;

export type CriticalVerificationDependency =
  (typeof CRITICAL_VERIFICATION_DEPENDENCIES)[number];
export type CriticalDependencyIntegrityCheck =
  | "npm-tree"
  | "root-lock-metadata"
  | "root-lock-entry"
  | "installed-package-metadata"
  | "installed-version"
  | "hidden-lock-metadata"
  | "hidden-lock-entry"
  | "hidden-lock-version";
export type CriticalDependencyIntegrityIssue = {
  packageName: CriticalVerificationDependency;
  lockedVersion: string | null;
  installedVersion: string | null;
  check: CriticalDependencyIntegrityCheck;
  detail: string;
};
export type CriticalDependencyIntegrityReport = {
  success: boolean;
  npmLsSucceeded: boolean;
  issues: CriticalDependencyIntegrityIssue[];
  recovery: string;
};

export const DATABASE_TARGET_ENV_VARS = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "DIRECT_URL",
  "SHADOW_DATABASE_URL",
  "SHADOW_URL",
] as const;
export const DISPOSABLE_DATABASE_CONFIRMATION_ENV =
  "TRAINER_DISPOSABLE_DB_CONFIRMED" as const;
export const IMPORT_ONLY_PLACEHOLDER_ENV =
  "TRAINER_IMPORT_ONLY_PLACEHOLDER_TEST" as const;
export const IMPORT_ONLY_PLACEHOLDER_URL =
  "postgresql://trainer_placeholder:placeholder@192.0.2.1:5432/trainer_placeholder" as const;

export type DatabaseTargetVariable = (typeof DATABASE_TARGET_ENV_VARS)[number];
export type DatabaseTargetEnvironment = Record<string, string | undefined> &
  Partial<Record<DatabaseTargetVariable, string | undefined>>;
export type TestSuiteEnvironmentClass =
  | "db-required"
  | "import-only-placeholder";
export type TestSuiteEnvironmentEntry = {
  path: string;
  environment: TestSuiteEnvironmentClass;
  owner: string;
  reason: string;
  commandId?: string;
  packageScript?: string;
};
export type TestSuiteEnvironmentManifest = {
  schema: "trainer-test-suite-environments";
  version: 1;
  suites: TestSuiteEnvironmentEntry[];
};
export type TestCommandRegistryEntry = {
  id: string;
  packageScript?: string;
  profile: string;
};
export type TestSuiteEnvironmentValidationError = {
  code:
    | "manifest-schema-invalid"
    | "manifest-version-invalid"
    | "registry-path-invalid"
    | "registry-path-not-test"
    | "registry-path-missing"
    | "registry-conflict"
    | "registry-environment-invalid"
    | "db-required-name-invalid"
    | "db-required-command-missing"
    | "db-required-command-unauthorized"
    | "import-only-command-invalid"
    | "unregistered-db-required-suite";
  path?: string;
  message: string;
};
export type TestSuiteEnvironmentSelection = {
  credentialFree: string[];
  importOnlyPlaceholder: TestSuiteEnvironmentEntry[];
  databaseRequired: TestSuiteEnvironmentEntry[];
};
export type VitestSummaryCounts = {
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
};
export type TestSuiteEnvironmentDelta = {
  added: TestSuiteEnvironmentEntry[];
  removed: TestSuiteEnvironmentEntry[];
  changed: Array<{
    before: TestSuiteEnvironmentEntry;
    after: TestSuiteEnvironmentEntry;
  }>;
};
export type CapabilityStatus = "available" | "missing" | "invalid";
export type TestGroupStatus = "runnable" | "blocked" | "separate";
export type DatabaseTargetStatus =
  | "missing"
  | "invalid"
  | "local-loopback"
  | "prohibited";
export type DependencyArrangement =
  | "standalone"
  | "junction"
  | "symlink"
  | "missing"
  | "unresolved";
export type PrismaReadiness =
  | "dependencies-missing"
  | "packages-missing"
  | "generated-client-missing"
  | "generated-client-partial-or-corrupt"
  | "generated-client-stale"
  | "compatible";

export type TestEnvironmentPreflightInput = {
  databaseTargets: DatabaseTargetEnvironment;
  dependencyInstallation: CapabilityStatus;
  dependencyArrangement: DependencyArrangement;
  dependencyLinkAllowed: boolean;
  prismaReadiness: PrismaReadiness;
  docker: CapabilityStatus;
};

export type TestEnvironmentPreflightReport = {
  success: boolean;
  databaseTargets: Record<DatabaseTargetVariable, DatabaseTargetStatus>;
  capabilities: {
    dependencyInstallation: CapabilityStatus;
    dependencyArrangement: DependencyArrangement;
    dependencyLinkAllowed: boolean;
    prismaReadiness: PrismaReadiness;
    docker: CapabilityStatus;
  };
  groups: {
    selectiveVerification: {
      status: TestGroupStatus;
      command: "npm run test:verify-gate";
      reason: string;
    };
    credentialFreeInventory: {
      status: TestGroupStatus;
      command: "npm run test:inventory:credential-free";
      reason: string;
    };
    disposableDatabase: {
      status: TestGroupStatus;
      command: "npm run test:db:workout-mutations -- --confirm-disposable";
      reason: string;
    };
    uiAudit: {
      status: TestGroupStatus;
      command: "npm run test:ui-audit";
      reason: string;
    };
  };
  blockers: string[];
  warnings: string[];
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SAFE_MUTATION_TARGET_QUERY_PARAMETERS = new Set([
  "application_name",
  "connect_timeout",
  "connection_limit",
  "pool_timeout",
  "schema",
  "socket_timeout",
  "sslmode",
]);
const SANITIZED_ENVIRONMENT_NAMES = new Set(
  [
    ...DATABASE_TARGET_ENV_VARS,
    DISPOSABLE_DATABASE_CONFIRMATION_ENV,
    IMPORT_ONLY_PLACEHOLDER_ENV,
  ].map((name) => name.toUpperCase())
);
const VERIFICATION_ENVIRONMENT_ALLOWLIST = new Set(
  [
    "APPDATA",
    "CI",
    "COLORTERM",
    "COMSPEC",
    "FORCE_COLOR",
    "GITHUB_ACTIONS",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_RUN_ID",
    "GITHUB_WORKSPACE",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOCALAPPDATA",
    "NODE_ENV",
    "NO_COLOR",
    "NPM_EXECPATH",
    "NPM_NODE_EXECPATH",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "RUNNER_ARCH",
    "RUNNER_OS",
    "RUNNER_TEMP",
    "SHELL",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "TZ",
    "USER",
    "USERPROFILE",
    "WINDIR",
  ].map((name) => name.toUpperCase())
);
const SENSITIVE_ENVIRONMENT_NAME =
  /(?:^|_)(?:ACCESS_KEY|API_KEY|AUTH|AUTHORIZATION|CLIENT_SECRET|CONNECTION_STRING|COOKIE|CREDENTIAL|CREDENTIALS|DATABASE_URL|DIRECT_URL|ID_TOKEN|PASSWORD|PASSCODE|PRIVATE_KEY|REFRESH_TOKEN|SECRET|SESSION_KEY|SHADOW_URL|TOKEN)(?:$|_)/;
const DATABASE_TARGET_REFERENCE =
  /\b(?:[A-Z][A-Z0-9_]*(?:DATABASE|POSTGRESQL|POSTGRES|DB)[A-Z0-9_]*_URL|DIRECT_URL|SHADOW_URL)\b/g;

function hasMalformedPercentEncoding(value: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(value);
}

function hasAmbiguousAuthority(databaseUrl: string): boolean {
  const schemeEnd = databaseUrl.indexOf("://");
  if (schemeEnd < 0) return false;
  const authorityEndCandidates = [
    databaseUrl.indexOf("/", schemeEnd + 3),
    databaseUrl.indexOf("?", schemeEnd + 3),
    databaseUrl.indexOf("#", schemeEnd + 3),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length > 0
      ? Math.min(...authorityEndCandidates)
      : databaseUrl.length;
  const authority = databaseUrl.slice(schemeEnd + 3, authorityEnd);
  return (authority.match(/@/g) ?? []).length > 1;
}

function hasUnsafeMutationTargetQuery(parsed: URL): boolean {
  const seen = new Set<string>();
  for (const rawKey of parsed.searchParams.keys()) {
    const key = rawKey.toLowerCase();
    if (!SAFE_MUTATION_TARGET_QUERY_PARAMETERS.has(key) || seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

export function classifyDatabaseTarget(databaseUrl?: string): DatabaseTargetStatus {
  if (!databaseUrl?.trim()) return "missing";
  if (
    hasMalformedPercentEncoding(databaseUrl) ||
    hasAmbiguousAuthority(databaseUrl)
  ) {
    return "invalid";
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return "invalid";
    }
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") return "invalid";
    decodeURIComponent(parsed.username);
    decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.pathname);
    if (hasUnsafeMutationTargetQuery(parsed)) return "invalid";

    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
      ? "local-loopback"
      : "prohibited";
  } catch {
    return "invalid";
  }
}

export function classifyDatabaseTargets(
  environment: DatabaseTargetEnvironment
): Record<DatabaseTargetVariable, DatabaseTargetStatus> {
  return Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [
      name,
      classifyDatabaseTarget(environment[name]),
    ])
  ) as Record<DatabaseTargetVariable, DatabaseTargetStatus>;
}

export function sanitizeDatabaseTargetEnvironment<
  T extends Record<string, string | undefined>,
>(environment: T): T {
  const sanitized = { ...environment } as T;
  for (const name of Object.keys(sanitized)) {
    if (SANITIZED_ENVIRONMENT_NAMES.has(name.toUpperCase())) {
      delete sanitized[name];
    }
  }
  return sanitized;
}

export function isSensitiveVerificationEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    SANITIZED_ENVIRONMENT_NAMES.has(normalized) ||
    normalized === "PGPASSWORD" ||
    normalized.endsWith("TOKEN") ||
    SENSITIVE_ENVIRONMENT_NAME.test(normalized)
  );
}

export function collectSensitiveVerificationEnvironmentValues(
  environment: Record<string, string | undefined>
): string[] {
  return [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([name, value]) =>
            isSensitiveVerificationEnvironmentName(name) &&
            typeof value === "string" &&
            value.length >= 8
        )
        .map(([, value]) => value as string)
    ),
  ].sort((left, right) => right.length - left.length);
}

export function buildCredentialSafeVerificationEnvironment(
  environment: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const nodeEnvironment =
    environment.NODE_ENV === "development" || environment.NODE_ENV === "production"
      ? environment.NODE_ENV
      : "test";
  const safe: NodeJS.ProcessEnv = { NODE_ENV: nodeEnvironment };
  const seen = new Set<string>(["NODE_ENV"]);
  for (const [name, value] of Object.entries(environment)) {
    const normalized = name.toUpperCase();
    if (
      value === undefined ||
      seen.has(normalized) ||
      isSensitiveVerificationEnvironmentName(name) ||
      !VERIFICATION_ENVIRONMENT_ALLOWLIST.has(normalized)
    ) {
      continue;
    }
    safe[name] = value;
    seen.add(normalized);
  }
  return safe;
}

function normalizedTestPath(testPath: string): string {
  return testPath.replaceAll("\\", "/");
}

function isTestFilePath(testPath: string): boolean {
  return /^src\/.+\.test\.tsx?$/.test(testPath);
}

function isDatabaseTestFilePath(testPath: string): boolean {
  return /\.db\.test\.tsx?$/.test(testPath);
}

export function validateTestSuiteEnvironmentManifest(input: {
  manifest: TestSuiteEnvironmentManifest;
  discoveredTestFiles: readonly string[];
  commandRegistry: readonly TestCommandRegistryEntry[];
}): TestSuiteEnvironmentValidationError[] {
  const errors: TestSuiteEnvironmentValidationError[] = [];
  if (input.manifest.schema !== "trainer-test-suite-environments") {
    errors.push({
      code: "manifest-schema-invalid",
      message: "The test-suite environment manifest schema is invalid.",
    });
  }
  if (input.manifest.version !== 1) {
    errors.push({
      code: "manifest-version-invalid",
      message: "The test-suite environment manifest version is unsupported.",
    });
  }

  const discovered = new Set(input.discoveredTestFiles.map(normalizedTestPath));
  const commands = new Map(input.commandRegistry.map((entry) => [entry.id, entry]));
  const entriesByPath = new Map<string, TestSuiteEnvironmentEntry>();

  for (const entry of input.manifest.suites) {
    const normalizedPath = normalizedTestPath(entry.path);
    if (normalizedPath !== entry.path || normalizedPath.includes("..")) {
      errors.push({
        code: "registry-path-invalid",
        path: entry.path,
        message: `${entry.path} must be a normalized repository-relative path.`,
      });
    }
    if (!isTestFilePath(normalizedPath)) {
      errors.push({
        code: "registry-path-not-test",
        path: entry.path,
        message: `${entry.path} is not a Trainer Vitest file path.`,
      });
    } else if (!discovered.has(normalizedPath)) {
      errors.push({
        code: "registry-path-missing",
        path: entry.path,
        message: `${entry.path} is registered but does not exist.`,
      });
    }

    if (entriesByPath.has(normalizedPath)) {
      errors.push({
        code: "registry-conflict",
        path: entry.path,
        message: `${entry.path} is registered more than once.`,
      });
    } else {
      entriesByPath.set(normalizedPath, entry);
    }

    if (
      entry.environment !== "db-required" &&
      entry.environment !== "import-only-placeholder"
    ) {
      errors.push({
        code: "registry-environment-invalid",
        path: entry.path,
        message: `${entry.path} has an unsupported environment class.`,
      });
      continue;
    }

    if (entry.environment === "db-required") {
      if (!isDatabaseTestFilePath(normalizedPath)) {
        errors.push({
          code: "db-required-name-invalid",
          path: entry.path,
          message: `${entry.path} must use the .db.test.ts(x) convention.`,
        });
      }
      const command = entry.commandId ? commands.get(entry.commandId) : undefined;
      if (!entry.commandId || !entry.packageScript || !command) {
        errors.push({
          code: "db-required-command-missing",
          path: entry.path,
          message: `${entry.path} has no registered DB-backed execution command.`,
        });
      } else if (
        command.packageScript !== entry.packageScript ||
        command.profile !== "disposable-database-write"
      ) {
        errors.push({
          code: "db-required-command-unauthorized",
          path: entry.path,
          message: `${entry.path} points to a command without the required disposable-database-write profile.`,
        });
      }
    } else if (entry.commandId || entry.packageScript) {
      errors.push({
        code: "import-only-command-invalid",
        path: entry.path,
        message: `${entry.path} is import-only and must not claim DB-backed execution.`,
      });
    }
  }

  for (const testFile of discovered) {
    if (
      isDatabaseTestFilePath(testFile) &&
      entriesByPath.get(testFile)?.environment !== "db-required"
    ) {
      errors.push({
        code: "unregistered-db-required-suite",
        path: testFile,
        message: `${testFile} uses the DB-required naming convention but is not registered as DB-required.`,
      });
    }
  }

  return errors;
}

export function selectTestSuitesByEnvironment(input: {
  manifest: TestSuiteEnvironmentManifest;
  discoveredTestFiles: readonly string[];
}): TestSuiteEnvironmentSelection {
  const classifiedPaths = new Set(
    input.manifest.suites.map((entry) => normalizedTestPath(entry.path))
  );
  return {
    credentialFree: input.discoveredTestFiles
      .map(normalizedTestPath)
      .filter((testFile) => !classifiedPaths.has(testFile))
      .sort(),
    importOnlyPlaceholder: input.manifest.suites
      .filter((entry) => entry.environment === "import-only-placeholder")
      .sort((left, right) => left.path.localeCompare(right.path)),
    databaseRequired: input.manifest.suites
      .filter((entry) => entry.environment === "db-required")
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function buildImportOnlyPlaceholderEnvironment(
  environment: Record<string, string | undefined>
): NodeJS.ProcessEnv &
  Record<typeof IMPORT_ONLY_PLACEHOLDER_ENV, "1"> & {
    DATABASE_URL: typeof IMPORT_ONLY_PLACEHOLDER_URL;
    TRAINER_CREDENTIAL_FREE_TEST: "1";
  } {
  const sanitized = buildCredentialSafeVerificationEnvironment(environment);
  return {
    ...sanitized,
    DATABASE_URL: IMPORT_ONLY_PLACEHOLDER_URL,
    TRAINER_CREDENTIAL_FREE_TEST: "1",
    [IMPORT_ONLY_PLACEHOLDER_ENV]: "1",
  } as NodeJS.ProcessEnv &
    Record<typeof IMPORT_ONLY_PLACEHOLDER_ENV, "1"> & {
      DATABASE_URL: typeof IMPORT_ONLY_PLACEHOLDER_URL;
      TRAINER_CREDENTIAL_FREE_TEST: "1";
    };
}

export function validateImportOnlyPlaceholderEnvironment(
  environment: Record<string, string | undefined>
): string[] {
  const errors: string[] = [];
  if (environment.DATABASE_URL !== IMPORT_ONLY_PLACEHOLDER_URL) {
    errors.push("Import-only placeholder mode requires the exact reserved TEST-NET database URL.");
  }
  for (const name of DATABASE_TARGET_ENV_VARS) {
    if (name !== "DATABASE_URL" && environment[name]?.trim()) {
      errors.push(`${name} must remain unset in import-only placeholder mode.`);
    }
  }
  if (environment[IMPORT_ONLY_PLACEHOLDER_ENV] !== "1") {
    errors.push(`${IMPORT_ONLY_PLACEHOLDER_ENV} must be enabled.`);
  }
  if (environment.TRAINER_CREDENTIAL_FREE_TEST !== "1") {
    errors.push("TRAINER_CREDENTIAL_FREE_TEST must remain enabled.");
  }
  return errors;
}

function parseSummaryLine(line: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} | null {
  const totalMatch = line.match(/\((\d+)\)\s*$/);
  if (!totalMatch) return null;
  const counts = { total: Number(totalMatch[1]), passed: 0, failed: 0, skipped: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped)/g)) {
    counts[match[2] as "passed" | "failed" | "skipped"] = Number(match[1]);
  }
  return counts;
}

export function parseVitestSummary(output: string): VitestSummaryCounts | null {
  const sanitizedOutput = output.replace(
    /\u001B\[[0-?]*[ -/]*[@-~]/g,
    ""
  );
  try {
    const json = JSON.parse(sanitizedOutput) as {
      numTotalTests?: unknown;
      numPassedTests?: unknown;
      numFailedTests?: unknown;
      numPendingTests?: unknown;
      numTodoTests?: unknown;
      testResults?: Array<{ status?: unknown }>;
    };
    const testCounts = [
      json.numTotalTests,
      json.numPassedTests,
      json.numFailedTests,
      json.numPendingTests,
      json.numTodoTests,
    ];
    if (
      !Array.isArray(json.testResults) ||
      !testCounts.every(
        (count) => Number.isInteger(count) && Number(count) >= 0
      )
    ) {
      return null;
    }
    const files = { total: json.testResults.length, passed: 0, failed: 0, skipped: 0 };
    for (const result of json.testResults) {
      if (result.status === "passed") files.passed += 1;
      else if (result.status === "failed") files.failed += 1;
      else if (result.status === "pending") files.skipped += 1;
      else return null;
    }
    const tests = {
      total: Number(json.numTotalTests),
      passed: Number(json.numPassedTests),
      failed: Number(json.numFailedTests),
      skipped: Number(json.numPendingTests) + Number(json.numTodoTests),
    };
    if (tests.passed + tests.failed + tests.skipped !== tests.total) {
      return null;
    }
    return { files, tests };
  } catch {
    // Human-readable Vitest output is parsed below for local runs.
  }
  const lines = sanitizedOutput.split(/\r?\n/);
  const fileLine = [...lines].reverse().find((line) => /\bTest Files\b/.test(line));
  const testLine = [...lines].reverse().find((line) => /^\s*Tests\s+/.test(line));
  if (!fileLine || !testLine) return null;
  const files = parseSummaryLine(fileLine);
  const tests = parseSummaryLine(testLine);
  return files && tests ? { files, tests } : null;
}

function comparableEnvironmentEntry(entry: TestSuiteEnvironmentEntry): string {
  return JSON.stringify({
    environment: entry.environment,
    owner: entry.owner,
    reason: entry.reason,
    commandId: entry.commandId ?? null,
    packageScript: entry.packageScript ?? null,
  });
}

export function compareTestSuiteEnvironmentManifests(
  base: TestSuiteEnvironmentManifest | undefined,
  current: TestSuiteEnvironmentManifest
): TestSuiteEnvironmentDelta {
  const baseEntries = new Map((base?.suites ?? []).map((entry) => [entry.path, entry]));
  const currentEntries = new Map(current.suites.map((entry) => [entry.path, entry]));
  const added = current.suites.filter((entry) => !baseEntries.has(entry.path));
  const removed = (base?.suites ?? []).filter((entry) => !currentEntries.has(entry.path));
  const changed: TestSuiteEnvironmentDelta["changed"] = [];
  for (const [testPath, after] of currentEntries) {
    const before = baseEntries.get(testPath);
    if (before && comparableEnvironmentEntry(before) !== comparableEnvironmentEntry(after)) {
      changed.push({ before, after });
    }
  }
  return {
    added: added.sort((left, right) => left.path.localeCompare(right.path)),
    removed: removed.sort((left, right) => left.path.localeCompare(right.path)),
    changed: changed.sort((left, right) =>
      left.after.path.localeCompare(right.after.path)
    ),
  };
}

export function parseExactDisposableConfirmationArgs(
  args: readonly string[],
  requiredInvocation?: string
): { valid: true } | { valid: false; message: string } {
  return args.length === 1 && args[0] === "--confirm-disposable"
    ? { valid: true }
    : {
        valid: false,
        message: [
          "Invalid invocation. Expected exactly one argument: --confirm-disposable.",
          requiredInvocation ? `Run: ${requiredInvocation}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
}

function normalizedDatabaseIdentity(value: string): string | null {
  if (classifyDatabaseTarget(value) !== "local-loopback") return null;
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const normalizedHost =
    host === "::1" || host === "localhost" || host === "127.0.0.1"
      ? "loopback"
      : host;
  const port = parsed.port || "5432";
  parsed.searchParams.sort();
  return `${normalizedHost}:${port}${parsed.pathname}?${parsed.searchParams.toString()}`;
}

export function validateDisposableDatabaseTargets(input: {
  environment: Record<string, string | undefined>;
  confirmed: boolean;
  requiredTargets?: readonly DatabaseTargetVariable[];
  matchingTargetPairs?: readonly (readonly [
    DatabaseTargetVariable,
    DatabaseTargetVariable,
  ])[];
}): { valid: boolean; reasons: string[] } {
  const databaseTargets = Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, input.environment[name]])
  ) as DatabaseTargetEnvironment;
  const statuses = classifyDatabaseTargets(databaseTargets);
  const reasons: string[] = [];
  const requiredTargets = input.requiredTargets ?? ["DATABASE_URL", "TEST_DATABASE_URL"];
  const matchingTargetPairs =
    input.matchingTargetPairs ?? [["DATABASE_URL", "TEST_DATABASE_URL"]];
  if (!input.confirmed) reasons.push("Explicit disposable database confirmation is required.");

  for (const name of DATABASE_TARGET_ENV_VARS) {
    const status = statuses[name];
    if (status === "invalid") reasons.push(`${name} is malformed or unsupported.`);
    if (status === "prohibited") reasons.push(`${name} is not an approved disposable target.`);
  }

  for (const name of requiredTargets) {
    if (!input.environment[name]?.trim()) {
      reasons.push(`${name} is required for database integration.`);
    }
  }

  for (const [leftName, rightName] of matchingTargetPairs) {
    const left = input.environment[leftName]?.trim();
    const right = input.environment[rightName]?.trim();
    if (left && right) {
      const leftIdentity = normalizedDatabaseIdentity(left);
      const rightIdentity = normalizedDatabaseIdentity(right);
      if (!leftIdentity || !rightIdentity || leftIdentity !== rightIdentity) {
        reasons.push(`${leftName} and ${rightName} must identify the same disposable target.`);
      }
    }
  }

  return { valid: reasons.length === 0, reasons };
}

export function resolveDisposableDatabaseTestTarget(
  environment: Record<string, string | undefined>
): string | undefined {
  const configured = DATABASE_TARGET_ENV_VARS.some(
    (name) => Boolean(environment[name]?.trim())
  );
  if (!configured) return undefined;

  const databaseTargets = Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, environment[name]])
  ) as DatabaseTargetEnvironment;
  const validation = validateDisposableDatabaseTargets({
    environment: databaseTargets,
    confirmed: environment[DISPOSABLE_DATABASE_CONFIRMATION_ENV] === "1",
  });
  if (!validation.valid) {
    throw new Error(`DATABASE_TEST_TARGET_BLOCKED:${validation.reasons.join("|")}`);
  }
  return environment.TEST_DATABASE_URL!.trim();
}

export function discoverDatabaseTargetVariableReferences(source: string): string[] {
  return [...new Set(source.match(DATABASE_TARGET_REFERENCE) ?? [])].sort();
}

export function classifyDependencyArrangement(input: {
  exists: boolean;
  resolved: boolean;
  isLink: boolean;
  platform: NodeJS.Platform;
}): DependencyArrangement {
  if (!input.exists) return "missing";
  if (!input.resolved) return "unresolved";
  if (!input.isLink) return "standalone";
  return input.platform === "win32" ? "junction" : "symlink";
}

export function isDependencyLinkAllowed(input: {
  resolvedTarget: string;
  registeredTargets: ReadonlySet<string>;
  currentLockHash: string | null;
  targetLockHash: string | null;
}): boolean {
  return (
    input.registeredTargets.has(input.resolvedTarget) &&
    input.currentLockHash !== null &&
    input.currentLockHash === input.targetLockHash
  );
}

function dependencyPathIdentity(
  filePath: string,
  platform: NodeJS.Platform
): string {
  const normalized = join(filePath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

type LockMetadata = {
  lockfileVersion?: unknown;
  packages?: Record<string, { version?: unknown }>;
};

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function packageLockKey(packageName: string): string {
  return `node_modules/${packageName}`;
}

function installedPackageMetadata(
  projectRoot: string,
  packageName: CriticalVerificationDependency
): { state: "available"; version: string } | { state: "missing" | "malformed" } {
  const metadataPath = join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json"
  );
  if (!existsSync(metadataPath)) return { state: "missing" };
  const metadata = readJsonObject(metadataPath);
  return metadata?.name === packageName &&
    typeof metadata.version === "string" &&
    metadata.version.length > 0
    ? { state: "available", version: metadata.version }
    : { state: "malformed" };
}

function validLockMetadata(value: Record<string, unknown> | null): LockMetadata | null {
  if (
    !value ||
    typeof value.lockfileVersion !== "number" ||
    !value.packages ||
    typeof value.packages !== "object" ||
    Array.isArray(value.packages)
  ) {
    return null;
  }
  return value as LockMetadata;
}

export function inspectCriticalDependencyIntegrity(input: {
  projectRoot: string;
  npmLsSucceeded: boolean;
}): CriticalDependencyIntegrityReport {
  const rootLock = validLockMetadata(
    readJsonObject(join(input.projectRoot, "package-lock.json"))
  );
  const hiddenLock = validLockMetadata(
    readJsonObject(join(input.projectRoot, "node_modules", ".package-lock.json"))
  );
  const issues: CriticalDependencyIntegrityIssue[] = [];

  for (const packageName of CRITICAL_VERIFICATION_DEPENDENCIES) {
    const installed = installedPackageMetadata(input.projectRoot, packageName);
    const installedVersion =
      installed.state === "available" ? installed.version : null;
    const rootEntry = rootLock?.packages?.[packageLockKey(packageName)];
    const lockedVersion =
      typeof rootEntry?.version === "string" && rootEntry.version.length > 0
        ? rootEntry.version
        : null;

    if (!input.npmLsSucceeded) {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion,
        check: "npm-tree",
        detail: "npm ls --all did not validate the installed dependency tree.",
      });
    }
    if (!rootLock) {
      issues.push({
        packageName,
        lockedVersion: null,
        installedVersion,
        check: "root-lock-metadata",
        detail: "The root package-lock.json is missing, unreadable, or malformed.",
      });
    } else if (!lockedVersion) {
      issues.push({
        packageName,
        lockedVersion: null,
        installedVersion,
        check: "root-lock-entry",
        detail: "The root lockfile has no valid exact version for this critical package.",
      });
    }

    if (installed.state !== "available") {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion: null,
        check: "installed-package-metadata",
        detail:
          installed.state === "missing"
            ? "The installed package is missing."
            : "The installed package metadata is unreadable, malformed, or names a different package.",
      });
    } else if (lockedVersion && installed.version !== lockedVersion) {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion: installed.version,
        check: "installed-version",
        detail: "The installed version differs from the exact root lockfile version.",
      });
    }

    const hiddenEntry = hiddenLock?.packages?.[packageLockKey(packageName)];
    const hiddenVersion =
      typeof hiddenEntry?.version === "string" && hiddenEntry.version.length > 0
        ? hiddenEntry.version
        : null;
    if (!hiddenLock) {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion,
        check: "hidden-lock-metadata",
        detail: "node_modules/.package-lock.json is missing, unreadable, or malformed.",
      });
    } else if (!hiddenVersion) {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion,
        check: "hidden-lock-entry",
        detail: "The hidden lockfile has no valid exact version for this critical package.",
      });
    } else if (lockedVersion && hiddenVersion !== lockedVersion) {
      issues.push({
        packageName,
        lockedVersion,
        installedVersion,
        check: "hidden-lock-version",
        detail: `The hidden lockfile records ${hiddenVersion}, not the root lockfile version.`,
      });
    }
  }

  return {
    success: issues.length === 0,
    npmLsSucceeded: input.npmLsSucceeded,
    issues,
    recovery:
      "Run trusted-runtime npm ci from trainer-app, then rerun verification; no automatic repair was attempted.",
  };
}

export function inspectDependencyFilesystem(input: {
  currentProjectRoot: string;
  registeredWorktreeRoots: readonly string[];
  platform: NodeJS.Platform;
  validateInstallation: (resolvedProjectRoot: string) => boolean;
}): {
  installation: CapabilityStatus;
  arrangement: DependencyArrangement;
  linkAllowed: boolean;
  dependencyRoot: string;
  dependencyProjectRoot: string;
} {
  const nodeModulesPath = join(input.currentProjectRoot, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    return {
      installation: "missing",
      arrangement: "missing",
      linkAllowed: false,
      dependencyRoot: nodeModulesPath,
      dependencyProjectRoot: input.currentProjectRoot,
    };
  }

  try {
    const resolved = realpathSync.native(nodeModulesPath);
    const isLink =
      lstatSync(nodeModulesPath).isSymbolicLink() ||
      dependencyPathIdentity(resolved, input.platform) !==
        dependencyPathIdentity(nodeModulesPath, input.platform);
    const arrangement = classifyDependencyArrangement({
      exists: true,
      resolved: true,
      isLink,
      platform: input.platform,
    });
    if (arrangement === "standalone") {
      return {
        installation: input.validateInstallation(input.currentProjectRoot)
          ? "available"
          : "invalid",
        arrangement,
        linkAllowed: true,
        dependencyRoot: resolved,
        dependencyProjectRoot: input.currentProjectRoot,
      };
    }

    const dependencyProjectRoot = join(resolved, "..");
    const registeredTargets = new Set<string>();
    for (const worktreeRoot of input.registeredWorktreeRoots) {
      const candidate = join(worktreeRoot, "trainer-app", "node_modules");
      try {
        const candidateResolved = realpathSync.native(candidate);
        if (
          dependencyPathIdentity(candidateResolved, input.platform) ===
          dependencyPathIdentity(candidate, input.platform)
        ) {
          registeredTargets.add(
            dependencyPathIdentity(candidateResolved, input.platform)
          );
        }
      } catch {
        // Missing, unresolved, or chained registered targets are not trusted.
      }
    }
    const currentLock = readOptionalFile(
      join(input.currentProjectRoot, "package-lock.json")
    );
    const targetLock = readOptionalFile(
      join(dependencyProjectRoot, "package-lock.json")
    );
    const linkAllowed = isDependencyLinkAllowed({
      resolvedTarget: dependencyPathIdentity(resolved, input.platform),
      registeredTargets,
      currentLockHash: currentLock ?? null,
      targetLockHash: targetLock ?? null,
    });
    return {
      installation:
        linkAllowed && input.validateInstallation(dependencyProjectRoot)
          ? "available"
          : "invalid",
      arrangement,
      linkAllowed,
      dependencyRoot: resolved,
      dependencyProjectRoot,
    };
  } catch {
    return {
      installation: "invalid",
      arrangement: "unresolved",
      linkAllowed: false,
      dependencyRoot: nodeModulesPath,
      dependencyProjectRoot: input.currentProjectRoot,
    };
  }
}

export function normalizePrismaSchema(source: string): string {
  let normalized = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (!inString && character === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (!/\s/.test(character)) normalized += character;
  }

  return normalized;
}

export function classifyPrismaReadiness(input: {
  dependenciesAvailable: boolean;
  prismaPackageAvailable: boolean;
  prismaClientPackageAvailable: boolean;
  prismaPackageMetadataValid: boolean;
  prismaClientPackageMetadataValid: boolean;
  generatedClientDirectoryAvailable: boolean;
  generatedPackageMetadataValid: boolean;
  requiredGeneratedArtifactsAvailable: boolean;
  clientForwardersAvailable: boolean;
  importProbeSucceeded: boolean;
  expectedModelMetadataAvailable: boolean;
  checkedInSchema?: string;
  generatedSchema?: string;
}): PrismaReadiness {
  if (!input.dependenciesAvailable) return "dependencies-missing";
  if (!input.prismaPackageAvailable || !input.prismaClientPackageAvailable) {
    return "packages-missing";
  }
  if (
    !input.generatedClientDirectoryAvailable ||
    input.generatedSchema === undefined
  ) {
    return "generated-client-missing";
  }
  if (
    !input.generatedPackageMetadataValid ||
    !input.prismaPackageMetadataValid ||
    !input.prismaClientPackageMetadataValid ||
    !input.requiredGeneratedArtifactsAvailable ||
    !input.clientForwardersAvailable ||
    !input.importProbeSucceeded ||
    !input.expectedModelMetadataAvailable
  ) {
    return "generated-client-partial-or-corrupt";
  }
  if (
    input.checkedInSchema === undefined ||
    normalizePrismaSchema(input.checkedInSchema) !==
      normalizePrismaSchema(input.generatedSchema)
  ) {
    return "generated-client-stale";
  }
  return "compatible";
}

const REQUIRED_GENERATED_CLIENT_ARTIFACTS = [
  "default.js",
  "default.d.ts",
  "index.js",
  "index.d.ts",
  "package.json",
  "query_compiler_fast_bg.js",
  "query_compiler_fast_bg.wasm",
  "query_compiler_fast_bg.wasm-base64.js",
  "schema.prisma",
] as const;
const REQUIRED_PRISMA_CLIENT_FORWARDERS = [
  ["@prisma", "client", "default.js"],
  ["@prisma", "client", "default.d.ts"],
  ["@prisma", "client", "runtime", "client.js"],
  ["@prisma", "client", "runtime", "client.mjs"],
  ["@prisma", "client", "runtime", "client.d.ts"],
] as const;

function readOptionalFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function generatedPackageMetadataIsValid(filePath: string): boolean {
  const source = readOptionalFile(filePath);
  if (!source) return false;
  try {
    const metadata = JSON.parse(source) as { main?: unknown; types?: unknown };
    return metadata.main === "index.js" && metadata.types === "index.d.ts";
  } catch {
    return false;
  }
}

function packageMetadataIsValid(filePath: string, expectedName: string): boolean {
  const source = readOptionalFile(filePath);
  if (!source) return false;
  try {
    const metadata = JSON.parse(source) as {
      name?: unknown;
      version?: unknown;
    };
    return (
      metadata.name === expectedName &&
      typeof metadata.version === "string" &&
      metadata.version.length > 0
    );
  } catch {
    return false;
  }
}

export function inspectPrismaClientFilesystem(input: {
  checkedInSchemaPath: string;
  dependencyRoot: string;
  dependenciesAvailable: boolean;
  importProbeSucceeded: boolean;
  expectedModelMetadataAvailable: boolean;
}): PrismaReadiness {
  const generatedClientPath = join(input.dependencyRoot, ".prisma", "client");
  const checkedInSchema = readOptionalFile(input.checkedInSchemaPath);
  const generatedSchema = readOptionalFile(
    join(generatedClientPath, "schema.prisma")
  );
  return classifyPrismaReadiness({
    dependenciesAvailable: input.dependenciesAvailable,
    prismaPackageAvailable: existsSync(
      join(input.dependencyRoot, "prisma", "package.json")
    ),
    prismaClientPackageAvailable: existsSync(
      join(input.dependencyRoot, "@prisma", "client", "package.json")
    ),
    prismaPackageMetadataValid: packageMetadataIsValid(
      join(input.dependencyRoot, "prisma", "package.json"),
      "prisma"
    ),
    prismaClientPackageMetadataValid: packageMetadataIsValid(
      join(input.dependencyRoot, "@prisma", "client", "package.json"),
      "@prisma/client"
    ),
    generatedClientDirectoryAvailable: existsSync(generatedClientPath),
    generatedPackageMetadataValid: generatedPackageMetadataIsValid(
      join(generatedClientPath, "package.json")
    ),
    requiredGeneratedArtifactsAvailable:
      REQUIRED_GENERATED_CLIENT_ARTIFACTS.every((relativePath) =>
        existsSync(join(generatedClientPath, relativePath))
      ),
    clientForwardersAvailable: REQUIRED_PRISMA_CLIENT_FORWARDERS.every(
      (relativePath) => existsSync(join(input.dependencyRoot, ...relativePath))
    ),
    importProbeSucceeded: input.importProbeSucceeded,
    expectedModelMetadataAvailable: input.expectedModelMetadataAvailable,
    checkedInSchema,
    generatedSchema,
  });
}

export function buildTestEnvironmentPreflight(
  input: TestEnvironmentPreflightInput
): TestEnvironmentPreflightReport {
  const databaseTargets = classifyDatabaseTargets(input.databaseTargets);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.dependencyInstallation !== "available") {
    blockers.push("The exact-lock dependency installation is unavailable.");
  }
  if (
    (input.dependencyArrangement === "junction" ||
      input.dependencyArrangement === "symlink") &&
    !input.dependencyLinkAllowed
  ) {
    blockers.push("The dependency link is unresolved, policy-external, or lock-incompatible.");
  }
  if (input.dependencyArrangement === "unresolved") {
    blockers.push("The dependency link cannot be resolved.");
  }
  if (input.prismaReadiness !== "compatible") {
    blockers.push(`Prisma readiness: ${input.prismaReadiness}.`);
  }

  const configuredTargets = DATABASE_TARGET_ENV_VARS.filter(
    (name) => databaseTargets[name] !== "missing"
  );
  if (configuredTargets.length > 0) {
    warnings.push(
      "Configured database target variables are reported by name only and are stripped from credential-free commands."
    );
  }

  const localCapabilitiesReady =
    input.dependencyInstallation === "available" &&
    input.dependencyArrangement !== "missing" &&
    input.dependencyArrangement !== "unresolved" &&
    (input.dependencyArrangement === "standalone" || input.dependencyLinkAllowed) &&
    input.prismaReadiness === "compatible";

  return {
    success: blockers.length === 0,
    databaseTargets,
    capabilities: {
      dependencyInstallation: input.dependencyInstallation,
      dependencyArrangement: input.dependencyArrangement,
      dependencyLinkAllowed: input.dependencyLinkAllowed,
      prismaReadiness: input.prismaReadiness,
      docker: input.docker,
    },
    groups: {
      selectiveVerification: {
        status: localCapabilitiesReady ? "runnable" : "blocked",
        command: "npm run test:verify-gate",
        reason: localCapabilitiesReady
          ? "The selective repository verification matrix is available."
          : "Compatible dependencies and generated Prisma Client are required.",
      },
      credentialFreeInventory: {
        status: localCapabilitiesReady ? "runnable" : "blocked",
        command: "npm run test:inventory:credential-free",
        reason: localCapabilitiesReady
          ? "Vitest may collect with every recognized database target stripped."
          : "Compatible dependencies and generated Prisma Client are required.",
      },
      disposableDatabase: {
        status: input.docker === "available" ? "separate" : "blocked",
        command: "npm run test:db:workout-mutations -- --confirm-disposable",
        reason:
          input.docker === "available"
            ? "Docker CLI is available; the mutating disposable suite requires explicit confirmation."
            : "Docker CLI is unavailable; disposable database coverage cannot run.",
      },
      uiAudit: {
        status: localCapabilitiesReady ? "separate" : "blocked",
        command: "npm run test:ui-audit",
        reason: localCapabilitiesReady
          ? "Playwright remains a separate managed-server command."
          : "Compatible local dependencies are unavailable.",
      },
    },
    blockers,
    warnings,
  };
}
