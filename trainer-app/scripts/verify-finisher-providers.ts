import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectFinisherProviderVerification,
  ProviderVerificationError,
} from "@/lib/operations/finisher-provider-adapters";
import {
  assessFinisherProviderVerification,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
  FINISHER_PRODUCTION_DATABASE,
  migrationInventorySha256,
} from "@/lib/operations/finisher-provider-verification";
import { EXPECTED_MIGRATION_CHAIN } from "@/lib/operations/migration-integrity";

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function required(argv: string[], name: string): string {
  const value = readArgument(argv, name)?.trim();
  if (!value) throw new Error(`Missing required ${name} <value>.`);
  return value;
}

function configuredVercelIdentity() {
  const path = resolve(process.cwd(), "..", "scripts", "codex", "trainer-remote.v1.json");
  const value = JSON.parse(readFileSync(path, "utf8")) as {
    vercel?: Record<string, unknown>;
  };
  const vercel = value.vercel;
  if (!vercel) throw new Error("Committed Vercel identity is unavailable.");
  for (const key of ["teamId", "teamSlug", "projectId", "projectName", "productionAlias"] as const) {
    if (typeof vercel[key] !== "string" || !vercel[key]) {
      throw new Error(`Committed Vercel identity field ${key} is unavailable.`);
    }
  }
  return vercel as {
    teamId: string;
    teamSlug: string;
    projectId: string;
    projectName: string;
    productionAlias: string;
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((argument) => argument.includes("evidence-file") || argument.includes("verified"))) {
    throw new Error("Caller-authored provider success claims are not accepted.");
  }
  const requiredApplicationCommit = required(argv, "--required-application-commit").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(requiredApplicationCommit)) {
    throw new Error("--required-application-commit must be a full lowercase Git SHA.");
  }
  const repositoryHead = required(argv, "--repository-head").toLowerCase();
  if (repositoryHead !== requiredApplicationCommit) {
    throw new Error("Repository HEAD must equal the required application commit.");
  }
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actualHead !== repositoryHead) {
    throw new Error("The checked-out repository HEAD does not match the required application commit.");
  }
  const migrationBlob = execFileSync(
    "git",
    ["rev-parse", `${actualHead}:${FINISHER_MIGRATION_PATH}`],
    { encoding: "utf8" },
  ).trim();
  if (migrationBlob !== FINISHER_MIGRATION_GIT_BLOB) {
    throw new Error("The checked-out Finisher migration is not the reviewed Git blob.");
  }
  const migrationSha256 = createHash("sha256")
    .update(execFileSync("git", ["cat-file", "blob", migrationBlob], { encoding: null }))
    .digest("hex");
  const inventorySha256 = migrationInventorySha256([...EXPECTED_MIGRATION_CHAIN]);
  const vercel = configuredVercelIdentity();
  const database = required(argv, "--expected-database");
  if (database !== FINISHER_PRODUCTION_DATABASE) {
    throw new Error(`The expected production database must be ${FINISHER_PRODUCTION_DATABASE}.`);
  }
  const target = {
    environment: "production" as const,
    githubOwner: "aaron8819",
    githubRepository: "trainer-app",
    vercelTeamId: vercel.teamId,
    vercelTeamSlug: vercel.teamSlug,
    vercelProjectId: vercel.projectId,
    vercelProjectName: vercel.projectName,
    productionAlias: vercel.productionAlias,
    supabaseOrganizationId: required(argv, "--expected-supabase-organization-id"),
    supabaseProjectRef: required(argv, "--expected-supabase-project-ref"),
    database: FINISHER_PRODUCTION_DATABASE,
  };
  const evidence = await collectFinisherProviderVerification({
    requiredApplicationCommit,
    disposableRunId: required(argv, "--disposable-run-id"),
    target,
    vercelToken: process.env.VERCEL_TOKEN,
    supabaseToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
  const assessment = assessFinisherProviderVerification(evidence, {
    evaluatedAt: new Date().toISOString(),
    repositoryHead,
    requiredApplicationCommit,
    migrationPath: FINISHER_MIGRATION_PATH,
    migrationGitBlob: FINISHER_MIGRATION_GIT_BLOB,
    migrationSha256,
    migrationInventorySha256: inventorySha256,
    target,
  });
  console.log(JSON.stringify({ evidence, assessment }, null, 2));
  process.exitCode = assessment.valid ? 0 : 1;
}

main().catch((error: unknown) => {
  const code = error instanceof ProviderVerificationError ? error.code : "invalid_invocation";
  console.error(JSON.stringify({
    schema: "trainer-finisher-provider-verification-error",
    version: 1,
    code,
    message: "Provider verification failed closed. No provider response body or credential was retained.",
  }));
  process.exitCode = 1;
});
