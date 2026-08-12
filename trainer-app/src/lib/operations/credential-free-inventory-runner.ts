import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
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
  | "subprocess-exit";

export type VitestFailedTest = {
  file: string;
  test: string | null;
  errorMessage: string;
  stackTrace: string;
};

export type VitestPhaseArtifactPaths = {
  directory: string;
  stdout: string;
  stderr: string;
  reporter: string;
  metadata: string;
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
  artifacts: VitestPhaseArtifactPaths;
  artifactsRetained: boolean;
};

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
};

type ParsedVitestReporter = {
  summary: VitestSummaryCounts;
  failures: VitestFailedTest[];
};

function phaseSlug(phase: string): string {
  return phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "phase";
}

export function createVitestPhaseArtifactPaths(input: {
  artifactRoot: string;
  phase: string;
  now?: Date;
  uniqueId?: string;
}): VitestPhaseArtifactPaths {
  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const uniqueId = input.uniqueId ?? randomUUID();
  const directory = path.join(
    input.artifactRoot,
    `${timestamp}-${process.pid}-${uniqueId}-${phaseSlug(input.phase)}`
  );
  mkdirSync(directory, { recursive: true });
  return {
    directory,
    stdout: path.join(directory, "vitest.stdout.log"),
    stderr: path.join(directory, "vitest.stderr.log"),
    reporter: path.join(directory, "vitest.reporter.json"),
    metadata: path.join(directory, "failure-metadata.json"),
  };
}

function parseFailureMessage(value: unknown): { errorMessage: string; stackTrace: string } {
  const stackTrace = typeof value === "string" ? value : "";
  const errorMessage = stackTrace.split(/\r?\n/, 1)[0] || "Vitest reported a failure without a message.";
  return { errorMessage, stackTrace };
}

function parseVitestReporter(source: string): ParsedVitestReporter | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = parseVitestSummary(source);
  const testResults = (value as { testResults?: unknown }).testResults;
  if (!summary || !Array.isArray(testResults)) return null;

  const failures: VitestFailedTest[] = [];
  for (const rawFile of testResults) {
    if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) return null;
    const file = rawFile as VitestJsonFile;
    if (typeof file.name !== "string" || !Array.isArray(file.assertionResults)) return null;
    for (const rawAssertion of file.assertionResults) {
      if (!rawAssertion || typeof rawAssertion !== "object" || Array.isArray(rawAssertion)) {
        return null;
      }
      const assertion = rawAssertion as VitestJsonAssertion;
      if (assertion.status !== "failed") continue;
      const failureMessages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages
        : [];
      const message = parseFailureMessage(failureMessages[0]);
      failures.push({
        file: file.name,
        test:
          typeof assertion.fullName === "string"
            ? assertion.fullName
            : typeof assertion.title === "string"
              ? assertion.title
              : null,
        ...message,
      });
    }
    if (file.status === "failed" && !failures.some((failure) => failure.file === file.name)) {
      failures.push({
        file: file.name,
        test: null,
        ...parseFailureMessage(file.message),
      });
    }
  }
  return { summary, failures };
}

function classifyFailure(input: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationError: string | null;
  externalFailure?: string | null;
  reporterState: "available" | "missing" | "malformed";
  failures: readonly VitestFailedTest[];
}): VitestFailureKind {
  if (input.signal || input.terminationError || input.exitCode === null) {
    return "worker-termination";
  }
  if (input.reporterState === "missing") return "reporter-missing";
  if (input.reporterState === "malformed") return "reporter-malformed";
  if (input.failures.length > 0) {
    return input.failures.some((failure) =>
      /(?:timed out|timeout)/i.test(`${failure.errorMessage}\n${failure.stackTrace}`)
    )
      ? "timeout"
      : "test-assertion";
  }
  return input.exitCode === 0 ? "none" : "subprocess-exit";
}

export function finalizeVitestPhaseArtifacts(input: {
  phase: string;
  paths: VitestPhaseArtifactPaths;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationError: string | null;
  externalFailure?: string | null;
  durationMs: number;
}): VitestPhaseResult {
  const reporterExists = existsSync(input.paths.reporter);
  const reporterSource = reporterExists
    ? readFileSync(input.paths.reporter, "utf8")
    : "";
  const parsedReporter = reporterExists && reporterSource.trim()
    ? parseVitestReporter(reporterSource)
    : null;
  const reporterState = !reporterExists || !reporterSource.trim()
    ? "missing"
    : parsedReporter
      ? "available"
      : "malformed";
  const failures = parsedReporter?.failures ?? [];
  const failureKind = classifyFailure({
    exitCode: input.exitCode,
    signal: input.signal,
    terminationError: input.terminationError,
    reporterState,
    failures,
  });
  const effectiveFailureKind = input.externalFailure
    ? "subprocess-exit"
    : failureKind;
  const success = input.exitCode === 0 && effectiveFailureKind === "none";
  const result: VitestPhaseResult = {
    phase: input.phase,
    success,
    status: input.exitCode ?? 1,
    exitCode: input.exitCode,
    signal: input.signal,
    abnormalTermination:
      input.exitCode === null || Boolean(input.signal || input.terminationError),
    terminationError: input.terminationError,
    externalFailure: input.externalFailure ?? null,
    durationMs: input.durationMs,
    summary: parsedReporter?.summary ?? null,
    reporterState,
    failureKind: effectiveFailureKind,
    failures,
    artifacts: input.paths,
    artifactsRetained: !success,
  };

  if (success) {
    rmSync(input.paths.directory, { recursive: true, force: true });
  } else {
    const stdoutBytes = existsSync(input.paths.stdout)
      ? Buffer.byteLength(readFileSync(input.paths.stdout))
      : 0;
    const stderrBytes = existsSync(input.paths.stderr)
      ? Buffer.byteLength(readFileSync(input.paths.stderr))
      : 0;
    writeFileSync(
      input.paths.metadata,
      `${JSON.stringify(
        {
          schema: "trainer-credential-free-vitest-failure",
          version: 1,
          ...result,
          captures: { stdoutBytes, stderrBytes },
        },
        null,
        2
      )}\n`
    );
  }
  return result;
}

export async function runVitestPhase(input: {
  phase: string;
  projectRoot: string;
  vitestCli: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  artifactRoot?: string;
  postRunFailure?: () => string | null;
}): Promise<VitestPhaseResult> {
  const paths = createVitestPhaseArtifactPaths({
    artifactRoot:
      input.artifactRoot ??
      path.join(input.projectRoot, "artifacts", "credential-free-inventory"),
    phase: input.phase,
  });
  const stdoutCapture = createWriteStream(paths.stdout, { flags: "wx" });
  const stderrCapture = createWriteStream(paths.stderr, { flags: "wx" });
  const startedAt = Date.now();
  console.log(`[${input.phase}] started; subprocess: Vitest`);

  const child = spawn(
    process.execPath,
    [
      input.vitestCli,
      "run",
      ...input.args,
      "--reporter=dot",
      "--reporter=json",
      `--outputFile.json=${paths.reporter}`,
    ],
    {
      cwd: input.projectRoot,
      env: input.environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutCapture.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrCapture.write(chunk);
    process.stderr.write(chunk);
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
  stdoutCapture.end();
  stderrCapture.end();
  await Promise.all([finished(stdoutCapture), finished(stderrCapture)]);

  const result = finalizeVitestPhaseArtifacts({
    phase: input.phase,
    paths,
    ...termination,
    externalFailure: input.postRunFailure?.() ?? null,
    durationMs: Date.now() - startedAt,
  });
  console.log(
    `[${input.phase}] ${result.success ? "completed" : "failed"} in ${formatElapsed(result.durationMs)}`
  );
  return result;
}

export function formatElapsed(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatVitestPhaseFailure(result: VitestPhaseResult): string[] {
  if (result.success) return [];
  const nextActionByKind: Record<Exclude<VitestFailureKind, "none">, string> = {
    "test-assertion": "Inspect the named failure and complete raw captures.",
    timeout: "Inspect the timed-out test and stack before changing any timeout.",
    "reporter-malformed": "Inspect the raw captures and malformed reporter file.",
    "reporter-missing": "Inspect the raw captures for reporter startup or write failure.",
    "worker-termination": "Inspect the signal/termination details and raw captures.",
    "subprocess-exit": "Inspect stdout and stderr for the unclassified subprocess failure.",
  };
  const lines = [
    `Failure: phase=${result.phase}; kind=${result.failureKind}; elapsed=${formatElapsed(result.durationMs)}; exit=${result.exitCode ?? "none"}; signal=${result.signal ?? "none"}.`,
  ];
  for (const failure of result.failures) {
    lines.push(
      `Failed ${failure.file}${failure.test ? ` > ${failure.test}` : " (file-level failure)"}: ${failure.errorMessage}`
    );
  }
  if (result.externalFailure) lines.push(`Failure detail: ${result.externalFailure}`);
  lines.push(
    `Artifacts: metadata=${result.artifacts.metadata}; stdout=${result.artifacts.stdout}; stderr=${result.artifacts.stderr}; reporter=${result.artifacts.reporter}.`
  );
  lines.push(
    `Next action: ${nextActionByKind[result.failureKind as Exclude<VitestFailureKind, "none">]}`
  );
  return lines;
}
