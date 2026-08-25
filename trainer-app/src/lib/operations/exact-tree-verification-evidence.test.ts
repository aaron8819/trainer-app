import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestSuiteEnvironmentManifest } from "./test-environment-preflight";
import type { VitestPhaseResult } from "./credential-free-inventory-runner";
import {
  assessExactTreeEvidenceReuse,
  computeClassificationHash,
  createCredentialFreeVerificationEvidence,
  CREDENTIAL_FREE_CHECK_ID,
  hashCanonicalValue,
  publishCredentialFreeVerificationEvidence,
  type CredentialFreeVerificationEvidence,
} from "./exact-tree-verification-evidence";

const projectRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(path.join(projectRoot, "scripts", "test-suite-environments.json"), "utf8")
) as TestSuiteEnvironmentManifest;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function phase(phaseName: string, files: number): VitestPhaseResult {
  return {
    phase: phaseName,
    success: true,
    status: 0,
    exitCode: 0,
    signal: null,
    abnormalTermination: false,
    terminationError: null,
    externalFailure: null,
    durationMs: 120,
    summary: {
      files: { total: files, passed: files, failed: 0, skipped: 0 },
      tests: { total: files * 2, passed: files * 2, failed: 0, skipped: 0 },
    },
    reporterState: "available",
    failureKind: "none",
    failures: [],
    artifactDiagnostics: [],
    artifacts: {
      root: "not-retained",
      directory: "not-retained",
      stdout: "not-retained",
      stderr: "not-retained",
      reporter: "not-retained",
      metadata: "not-retained",
    },
    artifactsRetained: false,
  };
}

function timedOutPhase(files: number): VitestPhaseResult {
  return {
    ...phase("credential-free suites", files),
    success: false,
    status: 1,
    exitCode: 1,
    failureKind: "timeout",
    summary: {
      files: { total: files, passed: files - 1, failed: 1, skipped: 0 },
      tests: { total: files * 2, passed: files * 2 - 1, failed: 1, skipped: 0 },
    },
    failures: [
      {
        file: "src/example.test.ts",
        test: "finishes",
        errorMessage: "Test timed out in 5000ms.",
        stackTrace: "Test timed out in 5000ms.",
      },
    ],
    artifactsRetained: true,
  };
}

function evidence(
  environment: Partial<NodeJS.ProcessEnv> = {}
): CredentialFreeVerificationEvidence {
  const value = createCredentialFreeVerificationEvidence({
    projectRoot,
    manifest,
    filesDiscovered: 3,
    credentialFreeSelected: 2,
    importOnlySelected: 1,
    databaseRequiredExcluded: 0,
    credentialFreeResult: phase("credential-free suites", 2),
    importOnlyResult: phase("import-only placeholder suites", 1),
    placeholderConnectionAttempted: false,
    exitCode: 0,
    totalDurationMs: 240,
    environment: {
      NODE_ENV: "test",
      TZ: "America/Chicago",
      GITHUB_REPOSITORY: "owner/repository",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
      ...environment,
    },
    completedAt: "2026-08-25T20:00:00.000Z",
  });
  return { ...value, repositoryState: { worktreeClean: true } };
}

function requestFor(value: CredentialFreeVerificationEvidence) {
  return {
    checkId: CREDENTIAL_FREE_CHECK_ID,
    treeSha: value.treeSha,
    verificationDefinitionHash: value.verificationDefinitionHash,
    classificationHash: value.classificationHash,
    lockfileHash: value.lockfileHash,
    hermetic: true,
    allowQualifiedPass: true,
  };
}

describe("exact-tree verification evidence", () => {
  it("hashes equivalent classification semantics independently of suite ordering", () => {
    const reversed = { ...manifest, suites: [...manifest.suites].reverse() };
    expect(computeClassificationHash(reversed)).toBe(
      computeClassificationHash(manifest)
    );
    expect(hashCanonicalValue({ b: 2, a: 1 })).toBe(
      hashCanonicalValue({ a: 1, b: 2 })
    );
  });

  it("publishes the canonical definition inputs, lockfile, versions, and exact tested tree", () => {
    const value = evidence({
      GITHUB_REPOSITORY: "owner/repository",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ATTEMPT: "2",
    });
    expect(value.checkedOutCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(value.treeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(value.verificationDefinition.inputs.map((entry) => entry.path)).toContain(
      ".github/workflows/credential-free-inventory.yml"
    );
    expect(value.verificationDefinition.inputs.map((entry) => entry.path)).toContain(
      "trainer-app/src/lib/operations/exact-tree-verification-evidence.ts"
    );
    expect(value.lockfileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(value.environment.workers).toBe(1);
    expect(value.run.url).toBe(
      "https://github.com/owner/repository/actions/runs/123"
    );
  });

  it("writes small machine evidence and a human job summary without arbitrary environment values", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "trainer-evidence-publish-"));
    temporaryDirectories.push(directory);
    const summaryPath = path.join(directory, "summary.md");
    const value = evidence({ UNRELATED_SECRET_SENTINEL: "must-not-appear" });
    const evidencePath = publishCredentialFreeVerificationEvidence({
      projectRoot: directory,
      evidence: value,
      environment: {
        NODE_ENV: "test",
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    });
    const serialized = readFileSync(evidencePath, "utf8");
    const summary = readFileSync(summaryPath, "utf8");
    expect(JSON.parse(serialized)).toMatchObject({
      schema: "trainer-verification-evidence",
      schemaVersion: 1,
      status: "pass",
      treeSha: value.treeSha,
    });
    expect(serialized).not.toContain("must-not-appear");
    expect(summary).toContain(value.treeSha);
    expect(summary).toContain(value.verificationDefinitionHash);
    expect(summary).toContain("Import safety: pass");
  });

  it("records PR head and merge-ref identities without claiming an unequal head tree", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "trainer-evidence-event-"));
    temporaryDirectories.push(directory);
    const eventPath = path.join(directory, "event.json");
    const unequalHead = "0000000000000000000000000000000000000000";
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: { sha: unequalHead },
          base: { sha: "1111111111111111111111111111111111111111", ref: "master" },
        },
      })
    );
    const value = evidence({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: "refs/pull/99/merge",
      GITHUB_SHA: "2222222222222222222222222222222222222222",
    });
    expect(value.prHeadSha).toBe(unequalHead);
    expect(value.prHeadTreeSha).toBeNull();
    expect(value.prHeadTreeMatchesTestedTree).toBeNull();
    expect(value.mergeRefSha).toBe("2222222222222222222222222222222222222222");
    expect(value.mergeRefTreeSha).toBeNull();
    expect(value.treeSha).not.toBe(value.prHeadSha);
  });

  it("reuses a complete pass for the same tree and equivalent definition", () => {
    const value = evidence();
    expect(assessExactTreeEvidenceReuse(value, requestFor(value))).toEqual({
      reusable: true,
      reason: "reusable",
    });
  });

  it("rejects dirty or non-durable local evidence as incomplete", () => {
    const value = evidence();
    expect(
      assessExactTreeEvidenceReuse(
        { ...value, repositoryState: { worktreeClean: false } },
        requestFor(value)
      ).reason
    ).toBe("incomplete-evidence");
    expect(
      assessExactTreeEvidenceReuse(
        { ...value, run: { ...value.run, runId: null, url: null } },
        requestFor(value)
      ).reason
    ).toBe("incomplete-evidence");
  });

  it.each([
    ["treeSha", "tree-mismatch", "a".repeat(40)],
    ["verificationDefinitionHash", "definition-mismatch", "definition-changed"],
    ["classificationHash", "classification-mismatch", "classification-changed"],
    ["lockfileHash", "lockfile-mismatch", "lockfile-changed"],
  ] as const)("rejects %s mismatch", (field, reason, replacement) => {
    const value = evidence();
    const request = { ...requestFor(value), [field]: replacement };
    expect(assessExactTreeEvidenceReuse(value, request).reason).toBe(reason);
  });

  it("never reuses failure or external-state checks from tree evidence", () => {
    const value = evidence();
    expect(
      assessExactTreeEvidenceReuse(
        { ...value, status: "fail" },
        requestFor(value)
      ).reason
    ).toBe("failed-evidence");
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        hermetic: false,
      }).reason
    ).toBe("non-hermetic-check");
  });

  it("marks only one timeout with complete selected coverage as targeted-retry eligible", () => {
    const value = createCredentialFreeVerificationEvidence({
      projectRoot,
      manifest,
      filesDiscovered: 3,
      credentialFreeSelected: 2,
      importOnlySelected: 1,
      databaseRequiredExcluded: 0,
      credentialFreeResult: timedOutPhase(2),
      importOnlyResult: phase("import-only placeholder suites", 1),
      placeholderConnectionAttempted: false,
      exitCode: 1,
      totalDurationMs: 240,
      environment: { NODE_ENV: "test", TZ: "America/Chicago" },
    });
    expect(value.status).toBe("fail");
    expect(value.failure).toMatchObject({
      phase: "credential-free suites",
      kind: "timeout",
      reporterComplete: true,
      selectedCoverageCompleted: true,
      retryEligibility: {
        eligible: true,
        file: "src/example.test.ts",
        test: "finishes",
      },
    });

    const assertion = {
      ...timedOutPhase(2),
      failureKind: "test-assertion" as const,
    };
    const assertionEvidence = createCredentialFreeVerificationEvidence({
      projectRoot,
      manifest,
      filesDiscovered: 3,
      credentialFreeSelected: 2,
      importOnlySelected: 1,
      databaseRequiredExcluded: 0,
      credentialFreeResult: assertion,
      importOnlyResult: phase("import-only placeholder suites", 1),
      placeholderConnectionAttempted: false,
      exitCode: 1,
      totalDurationMs: 240,
      environment: { NODE_ENV: "test", TZ: "America/Chicago" },
    });
    expect(assertionEvidence.failure?.retryEligibility.eligible).toBe(false);
  });

  it("accepts only a permitted non-recurring qualified timeout retry", () => {
    const value = evidence();
    const qualified: CredentialFreeVerificationEvidence = {
      ...value,
      status: "qualified_pass",
      qualification: {
        kind: "single-isolated-timeout",
        originalFailure: {
          file: "src/example.test.ts",
          test: "finishes",
          reporterComplete: true,
        },
        retry: { status: "pass", treeSha: value.treeSha },
        recurrence: { sameTestOccurrences: 1, blocked: false },
      },
    };
    expect(
      assessExactTreeEvidenceReuse(qualified, requestFor(value)).reusable
    ).toBe(true);
    expect(
      assessExactTreeEvidenceReuse(qualified, {
        ...requestFor(value),
        allowQualifiedPass: false,
      }).reason
    ).toBe("qualification-not-permitted");
    expect(
      assessExactTreeEvidenceReuse(
        {
          ...qualified,
          qualification: {
            ...qualified.qualification!,
            recurrence: { sameTestOccurrences: 2, blocked: true },
          },
        },
        requestFor(value)
      ).reason
    ).toBe("qualification-invalid");
  });

  it("does not use PR head equality as a substitute for tested-tree equality", () => {
    const value = evidence();
    const differentHead = { ...value, prHeadSha: "f".repeat(40) };
    expect(
      assessExactTreeEvidenceReuse(differentHead, requestFor(value)).reusable
    ).toBe(true);
    expect(
      assessExactTreeEvidenceReuse(differentHead, {
        ...requestFor(value),
        treeSha: "e".repeat(40),
      }).reason
    ).toBe("tree-mismatch");
  });

  it("keeps workflow publication durable, exact-tree keyed, and always-on", () => {
    const workflow = readFileSync(
      path.resolve(projectRoot, "..", ".github", "workflows", "credential-free-inventory.yml"),
      "utf8"
    );
    expect(workflow).toContain("id: tested_identity");
    expect(workflow).toContain("git rev-parse HEAD^{tree}");
    expect(workflow).toContain("steps.tested_identity.outputs.tree_sha");
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).toContain(
      "trainer-app/artifacts/credential-free-inventory/evidence/credential-free-inventory-evidence.json"
    );
  });
});
