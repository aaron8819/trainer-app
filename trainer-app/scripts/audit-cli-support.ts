import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";

export type AuditCliArgs = Record<string, string | boolean>;

export type AuditPreflightStatus = {
  env_loaded: boolean;
  db_reachable: boolean;
  owner_resolved: boolean;
};

export type AuditPreflight = {
  envFilePath: string | null;
  dbHost: string | null;
  ownerEmail: string | null;
  resolvedUserId: string | null;
  ownerSource:
    | "user-id-flag"
    | "owner-flag"
    | "env-default"
    | "fallback-default"
    | null;
  status: AuditPreflightStatus;
  failures: string[];
};

export type AuditWarningBuckets = {
  blockingErrors: string[];
  semanticWarnings: string[];
  backgroundWarnings: string[];
};

type WarningBucket = keyof AuditWarningBuckets;

type WarningClassificationRule = {
  bucket: WarningBucket;
  patterns: string[];
};

const WARNING_CLASSIFICATION_RULES: WarningClassificationRule[] = [
  {
    bucket: "semanticWarnings",
    patterns: [
      "[template-session]",
      "Section/role mismatch",
      "[stimulus-profile:coverage]",
    ],
  },
  {
    bucket: "backgroundWarnings",
    patterns: ["[stimulus-profile:fallback]"],
  },
];

export function parseArgs(argv: string[]): AuditCliArgs {
  const output: AuditCliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      output[key] = true;
      continue;
    }
    output[key] = value;
    index += 1;
  }
  return output;
}

function resolveDefaultEnvFile(): string | null {
  const candidates = [".env.local", ".env"].map((entry) => resolve(process.cwd(), entry));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function loadAuditEnv(envFileArg: string | undefined): {
  envLoaded: boolean;
  envFilePath: string | null;
} {
  const envFilePath = envFileArg ? resolve(process.cwd(), envFileArg) : resolveDefaultEnvFile();
  if (!envFilePath) {
    return {
      envLoaded: Boolean(process.env.DATABASE_URL),
      envFilePath: null,
    };
  }

  const result = dotenv.config({ path: envFilePath, override: false });
  return {
    envLoaded: !result.error,
    envFilePath,
  };
}

export function sanitizeDatabaseHost(connectionString: string | undefined): string | null {
  if (!connectionString) {
    return null;
  }

  try {
    const url = new URL(connectionString);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "unparseable";
  }
}

export function buildResolvedAuditIdentityRequest(
  args: AuditCliArgs,
  preflight: Pick<AuditPreflight, "ownerEmail" | "resolvedUserId">
): { userId?: string; ownerEmail?: string } {
  const explicitUserId = typeof args["user-id"] === "string" ? args["user-id"] : undefined;
  if (explicitUserId) {
    return { userId: explicitUserId };
  }

  const explicitOwnerEmail = typeof args.owner === "string" ? args.owner : undefined;
  if (explicitOwnerEmail) {
    return { ownerEmail: explicitOwnerEmail };
  }

  if (preflight.ownerEmail) {
    return { ownerEmail: preflight.ownerEmail };
  }

  if (preflight.resolvedUserId) {
    return { userId: preflight.resolvedUserId };
  }

  return {};
}

export async function runAuditPreflight(input: {
  args: AuditCliArgs;
  resolveIdentity: (request: {
    userId?: string;
    ownerEmail?: string;
  }) => Promise<{ userId: string; ownerEmail?: string }>;
  checkDb: () => Promise<void>;
}): Promise<AuditPreflight> {
  const ownerEmail = typeof input.args.owner === "string" ? input.args.owner : null;
  const explicitUserId = typeof input.args["user-id"] === "string" ? input.args["user-id"] : null;
  const failures: string[] = [];

  const preflight: AuditPreflight = {
    envFilePath: null,
    dbHost: sanitizeDatabaseHost(process.env.DATABASE_URL),
    ownerEmail,
    resolvedUserId: explicitUserId,
    ownerSource: explicitUserId
      ? "user-id-flag"
      : ownerEmail
        ? "owner-flag"
        : null,
    status: {
      env_loaded: Boolean(process.env.DATABASE_URL),
      db_reachable: false,
      owner_resolved: Boolean(explicitUserId),
    },
    failures,
  };

  if (!preflight.status.env_loaded) {
    failures.push("env_loaded=false");
    return preflight;
  }

  try {
    await input.checkDb();
    preflight.status.db_reachable = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`db_reachable=false message=${message}`);
    return preflight;
  }

  try {
    const identity =
      explicitUserId || ownerEmail
        ? await input.resolveIdentity({
            userId: explicitUserId ?? undefined,
            ownerEmail: ownerEmail ?? undefined,
          })
        : await (async () => {
            const { resolveOwner } = await import("@/lib/api/workout-context");
            const owner = await resolveOwner();
            preflight.ownerSource =
              typeof process.env.OWNER_EMAIL === "string" && process.env.OWNER_EMAIL.trim().length > 0
                ? "env-default"
                : "fallback-default";
            return {
              userId: owner.id,
              ownerEmail: owner.email,
            };
          })();
    preflight.ownerEmail = identity.ownerEmail ?? ownerEmail;
    preflight.resolvedUserId = identity.userId;
    preflight.status.owner_resolved = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`owner_resolved=false message=${message}`);
  }

  return preflight;
}

export function printAuditPreflight(prefix: string, preflight: AuditPreflight): void {
  console.log(
    `[${prefix}:preflight] ${JSON.stringify({
      env_file: preflight.envFilePath,
      db_host: preflight.dbHost,
      owner_email: preflight.ownerEmail,
      resolved_user_id: preflight.resolvedUserId,
      owner_source: preflight.ownerSource,
      ...preflight.status,
    })}`
  );
  console.log(
    `[${prefix}:owner] ${JSON.stringify({
      resolved_owner: preflight.ownerEmail ?? preflight.resolvedUserId,
      source: preflight.ownerSource,
    })}`
  );

  for (const failure of preflight.failures) {
    console.error(`[${prefix}:preflight] ${failure}`);
  }
}

export function assertAuditPreflight(prefix: string, preflight: AuditPreflight): void {
  if (
    preflight.status.env_loaded &&
    preflight.status.db_reachable &&
    preflight.status.owner_resolved
  ) {
    return;
  }

  throw new Error(
    `${prefix} preflight failed env_loaded=${preflight.status.env_loaded} db_reachable=${preflight.status.db_reachable} owner_resolved=${preflight.status.owner_resolved}`
  );
}

export function classifyWarning(rawMessage: string): WarningBucket {
  const message = rawMessage.trim();
  if (!message) {
    return "backgroundWarnings";
  }

  for (const rule of WARNING_CLASSIFICATION_RULES) {
    if (rule.patterns.some((pattern) => message.includes(pattern))) {
      return rule.bucket;
    }
  }

  return "backgroundWarnings";
}

export async function captureAuditWarnings<T>(
  operation: () => Promise<T>,
  options?: { debug?: boolean }
): Promise<{ result: T; warnings: AuditWarningBuckets }> {
  const warnings: AuditWarningBuckets = {
    blockingErrors: [],
    semanticWarnings: [],
    backgroundWarnings: [],
  };
  const originalWarn = console.warn;

  console.warn = (...args: unknown[]) => {
    const message = args
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    const bucket = classifyWarning(message);
    warnings[bucket].push(message);
    if (options?.debug) {
      originalWarn(...args);
    }
  };

  try {
    const result = await operation();
    return { result, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.blockingErrors.push(message);
    throw error;
  } finally {
    console.warn = originalWarn;
  }
}

export function printWarningSummary(prefix: string, warnings: AuditWarningBuckets): void {
  console.log(
    `[${prefix}:warnings] ${JSON.stringify({
      blocking_errors: warnings.blockingErrors.length,
      semantic_warnings: warnings.semanticWarnings.length,
      background_warnings: warnings.backgroundWarnings.length,
    })}`
  );
}
