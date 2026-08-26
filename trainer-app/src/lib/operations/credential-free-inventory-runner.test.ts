import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
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
  runVitestPhase,
  type ArtifactIo,
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
          startTime: 1_000,
          endTime: 1_025,
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
      executedFiles: [
        {
          file: "C:/repo/passing.test.ts",
          status: "passed",
          durationMs: 25,
        },
      ],
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
      failureKind: "safety-guard",
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

  it("keeps hostile phase and injected fixture identifiers inside the artifact root", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-artifact-safe-root-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({
      artifactRoot: root,
      phase: "../../outside\\phase",
      uniqueId: "../../hostile\\identifier",
    });
    expect(paths.directory.startsWith(`${paths.root}${process.platform === "win32" ? "\\" : "/"}`)).toBe(
      true
    );
    expect(paths.directory).not.toContain("..");
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

function retainedSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(directory, entry.name), "utf8"))
    .join("\n");
}

function createFakeVitestCli(): { projectRoot: string; cli: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), "trainer fake vitest with spaces "));
  temporaryDirectories.push(projectRoot);
  const cli = join(projectRoot, "fake-vitest.mjs");
  writeFileSync(
    cli,
    [
      'if (process.argv.some((argument) => argument.startsWith("--outputFile"))) {',
      '  throw new Error("Reporter output must not be persisted by the child process.");',
      '}',
      'const sentinelArgument = process.argv.find((argument) => argument.startsWith("--sentinel="));',
      'const sentinel = sentinelArgument?.slice("--sentinel=".length) ?? "";',
      'process.stdout.write(`useful stdout before ${sentinel} after\\n`);',
      'process.stderr.write(`useful stderr before ${sentinel} after\\n`);',
      'process.stdout.write(JSON.stringify({',
      '  numTotalTestSuites: 1, numPassedTestSuites: 0, numFailedTestSuites: 1, numPendingTestSuites: 0,',
      '  numTotalTests: 1, numPassedTests: 0, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0,',
      '  testResults: [{ name: "fake.test.ts", status: "failed", message: `file ${sentinel}`, assertionResults: [{ fullName: "fake failure", status: "failed", failureMessages: [`AssertionError: useful ${sentinel} evidence\\nstack`] }]}]',
      '}));',
      'process.stdout.write("\\n");',
      'process.exitCode = 1;',
    ].join("\n")
  );
  return { projectRoot, cli };
}

describe("credential-free Vitest runner integration", () => {
  it("redacts parent sentinel values before terminal display or retained persistence", async () => {
    const sentinel = "trainer-common-token-sentinel-4dbf77f6";
    const { projectRoot, cli } = createFakeVitestCli();
    const terminal: string[] = [];
    const result = await runVitestPhase({
      phase: "sentinel phase",
      projectRoot,
      vitestCli: cli,
      args: [`--sentinel=${sentinel}`],
      environment: { NODE_ENV: "test" },
      artifactRoot: join(projectRoot, "artifact root"),
      sensitiveValues: [sentinel],
      output: {
        stdout: (source) => terminal.push(source),
        stderr: (source) => terminal.push(source),
        log: (source) => terminal.push(source),
      },
    });

    expect(result.failureKind).toBe("test-assertion");
    expect(terminal.join("\n")).not.toContain(sentinel);
    expect(terminal.join("\n")).toContain("useful stdout before [REDACTED]");
    expect(terminal.join("\n")).toContain("after");
    expect(terminal.join("\n")).not.toContain("numTotalTestSuites");
    expect(retainedSources(result.artifacts.directory)).not.toContain(sentinel);
    expect(retainedSources(result.artifacts.directory)).toContain("useful [REDACTED] evidence");
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(formatVitestPhaseFailure(result).join("\n")).not.toContain(sentinel);
  });

  it("keeps an assertion primary when capture creation and writes fail", async () => {
    const { projectRoot, cli } = createFakeVitestCli();
    const result = await runVitestPhase({
      phase: "capture fault",
      projectRoot,
      vitestCli: cli,
      args: [],
      environment: { NODE_ENV: "test" },
      artifactRoot: join(projectRoot, "artifacts"),
      output: { stdout: () => {}, stderr: () => {}, log: () => {} },
      artifactIo: {
        openCapture: (filePath) => {
          if (filePath.endsWith("vitest.stdout.log")) throw new Error("EACCES locked capture");
          return openSync(filePath, "wx");
        },
        writeCapture: () => {
          throw new Error("ENOSPC capture write failed");
        },
        closeCapture: (fileDescriptor) => {
          closeSync(fileDescriptor);
          throw new Error("EPERM capture completion failed");
        },
      },
    });

    expect(result.failureKind).toBe("test-assertion");
    expect(result.artifactDiagnostics.map((entry) => entry.operation)).toEqual(
      expect.arrayContaining(["capture-open", "capture-write", "capture-close"])
    );
  });
});

describe("artifact fault isolation and failure precedence", () => {
  function throwingIo(
    operation: keyof ArtifactIo,
    predicate: (filePath: string) => boolean = () => true
  ): Partial<ArtifactIo> {
    if (operation === "readText") {
      return {
        readText: (filePath) => {
          if (predicate(filePath)) throw new Error("EACCES reporter locked");
          return readFileSync(filePath, "utf8");
        },
      };
    }
    if (operation === "writeText") {
      return {
        writeText: (filePath, source) => {
          if (predicate(filePath)) throw new Error("ENOSPC metadata write failed");
          writeFileSync(filePath, source);
        },
      };
    }
    if (operation === "removeDirectory") {
      return {
        removeDirectory: (directory) => {
          if (predicate(directory)) throw new Error("EPERM cleanup locked");
          rmSync(directory, { recursive: true, force: true });
        },
      };
    }
    throw new Error(`Unsupported fault operation: ${operation}`);
  }

  it("keeps a signal primary when reporter read and external guard checks also fail", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-signal-fault-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "signal" });
    writeFileSync(paths.stdout, "stdout");
    writeFileSync(paths.stderr, "stderr");
    writeFileSync(paths.reporter, reporter());
    const result = finalizeVitestPhaseArtifacts({
      phase: "signal",
      paths,
      exitCode: null,
      signal: "SIGTERM",
      terminationError: "worker terminated",
      externalFailure: "socket attempt blocked",
      durationMs: 50,
      artifactIo: throwingIo("readText"),
    });
    expect(result.failureKind).toBe("worker-termination");
    expect(result.externalFailure).toBe("socket attempt blocked");
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "reporter-read" })
    );
    const summary = formatVitestPhaseFailure(result).join("\n");
    expect(summary).toContain("Termination detail: worker terminated");
    expect(summary).toContain("Additional safety finding: socket attempt blocked");
    expect(summary).toContain("Artifact diagnostic:");
  });

  it("keeps assertion and timeout evidence ahead of external or malformed conditions", () => {
    const assertion = finalizeFixture({
      exitCode: 1,
      externalFailure: "socket attempt blocked",
      reporter: reporter({
        failures: [{ file: "assert.test.ts", test: "asserts", message: "AssertionError: no" }],
      }),
    });
    expect(assertion.failureKind).toBe("test-assertion");

    const timeoutSource = JSON.stringify({
      numTotalTests: "invalid-summary",
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: "slow.test.ts",
          status: "failed",
          assertionResults: [
            {
              fullName: "times out",
              status: "failed",
              failureMessages: ["Error: Test timed out in 5000ms"],
            },
          ],
        },
      ],
    });
    const timeout = finalizeFixture({ exitCode: 1, reporter: timeoutSource });
    expect(timeout).toMatchObject({ failureKind: "timeout", reporterState: "malformed" });
  });

  it("reports metadata write failure secondarily without replacing assertion", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-metadata-fault-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "metadata" });
    writeFileSync(paths.stdout, "stdout");
    writeFileSync(paths.stderr, "stderr");
    writeFileSync(
      paths.reporter,
      reporter({
        failures: [{ file: "primary.test.ts", test: "primary", message: "AssertionError: primary" }],
      })
    );
    const result = finalizeVitestPhaseArtifacts({
      phase: "metadata",
      paths,
      exitCode: 1,
      signal: null,
      terminationError: null,
      durationMs: 10,
      artifactIo: throwingIo("writeText", (filePath) => filePath.endsWith("failure-metadata.json")),
    });
    expect(result.failureKind).toBe("test-assertion");
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "metadata-write" })
    );
    expect(formatVitestPhaseFailure(result).join("\n")).toContain("metadata-write");
  });

  it("turns success cleanup failure into an explicit artifact failure", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-cleanup-fault-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "cleanup" });
    writeFileSync(paths.stdout, "stdout");
    writeFileSync(paths.stderr, "stderr");
    writeFileSync(paths.reporter, reporter());
    const result = finalizeVitestPhaseArtifacts({
      phase: "cleanup",
      paths,
      exitCode: 0,
      signal: null,
      terminationError: null,
      durationMs: 10,
      artifactIo: throwingIo("removeDirectory"),
    });
    expect(result).toMatchObject({ success: false, failureKind: "artifact-failure" });
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "success-cleanup" })
    );
  });

  it("refuses cleanup when the run directory resolves to the artifact root", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-unsafe-cleanup-"));
    temporaryDirectories.push(root);
    const paths = {
      root,
      directory: root,
      stdout: join(root, "vitest.stdout.log"),
      stderr: join(root, "vitest.stderr.log"),
      reporter: join(root, "vitest.reporter.json"),
      metadata: join(root, "failure-metadata.json"),
    };
    writeFileSync(paths.stdout, "stdout");
    writeFileSync(paths.stderr, "stderr");
    writeFileSync(paths.reporter, reporter());
    let cleanupCalled = false;
    const result = finalizeVitestPhaseArtifacts({
      phase: "unsafe cleanup",
      paths,
      exitCode: 0,
      signal: null,
      terminationError: null,
      durationMs: 10,
      artifactIo: {
        removeDirectory: () => {
          cleanupCalled = true;
        },
      },
    });
    expect(cleanupCalled).toBe(false);
    expect(result.failureKind).toBe("artifact-failure");
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "unsafe-cleanup" })
    );
  });

  it("retains partial evidence when a capture is missing during failure finalization", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-missing-capture-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "missing" });
    writeFileSync(paths.stderr, "stderr remains");
    writeFileSync(
      paths.reporter,
      reporter({
        failures: [{ file: "primary.test.ts", test: "primary", message: "AssertionError: primary" }],
      })
    );
    const result = finalizeVitestPhaseArtifacts({
      phase: "missing",
      paths,
      exitCode: 1,
      signal: null,
      terminationError: null,
      durationMs: 10,
    });
    expect(result.failureKind).toBe("test-assertion");
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "capture-size", path: paths.stdout })
    );
    expect(readFileSync(paths.stderr, "utf8")).toBe("stderr remains");
  });

  it("keeps generic subprocess exit primary when an artifact also fails", () => {
    const root = mkdtempSync(join(tmpdir(), "trainer-exit-artifact-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "exit" });
    writeFileSync(paths.stdout, "stdout");
    writeFileSync(paths.stderr, "stderr");
    writeFileSync(paths.reporter, reporter());
    const result = finalizeVitestPhaseArtifacts({
      phase: "exit",
      paths,
      exitCode: 2,
      signal: null,
      terminationError: null,
      durationMs: 10,
      artifactIo: throwingIo("writeText", (filePath) => filePath.endsWith("failure-metadata.json")),
    });
    expect(result.failureKind).toBe("subprocess-exit");
    expect(result.artifactDiagnostics).toContainEqual(
      expect.objectContaining({ operation: "metadata-write" })
    );
  });

  it("distinguishes missing reporter with and without known termination", () => {
    expect(finalizeFixture({ reporter: null, exitCode: 1 }).failureKind).toBe(
      "reporter-missing"
    );
    expect(
      finalizeFixture({ reporter: null, exitCode: null, signal: "SIGTERM" }).failureKind
    ).toBe("worker-termination");
  });

  it("redacts reporter, metadata, guard, termination, and rendered summary values", () => {
    const sentinel = "mixed-case-secret-sentinel-8f6b";
    const root = mkdtempSync(join(tmpdir(), "trainer-summary-redaction-"));
    temporaryDirectories.push(root);
    const paths = createVitestPhaseArtifactPaths({ artifactRoot: root, phase: "redaction" });
    writeFileSync(paths.stdout, `safe ${sentinel} output`);
    writeFileSync(paths.stderr, `safe ${sentinel} error`);
    writeFileSync(
      paths.reporter,
      reporter({
        failures: [{ file: "redact.test.ts", test: "redacts", message: `AssertionError: ${sentinel} useful` }],
      })
    );
    const result = finalizeVitestPhaseArtifacts({
      phase: "redaction",
      paths,
      exitCode: null,
      signal: "SIGTERM",
      terminationError: `terminated ${sentinel}`,
      externalFailure: `guard ${sentinel}`,
      durationMs: 10,
      sensitiveValues: [sentinel],
    });
    const rendered = formatVitestPhaseFailure(result).join("\n");
    expect(rendered).not.toContain(sentinel);
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(readFileSync(paths.reporter, "utf8")).not.toContain(sentinel);
    expect(readFileSync(paths.metadata, "utf8")).not.toContain(sentinel);
    expect(rendered).toContain("[REDACTED]");
  });
});
