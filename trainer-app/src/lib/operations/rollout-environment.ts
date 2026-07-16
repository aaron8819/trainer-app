import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { assertProductionWriteAllowed } from "./production-write-gate";

export type RolloutTargetClass = "local" | "disposable" | "remote";

export type RolloutEnvironment = {
  envFile: string;
  targetClass: RolloutTargetClass;
  writeEnabled: boolean;
  remoteWriteConfirmed: boolean;
};

type LoadRolloutEnvironmentOptions = {
  argv: string[];
  allowWrite: boolean;
  requireExplicitEnvFile?: boolean;
  cwd?: string;
  environment?: Record<string, string | undefined>;
  requiredVariables?: string[];
};

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  );
}

export function classifyRolloutTarget(
  connectionString: string,
  disposableConfirmed: boolean,
): RolloutTargetClass {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL in the explicit environment file is invalid.");
  }
  if (!isLoopbackHost(url.hostname)) return "remote";
  return disposableConfirmed ? "disposable" : "local";
}

export function loadRolloutEnvironment(
  options: LoadRolloutEnvironmentOptions,
): RolloutEnvironment {
  const requireExplicit = options.requireExplicitEnvFile ?? true;
  const envFileArg = readArgument(options.argv, "--env-file");
  if (requireExplicit && !envFileArg) {
    throw new Error("Missing required --env-file <path>. No environment file is loaded implicitly.");
  }
  if (!envFileArg) {
    throw new Error("An explicit environment file is required for rollout commands.");
  }

  const envFile = resolve(options.cwd ?? process.cwd(), envFileArg);
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(readFileSync(envFile));
  } catch {
    throw new Error(`Unable to load the explicitly named environment file: ${envFile}`);
  }

  const requiredVariables = options.requiredVariables ?? ["DATABASE_URL"];
  for (const variable of requiredVariables) {
    if (!parsed[variable]) {
      throw new Error(`The explicitly named environment file must define ${variable}.`);
    }
  }

  const environment = options.environment ?? process.env;
  for (const [key, value] of Object.entries(parsed)) environment[key] = value;

  const connectionString = parsed.DATABASE_URL!;

  const writeEnabled = options.argv.includes("--write");
  const remoteWriteConfirmed = options.argv.includes("--confirm-remote-write");
  const disposableConfirmed = options.argv.includes("--confirm-disposable");
  const targetClass = classifyRolloutTarget(connectionString, disposableConfirmed);

  if (writeEnabled && !options.allowWrite) {
    throw new Error("--write is not supported by this read-only command.");
  }
  if (remoteWriteConfirmed && !writeEnabled) {
    throw new Error("--confirm-remote-write is valid only together with --write.");
  }
  if (writeEnabled && targetClass === "remote" && !remoteWriteConfirmed) {
    throw new Error("Remote --write requires --confirm-remote-write before any database connection.");
  }
  if (writeEnabled && targetClass === "remote") {
    assertProductionWriteAllowed("operational_backfill", parsed);
  }

  return { envFile, targetClass, writeEnabled, remoteWriteConfirmed };
}

export function sanitizedRolloutEnvironment(
  environment: RolloutEnvironment,
): Record<string, string | boolean> {
  return {
    envFile: environment.envFile,
    targetClass: environment.targetClass,
    mode: environment.writeEnabled ? "write" : "dry_run",
    remoteWriteConfirmed: environment.remoteWriteConfirmed,
  };
}

export function assertOperationalProductionWriteAllowed(options: {
  argv: string[];
  writeRequested: boolean;
  operation?: "operational_backfill";
  environment?: Record<string, string | undefined>;
}): void {
  if (!options.writeRequested) return;

  const environment = options.environment ?? process.env;
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL");

  const targetClass = classifyRolloutTarget(
    connectionString,
    options.argv.includes("--confirm-disposable"),
  );
  if (targetClass !== "remote") return;
  if (!options.argv.includes("--confirm-remote-write")) {
    throw new Error("Remote write requires --confirm-remote-write before any database connection.");
  }
  assertProductionWriteAllowed(options.operation ?? "operational_backfill", environment);
}

export async function runWithRolloutEnvironment<T>(
  options: LoadRolloutEnvironmentOptions,
  operation: (environment: RolloutEnvironment) => Promise<T>,
): Promise<T> {
  const environment = loadRolloutEnvironment(options);
  return operation(environment);
}
