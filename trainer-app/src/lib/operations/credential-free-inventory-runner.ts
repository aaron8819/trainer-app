import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  parseVitestSummary,
  type VitestSummaryCounts,
} from "./test-environment-preflight";

export type VitestFailureKind =
  | "none"
  | "test-assertion"
  | "timeout"
  | "reporter-malformed"
  | "reporter-missing"
  | "worker-termination"
  | "safety-guard"
  | "artifact-failure"
  | "subprocess-exit";

export type VitestFailedTest = {
  file: string;
  test: string | null;
  errorMessage: string;
  stackTrace: string;
};

export type VitestExecutedFile = {
  file: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number | null;
};

export type VitestPhaseArtifactPaths = {
  root: string;
  directory: string;
  stdout: string;
  stderr: string;
  reporter: string;
  metadata: string;
};

export type ArtifactDiagnostic = {
  operation:
    | "directory-create"
    | "capture-open"
    | "capture-write"
    | "capture-close"
    | "reporter-read"
    | "reporter-sanitize"
    | "reporter-cleanup"
    | "capture-size"
    | "metadata-write"
    | "success-cleanup"
    | "unsafe-cleanup";
  path: string;
  message: string;
};

export type VitestPhaseResult = {
  phase: string;
  success: boolean;
  status: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  abnormalTermination: boolean;
  terminationError: string | null;
  externalFailure: string | null;
  durationMs: number;
  summary: VitestSummaryCounts | null;
  reporterState: "available" | "missing" | "malformed";
  failureKind: VitestFailureKind;
  failures: VitestFailedTest[];
  executedFiles?: VitestExecutedFile[];
  artifactDiagnostics: ArtifactDiagnostic[];
  artifacts: VitestPhaseArtifactPaths;
  artifactsRetained: boolean;
};

export type ArtifactIo = {
  mkdir(directory: string): void;
  exists(filePath: string): boolean;
  openCapture(filePath: string): number;
  writeCapture(fileDescriptor: number, source: string): void;
  closeCapture(fileDescriptor: number): void;
  readText(filePath: string): string;
  writeText(filePath: string, source: string): void;
  size(filePath: string): number;
  removeFile(filePath: string): void;
  removeDirectory(directory: string): void;
};

export type RunnerOutput = {
  stdout(source: string): void;
  stderr(source: string): void;
  log(source: string): void;
};

const DEFAULT_ARTIFACT_IO: ArtifactIo = {
  mkdir: (directory) => mkdirSync(directory, { recursive: true }),
  exists: existsSync,
  openCapture: (filePath) => openSync(filePath, "wx"),
  writeCapture: (fileDescriptor, source) => {
    const buffer = Buffer.from(source, "utf8");
    let offset = 0;
    while (offset < buffer.length) {
      offset += writeSync(fileDescriptor, buffer, offset, buffer.length - offset);
    }
  },
  closeCapture: closeSync,
  readText: (filePath) => readFileSync(filePath, "utf8"),
  writeText: (filePath, source) => writeFileSync(filePath, source, "utf8"),
  size: (filePath) => statSync(filePath).size,
  removeFile: (filePath) => rmSync(filePath, { force: true }),
  removeDirectory: (directory) =>
    rmSync(directory, { recursive: true, force: true }),
};

const DEFAULT_OUTPUT: RunnerOutput = {
  stdout: (source) => process.stdout.write(source),
  stderr: (source) => process.stderr.write(source),
  log: (source) => console.log(source),
};

const VITEST_JSON_REPORTER_PREFIX = '{"numTotalTestSuites":';

type VitestJsonAssertion = {
  fullName?: unknown;
  title?: unknown;
  status?: unknown;
  failureMessages?: unknown;
};

type VitestJsonFile = {
  name?: unknown;
  status?: unknown;
  message?: unknown;
  assertionResults?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

type ParsedVitestReporter = {
  summary: VitestSummaryCounts | null;
  failures: VitestFailedTest[];
  executedFiles: VitestExecutedFile[];
  malformed: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown artifact error.";
}

function mergedArtifactIo(overrides?: Partial<ArtifactIo>): ArtifactIo {
  return { ...DEFAULT_ARTIFACT_IO, ...overrides };
}

function phaseSlug(phase: string): string {
  return (
    phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "phase"
  );
}

function artifactPaths(input: {
  artifactRoot: string;
  phase: string;
  now?: Date;
  uniqueId?: string;
}): VitestPhaseArtifactPaths {
  const root = path.resolve(input.artifactRoot);
  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const uniqueId = (input.uniqueId ?? randomUUID()).replace(/[^a-zA-Z0-9-]/g, "-");
  const directory = path.join(
    root,
    `${timestamp}-${process.pid}-${uniqueId}-${phaseSlug(input.phase)}`
  );
  return {
    root,
    directory,
    stdout: path.join(directory, "vitest.stdout.log"),
    stderr: path.join(directory, "vitest.stderr.log"),
    reporter: path.join(directory, "vitest.reporter.json"),
    metadata: path.join(directory, "failure-metadata.json"),
  };
}

export function createVitestPhaseArtifactPaths(input: {
  artifactRoot: string;
  phase: string;
  now?: Date;
  uniqueId?: string;
}): VitestPhaseArtifactPaths {
  const paths = artifactPaths(input);
  DEFAULT_ARTIFACT_IO.mkdir(paths.directory);
  return paths;
}

export function redactSensitiveValues(
  source: string,
  sensitiveValues: readonly string[]
): string {
  let redacted = source;
  const values = [...new Set(sensitiveValues.filter((value) => value.length >= 8))].sort(
    (left, right) => right.length - left.length
  );
  for (const value of values) redacted = redacted.split(value).join("[REDACTED]");
  return redacted;
}

class StreamingSecretRedactor {
  private readonly decoder = new StringDecoder("utf8");
  private readonly values: string[];
  private readonly maximumLength: number;
  private pending = "";

  constructor(sensitiveValues: readonly string[]) {
    this.values = [...new Set(sensitiveValues.filter((value) => value.length >= 8))].sort(
      (left, right) => right.length - left.length
    );
    this.maximumLength = Math.max(1, ...this.values.map((value) => value.length));
  }

  push(chunk: Buffer): string {
    this.pending += this.decoder.write(chunk);
    return this.flush(false);
  }

  end(): string {
    this.pending += this.decoder.end();
    return this.flush(true);
  }

  private flush(final: boolean): string {
    let output = "";
    while (this.pending.length > 0 && (final || this.pending.length > this.maximumLength)) {
      const match = this.values.find((value) => this.pending.startsWith(value));
      if (match) {
        output += "[REDACTED]";
        this.pending = this.pending.slice(match.length);
      } else {
        output += this.pending[0];
        this.pending = this.pending.slice(1);
      }
    }
    return output;
  }
}

class ReporterTerminalFilter {
  private atLineStart = true;
  private candidate = "";
  private suppressingLine = false;

  push(source: string): string {
    let output = "";
    for (const character of source) {
      if (this.suppressingLine) {
        if (character === "\n") {
          this.suppressingLine = false;
          this.atLineStart = true;
        }
        continue;
      }

      if (this.atLineStart) {
        this.candidate += character;
        if (VITEST_JSON_REPORTER_PREFIX.startsWith(this.candidate)) {
          if (this.candidate === VITEST_JSON_REPORTER_PREFIX) {
            this.candidate = "";
            this.suppressingLine = true;
          }
          continue;
        }
        output += this.candidate;
        this.atLineStart = character === "\n";
        this.candidate = "";
        continue;
      }

      output += character;
      if (character === "\n") this.atLineStart = true;
    }
    return output;
  }

  end(): string {
    if (this.suppressingLine) return "";
    const output = this.candidate;
    this.candidate = "";
    return output;
  }
}

function extractVitestJsonReporter(source: string): string | null {
  const lines = source.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith(VITEST_JSON_REPORTER_PREFIX)) return lines[index];
  }
  return null;
}

function parseFailureMessage(
  value: unknown,
  sensitiveValues: readonly string[]
): { errorMessage: string; stackTrace: string } {
  const stackTrace = redactSensitiveValues(
    typeof value === "string" ? value : "",
    sensitiveValues
  );
  const errorMessage =
    stackTrace.split(/\r?\n/, 1)[0] || "Vitest reported a failure without a message.";
  return { errorMessage, stackTrace };
}

function parseVitestReporter(
  source: string,
  sensitiveValues: readonly string[]
): ParsedVitestReporter {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { summary: null, failures: [], executedFiles: [], malformed: true };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { summary: null, failures: [], executedFiles: [], malformed: true };
  }

  const summary = parseVitestSummary(source);
  const testResults = (value as { testResults?: unknown }).testResults;
  if (!Array.isArray(testResults)) {
    return { summary, failures: [], executedFiles: [], malformed: true };
  }

  let malformed = summary === null;
  const failures: VitestFailedTest[] = [];
  const executedFiles: VitestExecutedFile[] = [];
  for (const rawFile of testResults) {
    if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) {
      malformed = true;
      continue;
    }
    const file = rawFile as VitestJsonFile;
    if (typeof file.name !== "string" || !Array.isArray(file.assertionResults)) {
      malformed = true;
      continue;
    }
    const fileName = redactSensitiveValues(file.name, sensitiveValues);
    const fileStatus =
      file.status === "passed"
        ? "passed"
        : file.status === "failed"
          ? "failed"
          : file.status === "pending" || file.status === "skipped"
            ? "skipped"
            : null;
    if (fileStatus === null) malformed = true;
    const durationMs =
      typeof file.startTime === "number" &&
      Number.isFinite(file.startTime) &&
      typeof file.endTime === "number" &&
      Number.isFinite(file.endTime) &&
      file.endTime >= file.startTime
        ? file.endTime - file.startTime
        : null;
    if (fileStatus !== null) {
      executedFiles.push({ file: fileName, status: fileStatus, durationMs });
    }
    const fileFailureCount = failures.length;
    for (const rawAssertion of file.assertionResults) {
      if (!rawAssertion || typeof rawAssertion !== "object" || Array.isArray(rawAssertion)) {
        malformed = true;
        continue;
      }
      const assertion = rawAssertion as VitestJsonAssertion;
      if (assertion.status !== "failed") continue;
      const failureMessages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages
        : [];
      if (!Array.isArray(assertion.failureMessages)) malformed = true;
      failures.push({
        file: fileName,
        test:
          typeof assertion.fullName === "string"
            ? redactSensitiveValues(assertion.fullName, sensitiveValues)
            : typeof assertion.title === "string"
              ? redactSensitiveValues(assertion.title, sensitiveValues)
              : null,
        ...parseFailureMessage(failureMessages[0], sensitiveValues),
      });
    }
    if (file.status === "failed" && failures.length === fileFailureCount) {
      failures.push({
        file: fileName,
        test: null,
        ...parseFailureMessage(file.message, sensitiveValues),
      });
    }
  }
  return { summary, failures, executedFiles, malformed };
}

function classifyFailure(input: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationError: string | null;
  externalFailure: string | null;
  reporterState: "available" | "missing" | "malformed";
  failures: readonly VitestFailedTest[];
  artifactDiagnostics: readonly ArtifactDiagnostic[];
}): VitestFailureKind {
  if (input.signal || input.terminationError || input.exitCode === null) {
    return "worker-termination";
  }
  if (input.failures.length > 0) {
    return input.failures.some((failure) =>
      /(?:timed out|timeout)/i.test(`${failure.errorMessage}\n${failure.stackTrace}`)
    )
      ? "timeout"
      : "test-assertion";
  }
  if (input.externalFailure) return "safety-guard";
  if (input.reporterState === "missing") return "reporter-missing";
  if (input.reporterState === "malformed") return "reporter-malformed";
  if (input.exitCode !== 0) return "subprocess-exit";
  return input.artifactDiagnostics.length > 0 ? "artifact-failure" : "none";
}

function diagnostic(
  diagnostics: ArtifactDiagnostic[],
  operation: ArtifactDiagnostic["operation"],
  filePath: string,
  error: unknown,
  sensitiveValues: readonly string[]
): void {
  diagnostics.push({
    operation,
    path: redactSensitiveValues(filePath, sensitiveValues),
    message: redactSensitiveValues(errorMessage(error), sensitiveValues),
  });
}

function safeArtifactDirectory(paths: VitestPhaseArtifactPaths): boolean {
  const root = path.resolve(paths.root);
  const directory = path.resolve(paths.directory);
  const relative = path.relative(root, directory);
  return (
    root !== path.parse(root).root &&
    directory !== root &&
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function safeSize(input: {
  io: ArtifactIo;
  filePath: string;
  diagnostics: ArtifactDiagnostic[];
  sensitiveValues: readonly string[];
}): number | null {
  let exists = false;
  try {
    exists = input.io.exists(input.filePath);
  } catch (error) {
    diagnostic(
      input.diagnostics,
      "capture-size",
      input.filePath,
      error,
      input.sensitiveValues
    );
    return null;
  }
  if (!exists) {
    diagnostic(
      input.diagnostics,
      "capture-size",
      input.filePath,
      new Error("Capture file is missing."),
      input.sensitiveValues
    );
    return null;
  }
  try {
    return input.io.size(input.filePath);
  } catch (error) {
    diagnostic(
      input.diagnostics,
      "capture-size",
      input.filePath,
      error,
      input.sensitiveValues
    );
    return null;
  }
}

export function finalizeVitestPhaseArtifacts(input: {
  phase: string;
  paths: VitestPhaseArtifactPaths;
  reporterSourcePath?: string;
  reporterOutput?: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationError: string | null;
  externalFailure?: string | null;
  durationMs: number;
  sensitiveValues?: readonly string[];
  artifactIo?: Partial<ArtifactIo>;
  artifactDiagnostics?: ArtifactDiagnostic[];
}): VitestPhaseResult {
  const sensitiveValues = input.sensitiveValues ?? [];
  const io = mergedArtifactIo(input.artifactIo);
  const artifactDiagnostics = input.artifactDiagnostics ?? [];
  const reporterSourcePath = input.reporterSourcePath ?? input.paths.reporter;
  const reporterOutputProvided = Object.hasOwn(input, "reporterOutput");
  let reporterExists = false;
  let reporterSource = "";

  if (reporterOutputProvided) {
    reporterExists = input.reporterOutput !== null;
    reporterSource = input.reporterOutput ?? "";
  } else {
    try {
      reporterExists = io.exists(reporterSourcePath);
      if (reporterExists) reporterSource = io.readText(reporterSourcePath);
    } catch (error) {
      reporterExists = true;
      diagnostic(
        artifactDiagnostics,
        "reporter-read",
        reporterSourcePath,
        error,
        sensitiveValues
      );
    }
  }

  const redactedReporter = redactSensitiveValues(reporterSource, sensitiveValues);
  if (reporterExists && reporterSource.length > 0) {
    if (!reporterOutputProvided) {
      try {
        io.writeText(reporterSourcePath, redactedReporter);
      } catch (error) {
        diagnostic(
          artifactDiagnostics,
          "reporter-sanitize",
          reporterSourcePath,
          error,
          sensitiveValues
        );
      }
    }
    if (reporterOutputProvided || reporterSourcePath !== input.paths.reporter) {
      try {
        io.writeText(input.paths.reporter, redactedReporter);
      } catch (error) {
        diagnostic(
          artifactDiagnostics,
          "reporter-sanitize",
          input.paths.reporter,
          error,
          sensitiveValues
        );
      }
    }
  }
  if (!reporterOutputProvided && reporterSourcePath !== input.paths.reporter) {
    try {
      io.removeFile(reporterSourcePath);
    } catch (error) {
      diagnostic(
        artifactDiagnostics,
        "reporter-cleanup",
        reporterSourcePath,
        error,
        sensitiveValues
      );
    }
  }

  const parsedReporter = redactedReporter.trim()
    ? parseVitestReporter(redactedReporter, sensitiveValues)
    : null;
  const reporterState = !reporterExists || !redactedReporter.trim()
    ? "missing"
    : parsedReporter?.malformed
      ? "malformed"
      : "available";
  const failures = parsedReporter?.failures ?? [];
  const terminationError = input.terminationError
    ? redactSensitiveValues(input.terminationError, sensitiveValues)
    : null;
  const externalFailure = input.externalFailure
    ? redactSensitiveValues(input.externalFailure, sensitiveValues)
    : null;

  let failureKind = classifyFailure({
    exitCode: input.exitCode,
    signal: input.signal,
    terminationError,
    externalFailure,
    reporterState,
    failures,
    artifactDiagnostics,
  });

  if (failureKind === "none") {
    if (!safeArtifactDirectory(input.paths)) {
      diagnostic(
        artifactDiagnostics,
        "unsafe-cleanup",
        input.paths.directory,
        new Error("Refused cleanup outside the unique artifact root."),
        sensitiveValues
      );
    } else {
      try {
        io.removeDirectory(input.paths.directory);
      } catch (error) {
        diagnostic(
          artifactDiagnostics,
          "success-cleanup",
          input.paths.directory,
          error,
          sensitiveValues
        );
      }
    }
    if (artifactDiagnostics.length > 0) failureKind = "artifact-failure";
  }

  const success = input.exitCode === 0 && failureKind === "none";
  const result: VitestPhaseResult = {
    phase: redactSensitiveValues(input.phase, sensitiveValues),
    success,
    status: input.exitCode ?? 1,
    exitCode: input.exitCode,
    signal: input.signal,
    abnormalTermination:
      input.exitCode === null || Boolean(input.signal || terminationError),
    terminationError,
    externalFailure,
    durationMs: Math.max(0, input.durationMs),
    summary: parsedReporter?.summary ?? null,
    reporterState,
    failureKind,
    failures,
    executedFiles: parsedReporter?.executedFiles ?? [],
    artifactDiagnostics,
    artifacts: input.paths,
    artifactsRetained: !success,
  };

  if (!success) {
    const stdoutBytes = safeSize({
      io,
      filePath: input.paths.stdout,
      diagnostics: artifactDiagnostics,
      sensitiveValues,
    });
    const stderrBytes = safeSize({
      io,
      filePath: input.paths.stderr,
      diagnostics: artifactDiagnostics,
      sensitiveValues,
    });
    try {
      io.writeText(
        input.paths.metadata,
        `${redactSensitiveValues(
          JSON.stringify(
            {
              schema: "trainer-credential-free-vitest-failure",
              version: 1,
              ...result,
              captures: { stdoutBytes, stderrBytes },
            },
            null,
            2
          ),
          sensitiveValues
        )}\n`
      );
    } catch (error) {
      diagnostic(
        artifactDiagnostics,
        "metadata-write",
        input.paths.metadata,
        error,
        sensitiveValues
      );
    }
  }
  return result;
}

type Capture = { fileDescriptor: number | null; path: string; failed: boolean };

function openCapture(input: {
  io: ArtifactIo;
  filePath: string;
  diagnostics: ArtifactDiagnostic[];
  sensitiveValues: readonly string[];
}): Capture {
  try {
    return {
      fileDescriptor: input.io.openCapture(input.filePath),
      path: input.filePath,
      failed: false,
    };
  } catch (error) {
    diagnostic(
      input.diagnostics,
      "capture-open",
      input.filePath,
      error,
      input.sensitiveValues
    );
    return { fileDescriptor: null, path: input.filePath, failed: true };
  }
}

function writeCaptureSafely(input: {
  capture: Capture;
  source: string;
  io: ArtifactIo;
  diagnostics: ArtifactDiagnostic[];
  sensitiveValues: readonly string[];
}): void {
  if (input.capture.fileDescriptor === null || input.capture.failed || !input.source) return;
  try {
    input.io.writeCapture(input.capture.fileDescriptor, input.source);
  } catch (error) {
    input.capture.failed = true;
    diagnostic(
      input.diagnostics,
      "capture-write",
      input.capture.path,
      error,
      input.sensitiveValues
    );
  }
}

function closeCaptureSafely(input: {
  capture: Capture;
  io: ArtifactIo;
  diagnostics: ArtifactDiagnostic[];
  sensitiveValues: readonly string[];
}): void {
  if (input.capture.fileDescriptor === null) return;
  try {
    input.io.closeCapture(input.capture.fileDescriptor);
  } catch (error) {
    diagnostic(
      input.diagnostics,
      "capture-close",
      input.capture.path,
      error,
      input.sensitiveValues
    );
  }
}

export async function runVitestPhase(input: {
  phase: string;
  projectRoot: string;
  vitestCli: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  artifactRoot?: string;
  postRunFailure?: () => string | null;
  sensitiveValues?: readonly string[];
  artifactIo?: Partial<ArtifactIo>;
  output?: RunnerOutput;
}): Promise<VitestPhaseResult> {
  const sensitiveValues = input.sensitiveValues ?? [];
  const io = mergedArtifactIo(input.artifactIo);
  const output = input.output ?? DEFAULT_OUTPUT;
  const artifactDiagnostics: ArtifactDiagnostic[] = [];
  const paths = artifactPaths({
    artifactRoot:
      input.artifactRoot ??
      path.join(input.projectRoot, "artifacts", "credential-free-inventory"),
    phase: input.phase,
  });
  try {
    io.mkdir(paths.directory);
  } catch (error) {
    diagnostic(
      artifactDiagnostics,
      "directory-create",
      paths.directory,
      error,
      sensitiveValues
    );
  }

  const stdoutCapture = openCapture({
    io,
    filePath: paths.stdout,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });
  const stderrCapture = openCapture({
    io,
    filePath: paths.stderr,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });
  const stdoutRedactor = new StreamingSecretRedactor(sensitiveValues);
  const stderrRedactor = new StreamingSecretRedactor(sensitiveValues);
  const reporterTerminalFilter = new ReporterTerminalFilter();
  const safeStdout: string[] = [];
  const startedAt = Date.now();
  output.log(`[${redactSensitiveValues(input.phase, sensitiveValues)}] started; subprocess: Vitest`);

  const child = spawn(
    process.execPath,
    [
      input.vitestCli,
      "run",
      ...input.args,
      "--reporter=dot",
      "--reporter=json",
    ],
    {
      cwd: input.projectRoot,
      env: input.environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout.on("data", (chunk: Buffer) => {
    const safe = stdoutRedactor.push(chunk);
    safeStdout.push(safe);
    writeCaptureSafely({
      capture: stdoutCapture,
      source: safe,
      io,
      diagnostics: artifactDiagnostics,
      sensitiveValues,
    });
    const terminalSource = reporterTerminalFilter.push(safe);
    if (terminalSource) output.stdout(terminalSource);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const safe = stderrRedactor.push(chunk);
    writeCaptureSafely({
      capture: stderrCapture,
      source: safe,
      io,
      diagnostics: artifactDiagnostics,
      sensitiveValues,
    });
    if (safe) output.stderr(safe);
  });

  const termination = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    terminationError: string | null;
  }>((resolve) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: null,
        signal: null,
        terminationError: `${error.name}: ${error.message}`,
      });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, signal, terminationError: null });
    });
  });

  const stdoutTail = stdoutRedactor.end();
  const stderrTail = stderrRedactor.end();
  writeCaptureSafely({
    capture: stdoutCapture,
    source: stdoutTail,
    io,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });
  safeStdout.push(stdoutTail);
  writeCaptureSafely({
    capture: stderrCapture,
    source: stderrTail,
    io,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });
  const terminalTail = reporterTerminalFilter.push(stdoutTail);
  if (terminalTail) output.stdout(terminalTail);
  const terminalEnd = reporterTerminalFilter.end();
  if (terminalEnd) output.stdout(terminalEnd);
  if (stderrTail) output.stderr(stderrTail);
  closeCaptureSafely({
    capture: stdoutCapture,
    io,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });
  closeCaptureSafely({
    capture: stderrCapture,
    io,
    diagnostics: artifactDiagnostics,
    sensitiveValues,
  });

  const result = finalizeVitestPhaseArtifacts({
    phase: input.phase,
    paths,
    reporterOutput: extractVitestJsonReporter(safeStdout.join("")),
    ...termination,
    externalFailure: input.postRunFailure?.() ?? null,
    durationMs: Date.now() - startedAt,
    sensitiveValues,
    artifactIo: input.artifactIo,
    artifactDiagnostics,
  });
  output.log(
    `[${result.phase}] ${result.success ? "completed" : "failed"} in ${formatElapsed(result.durationMs)}`
  );
  return result;
}

export function formatElapsed(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(1)}s`;
}

export function formatVitestPhaseFailure(result: VitestPhaseResult): string[] {
  if (result.success) return [];
  const nextActionByKind: Record<Exclude<VitestFailureKind, "none">, string> = {
    "test-assertion": "Inspect the named failure and complete safe captures.",
    timeout: "Inspect the timed-out test and stack before changing any timeout.",
    "reporter-malformed": "Inspect the safe captures and malformed reporter file.",
    "reporter-missing": "Inspect the safe captures for reporter startup or write failure.",
    "worker-termination": "Inspect the signal/termination details and safe captures.",
    "safety-guard": "Inspect the additional safety finding and safe captures.",
    "artifact-failure": "Inspect the secondary artifact diagnostics and partial bundle.",
    "subprocess-exit": "Inspect stdout and stderr for the unclassified subprocess failure.",
  };
  const lines = [
    `Failure: phase=${result.phase}; kind=${result.failureKind}; elapsed=${formatElapsed(result.durationMs)}; exit=${result.exitCode ?? "none"}; signal=${result.signal ?? "none"}.`,
  ];
  if (result.terminationError) {
    lines.push(`Termination detail: ${result.terminationError}`);
  }
  for (const failure of result.failures) {
    lines.push(
      `Failed ${failure.file}${failure.test ? ` > ${failure.test}` : " (file-level failure)"}: ${failure.errorMessage}`
    );
  }
  if (result.externalFailure) {
    lines.push(`Additional safety finding: ${result.externalFailure}`);
  }
  for (const artifactDiagnostic of result.artifactDiagnostics) {
    lines.push(
      `Artifact diagnostic: operation=${artifactDiagnostic.operation}; path=${artifactDiagnostic.path}; ${artifactDiagnostic.message}`
    );
  }
  lines.push(
    `Artifacts: metadata=${result.artifacts.metadata}; stdout=${result.artifacts.stdout}; stderr=${result.artifacts.stderr}; reporter=${result.artifacts.reporter}.`
  );
  lines.push(
    `Next action: ${nextActionByKind[result.failureKind as Exclude<VitestFailureKind, "none">]}`
  );
  return lines;
}
