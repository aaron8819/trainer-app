import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVitestPhaseArtifactPaths,
  finalizeVitestPhaseArtifacts,
  formatVitestPhaseFailure,
} from "./credential-free-inventory-runner";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function reporter(input?: {
  failures?: Array<{ file: string; test: string; message: string }>;
}): string {
  const failures = input?.failures ?? [];
  const byFile = new Map<string, typeof failures>();
  for (const failure of failures) {
    byFile.set(failure.file, [...(byFile.get(failure.file) ?? []), failure]);
  }
  const testResults = failures.length === 0
    ? [
        {
          name: "C:/repo/passing.test.ts",
          status: "passed",
          message: "",
          assertionResults: [
            {
              fullName: "passing test",
              title: "passing test",
              status: "passed",
              failureMessages: [],
            },
          ],
        },
      ]
    : [...byFile].map(([file, fileFailures]) => ({
        name: file,
        status: "failed",
        message: fileFailures[0].message,
        assertionResults: fileFailures.map((failure) => ({
          fullName: failure.test,
          title: failure.test,
          status: "failed",
          failureMessages: [failure.message],
        })),
      }));
  return JSON.stringify({
    numTotalTests: failures.length || 1,
    numPassedTests: failures.length === 0 ? 1 : 0,
    numFailedTests: failures.length,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults,
  });
}

function finalizeFixture(input?: {
  reporter?: string | null;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  externalFailure?: string | null;
  stdout?: string;
  stderr?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "trainer phase artifacts with spaces "));
  temporaryDirectories.push(root);
  const paths = createVitestPhaseArtifactPaths({
    artifactRoot: join(root, "artifact root with spaces"),
    phase: "credential-free suites",
  });
  writeFileSync(paths.stdout, input?.stdout ?? "complete stdout\n");
  writeFileSync(paths.stderr, input?.stderr ?? "complete stderr\n");
  if (input?.reporter !== null) {
    writeFileSync(paths.reporter, input?.reporter ?? reporter());
  }
  return finalizeVitestPhaseArtifacts({
    phase: "credential-free suites",
    paths,
    exitCode: input?.exitCode === undefined ? 0 : input.exitCode,
    signal: input?.signal ?? null,
    terminationError: null,
    externalFailure: input?.externalFailure ?? null,
    durationMs: 12_345,
  });
}

describe("credential-free Vitest failure artifacts", () => {
  it("cleans disposable captures after a normal successful phase", () => {
    const result = finalizeFixture();
    expect(result).toMatchObject({
      success: true,
      failureKind: "none",
      artifactsRetained: false,
    });
    expect(existsSync(result.artifacts.directory)).toBe(false);
  });

  it("retains an ordinary failed test with file, test, message, and stack", () => {
    const stack = "AssertionError: expected 1 to be 2\n    at C:/repo/ordinary.test.ts:8:3";
    const result = finalizeFixture({
      exitCode: 1,
      reporter: reporter({
        failures: [
          { file: "C:/repo/ordinary.test.ts", test: "ordinary assertion", message: stack },
        ],
      }),
    });
    expect(result).toMatchObject({
      success: false,
      failureKind: "test-assertion",
      reporterState: "available",
      artifactsRetained: true,
      failures: [
        {
          file: "C:/repo/ordinary.test.ts",
          test: "ordinary assertion",
          errorMessage: "AssertionError: expected 1 to be 2",
          stackTrace: stack,
        },
      ],
    });
    const metadata = JSON.parse(
      readFileSync(result.artifacts.metadata, "utf8")
    ) as { failures: Array<{ stackTrace: string }> };
    expect(metadata.failures[0].stackTrace).toBe(stack);
  });

  it("retains every failed test across multiple files", () => {
    const result = finalizeFixture({
      exitCode: 1,
      reporter: reporter({
        failures: [
          { file: "C:/repo/first.test.ts", test: "first failure", message: "first\nstack" },
          { file: "C:/repo/first.test.ts", test: "second failure", message: "second\nstack" },
          { file: "C:/repo/other.test.ts", test: "third failure", message: "third\nstack" },
        ],
      }),
    });
    expect(result.failures.map(({ file, test }) => ({ file, test }))).toEqual([
      { file: "C:/repo/first.test.ts", test: "first failure" },
      { file: "C:/repo/first.test.ts", test: "second failure" },
      { file: "C:/repo/other.test.ts", test: "third failure" },
    ]);
  });

  it.each([
    { label: "malformed", source: "{", kind: "reporter-malformed", state: "malformed" },
    { label: "empty", source: "", kind: "reporter-missing", state: "missing" },
  ])("retains raw output for $label reporter output", ({ source, kind, state }) => {
    const result = finalizeFixture({ reporter: source, exitCode: 1 });
    expect(result).toMatchObject({ failureKind: kind, reporterState: state });
    expect(readFileSync(result.artifacts.stdout, "utf8")).toBe("complete stdout\n");
    expect(readFileSync(result.artifacts.stderr, "utf8")).toBe("complete stderr\n");
  });

  it("classifies a missing reporter file without fabricating a test identity", () => {
    const result = finalizeFixture({ reporter: null, exitCode: 1 });
    expect(result).toMatchObject({
      failureKind: "reporter-missing",
      reporterState: "missing",
      failures: [],
    });
    expect(existsSync(result.artifacts.metadata)).toBe(true);
  });

  it("classifies a generic nonzero exit with no reported test failure", () => {
    const result = finalizeFixture({ exitCode: 2 });
    expect(result).toMatchObject({
      failureKind: "subprocess-exit",
      exitCode: 2,
      failures: [],
    });
  });

  it("retains an otherwise successful phase when an external safety guard fails", () => {
    const result = finalizeFixture({
      externalFailure: "Import-only placeholder connection attempt was blocked.",
    });
    expect(result).toMatchObject({
      success: false,
      failureKind: "subprocess-exit",
      externalFailure: "Import-only placeholder connection attempt was blocked.",
      artifactsRetained: true,
    });
    expect(existsSync(result.artifacts.metadata)).toBe(true);
  });

  it("classifies signals and abnormal termination", () => {
    const result = finalizeFixture({ exitCode: null, signal: "SIGTERM" });
    expect(result).toMatchObject({
      failureKind: "worker-termination",
      signal: "SIGTERM",
      abnormalTermination: true,
    });
  });

  it("classifies reported test timeouts distinctly", () => {
    const result = finalizeFixture({
      exitCode: 1,
      reporter: reporter({
        failures: [
          {
            file: "C:/repo/slow.test.ts",
            test: "slow guard",
            message: "Error: Test timed out in 5000ms\n    at slow.test.ts:1:1",
          },
        ],
      }),
    });
    expect(result.failureKind).toBe("timeout");
  });

  it("creates collision-resistant artifact names", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-artifact-unique-"));
    temporaryDirectories.push(root);
    const first = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "same phase" });
    const second = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "same phase" });
    expect(first.directory).not.toBe(second.directory);
  });

  it("preserves complete captures under paths containing spaces", () => {
    const completeOutput = `begin\n${"x".repeat(300_000)}\nend`;
    const result = finalizeFixture({
      exitCode: 1,
      stdout: completeOutput,
      reporter: reporter({
        failures: [
          { file: "C:/path with spaces/test file.test.ts", test: "fails", message: "failure" },
        ],
      }),
    });
    expect(result.artifacts.directory).toContain(" ");
    expect(readFileSync(result.artifacts.stdout, "utf8")).toBe(completeOutput);
    expect(readFileSync(result.artifacts.stdout, "utf8").endsWith("end")).toBe(true);
  });

  it("formats a concise diagnostic with phase, identity, exit, elapsed time, artifacts, and action", () => {
    const result = finalizeFixture({
      exitCode: 1,
      reporter: reporter({
        failures: [
          { file: "C:/repo/failing.test.ts", test: "named test", message: "assertion failed" },
        ],
      }),
    });
    const summary = formatVitestPhaseFailure(result).join("\n");
    expect(summary).toContain("phase=credential-free suites");
    expect(summary).toContain("kind=test-assertion");
    expect(summary).toContain("elapsed=12.3s");
    expect(summary).toContain("exit=1");
    expect(summary).toContain("C:/repo/failing.test.ts > named test");
    expect(summary).toContain(result.artifacts.metadata);
    expect(summary).toContain("Next action:");
  });
});
