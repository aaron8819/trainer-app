import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const EXIT = Object.freeze({
  satisfied: 0,
  blocked: 1,
  invalidInvocation: 2,
});
const allowedFlags = new Set([
  "--debug",
  "--json",
  "--run-credential-free-inventory",
  "--run-verify-gate",
]);
const args = process.argv.slice(2);
const unknownFlags = args.filter((argument) => !allowedFlags.has(argument));
const runFlags = args.filter((argument) => argument.startsWith("--run-"));

if (
  unknownFlags.length > 0 ||
  runFlags.length > 1 ||
  (args.includes("--json") && runFlags.length > 0) ||
  (args.includes("--debug") && args.includes("--json"))
) {
  console.error("Invalid invocation. Supported flags: --debug, --json, --run-credential-free-inventory, --run-verify-gate.");
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
  env: process.env,
  encoding: "utf8",
  windowsHide: true,
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
