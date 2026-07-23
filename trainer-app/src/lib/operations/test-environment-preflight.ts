import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

export const DATABASE_TARGET_ENV_VARS = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "DIRECT_URL",
  "SHADOW_DATABASE_URL",
  "SHADOW_URL",
] as const;
export const DISPOSABLE_DATABASE_CONFIRMATION_ENV =
  "TRAINER_DISPOSABLE_DB_CONFIRMED" as const;

export type DatabaseTargetVariable = (typeof DATABASE_TARGET_ENV_VARS)[number];
export type DatabaseTargetEnvironment = Record<string, string | undefined> &
  Partial<Record<DatabaseTargetVariable, string | undefined>>;
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
  [...DATABASE_TARGET_ENV_VARS, DISPOSABLE_DATABASE_CONFIRMATION_ENV].map((name) =>
    name.toUpperCase()
  )
);
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

export function parseExactDisposableConfirmationArgs(
  args: readonly string[]
): { valid: true } | { valid: false; message: string } {
  return args.length === 1 && args[0] === "--confirm-disposable"
    ? { valid: true }
    : {
        valid: false,
        message:
          "Invalid invocation. Expected exactly one argument: --confirm-disposable.",
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
