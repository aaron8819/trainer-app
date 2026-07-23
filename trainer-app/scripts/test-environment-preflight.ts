import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildTestEnvironmentPreflight,
  DATABASE_TARGET_ENV_VARS,
  inspectDependencyFilesystem,
  inspectPrismaClientFilesystem,
  sanitizeDatabaseTargetEnvironment,
  type CapabilityStatus,
  type DatabaseTargetEnvironment,
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

function registeredWorktreeRoots(projectRoot: string): string[] {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.normalize(line.slice("worktree ".length)));
}

function resolveNpmCli(): string | undefined {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  );
}

function validateDependencyInstallation(projectRoot: string): boolean {
  const npmCli = resolveNpmCli();
  if (!npmCli) return false;
  const result = spawnSync(process.execPath, [npmCli, "ls", "--all", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
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

function expectedPrismaModels(schema: string | undefined): string[] {
  return schema
    ? [
        ...schema.matchAll(
          /\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm
        ),
      ]
        .filter((match) => !match[2].includes("@@ignore"))
        .map((match) => match[1])
    : [];
}

function probeGeneratedPrismaClient(
  clientForwarder: string,
  expectedModels: readonly string[]
): { importSucceeded: boolean; expectedModelsAvailable: boolean } {
  const probe = [
    "const client=require(process.argv[1]);",
    "const expected=JSON.parse(process.argv[2]);",
    "const models=client.Prisma?.dmmf?.datamodel?.models?.map((model)=>model.name);",
    "if(typeof client.PrismaClient!==\"function\"||!Array.isArray(models))process.exit(1);",
    "if(!expected.every((name)=>models.includes(name)))process.exit(2);",
  ].join("");
  const env = sanitizeDatabaseTargetEnvironment(process.env);
  env.TRAINER_CREDENTIAL_FREE_TEST = "1";
  const result = spawnSync(
    process.execPath,
    ["-e", probe, clientForwarder, JSON.stringify(expectedModels)],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      windowsHide: true,
    }
  );
  return {
    importSucceeded: result.status === 0 || result.status === 2,
    expectedModelsAvailable: result.status === 0,
  };
}

const projectRoot = process.cwd();
const dependency = inspectDependencyFilesystem({
  currentProjectRoot: projectRoot,
  registeredWorktreeRoots: registeredWorktreeRoots(projectRoot),
  platform: process.platform,
  validateInstallation: validateDependencyInstallation,
});
const nodeModulesPath = dependency.dependencyRoot;
const checkedInSchema = readOptional(path.join(projectRoot, "prisma", "schema.prisma"));
const probe =
  existsSync(path.join(nodeModulesPath, "@prisma", "client", "default.js"))
    ? probeGeneratedPrismaClient(
        path.join(nodeModulesPath, "@prisma", "client", "default.js"),
        expectedPrismaModels(checkedInSchema)
      )
    : { importSucceeded: false, expectedModelsAvailable: false };
const prismaReadiness = inspectPrismaClientFilesystem({
  checkedInSchemaPath: path.join(projectRoot, "prisma", "schema.prisma"),
  dependencyRoot: nodeModulesPath,
  dependenciesAvailable: dependency.installation === "available",
  importProbeSucceeded: probe.importSucceeded,
  expectedModelMetadataAvailable: probe.expectedModelsAvailable,
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
