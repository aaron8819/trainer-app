import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCanonicalDisposableEvidence,
  type DisposableEvidenceCommandRunner,
} from "./finisher-disposable-evidence";
import { FINISHER_MIGRATION_GIT_BLOB } from "./finisher-provider-verification";

const COMMIT = "a".repeat(40);
const MIGRATION_BYTES = Buffer.from("canonical-migration-bytes\n", "utf8");

function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "aaron8819/trainer-app",
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: COMMIT,
  };
}

function runner(options: { dirty?: boolean; blob?: string } = {}): DisposableEvidenceCommandRunner {
  return (_executable, args) => {
    const joined = args.join(" ");
    if (joined === "rev-parse HEAD") {
      return { status: 0, stdout: Buffer.from(`${COMMIT}\n`), stderr: "" };
    }
    if (joined.startsWith("status --porcelain")) {
      return {
        status: 0,
        stdout: Buffer.from(options.dirty ? " M migration.sql\n" : ""),
        stderr: "",
      };
    }
    if (joined.startsWith("rev-parse ") && joined.includes(":")) {
      return {
        status: 0,
        stdout: Buffer.from(`${options.blob ?? FINISHER_MIGRATION_GIT_BLOB}\n`),
        stderr: "",
      };
    }
    if (joined === `cat-file blob ${FINISHER_MIGRATION_GIT_BLOB}`) {
      return { status: 0, stdout: MIGRATION_BYTES, stderr: "" };
    }
    return { status: 1, stdout: Buffer.alloc(0), stderr: "unexpected" };
  };
}

describe("canonical disposable evidence generator", () => {
  it("binds exact workflow head, Git blob, SHA-256, inventory, and terminal state", () => {
    const result = buildCanonicalDisposableEvidence({
      appRoot: process.cwd(),
      expectedCommit: COMMIT,
      startedAt: "2026-07-31T17:00:00.000Z",
      completedAt: "2026-07-31T17:10:00.000Z",
      environment: environment(),
      runner: runner(),
    });
    expect(result.commitSha).toBe(COMMIT);
    expect(result.migration.gitBlob).toBe(FINISHER_MIGRATION_GIT_BLOB);
    expect(result.migration.sha256).toBe(
      createHash("sha256").update(MIGRATION_BYTES).digest("hex"),
    );
    expect(result.migration.sha256).not.toBe(
      "01f2fd87b63dfb622b8ccbede86236e4db6f35f9317ebcda331f786b13b9a114",
    );
    expect(result.terminalState).toMatchObject({
      migrationApplied: true,
      restrictedAdministratorWorkflowVerified: true,
      databaseWritesOutsideDisposable: 0,
    });
  });

  it("refuses dirty source state", () => {
    expect(() => buildCanonicalDisposableEvidence({
      appRoot: process.cwd(),
      expectedCommit: COMMIT,
      startedAt: "2026-07-31T17:00:00.000Z",
      completedAt: "2026-07-31T17:10:00.000Z",
      environment: environment(),
      runner: runner({ dirty: true }),
    })).toThrow("refuses a dirty worktree");
  });

  it("refuses ambiguous or wrong workflow commits", () => {
    expect(() => buildCanonicalDisposableEvidence({
      appRoot: process.cwd(),
      expectedCommit: "b".repeat(40),
      startedAt: "2026-07-31T17:00:00.000Z",
      completedAt: "2026-07-31T17:10:00.000Z",
      environment: environment(),
      runner: runner(),
    })).toThrow("must match exactly");
  });

  it("refuses a stale migration Git blob", () => {
    expect(() => buildCanonicalDisposableEvidence({
      appRoot: process.cwd(),
      expectedCommit: COMMIT,
      startedAt: "2026-07-31T17:00:00.000Z",
      completedAt: "2026-07-31T17:10:00.000Z",
      environment: environment(),
      runner: runner({ blob: "b".repeat(40) }),
    })).toThrow("does not match the reviewed identity");
  });

  it("refuses non-canonical workflow environments", () => {
    expect(() => buildCanonicalDisposableEvidence({
      appRoot: process.cwd(),
      expectedCommit: COMMIT,
      startedAt: "2026-07-31T17:00:00.000Z",
      completedAt: "2026-07-31T17:10:00.000Z",
      environment: { ...environment(), GITHUB_REF: "refs/pull/28/merge" },
      runner: runner(),
    })).toThrow("only from the master workflow_dispatch run");
  });
});
