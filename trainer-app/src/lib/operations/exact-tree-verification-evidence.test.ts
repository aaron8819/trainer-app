import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TestSuiteEnvironmentManifest } from "./test-environment-preflight";
import type { VitestPhaseResult } from "./credential-free-inventory-runner";
import {
  assessExactTreeEvidenceReuse,
  computeVerificationDefinition,
  computeClassificationHash,
  createCredentialFreeVerificationEvidence,
  createEvidenceReuseRequest,
  CREDENTIAL_FREE_CHECK_ID,
  credentialFreeEvidenceArtifactName,
  hashCommittedGitPath,
  hashCanonicalValue,
  parseCredentialFreeVerificationEvidenceJson,
  publishCredentialFreeVerificationEvidence,
  readCurrentRepositoryState,
  validateCredentialFreeVerificationEvidence,
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

let cachedEvidence: CredentialFreeVerificationEvidence | null = null;

function createEvidenceFixture(
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
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_WORKFLOW: "Trainer pull request checks",
      GITHUB_JOB: "credential-free-inventory",
      ...environment,
    },
    completedAt: "2026-08-25T20:00:00.000Z",
  });
  return {
    ...value,
    repositoryState: { worktreeClean: true },
    environment: { ...value.environment, node: "v22.20.0" },
  };
}

function evidence(
  environment: Partial<NodeJS.ProcessEnv> = {}
): CredentialFreeVerificationEvidence {
  if (environment.GITHUB_EVENT_PATH || environment.GITHUB_REF) {
    return createEvidenceFixture(environment);
  }
  cachedEvidence ??= createEvidenceFixture();
  const value = structuredClone(cachedEvidence);
  if (environment.GITHUB_RUN_ATTEMPT) {
    value.run.runAttempt = environment.GITHUB_RUN_ATTEMPT;
  }
  return value;
}

function requestFor(value: CredentialFreeVerificationEvidence) {
  return {
    checkId: CREDENTIAL_FREE_CHECK_ID,
    currentRepositoryState: {
      commitSha: value.checkedOutCommitSha,
      treeSha: value.treeSha,
      worktreeClean: true,
      dirtyPaths: [],
    },
    verificationDefinitionHash: value.verificationDefinitionHash,
    classificationHash: value.classificationHash,
    lockfileHash: value.lockfileHash,
    toolchain: {
      nodeMajor: value.verificationDefinition.nodeMajor,
      vitest: value.environment.vitest,
      workers: value.verificationDefinition.workers,
    },
    hermetic: true,
    allowQualifiedPass: true,
  };
}

function git(repositoryRoot: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function temporaryGitRepository(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "trainer-evidence-git-"));
  temporaryDirectories.push(directory);
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.email", "trainer-test@example.invalid"]);
  git(directory, ["config", "user.name", "Trainer Evidence Test"]);
  return directory;
}

const minimalManifest: TestSuiteEnvironmentManifest = {
  schema: "trainer-test-suite-environments",
  version: 1,
  suites: [
    {
      path: "src/example.test.ts",
      environment: "import-only-placeholder",
      owner: "test",
      reason: "portable fixture",
    },
  ],
};

function writeDefinitionPolicy(repositoryRoot: string, files: string[]): void {
  const policyPath = path.join(repositoryRoot, "scripts", "codex", "trainer-policy.v1.json");
  mkdirSync(path.dirname(policyPath), { recursive: true });
  writeFileSync(
    policyPath,
    `${JSON.stringify({
      verification: {
        exactTreeEvidence: {
          schemaVersion: 1,
          checks: [
            {
              id: CREDENTIAL_FREE_CHECK_ID,
              definition: {
                packageScript: "test:inventory:credential-free",
                nodeMajor: 22,
                workers: 1,
                classificationOwner: "trainer-app/scripts/test-suite-environments.json",
                includeLockfile: true,
                files,
                registryCommandIds: ["npm-test-inventory-credential-free"],
              },
            },
          ],
        },
      },
      commandRegistry: [
        {
          id: "npm-test-inventory-credential-free",
          packageScript: "test:inventory:credential-free",
          profile: "local-artifact-write",
        },
      ],
    })}\n`,
    "utf8"
  );
}

function createDefinitionRepository(): { repositoryRoot: string; projectRoot: string } {
  const repositoryRoot = temporaryGitRepository();
  const projectRoot = path.join(repositoryRoot, "trainer-app");
  mkdirSync(path.join(repositoryRoot, "definition"), { recursive: true });
  mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
  writeFileSync(path.join(repositoryRoot, "definition", "a.txt"), "alpha\n", "utf8");
  writeFileSync(path.join(repositoryRoot, "definition", "b.txt"), "beta\n", "utf8");
  writeFileSync(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ scripts: { "test:inventory:credential-free": "node inventory.js" } })}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(projectRoot, "package-lock.json"),
    `${JSON.stringify({
      lockfileVersion: 3,
      packages: { "node_modules/vitest": { version: "4.0.18" } },
    })}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(projectRoot, "scripts", "test-suite-environments.json"),
    `${JSON.stringify(minimalManifest)}\n`,
    "utf8"
  );
  writeDefinitionPolicy(repositoryRoot, ["definition/b.txt", "definition/a.txt"]);
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "--quiet", "-m", "fixture"]);
  return { repositoryRoot, projectRoot };
}

beforeAll(() => {
  cachedEvidence = createEvidenceFixture();
}, 30_000);

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

  it("binds definition and lockfile hashes to committed blobs across LF and CRLF checkouts", () => {
    const { repositoryRoot, projectRoot: fixtureProjectRoot } = createDefinitionRepository();
    const linuxStyle = computeVerificationDefinition({
      projectRoot: fixtureProjectRoot,
      classificationManifest: minimalManifest,
    });
    const committedInputHash = hashCommittedGitPath(repositoryRoot, "definition/a.txt");
    const committedLockHash = hashCommittedGitPath(
      repositoryRoot,
      "trainer-app/package-lock.json"
    );

    git(repositoryRoot, ["config", "core.autocrlf", "true"]);
    writeFileSync(path.join(repositoryRoot, "definition", "a.txt"), "alpha\r\n", "utf8");
    const lockfilePath = path.join(fixtureProjectRoot, "package-lock.json");
    writeFileSync(
      lockfilePath,
      readFileSync(lockfilePath, "utf8").replaceAll("\n", "\r\n"),
      "utf8"
    );
    expect(readFileSync(path.join(repositoryRoot, "definition", "a.txt"), "utf8")).toContain(
      "\r\n"
    );

    const windowsStyle = computeVerificationDefinition({
      projectRoot: fixtureProjectRoot,
      classificationManifest: minimalManifest,
    });
    expect(windowsStyle.hash).toBe(linuxStyle.hash);
    expect(windowsStyle.lockfileHash).toBe(linuxStyle.lockfileHash);
    expect(windowsStyle.inputs.find((entry) => entry.path === "definition/a.txt")?.sha256).toBe(
      committedInputHash
    );
    expect(windowsStyle.lockfileHash).toBe(committedLockHash);
  }, 30_000);

  it("canonicalizes definition path order and separators and fails closed on duplicates or missing blobs", () => {
    const { repositoryRoot, projectRoot: fixtureProjectRoot } = createDefinitionRepository();
    const first = computeVerificationDefinition({
      projectRoot: fixtureProjectRoot,
      classificationManifest: minimalManifest,
    });
    expect(first.inputs.map((entry) => entry.path)).toEqual([
      "definition/a.txt",
      "definition/b.txt",
    ]);

    writeDefinitionPolicy(repositoryRoot, ["definition\\a.txt", "definition\\b.txt"]);
    git(repositoryRoot, ["add", "."]);
    git(repositoryRoot, ["commit", "--quiet", "-m", "separator variant"]);
    const separatorVariant = computeVerificationDefinition({
      projectRoot: fixtureProjectRoot,
      classificationManifest: minimalManifest,
    });
    expect(separatorVariant.hash).toBe(first.hash);

    writeDefinitionPolicy(repositoryRoot, ["definition/a.txt", "definition\\a.txt"]);
    git(repositoryRoot, ["add", "."]);
    git(repositoryRoot, ["commit", "--quiet", "-m", "duplicate variant"]);
    expect(() =>
      computeVerificationDefinition({
        projectRoot: fixtureProjectRoot,
        classificationManifest: minimalManifest,
      })
    ).toThrow(/duplicate input paths/i);

    writeDefinitionPolicy(repositoryRoot, ["definition/missing.txt"]);
    git(repositoryRoot, ["add", "."]);
    git(repositoryRoot, ["commit", "--quiet", "-m", "missing variant"]);
    expect(() =>
      computeVerificationDefinition({
        projectRoot: fixtureProjectRoot,
        classificationManifest: minimalManifest,
      })
    ).toThrow(/committed Git state|Git blob/i);
  }, 30_000);

  it("rejects malformed and conflicting classification sources", () => {
    expect(() =>
      computeClassificationHash(
        { ...minimalManifest, schema: "wrong" } as unknown as TestSuiteEnvironmentManifest
      )
    ).toThrow(/malformed/i);
    expect(() =>
      computeClassificationHash({
        ...minimalManifest,
        suites: [...minimalManifest.suites, ...minimalManifest.suites],
      })
    ).toThrow(/duplicated/i);
  });

  it("fails closed when the committed classification source is missing, malformed, or conflicted", () => {
    const missing = createDefinitionRepository();
    git(missing.repositoryRoot, [
      "rm",
      "--quiet",
      "trainer-app/scripts/test-suite-environments.json",
    ]);
    git(missing.repositoryRoot, ["commit", "--quiet", "-m", "missing classification"]);
    expect(() =>
      createEvidenceReuseRequest({
        projectRoot: missing.projectRoot,
        allowQualifiedPass: false,
      })
    ).toThrow(/committed credential-free classification source/i);

    const malformed = createDefinitionRepository();
    writeFileSync(
      path.join(malformed.projectRoot, "scripts", "test-suite-environments.json"),
      "{not-json",
      "utf8"
    );
    git(malformed.repositoryRoot, ["add", "."]);
    git(malformed.repositoryRoot, ["commit", "--quiet", "-m", "malformed classification"]);
    expect(() =>
      createEvidenceReuseRequest({
        projectRoot: malformed.projectRoot,
        allowQualifiedPass: false,
      })
    ).toThrow(/committed credential-free classification source/i);

    const conflicted = createDefinitionRepository();
    writeFileSync(
      path.join(conflicted.projectRoot, "scripts", "test-suite-environments.json"),
      `${JSON.stringify({
        ...minimalManifest,
        suites: [...minimalManifest.suites, ...minimalManifest.suites],
      })}\n`,
      "utf8"
    );
    git(conflicted.repositoryRoot, ["add", "."]);
    git(conflicted.repositoryRoot, ["commit", "--quiet", "-m", "conflicted classification"]);
    expect(() =>
      createEvidenceReuseRequest({
        projectRoot: conflicted.projectRoot,
        allowQualifiedPass: false,
      })
    ).toThrow(/committed credential-free classification source/i);
  }, 45_000);

  it("parses artifact JSON as untrusted input", () => {
    const value = evidence();
    expect(parseCredentialFreeVerificationEvidenceJson(JSON.stringify(value))).toMatchObject({
      valid: true,
    });
    expect(parseCredentialFreeVerificationEvidenceJson("{not-json")).toEqual({
      valid: false,
      errors: ["evidence JSON is malformed"],
    });
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
    expect(summary).toContain(credentialFreeEvidenceArtifactName(value));
  });

  it("records coherent PR head and merge-ref identities", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "trainer-evidence-event-"));
    temporaryDirectories.push(directory);
    const eventPath = path.join(directory, "event.json");
    const currentCommit = git(path.resolve(projectRoot, ".."), ["rev-parse", "HEAD"]);
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: { sha: currentCommit },
          base: { sha: currentCommit, ref: "master" },
        },
      })
    );
    const value = evidence({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: "refs/pull/99/merge",
      GITHUB_SHA: currentCommit,
    });
    expect(value.prHeadSha).toBe(currentCommit);
    expect(value.prHeadTreeSha).toBe(value.treeSha);
    expect(value.prHeadTreeMatchesTestedTree).toBe(true);
    expect(value.mergeRefSha).toBe(currentCommit);
    expect(value.mergeRefTreeSha).toBe(value.treeSha);
  }, 20_000);

  it("reuses a complete pass for the same tree and equivalent definition", () => {
    const value = evidence();
    expect(assessExactTreeEvidenceReuse(value, requestFor(value))).toEqual({
      reusable: true,
      reason: "reusable",
    });
  });

  it("derives consumer cleanliness from Git status while respecting ignored files", () => {
    const repositoryRoot = temporaryGitRepository();
    writeFileSync(path.join(repositoryRoot, ".gitignore"), "cache/\n", "utf8");
    writeFileSync(path.join(repositoryRoot, "tracked.ts"), "export const value = 1;\n", "utf8");
    git(repositoryRoot, ["add", "."]);
    git(repositoryRoot, ["commit", "--quiet", "-m", "consumer fixture"]);

    const clean = readCurrentRepositoryState(repositoryRoot);
    const value = { ...evidence(), treeSha: clean.treeSha };
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: clean,
      })
    ).toEqual({ reusable: true, reason: "reusable" });

    writeFileSync(path.join(repositoryRoot, "tracked.ts"), "export const value = 2;\n", "utf8");
    const tracked = readCurrentRepositoryState(repositoryRoot);
    expect(tracked.dirtyPaths).toEqual([
      { path: "tracked.ts", categories: ["tracked"] },
    ]);
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: tracked,
      }).reason
    ).toBe("dirty-current-checkout");

    git(repositoryRoot, ["add", "tracked.ts"]);
    const staged = readCurrentRepositoryState(repositoryRoot);
    expect(staged.dirtyPaths).toEqual([
      { path: "tracked.ts", categories: ["staged"] },
    ]);
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: staged,
      }).reason
    ).toBe("dirty-current-checkout");

    git(repositoryRoot, ["restore", "--staged", "tracked.ts"]);
    git(repositoryRoot, ["restore", "tracked.ts"]);
    writeFileSync(path.join(repositoryRoot, "untracked.test.ts"), "test('x', () => {});\n", "utf8");
    const untracked = readCurrentRepositoryState(repositoryRoot);
    expect(untracked.dirtyPaths).toEqual([
      { path: "untracked.test.ts", categories: ["untracked"] },
    ]);
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: untracked,
      }).reason
    ).toBe("dirty-current-checkout");

    rmSync(path.join(repositoryRoot, "untracked.test.ts"));
    mkdirSync(path.join(repositoryRoot, "cache"));
    writeFileSync(path.join(repositoryRoot, "cache", "artifact.bin"), "ignored", "utf8");
    const ignored = readCurrentRepositoryState(repositoryRoot);
    expect(ignored).toMatchObject({ worktreeClean: true, dirtyPaths: [] });
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: ignored,
      }).reusable
    ).toBe(true);
  }, 30_000);

  it("builds reuse compatibility from committed policy, lockfile, and current Git state", () => {
    const { repositoryRoot, projectRoot: fixtureProjectRoot } = createDefinitionRepository();
    const request = createEvidenceReuseRequest({
      projectRoot: fixtureProjectRoot,
      allowQualifiedPass: false,
    });
    expect(request.currentRepositoryState).toMatchObject({
      commitSha: git(repositoryRoot, ["rev-parse", "HEAD"]),
      treeSha: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
      worktreeClean: true,
      dirtyPaths: [],
    });
    expect(request.toolchain).toEqual({ nodeMajor: 22, vitest: "4.0.18", workers: 1 });
    expect(request.lockfileHash).toBe(
      hashCommittedGitPath(repositoryRoot, "trainer-app/package-lock.json")
    );
  }, 20_000);

  it("rejects dirty or non-durable producer evidence as incomplete", () => {
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
    [
      "pass with failure payload",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        failure: {
          phase: "credential-free suites",
          kind: "test-assertion",
          reporterComplete: true,
          selectedCoverageCompleted: true,
          failures: [{ file: "src/example.test.ts", test: "fails", message: "failure" }],
          retryEligibility: {
            eligible: false,
            reason: "not eligible",
            file: null,
            test: null,
          },
        },
      }),
    ],
    [
      "pass with failed tests",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        counts: {
          ...value.counts,
          testsPassed: value.counts.testsPassed - 1,
          testsFailed: 1,
        },
      }),
    ],
    [
      "invalid completedAt",
      (value: CredentialFreeVerificationEvidence) => ({ ...value, completedAt: "not-a-date" }),
    ],
    [
      "contradictory nested definition hash",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        verificationDefinition: { ...value.verificationDefinition, hash: "f".repeat(64) },
      }),
    ],
    [
      "invalid SHA and hash format",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        treeSha: "not-a-sha",
        classificationHash: "not-a-hash",
      }),
    ],
    [
      "negative counts and durations",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        counts: { ...value.counts, filesExecuted: -1 },
        durations: { ...value.durations, totalMs: -1 },
      }),
    ],
    [
      "qualified pass without qualification",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        status: "qualified_pass",
        qualification: null,
      }),
    ],
    [
      "impossible Node identity",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        environment: { ...value.environment, node: "v999" },
      }),
    ],
    [
      "incomplete required import-safety phase",
      (value: CredentialFreeVerificationEvidence) => ({
        ...value,
        importSafety: { status: "not_run", connectionAttempted: false },
      }),
    ],
  ])("fails closed for malformed evidence: %s", (_label, mutate) => {
    const value = evidence();
    const malformed = mutate(value) as unknown;
    expect(validateCredentialFreeVerificationEvidence(malformed).valid).toBe(false);
    expect(assessExactTreeEvidenceReuse(malformed, requestFor(value))).toEqual({
      reusable: false,
      reason: "malformed-evidence",
    });
  });

  it("rejects an otherwise coherent incompatible requested toolchain", () => {
    const value = evidence();
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        toolchain: { ...requestFor(value).toolchain, nodeMajor: 23 },
      }).reason
    ).toBe("incompatible-toolchain");
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        toolchain: { ...requestFor(value).toolchain, vitest: "99.0.0" },
      }).reason
    ).toBe("incompatible-toolchain");
  });

  it("does not require producer and consumer operating-system identity", () => {
    const value = evidence();
    const ubuntuEvidence = {
      ...value,
      environment: {
        ...value.environment,
        os: "linux 6.11.0",
        architecture: "x64",
        runnerImage: "ubuntu24",
      },
    };
    expect(assessExactTreeEvidenceReuse(ubuntuEvidence, requestFor(value)).reusable).toBe(true);
  });

  it("fails closed outside Git, without HEAD, and when a required blob is unavailable", () => {
    const nonRepository = mkdtempSync(path.join(tmpdir(), "trainer-evidence-no-git-"));
    temporaryDirectories.push(nonRepository);
    expect(() => readCurrentRepositoryState(nonRepository)).toThrow(/Git commit and tree/i);

    const repositoryWithoutHead = temporaryGitRepository();
    expect(() => readCurrentRepositoryState(repositoryWithoutHead)).toThrow(/Git commit and tree/i);
    expect(() => hashCommittedGitPath(repositoryWithoutHead, "missing.txt")).toThrow(
      /committed Git state/i
    );
  });

  it.each([
    ["verificationDefinitionHash", "definition-mismatch", "b".repeat(64)],
    ["classificationHash", "classification-mismatch", "c".repeat(64)],
    ["lockfileHash", "lockfile-mismatch", "d".repeat(64)],
  ] as const)("rejects %s mismatch", (field, reason, replacement) => {
    const value = evidence();
    const request = { ...requestFor(value), [field]: replacement };
    expect(assessExactTreeEvidenceReuse(value, request).reason).toBe(reason);
  });

  it("rejects a current consumer tree mismatch", () => {
    const value = evidence();
    expect(
      assessExactTreeEvidenceReuse(value, {
        ...requestFor(value),
        currentRepositoryState: {
          ...requestFor(value).currentRepositoryState,
          treeSha: "a".repeat(40),
        },
      }).reason
    ).toBe("tree-mismatch");
  });

  it("never reuses coherent failure or external-state checks from tree evidence", () => {
    const value = evidence();
    const failed = {
      ...value,
      status: "fail" as const,
      counts: {
        ...value.counts,
        filesPassed: value.counts.filesPassed - 1,
        filesFailed: 1,
        testsPassed: value.counts.testsPassed - 1,
        testsFailed: 1,
      },
      failure: {
        phase: "credential-free suites",
        kind: "test-assertion" as const,
        reporterComplete: true,
        selectedCoverageCompleted: true,
        failures: [{ file: "src/example.test.ts", test: "fails", message: "failure" }],
        retryEligibility: {
          eligible: false,
          reason: "not eligible",
          file: null,
          test: null,
        },
      },
    };
    expect(
      assessExactTreeEvidenceReuse(failed, requestFor(value)).reason
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
  }, 30_000);

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
    ).toBe("malformed-evidence");
  });

  it("allows different commits with the same tree but never substitutes commit identity for tree equality", () => {
    const value = evidence();
    const differentCommit = { ...value, checkedOutCommitSha: "f".repeat(40) };
    expect(
      assessExactTreeEvidenceReuse(differentCommit, {
        ...requestFor(value),
        currentRepositoryState: {
          ...requestFor(value).currentRepositoryState,
          commitSha: "e".repeat(40),
        },
      }).reusable
    ).toBe(true);
    expect(
      assessExactTreeEvidenceReuse(differentCommit, {
        ...requestFor(value),
        currentRepositoryState: {
          ...requestFor(value).currentRepositoryState,
          treeSha: "e".repeat(40),
        },
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
      "name: credential-free-inventory-evidence-tree-${{ steps.tested_identity.outputs.tree_sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}"
    );
    expect(workflow).toContain(
      "trainer-app/artifacts/credential-free-inventory/evidence/credential-free-inventory-evidence.json"
    );
  });
});
