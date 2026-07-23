import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import {
  buildTestEnvironmentPreflight,
  classifyDependencyArrangement,
  classifyPrismaReadiness,
  DATABASE_TARGET_ENV_VARS,
  isDependencyLinkAllowed,
  sanitizeDatabaseTargetEnvironment,
  type CapabilityStatus,
  type DatabaseTargetEnvironment,
  type DependencyArrangement,
} from "../src/lib/operations/test-environment-preflight";

function capability(available: boolean): CapabilityStatus {
  return available ? "available" : "missing";
}

function readOptional(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function hashFile(filePath: string): string | null {
  const source = readOptional(filePath);
  return source === undefined
    ? null
    : createHash("sha256").update(source).digest("hex");
}

function registeredDependencyTargets(projectRoot: string): Set<string> {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return new Set();
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .map((worktree) => path.normalize(path.join(worktree, "trainer-app", "node_modules")))
  );
}

function inspectDependencies(projectRoot: string): {
  installation: CapabilityStatus;
  arrangement: DependencyArrangement;
  linkAllowed: boolean;
} {
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    return { installation: "missing", arrangement: "missing", linkAllowed: false };
  }

  try {
    const resolved = path.normalize(realpathSync.native(nodeModulesPath));
    const isLink =
      lstatSync(nodeModulesPath).isSymbolicLink() ||
      resolved !== path.normalize(nodeModulesPath);
    const arrangement = classifyDependencyArrangement({
      exists: true,
      resolved: true,
      isLink,
      platform: process.platform,
    });
    if (arrangement === "standalone") {
      return { installation: "available", arrangement: "standalone", linkAllowed: true };
    }

    const currentLockHash = hashFile(path.join(projectRoot, "package-lock.json"));
    const targetLockHash = hashFile(path.join(path.dirname(resolved), "package-lock.json"));
    const allowedTargets = registeredDependencyTargets(projectRoot);
    return {
      installation: "available",
      arrangement,
      linkAllowed: isDependencyLinkAllowed({
        resolvedTarget: resolved,
        registeredTargets: allowedTargets,
        currentLockHash,
        targetLockHash,
      }),
    };
  } catch {
    return { installation: "invalid", arrangement: "unresolved", linkAllowed: false };
  }
}

function databaseTargets(): DatabaseTargetEnvironment {
  return Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, process.env[name]])
  ) as DatabaseTargetEnvironment;
}

function runCredentialFree(command: string, args: string[]): number {
  const env = sanitizeDatabaseTargetEnvironment(process.env);
  env.TRAINER_CREDENTIAL_FREE_TEST = "1";
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return result.status ?? 1;
}

const projectRoot = process.cwd();
const dependency = inspectDependencies(projectRoot);
const nodeModulesPath = path.join(projectRoot, "node_modules");
const checkedInSchema = readOptional(path.join(projectRoot, "prisma", "schema.prisma"));
const generatedSchema = readOptional(
  path.join(nodeModulesPath, ".prisma", "client", "schema.prisma")
);
const prismaReadiness = classifyPrismaReadiness({
  dependenciesAvailable: dependency.installation === "available",
  prismaPackageAvailable: existsSync(path.join(nodeModulesPath, "prisma", "package.json")),
  prismaClientPackageAvailable: existsSync(
    path.join(nodeModulesPath, "@prisma", "client", "package.json")
  ),
  generatedClientAvailable:
    existsSync(path.join(nodeModulesPath, ".prisma", "client", "default.js")) &&
    existsSync(path.join(nodeModulesPath, ".prisma", "client", "default.d.ts")),
  checkedInSchema,
  generatedSchema,
});
const dockerProbe = spawnSync("docker", ["--version"], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 5_000,
});

const report = buildTestEnvironmentPreflight({
  databaseTargets: databaseTargets(),
  dependencyInstallation: dependency.installation,
  dependencyArrangement: dependency.arrangement,
  dependencyLinkAllowed: dependency.linkAllowed,
  prismaReadiness,
  docker: capability(dockerProbe.status === 0),
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Trainer test environment preflight");
  console.log(
    `- dependencies: ${report.capabilities.dependencyInstallation} (${report.capabilities.dependencyArrangement})`
  );
  console.log(
    `- dependency link policy: ${report.capabilities.dependencyLinkAllowed ? "allowed" : "not-allowed"}`
  );
  console.log(`- Prisma readiness: ${report.capabilities.prismaReadiness}`);
  for (const name of DATABASE_TARGET_ENV_VARS) {
    console.log(`- ${name}: ${report.databaseTargets[name]}`);
  }
  console.log(`- Docker CLI: ${report.capabilities.docker}`);
  for (const group of Object.values(report.groups)) {
    console.log(`- ${group.command}: ${group.status} — ${group.reason}`);
  }
  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  for (const blocker of report.blockers) console.error(`blocker: ${blocker}`);
}

if (!report.success) {
  process.exitCode = 1;
} else if (process.argv.includes("--run-credential-free-inventory")) {
  process.exitCode = runCredentialFree(process.execPath, [
    path.join(nodeModulesPath, "vitest", "vitest.mjs"),
    "run",
  ]);
} else if (process.argv.includes("--run-verify-gate")) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) {
    console.error("blocker: npm CLI path is unavailable.");
    process.exitCode = 1;
  } else {
    process.exitCode = runCredentialFree(process.execPath, [npmCli, "run", "verify"]);
  }
}
