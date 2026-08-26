import path from "node:path";
import { DATABASE_TARGET_ENV_VARS } from "./test-environment-preflight";
import type {
  VitestFailureKind,
  VitestPhaseResult,
} from "./credential-free-inventory-runner";

export const CREDENTIAL_FREE_SHARD_COUNT = 4 as const;
export const INVENTORY_COMPONENT_SCHEMA =
  "trainer-credential-free-inventory-component" as const;
export const INVENTORY_COMPONENT_SCHEMA_VERSION = 1 as const;
export const CREDENTIAL_SAFE_PROFILE =
  "trainer-credential-safe-launcher-v1" as const;

export const INVENTORY_VITEST_EXECUTION_ARGS = [
  "--maxWorkers",
  "1",
  "--pool=forks",
  "--isolate",
] as const;

export type InventoryComponentStatus = "pass" | "fail";

export type InventoryResultCounts = {
  selectedFiles: number;
  executedFiles: number;
  passedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
};

export type InventoryExecutionIdentity = {
  nodeVersion: string;
  vitestVersion: string;
  pool: "forks";
  isolation: true;
  workerCount: 1;
  timezone: string;
};

export type InventorySecurityIdentity = {
  profile: typeof CREDENTIAL_SAFE_PROFILE;
  credentialStripping: true;
  databaseTargetsRemoved: string[];
  dotenvSuppressed: true;
};

export type InventoryComponentIdentity = {
  treeSha: string;
  checkedOutCommitSha: string;
  verificationDefinitionHash: string;
  classificationHash: string;
  lockfileHash: string;
  workflow: string;
  workflowRunId: string;
  runAttempt: string;
  job: string;
  execution: InventoryExecutionIdentity;
  security: InventorySecurityIdentity;
};

type InventoryComponentBase = InventoryComponentIdentity & {
  schema: typeof INVENTORY_COMPONENT_SCHEMA;
  schemaVersion: typeof INVENTORY_COMPONENT_SCHEMA_VERSION;
  files: string[];
  fileDurations: Array<{ file: string; durationMs: number }>;
  counts: InventoryResultCounts;
  durationMs: number;
  status: InventoryComponentStatus;
  reporterState: "available" | "missing" | "malformed";
  failureClassification: VitestFailureKind;
};

export type CredentialFreeShardSummary = InventoryComponentBase & {
  componentType: "credential-free-shard";
  shardIndex: number;
  shardCount: number;
};

export type ImportSafetySummary = InventoryComponentBase & {
  componentType: "import-safety";
  placeholderValidationPassed: boolean;
  socketGuardCompleted: boolean;
  connectionAttempted: boolean;
};

export type InventoryComponentSummary =
  | CredentialFreeShardSummary
  | ImportSafetySummary;

export type AggregateValidationExpectation = InventoryComponentIdentity & {
  credentialFreeFiles: string[];
  importOnlyFiles: string[];
  databaseRequiredFiles: string[];
  dependencyResults: {
    credentialShards: string;
    importSafety: string;
  };
};

export type CredentialFreeAggregateValidation = {
  components: {
    credentialFree: CredentialFreeShardSummary[];
    importSafety: ImportSafetySummary;
  };
  coverage: {
    credentialFreeExpected: string[];
    credentialFreeUnion: string[];
    importOnlyExpected: string[];
    databaseRequiredExcluded: string[];
    unionExact: true;
    noOverlap: true;
    importExact: true;
    databaseExcluded: true;
  };
  counts: InventoryResultCounts & {
    filesDiscovered: number;
    databaseRequiredExcluded: number;
  };
  durations: {
    credentialFreeMs: number;
    importOnlyMs: number;
    componentTotalMs: number;
    criticalPathMs: number;
  };
};

export type AggregateValidationResult =
  | { valid: true; aggregate: CredentialFreeAggregateValidation }
  | { valid: false; errors: string[] };

export function buildCredentialFreeShardVitestArgs(input: {
  excludedFiles: readonly string[];
  shardIndex: number;
  shardCount: number;
}): string[] {
  if (
    input.shardCount !== CREDENTIAL_FREE_SHARD_COUNT ||
    !Number.isInteger(input.shardIndex) ||
    input.shardIndex < 1 ||
    input.shardIndex > CREDENTIAL_FREE_SHARD_COUNT
  ) {
    throw new Error("Credential-free shard identity is invalid.");
  }
  return [
    ...input.excludedFiles.flatMap((file) => ["--exclude", file]),
    ...INVENTORY_VITEST_EXECUTION_ARGS,
    `--shard=${input.shardIndex}/${input.shardCount}`,
  ];
}

export function buildImportSafetyVitestArgs(files: readonly string[]): string[] {
  return [...files, ...INVENTORY_VITEST_EXECUTION_ARGS];
}

function phaseSummaryData(projectRoot: string, result: VitestPhaseResult) {
  let pathFailure = false;
  let executed = result.executedFiles ?? [];
  let files: string[] = [];
  let fileDurations: Array<{ file: string; durationMs: number }> = [];
  try {
    files = normalizeExecutedReporterFiles(
      projectRoot,
      executed.map((entry) => entry.file)
    );
    const durationByFile = new Map(
      executed
        .filter((entry) => entry.durationMs !== null)
        .map((entry) => [
          normalizeExecutedReporterFile(projectRoot, entry.file),
          entry.durationMs as number,
        ])
    );
    fileDurations = [...durationByFile]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, durationMs]) => ({ file, durationMs }));
  } catch {
    pathFailure = true;
    executed = [];
  }
  const summary = result.summary;
  const status: InventoryComponentStatus =
    result.success && !pathFailure ? "pass" : "fail";
  const reporterState: "available" | "missing" | "malformed" = pathFailure
    ? "malformed"
    : result.reporterState;
  const failureClassification: VitestFailureKind = pathFailure
    ? "reporter-malformed"
    : result.failureKind;
  return {
    files,
    fileDurations,
    counts: {
      selectedFiles: summary?.files.total ?? 0,
      executedFiles: files.length,
      passedFiles: pathFailure ? 0 : (summary?.files.passed ?? 0),
      failedFiles: pathFailure ? 0 : (summary?.files.failed ?? 0),
      skippedFiles: pathFailure ? 0 : (summary?.files.skipped ?? 0),
      totalTests: summary?.tests.total ?? 0,
      passedTests: summary?.tests.passed ?? 0,
      failedTests: summary?.tests.failed ?? 0,
      skippedTests: summary?.tests.skipped ?? 0,
    },
    durationMs: result.durationMs,
    status,
    reporterState,
    failureClassification,
  };
}

export function createCredentialFreeShardSummary(input: {
  projectRoot: string;
  identity: InventoryComponentIdentity;
  shardIndex: number;
  shardCount: number;
  result: VitestPhaseResult;
}): CredentialFreeShardSummary {
  return {
    schema: INVENTORY_COMPONENT_SCHEMA,
    schemaVersion: INVENTORY_COMPONENT_SCHEMA_VERSION,
    componentType: "credential-free-shard",
    ...input.identity,
    shardIndex: input.shardIndex,
    shardCount: input.shardCount,
    ...phaseSummaryData(input.projectRoot, input.result),
  };
}

export function createImportSafetySummary(input: {
  projectRoot: string;
  identity: InventoryComponentIdentity;
  result: VitestPhaseResult;
  placeholderValidationPassed: boolean;
  socketGuardCompleted: boolean;
  connectionAttempted: boolean;
}): ImportSafetySummary {
  return {
    schema: INVENTORY_COMPONENT_SCHEMA,
    schemaVersion: INVENTORY_COMPONENT_SCHEMA_VERSION,
    componentType: "import-safety",
    ...input.identity,
    ...phaseSummaryData(input.projectRoot, input.result),
    placeholderValidationPassed: input.placeholderValidationPassed,
    socketGuardCompleted: input.socketGuardCompleted,
    connectionAttempted: input.connectionAttempted,
  };
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_NUMBER_PATTERN = /^[1-9]\d*$/;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const TOOL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const JOB_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;

const BASE_KEYS = [
  "schema",
  "schemaVersion",
  "componentType",
  "treeSha",
  "checkedOutCommitSha",
  "verificationDefinitionHash",
  "classificationHash",
  "lockfileHash",
  "workflow",
  "workflowRunId",
  "runAttempt",
  "job",
  "execution",
  "security",
  "files",
  "fileDurations",
  "counts",
  "durationMs",
  "status",
  "reporterState",
  "failureClassification",
] as const;

const COUNT_KEYS = [
  "selectedFiles",
  "executedFiles",
  "passedFiles",
  "failedFiles",
  "skippedFiles",
  "totalTests",
  "passedTests",
  "failedTests",
  "skippedTests",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((entry, index) => entry === wanted[index])
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeFileIdentity(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === value &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    normalized.startsWith("src/") &&
    /\.test\.tsx?$/.test(normalized)
  );
}

export function normalizeExecutedReporterFile(
  projectRoot: string,
  reporterFile: string
): string {
  if (typeof reporterFile !== "string" || reporterFile.length === 0) {
    throw new Error("Reporter file identity is empty.");
  }
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(reporterFile)
    ? path.resolve(reporterFile)
    : path.resolve(root, reporterFile);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!safeFileIdentity(relative)) {
    throw new Error(`Reporter file identity is outside trainer-app: ${reporterFile}.`);
  }
  return relative;
}

export function normalizeExecutedReporterFiles(
  projectRoot: string,
  reporterFiles: readonly string[]
): string[] {
  const normalized = reporterFiles.map((file) =>
    normalizeExecutedReporterFile(projectRoot, file)
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Reporter file identities contain duplicates after normalization.");
  }
  return normalized.sort();
}

function validateStringFiles(
  value: unknown,
  label: string,
  errors: string[]
): string[] | null {
  if (!Array.isArray(value) || !value.every(safeFileIdentity)) {
    errors.push(`${label} file identities are malformed`);
    return null;
  }
  if (new Set(value).size !== value.length) {
    errors.push(`${label} file identities are duplicated`);
    return null;
  }
  if (value.some((entry, index) => index > 0 && value[index - 1] >= entry)) {
    errors.push(`${label} file identities are not stably ordered`);
    return null;
  }
  return value as string[];
}

function validateExecution(
  value: unknown,
  label: string,
  errors: string[]
): InventoryExecutionIdentity | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "nodeVersion",
      "vitestVersion",
      "pool",
      "isolation",
      "workerCount",
      "timezone",
    ])
  ) {
    errors.push(`${label} execution identity is malformed`);
    return null;
  }
  if (
    typeof value.nodeVersion !== "string" ||
    !NODE_VERSION_PATTERN.test(value.nodeVersion) ||
    typeof value.vitestVersion !== "string" ||
    !TOOL_VERSION_PATTERN.test(value.vitestVersion) ||
    value.pool !== "forks" ||
    value.isolation !== true ||
    value.workerCount !== 1 ||
    typeof value.timezone !== "string" ||
    value.timezone.length === 0
  ) {
    errors.push(`${label} execution semantics are invalid`);
    return null;
  }
  return value as InventoryExecutionIdentity;
}

function validateSecurity(
  value: unknown,
  label: string,
  errors: string[]
): InventorySecurityIdentity | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "profile",
      "credentialStripping",
      "databaseTargetsRemoved",
      "dotenvSuppressed",
    ])
  ) {
    errors.push(`${label} security identity is malformed`);
    return null;
  }
  const expectedTargets = [...DATABASE_TARGET_ENV_VARS].sort();
  const actualTargets = Array.isArray(value.databaseTargetsRemoved)
    ? value.databaseTargetsRemoved
    : null;
  if (
    value.profile !== CREDENTIAL_SAFE_PROFILE ||
    value.credentialStripping !== true ||
    value.dotenvSuppressed !== true ||
    !actualTargets ||
    actualTargets.length !== expectedTargets.length ||
    !expectedTargets.every(
      (entry, index) => actualTargets[index] === entry
    )
  ) {
    errors.push(`${label} security semantics are invalid`);
    return null;
  }
  return value as InventorySecurityIdentity;
}

function validateCounts(
  value: unknown,
  files: readonly string[] | null,
  status: unknown,
  label: string,
  errors: string[]
): InventoryResultCounts | null {
  if (!isRecord(value) || !exactKeys(value, COUNT_KEYS)) {
    errors.push(`${label} counts are malformed`);
    return null;
  }
  for (const key of COUNT_KEYS) {
    if (!nonNegativeInteger(value[key])) errors.push(`${label} ${key} is invalid`);
  }
  if (errors.some((entry) => entry.startsWith(`${label} `))) return null;
  const counts = value as InventoryResultCounts;
  if (files && counts.executedFiles !== files.length) {
    errors.push(`${label} executed file count differs from file identities`);
  }
  if (
    counts.passedFiles + counts.failedFiles + counts.skippedFiles !==
    counts.executedFiles
  ) {
    errors.push(`${label} file result counts do not reconcile`);
  }
  if (
    counts.passedTests + counts.failedTests + counts.skippedTests !==
    counts.totalTests
  ) {
    errors.push(`${label} test result counts do not reconcile`);
  }
  if (
    status === "pass" &&
    (counts.selectedFiles !== counts.executedFiles ||
      counts.failedFiles !== 0 ||
      counts.failedTests !== 0)
  ) {
    errors.push(`${label} pass status contradicts counts`);
  }
  return counts;
}

function validateComponent(
  value: unknown,
  index: number,
  errors: string[]
): InventoryComponentSummary | null {
  const label = `component ${index + 1}`;
  if (!isRecord(value)) {
    errors.push(`${label} is not an object`);
    return null;
  }
  const componentType = value.componentType;
  const extraKeys =
    componentType === "credential-free-shard"
      ? ["shardIndex", "shardCount"]
      : componentType === "import-safety"
        ? [
            "placeholderValidationPassed",
            "socketGuardCompleted",
            "connectionAttempted",
          ]
        : [];
  if (
    extraKeys.length === 0 ||
    !exactKeys(value, [...BASE_KEYS, ...extraKeys])
  ) {
    errors.push(`${label} shape is malformed`);
    return null;
  }
  if (
    value.schema !== INVENTORY_COMPONENT_SCHEMA ||
    value.schemaVersion !== INVENTORY_COMPONENT_SCHEMA_VERSION
  ) {
    errors.push(`${label} schema is unsupported`);
  }
  for (const [key, pattern] of [
    ["treeSha", SHA_PATTERN],
    ["checkedOutCommitSha", SHA_PATTERN],
    ["verificationDefinitionHash", SHA256_PATTERN],
    ["classificationHash", SHA256_PATTERN],
    ["lockfileHash", SHA256_PATTERN],
  ] as const) {
    if (typeof value[key] !== "string" || !pattern.test(value[key])) {
      errors.push(`${label} ${key} is invalid`);
    }
  }
  if (
    typeof value.workflowRunId !== "string" ||
    !RUN_NUMBER_PATTERN.test(value.workflowRunId) ||
    typeof value.workflow !== "string" ||
    value.workflow.length === 0 ||
    typeof value.runAttempt !== "string" ||
    !RUN_NUMBER_PATTERN.test(value.runAttempt) ||
    typeof value.job !== "string" ||
    !JOB_PATTERN.test(value.job)
  ) {
    errors.push(`${label} workflow identity is invalid`);
  }
  const execution = validateExecution(value.execution, label, errors);
  const security = validateSecurity(value.security, label, errors);
  const files = validateStringFiles(value.files, label, errors);
  const counts = validateCounts(value.counts, files, value.status, label, errors);
  if (!nonNegativeFinite(value.durationMs)) {
    errors.push(`${label} duration is invalid`);
  }
  if (value.status !== "pass" && value.status !== "fail") {
    errors.push(`${label} status is invalid`);
  }
  if (!['available', 'missing', 'malformed'].includes(String(value.reporterState))) {
    errors.push(`${label} reporter state is invalid`);
  }
  const failureKinds = new Set<VitestFailureKind>([
    "none",
    "test-assertion",
    "timeout",
    "reporter-malformed",
    "reporter-missing",
    "worker-termination",
    "safety-guard",
    "artifact-failure",
    "subprocess-exit",
  ]);
  if (!failureKinds.has(value.failureClassification as VitestFailureKind)) {
    errors.push(`${label} failure classification is invalid`);
  }
  if (
    value.status === "pass" &&
    (value.reporterState !== "available" || value.failureClassification !== "none")
  ) {
    errors.push(`${label} pass status contradicts reporter state`);
  }
  if (!Array.isArray(value.fileDurations)) {
    errors.push(`${label} file durations are malformed`);
  } else {
    const durationFiles: string[] = [];
    for (const entry of value.fileDurations) {
      if (
        !isRecord(entry) ||
        !exactKeys(entry, ["file", "durationMs"]) ||
        !safeFileIdentity(entry.file) ||
        !nonNegativeFinite(entry.durationMs)
      ) {
        errors.push(`${label} file duration is invalid`);
        continue;
      }
      durationFiles.push(entry.file);
    }
    if (new Set(durationFiles).size !== durationFiles.length) {
      errors.push(`${label} file durations are duplicated`);
    }
    if (files && durationFiles.some((file) => !files.includes(file))) {
      errors.push(`${label} file duration references an unexecuted file`);
    }
  }
  if (componentType === "credential-free-shard") {
    if (!nonNegativeInteger(value.shardIndex) || value.shardIndex < 1) {
      errors.push(`${label} shard index is invalid`);
    }
    if (!nonNegativeInteger(value.shardCount) || value.shardCount < 1) {
      errors.push(`${label} shard count is invalid`);
    }
  } else if (
    typeof value.placeholderValidationPassed !== "boolean" ||
    typeof value.socketGuardCompleted !== "boolean" ||
    typeof value.connectionAttempted !== "boolean"
  ) {
    errors.push(`${label} import safety fields are invalid`);
  } else if (
    value.status === "pass" &&
    (value.placeholderValidationPassed !== true ||
      value.socketGuardCompleted !== true ||
      value.connectionAttempted !== false)
  ) {
    errors.push(`${label} import pass contradicts safety fields`);
  }
  if (!execution || !security || !files || !counts) return null;
  return value as InventoryComponentSummary;
}

function sameFiles(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function normalizedExpectedFiles(
  value: readonly string[],
  label: string,
  errors: string[]
): string[] {
  const result = [...value].sort();
  if (!result.every(safeFileIdentity) || new Set(result).size !== result.length) {
    errors.push(`${label} canonical file set is malformed`);
  }
  return result;
}

function identityMismatch(
  component: InventoryComponentSummary,
  expected: InventoryComponentIdentity
): string[] {
  const errors: string[] = [];
  for (const key of [
    "treeSha",
    "checkedOutCommitSha",
    "verificationDefinitionHash",
    "classificationHash",
    "lockfileHash",
    "workflow",
    "workflowRunId",
    "runAttempt",
  ] as const) {
    if (component[key] !== expected[key]) errors.push(key);
  }
  if (JSON.stringify(component.execution) !== JSON.stringify(expected.execution)) {
    errors.push("execution");
  }
  if (JSON.stringify(component.security) !== JSON.stringify(expected.security)) {
    errors.push("security");
  }
  return errors;
}

function sumCounts(components: readonly InventoryComponentSummary[]): InventoryResultCounts {
  return components.reduce<InventoryResultCounts>(
    (total, component) => {
      for (const key of COUNT_KEYS) total[key] += component.counts[key];
      return total;
    },
    Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as InventoryResultCounts
  );
}

export function validateCredentialFreeAggregate(input: {
  untrustedComponents: readonly unknown[];
  expected: AggregateValidationExpectation;
}): AggregateValidationResult {
  const errors: string[] = [];
  if (input.expected.dependencyResults.credentialShards !== "success") {
    errors.push("credential shard dependency did not succeed");
  }
  if (input.expected.dependencyResults.importSafety !== "success") {
    errors.push("import safety dependency did not succeed");
  }
  const components = input.untrustedComponents
    .map((component, index) => validateComponent(component, index, errors))
    .filter((component): component is InventoryComponentSummary => component !== null);
  const shards = components
    .filter(
      (component): component is CredentialFreeShardSummary =>
        component.componentType === "credential-free-shard"
    )
    .sort((left, right) => left.shardIndex - right.shardIndex);
  const imports = components.filter(
    (component): component is ImportSafetySummary =>
      component.componentType === "import-safety"
  );
  if (components.length !== input.untrustedComponents.length) {
    errors.push("one or more component summaries are malformed");
  }
  if (shards.length !== CREDENTIAL_FREE_SHARD_COUNT) {
    errors.push(`expected exactly ${CREDENTIAL_FREE_SHARD_COUNT} credential shards`);
  }
  if (imports.length !== 1) errors.push("expected exactly one import safety summary");
  const shardIndexes = shards.map((component) => component.shardIndex);
  if (new Set(shardIndexes).size !== shardIndexes.length) {
    errors.push("credential shard index is duplicated");
  }
  for (let index = 1; index <= CREDENTIAL_FREE_SHARD_COUNT; index += 1) {
    if (!shardIndexes.includes(index)) errors.push(`credential shard ${index}/4 is missing`);
  }
  for (const component of components) {
    const mismatches = identityMismatch(component, input.expected);
    if (mismatches.length > 0) {
      errors.push(
        `${component.componentType} identity mismatch: ${mismatches.join(", ")}`
      );
    }
    if (component.status !== "pass") errors.push(`${component.componentType} did not pass`);
    if (
      component.componentType === "credential-free-shard" &&
      component.job !== "credential-free-shard"
    ) {
      errors.push(`credential shard ${component.shardIndex} job identity is invalid`);
    }
    if (component.componentType === "import-safety" && component.job !== "import-safety") {
      errors.push("import safety job identity is invalid");
    }
    if (
      component.componentType === "credential-free-shard" &&
      component.shardCount !== CREDENTIAL_FREE_SHARD_COUNT
    ) {
      errors.push(`credential shard ${component.shardIndex} has the wrong shard count`);
    }
  }
  const expectedCredential = normalizedExpectedFiles(
    input.expected.credentialFreeFiles,
    "credential-free",
    errors
  );
  const expectedImport = normalizedExpectedFiles(
    input.expected.importOnlyFiles,
    "import-only",
    errors
  );
  const expectedDatabase = normalizedExpectedFiles(
    input.expected.databaseRequiredFiles,
    "database-required",
    errors
  );
  const classified = [...expectedCredential, ...expectedImport, ...expectedDatabase];
  if (new Set(classified).size !== classified.length) {
    errors.push("canonical environment file sets overlap");
  }
  const seenCredential = new Set<string>();
  let overlap = false;
  for (const shard of shards) {
    for (const file of shard.files) {
      if (seenCredential.has(file)) overlap = true;
      seenCredential.add(file);
    }
  }
  if (overlap) errors.push("credential shard file sets overlap");
  const credentialUnion = [...seenCredential].sort();
  if (!sameFiles(credentialUnion, expectedCredential)) {
    errors.push("credential shard union does not equal canonical selection");
  }
  const importFiles = imports[0]?.files ?? [];
  if (!sameFiles(importFiles, expectedImport)) {
    errors.push("import safety files do not equal canonical import-only selection");
  }
  const prohibited = new Set([...expectedImport, ...expectedDatabase]);
  if (credentialUnion.some((file) => prohibited.has(file))) {
    errors.push("credential shard contains an import-only or database-required file");
  }
  const database = new Set(expectedDatabase);
  if (importFiles.some((file) => database.has(file))) {
    errors.push("import safety contains a database-required file");
  }
  if (errors.length > 0 || !imports[0]) return { valid: false, errors };

  const counts = sumCounts(components);
  const credentialFreeMs = shards.reduce(
    (total, component) => total + component.durationMs,
    0
  );
  const componentDurations = components.map((component) => component.durationMs);
  return {
    valid: true,
    aggregate: {
      components: { credentialFree: shards, importSafety: imports[0] },
      coverage: {
        credentialFreeExpected: expectedCredential,
        credentialFreeUnion: credentialUnion,
        importOnlyExpected: expectedImport,
        databaseRequiredExcluded: expectedDatabase,
        unionExact: true,
        noOverlap: true,
        importExact: true,
        databaseExcluded: true,
      },
      counts: {
        ...counts,
        filesDiscovered: classified.length,
        databaseRequiredExcluded: expectedDatabase.length,
      },
      durations: {
        credentialFreeMs,
        importOnlyMs: imports[0].durationMs,
        componentTotalMs: componentDurations.reduce((total, value) => total + value, 0),
        criticalPathMs: Math.max(0, ...componentDurations),
      },
    },
  };
}
