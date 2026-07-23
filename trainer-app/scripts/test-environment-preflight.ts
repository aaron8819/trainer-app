import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  buildTestEnvironmentPreflight,
  type CapabilityStatus,
} from "../src/lib/operations/test-environment-preflight";

function readPackageVersion(packagePath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function capability(available: boolean): CapabilityStatus {
  return available ? "available" : "missing";
}

const projectRoot = process.cwd();
const nodeModulesPath = path.join(projectRoot, "node_modules");
const dependencyInstallation = capability(existsSync(nodeModulesPath));
let dependencyArrangement: "standalone" | "junction" | "missing" = "missing";

if (dependencyInstallation === "available") {
  const resolvedNodeModules = realpathSync.native(nodeModulesPath);
  dependencyArrangement =
    lstatSync(nodeModulesPath).isSymbolicLink() ||
    path.normalize(resolvedNodeModules) !== path.normalize(nodeModulesPath)
      ? "junction"
      : "standalone";
}

const prismaClientPackage = path.join(nodeModulesPath, "@prisma", "client", "package.json");
const prismaCliPackage = path.join(nodeModulesPath, "prisma", "package.json");
const prismaClientVersion = readPackageVersion(prismaClientPackage);
const prismaCliVersion = readPackageVersion(prismaCliPackage);
const prismaClient = capability(Boolean(prismaClientVersion));
const dockerProbe = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
  encoding: "utf8",
  windowsHide: true,
});

const report = buildTestEnvironmentPreflight({
  databaseUrl: process.env.DATABASE_URL,
  dependencyInstallation,
  dependencyArrangement,
  prismaClient,
  prismaVersionMatches:
    Boolean(prismaClientVersion) &&
    Boolean(prismaCliVersion) &&
    prismaClientVersion === prismaCliVersion,
  docker: dockerProbe.status === 0 ? "available" : "missing",
});

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Trainer test environment preflight");
  console.log(`- dependencies: ${report.capabilities.dependencyInstallation} (${report.capabilities.dependencyArrangement})`);
  console.log(
    `- Prisma Client: ${report.capabilities.prismaClient} (${report.capabilities.prismaVersionMatches ? "version-aligned" : "version-mismatch"})`
  );
  console.log(`- DATABASE_URL target: ${report.databaseTarget}`);
  console.log(`- Docker: ${report.capabilities.docker}`);
  for (const group of Object.values(report.groups)) {
    console.log(`- ${group.command}: ${group.status} — ${group.reason}`);
  }
  for (const warning of report.warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const blocker of report.blockers) {
    console.error(`blocker: ${blocker}`);
  }
}

const requireFull = process.argv.includes("--require-full");
if (!report.success || (requireFull && report.groups.fullVitest.status !== "runnable")) {
  process.exitCode = 1;
}
