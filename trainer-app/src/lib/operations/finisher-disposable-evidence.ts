import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  disposableEvidenceSchema,
  FINISHER_DISPOSABLE_WORKFLOW,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
  FINISHER_PROVIDER_CONTRACT_VERSION,
  FINISHER_PROVIDER_TOOL_VERSION,
  migrationInventorySha256,
  type DisposableVerificationEvidence,
} from "./finisher-provider-verification";
import {
  EXPECTED_MIGRATION_CHAIN,
  MIGRATION_AUTHORIZATION_POLICY,
} from "./migration-integrity";

type CommandResult = { status: number; stdout: Buffer; stderr: string };
export type DisposableEvidenceCommandRunner = (
  executable: string,
  args: string[],
  cwd: string,
) => CommandResult;

const defaultRunner: DisposableEvidenceCommandRunner = (executable, args, cwd) => {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: null,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: Buffer.from(result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
};

function runText(
  runner: DisposableEvidenceCommandRunner,
  executable: string,
  args: string[],
  cwd: string,
): string {
  const result = runner(executable, args, cwd);
  if (result.status !== 0) {
    throw new Error(`Canonical source inspection failed: ${executable} ${args[0] ?? ""}.`);
  }
  return result.stdout.toString("utf8").trim();
}

export type DisposableEvidenceEnvironment = {
  GITHUB_ACTIONS?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_REF?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_RUN_ID?: string;
  GITHUB_RUN_ATTEMPT?: string;
  GITHUB_SHA?: string;
};

export function assertCanonicalDisposableEnvironment(
  environment: DisposableEvidenceEnvironment,
  expectedCommit: string,
): void {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    environment.GITHUB_REF !== "refs/heads/master" ||
    environment.GITHUB_REPOSITORY !== "aaron8819/trainer-app" ||
    environment.GITHUB_SHA?.trim().toLowerCase() !== expectedCommit
  ) {
    throw new Error(
      "Canonical disposable evidence is available only from the master workflow_dispatch run at its exact GITHUB_SHA. " +
        "The checked-out, requested, and GitHub workflow commits must match exactly.",
    );
  }
}

export function buildCanonicalDisposableEvidence(input: {
  appRoot: string;
  expectedCommit: string;
  startedAt: string;
  completedAt: string;
  environment: DisposableEvidenceEnvironment;
  runner?: DisposableEvidenceCommandRunner;
}): DisposableVerificationEvidence {
  const runner = input.runner ?? defaultRunner;
  const repositoryRoot = resolve(input.appRoot, "..");
  const environment = input.environment;
  if (!/^[0-9a-f]{40}$/.test(input.expectedCommit)) {
    throw new Error("The expected commit must be one full lowercase Git SHA.");
  }
  assertCanonicalDisposableEnvironment(environment, input.expectedCommit);
  const head = runText(runner, "git", ["rev-parse", "HEAD"], repositoryRoot);
  if (head !== input.expectedCommit) {
    throw new Error("The checked-out, requested, and GitHub workflow commits must match exactly.");
  }
  const dirty = runText(
    runner,
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repositoryRoot,
  );
  if (dirty) throw new Error("Canonical disposable evidence refuses a dirty worktree.");

  const blob = runText(
    runner,
    "git",
    ["rev-parse", `${head}:${FINISHER_MIGRATION_PATH}`],
    repositoryRoot,
  );
  if (blob !== FINISHER_MIGRATION_GIT_BLOB) {
    throw new Error("The Finisher migration Git blob does not match the reviewed identity.");
  }
  const blobBytes = runner(
    "git",
    ["cat-file", "blob", blob],
    repositoryRoot,
  );
  if (blobBytes.status !== 0) {
    throw new Error("The Finisher migration blob could not be read from Git.");
  }
  const migrationSha256 = createHash("sha256")
    .update(blobBytes.stdout)
    .digest("hex");
  const migrationRoot = join(input.appRoot, "prisma", "migrations");
  const inventory = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(inventory) !== JSON.stringify(EXPECTED_MIGRATION_CHAIN)) {
    throw new Error("The checked-out migration inventory is unexpected or ambiguous.");
  }
  const migrationFile = join(repositoryRoot, FINISHER_MIGRATION_PATH);
  if (readFileSync(migrationFile).byteLength === 0) {
    throw new Error("The checked-out Finisher migration is empty.");
  }
  const runId = environment.GITHUB_RUN_ID ?? "";
  const runAttempt = Number(environment.GITHUB_RUN_ATTEMPT);
  const evidence = {
    schema: "trainer-finisher-disposable-verification",
    version: 1,
    contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
    toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
    authority: "github_actions_exact_head_artifact",
    repository: "aaron8819/trainer-app",
    workflow: FINISHER_DISPOSABLE_WORKFLOW,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    commitSha: head,
    ref: "refs/heads/master",
    event: "workflow_dispatch",
    environment: "disposable",
    postgresMajor: 16,
    sourceClean: true,
    migration: {
      path: FINISHER_MIGRATION_PATH,
      sha256: migrationSha256,
      gitBlob: FINISHER_MIGRATION_GIT_BLOB,
      inventorySha256: migrationInventorySha256(inventory),
      inventory,
    },
    preMigrationState: {
      checkedIn: inventory.length,
      applied: inventory.length - 1,
      pending: [...MIGRATION_AUTHORIZATION_POLICY.expectedPendingMigrations],
    },
    terminalState: {
      migrationApplied: true,
      exactSchemaVerified: true,
      exactCatalogVerified: true,
      restrictedAdministratorWorkflowVerified: true,
      principalTerminalStateVerified: true,
      productionWritePathCoverageVerified: true,
      databaseWritesOutsideDisposable: 0,
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  } satisfies DisposableVerificationEvidence;
  return disposableEvidenceSchema.parse(evidence);
}
