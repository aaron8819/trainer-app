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
  status: AuditPreflightStatus;
  failures: string[];
};

export type AuditWarningBuckets = {
  blockingErrors: string[];
  semanticWarnings: string[];
  backgroundWarnings: string[];
};

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
    const identity = await input.resolveIdentity({
      userId: explicitUserId ?? undefined,
      ownerEmail: ownerEmail ?? undefined,
    });
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
      ...preflight.status,
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

function classifyWarning(rawMessage: string): keyof AuditWarningBuckets {
  const message = rawMessage.trim();
  if (!message) {
    return "backgroundWarnings";
  }
  if (
    message.includes("[template-session]") ||
    message.includes("Section/role mismatch") ||
    message.includes("[stimulus-profile:coverage]")
  ) {
    return "semanticWarnings";
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
