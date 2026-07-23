import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const EXIT = Object.freeze({
  satisfied: 0,
  blocked: 1,
  invalidInvocation: 2,
});
const allowedFlags = new Set([
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
  (args.includes("--json") && runFlags.length > 0)
) {
  console.error("Invalid invocation. Supported flags: --json, --run-credential-free-inventory, --run-verify-gate.");
  process.exit(EXIT.invalidInvocation);
}

const projectRoot = process.cwd();
const nodeModulesPath = path.join(projectRoot, "node_modules");
const tsxLauncher = path.join(nodeModulesPath, "tsx", "dist", "cli.mjs");
const typedRunner = path.join(projectRoot, "scripts", "test-environment-preflight.ts");

if (!existsSync(nodeModulesPath) || !existsSync(tsxLauncher)) {
  const missing = {
    success: false,
    exitCode: EXIT.blocked,
    dependencyInstallation: existsSync(nodeModulesPath)
      ? "tsx-missing"
      : "dependencies-missing",
    message: "Install or link an approved exact-lock dependency installation before running typed checks.",
  };
  if (args.includes("--json")) console.log(JSON.stringify(missing, null, 2));
  else {
    console.error(`blocker: ${missing.dependencyInstallation}`);
    console.error(`blocker: ${missing.message}`);
  }
  process.exit(EXIT.blocked);
}

const result = spawnSync(process.execPath, [tsxLauncher, typedRunner, ...args], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
process.exit(result.status ?? EXIT.blocked);
