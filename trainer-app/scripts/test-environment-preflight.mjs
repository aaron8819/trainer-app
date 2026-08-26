import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const EXIT = Object.freeze({
  satisfied: 0,
  blocked: 1,
  invalidInvocation: 2,
});
const restrictedLauncherEnvironment = "TRAINER_RESTRICTED_VERIFICATION_LAUNCHER";
const environmentAllowlist = new Set([
  "APPDATA",
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "GITHUB_JOB",
  "GITHUB_REF",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "GITHUB_STEP_SUMMARY",
  "GITHUB_WORKFLOW",
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
]);
const sensitiveEnvironmentName =
  /(?:^|_)(?:ACCESS_KEY|API_KEY|AUTH|AUTHORIZATION|CLIENT_SECRET|CONNECTION_STRING|COOKIE|CREDENTIAL|CREDENTIALS|DATABASE_URL|DIRECT_URL|ID_TOKEN|PASSWORD|PASSCODE|PRIVATE_KEY|REFRESH_TOKEN|SECRET|SESSION_KEY|SHADOW_URL|TOKEN)(?:$|_)/;

function isSensitiveEnvironmentName(name) {
  const normalized = name.toUpperCase();
  return (
    normalized === "PGPASSWORD" ||
    normalized.endsWith("TOKEN") ||
    sensitiveEnvironmentName.test(normalized) ||
    normalized === "TRAINER_DISPOSABLE_DB_CONFIRMED" ||
    normalized === "TRAINER_IMPORT_ONLY_PLACEHOLDER_TEST"
  );
}

function credentialSafeEnvironment(environment) {
  const safe = {
    NODE_ENV:
      environment.NODE_ENV === "development" || environment.NODE_ENV === "production"
        ? environment.NODE_ENV
        : "test",
    [restrictedLauncherEnvironment]: "1",
  };
  const seen = new Set(["NODE_ENV", restrictedLauncherEnvironment]);
  for (const [name, value] of Object.entries(environment)) {
    const normalized = name.toUpperCase();
    if (
      value === undefined ||
      seen.has(normalized) ||
      isSensitiveEnvironmentName(name) ||
      !environmentAllowlist.has(normalized)
    ) {
      continue;
    }
    safe[name] = value;
    seen.add(normalized);
  }
  return safe;
}

function sensitiveEnvironmentValues(environment) {
  return [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([name, value]) =>
            isSensitiveEnvironmentName(name) &&
            typeof value === "string" &&
            value.length >= 8
        )
        .map(([, value]) => value)
    ),
  ].sort((left, right) => right.length - left.length);
}
const allowedBooleanFlags = new Set([
  "--debug",
  "--json",
  "--run-credential-free-aggregate",
  "--run-credential-free-inventory",
  "--run-credential-free-shard",
  "--run-import-safety",
  "--run-verify-gate",
]);
const allowedValueFlags = new Set([
  "--base-ref",
  "--credential-shards-result",
  "--import-safety-result",
  "--shard",
]);
const args = process.argv.slice(2);
const unknownFlags = [];
const values = new Map();
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (allowedBooleanFlags.has(argument)) continue;
  if (allowedValueFlags.has(argument)) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) unknownFlags.push(argument);
    else {
      if (values.has(argument)) unknownFlags.push(argument);
      values.set(argument, value);
      index += 1;
    }
    continue;
  }
  unknownFlags.push(argument);
}
const runFlags = args.filter((argument) => argument.startsWith("--run-"));
const shardRun = args.includes("--run-credential-free-shard");
const aggregateRun = args.includes("--run-credential-free-aggregate");
const baseRef = values.get("--base-ref");

if (
  unknownFlags.length > 0 ||
  runFlags.length > 1 ||
  (baseRef &&
    !args.includes("--run-credential-free-inventory") &&
    !aggregateRun) ||
  (shardRun !== values.has("--shard")) ||
  (aggregateRun !== values.has("--credential-shards-result")) ||
  (aggregateRun !== values.has("--import-safety-result")) ||
  (args.includes("--json") && runFlags.length > 0) ||
  (args.includes("--debug") && args.includes("--json"))
) {
  console.error("Invalid invocation. Supported flags: --debug, --json, --run-credential-free-inventory [--base-ref <git-ref>], --run-credential-free-shard --shard <N/4>, --run-import-safety, --run-credential-free-aggregate --credential-shards-result <result> --import-safety-result <result>, --run-verify-gate.");
  process.exit(EXIT.invalidInvocation);
}

const projectRoot = process.cwd();
const packageMetadataPath = path.join(projectRoot, "package.json");
const lockfilePath = path.join(projectRoot, "package-lock.json");
const nodeModulesPath = path.join(projectRoot, "node_modules");
const tsxLauncher = path.join(nodeModulesPath, "tsx", "dist", "cli.mjs");
const typedRunner = path.join(projectRoot, "scripts", "test-environment-preflight.ts");

function reportFailure(exitCode, code, message) {
  const failure = {
    success: false,
    exitCode,
    code,
    message,
  };
  if (args.includes("--json")) console.log(JSON.stringify(failure, null, 2));
  else {
    console.error(`${exitCode === EXIT.invalidInvocation ? "invalid" : "blocker"}: ${code}`);
    console.error(`${exitCode === EXIT.invalidInvocation ? "invalid" : "blocker"}: ${message}`);
  }
  process.exit(exitCode);
}

if (!existsSync(packageMetadataPath)) {
  reportFailure(
    EXIT.blocked,
    "package-metadata-missing",
    "Repository package metadata is required."
  );
}
try {
  const metadata = JSON.parse(readFileSync(packageMetadataPath, "utf8"));
  if (!metadata || typeof metadata !== "object" || typeof metadata.scripts !== "object") {
    throw new Error("invalid");
  }
} catch {
  reportFailure(
    EXIT.invalidInvocation,
    "package-metadata-malformed",
    "Repository package metadata is malformed."
  );
}
if (!existsSync(lockfilePath)) {
  reportFailure(EXIT.blocked, "lockfile-missing", "The exact-lock lockfile is required.");
}
if (!existsSync(typedRunner)) {
  reportFailure(EXIT.blocked, "typed-runner-missing", "The typed preflight runner is missing.");
}
if (!existsSync(nodeModulesPath)) {
  reportFailure(
    EXIT.blocked,
    "dependencies-missing",
    "Local dependencies are missing. Run npm ci deliberately from trainer-app before verification; no package download fallback was attempted."
  );
}
if (!existsSync(tsxLauncher)) {
  reportFailure(
    EXIT.blocked,
    "tsx-launcher-missing",
    "The approved dependency installation does not contain the tsx launcher."
  );
}

const result = spawnSync(process.execPath, [tsxLauncher, typedRunner, ...args], {
  cwd: projectRoot,
  env: credentialSafeEnvironment(process.env),
  input: JSON.stringify(sensitiveEnvironmentValues(process.env)),
  encoding: runFlags.length > 0 ? undefined : "utf8",
  windowsHide: true,
  stdio:
    runFlags.length > 0
      ? ["pipe", "inherit", "inherit"]
      : ["pipe", "pipe", "pipe"],
});
if (result.error) {
  if (args.includes("--debug")) {
    console.error(`debug: typed runner spawn failed (${result.error.code ?? "unknown"}).`);
  }
  reportFailure(EXIT.blocked, "typed-runner-spawn-failed", "The typed preflight runner could not start.");
}
if (result.signal || result.status === null) {
  if (args.includes("--debug")) {
    console.error(`debug: typed runner terminated (${result.signal ?? "no-status"}).`);
  }
  reportFailure(
    EXIT.blocked,
    "typed-runner-terminated",
    "The typed preflight runner terminated without a stable exit status."
  );
}

const trustedOutput =
  runFlags.length > 0 ||
  result.status === 0 ||
  result.stdout.includes("Trainer test environment preflight") ||
  result.stdout.trimStart().startsWith("{");
if (trustedOutput) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
} else {
  if (args.includes("--debug")) {
    console.error(`debug: typed runner loader failed (exit ${result.status}).`);
  }
  console.error("blocker: typed-runner-loader-failed");
  console.error("blocker: The typed preflight runner could not be loaded.");
}
process.exit(result.status);
