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
  | "client-not-generated"
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
const DATABASE_TARGET_REFERENCE =
  /\b(?:[A-Z][A-Z0-9_]*(?:DATABASE|POSTGRESQL|POSTGRES|DB)[A-Z0-9_]*_URL|DIRECT_URL|SHADOW_URL)\b/g;

function hasMalformedPercentEncoding(value: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(value);
}

export function classifyDatabaseTarget(databaseUrl?: string): DatabaseTargetStatus {
  if (!databaseUrl?.trim()) return "missing";
  if (hasMalformedPercentEncoding(databaseUrl)) return "invalid";

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return "invalid";
    }
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") return "invalid";
    decodeURIComponent(parsed.username);
    decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.pathname);

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

export function sanitizeDatabaseTargetEnvironment(
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const name of DATABASE_TARGET_ENV_VARS) delete sanitized[name];
  return sanitized;
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
  generatedClientAvailable: boolean;
  checkedInSchema?: string;
  generatedSchema?: string;
}): PrismaReadiness {
  if (!input.dependenciesAvailable) return "dependencies-missing";
  if (!input.prismaPackageAvailable || !input.prismaClientPackageAvailable) {
    return "packages-missing";
  }
  if (
    !input.generatedClientAvailable ||
    input.generatedSchema === undefined
  ) {
    return "client-not-generated";
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
