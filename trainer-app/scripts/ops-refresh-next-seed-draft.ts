import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadAuditEnv } from "./audit-cli-support";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OpsRefreshNextSeedDraftArgs = {
  origin: string;
  owner: string;
  sourceMesocycleId: string;
  envFile?: string;
  allowNonV2DraftSource: boolean;
};

export type OriginValidationResult =
  | {
      ok: true;
      origin: string;
      signal: "home_page_title";
      limitation: string;
    }
  | {
      ok: false;
      origin: string;
      reason: string;
      signal: "home_page_title" | "unavailable";
      status?: number;
      bodySample?: string;
    };

export type SafetyCounts = {
  mesocycleCount: number;
  successorCount: number;
  workoutCount: number;
  setLogCount: number;
  sessionCheckInCount: number;
};

export type RefreshResponseSummary = {
  ok: boolean;
  draftSource: string;
  refreshedAt: string;
  slotCount: number | null;
  exerciseRowCount: number | null;
  seedHashChanged: "yes" | "no" | "n/a";
  minimalExecutableRows: boolean | null;
};

export type AcceptanceDecision =
  | "accepted"
  | "accepted_with_watch_items"
  | "rejected"
  | "not_runnable"
  | "unknown";

type SourceSnapshot = {
  userId: string;
  source: {
    id: string;
    state: string;
    macroCycleId: string;
    mesoNumber: number;
  };
  draftSource: string | null;
  draftRefreshedAt: string | null;
  draftSeedHash: string | null;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type AuditSummary = {
  handoffReady: boolean | null;
  acceptanceDecision: AcceptanceDecision;
  blockersHighRisks: string[];
  watchItems: string[];
  hardFloorStatus: string;
  overMavStatus: string;
  recommendation: string;
};

function boolWord(value: boolean | null | undefined): string {
  if (value == null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--origin must be an http(s) URL");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseOpsRefreshNextSeedDraftArgs(
  argv: string[],
): OpsRefreshNextSeedDraftArgs {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}"`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }
    values.set(key, next);
    index += 1;
  }

  const origin = values.get("origin");
  const owner = values.get("owner");
  const sourceMesocycleId = values.get("source-mesocycle-id");
  if (typeof origin !== "string" || origin.trim().length === 0) {
    throw new Error("Missing required --origin");
  }
  if (typeof owner !== "string" || owner.trim().length === 0) {
    throw new Error("Missing required --owner");
  }
  if (
    typeof sourceMesocycleId !== "string" ||
    sourceMesocycleId.trim().length === 0
  ) {
    throw new Error("Missing required --source-mesocycle-id");
  }

  const envFile = values.get("env-file");
  if (envFile !== undefined && typeof envFile !== "string") {
    throw new Error("--env-file requires a path value");
  }

  return {
    origin: normalizeOrigin(origin.trim()),
    owner: owner.trim(),
    sourceMesocycleId: sourceMesocycleId.trim(),
    envFile,
    allowNonV2DraftSource: values.get("allow-non-v2-draft-source") === true,
  };
}

export function buildRefreshRouteUrl(input: {
  origin: string;
  sourceMesocycleId: string;
}): string {
  return `${input.origin}/api/mesocycles/${encodeURIComponent(
    input.sourceMesocycleId,
  )}/refresh-next-seed-draft`;
}

export async function validateTrainerOrigin(input: {
  origin: string;
  fetchImpl?: FetchLike;
}): Promise<OriginValidationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const origin = normalizeOrigin(input.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetchImpl(origin, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ok: false,
      origin,
      reason: error instanceof Error ? error.message : String(error),
      signal: "unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      origin,
      reason: `origin returned HTTP ${response.status}`,
      signal: "home_page_title",
      status: response.status,
      bodySample: text.slice(0, 160),
    };
  }

  if (text.includes("Personal AI Trainer")) {
    return {
      ok: true,
      origin,
      signal: "home_page_title",
      limitation:
        "No dedicated app identity endpoint exists; this script verifies the safest current signal, the Trainer home-page title text.",
    };
  }

  return {
    ok: false,
    origin,
    reason:
      "origin did not expose the expected Trainer home-page identity signal",
    signal: "home_page_title",
    status: response.status,
    bodySample: text.slice(0, 160),
  };
}

export function formatOriginValidationResult(
  result: OriginValidationResult,
): string[] {
  if (result.ok) {
    return [
      `[ops:origin] trainer_app=yes origin=${result.origin} signal=${result.signal}`,
      `[ops:origin] limitation=${result.limitation}`,
    ];
  }

  return [
    `[ops:origin] trainer_app=no origin=${result.origin} signal=${result.signal} reason=${result.reason}`,
    ...(result.bodySample
      ? [`[ops:origin] body_sample=${JSON.stringify(result.bodySample)}`]
      : []),
  ];
}

export function compareSafetyCounts(input: {
  before: SafetyCounts;
  after: SafetyCounts;
}): { ok: boolean; violations: string[] } {
  const violations = (
    Object.keys(input.before) as Array<keyof SafetyCounts>
  ).flatMap((key) =>
    input.before[key] === input.after[key]
      ? []
      : [`${key}: ${input.before[key]} -> ${input.after[key]}`],
  );
  return { ok: violations.length === 0, violations };
}

export function summarizeRefreshResponse(input: {
  responseBody: unknown;
  beforeDraftSeedHash: string | null;
  afterDraftSeedHash: string | null;
  afterDraftSource: string | null;
  afterDraftRefreshedAt: string | null;
}): RefreshResponseSummary {
  const body =
    input.responseBody && typeof input.responseBody === "object"
      ? (input.responseBody as Record<string, unknown>)
      : {};
  const seedDraft =
    body.seedDraft && typeof body.seedDraft === "object"
      ? (body.seedDraft as Record<string, unknown>)
      : {};

  return {
    ok: body.ok === true,
    draftSource:
      (typeof seedDraft.source === "string" ? seedDraft.source : null) ??
      input.afterDraftSource ??
      "unknown",
    refreshedAt: input.afterDraftRefreshedAt ?? "unknown",
    slotCount:
      typeof seedDraft.slotCount === "number" ? seedDraft.slotCount : null,
    exerciseRowCount:
      typeof seedDraft.exerciseCount === "number"
        ? seedDraft.exerciseCount
        : null,
    seedHashChanged:
      input.beforeDraftSeedHash && input.afterDraftSeedHash
        ? input.beforeDraftSeedHash === input.afterDraftSeedHash
          ? "no"
          : "yes"
        : "n/a",
    minimalExecutableRows:
      typeof seedDraft.minimalExecutableRowsOnly === "boolean"
        ? seedDraft.minimalExecutableRowsOnly
        : null,
  };
}

export function formatRefreshSummary(summary: RefreshResponseSummary): string[] {
  return [
    "[ops:refresh] compact summary",
    `ok=${boolWord(summary.ok)}`,
    `draft_source=${summary.draftSource}`,
    `refreshed_at=${summary.refreshedAt}`,
    `slot_count=${summary.slotCount ?? "unknown"}`,
    `exercise_row_count=${summary.exerciseRowCount ?? "unknown"}`,
    `seed_hash_changed=${summary.seedHashChanged}`,
    `minimal_executable_rows=${boolWord(summary.minimalExecutableRows)}`,
  ];
}

export function buildAuditCommandArgs(input: {
  mode: "next-mesocycle-handoff-dry-run" | "next-mesocycle-acceptance-gate";
  owner: string;
  sourceMesocycleId: string;
  envFile?: string;
}): string[] {
  return [
    "run",
    "audit:workout",
    "--",
    "--env-file",
    input.envFile ?? ".env.local",
    "--mode",
    input.mode,
    "--owner",
    input.owner,
    "--source-mesocycle-id",
    input.sourceMesocycleId,
    "--no-artifact",
    "--operator-debug",
  ];
}

export function commandArgsContainAcceptRoute(args: string[]): boolean {
  return args.some((arg) => arg.includes("accept-next-cycle"));
}

export function interpretAcceptanceDecision(
  decision: string | null | undefined,
): { decision: AcceptanceDecision; exitCode: 0 | 1 } {
  if (decision === "accepted" || decision === "accepted_with_watch_items") {
    return { decision, exitCode: 0 };
  }
  if (decision === "rejected" || decision === "not_runnable") {
    return { decision, exitCode: 1 };
  }
  return { decision: "unknown", exitCode: 1 };
}

export function parseFinalAuditSummary(input: {
  handoffStdout: string;
  acceptanceStdout: string;
}): AuditSummary {
  const handoffReadyMatch = input.handoffStdout.match(/handoff_ready=(yes|no)/);
  const decisionMatch =
    input.acceptanceStdout.match(/final decision:\s*([a-z_]+)/) ??
    input.acceptanceStdout.match(/gate_result=([a-z_]+)/);
  const recommendationMatch = input.acceptanceStdout.match(
    /^recommendation:\s*(.+)$/m,
  );
  const findingRows = extractTableRows(
    input.acceptanceStdout,
    "Finding | Severity | Owner seam | Smallest safe fix | Must fix before Week 1 | Evidence",
  );
  const blockersHighRisks = findingRows
    .map((row) => row.split(" | "))
    .filter((parts) => parts[1] === "blocker" || parts[1] === "high_risk")
    .map((parts) => `${parts[0]} (${parts[1]}): ${parts[5] ?? "no evidence"}`);
  const watchRows = extractTableRows(
    input.acceptanceStdout,
    "Risk | Why it matters | Monitoring plan",
  ).filter((row) => !row.startsWith("none |"));
  const muscleRows = extractTableRows(
    input.acceptanceStdout,
    "Muscle | Projected sets | MEV | Productive/Target | MAV | Status | Severity | Notes",
  );
  const hardFloorRows = muscleRows.filter((row) => row.includes("below_mev"));
  const overMavRows = muscleRows.filter((row) => row.includes("over_mav"));

  return {
    handoffReady:
      handoffReadyMatch?.[1] === "yes"
        ? true
        : handoffReadyMatch?.[1] === "no"
          ? false
          : null,
    acceptanceDecision: interpretAcceptanceDecision(decisionMatch?.[1]).decision,
    blockersHighRisks,
    watchItems: watchRows,
    hardFloorStatus:
      hardFloorRows.length > 0 ? `fail: ${hardFloorRows.join("; ")}` : "pass",
    overMavStatus:
      overMavRows.length > 0 ? `warning: ${overMavRows.join("; ")}` : "clear",
    recommendation: recommendationMatch?.[1]?.trim() ?? "unknown",
  };
}

export function formatFinalAuditSummary(summary: AuditSummary): string[] {
  return [
    "[ops:final] summary",
    `handoff_ready=${boolWord(summary.handoffReady)}`,
    `acceptance_decision=${summary.acceptanceDecision}`,
    `blockers_high_risks=${summary.blockersHighRisks.join("; ") || "none"}`,
    `watch_items=${summary.watchItems.join("; ") || "none"}`,
    `hard_floor_status=${summary.hardFloorStatus}`,
    `over_mav_status=${summary.overMavStatus}`,
    `recommendation=${summary.recommendation}`,
  ];
}

function extractTableRows(stdout: string, header: string): string[] {
  const lines = stdout.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex < 0) {
    return [];
  }
  const rows: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      break;
    }
    if (!trimmed.includes(" | ")) {
      break;
    }
    rows.push(trimmed);
  }
  return rows;
}

function stableJsonHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function getAcceptedDraftSeed(draft: unknown): {
  source: string | null;
  refreshedAt: string | null;
  seed: unknown;
} {
  if (!draft || typeof draft !== "object") {
    return { source: null, refreshedAt: null, seed: null };
  }
  const acceptedSeedDraft = (draft as { acceptedSeedDraft?: unknown })
    .acceptedSeedDraft;
  if (!acceptedSeedDraft || typeof acceptedSeedDraft !== "object") {
    return { source: null, refreshedAt: null, seed: null };
  }
  const accepted = acceptedSeedDraft as {
    source?: unknown;
    refreshedAt?: unknown;
    slotPlanSeedJson?: unknown;
  };
  return {
    source: typeof accepted.source === "string" ? accepted.source : null,
    refreshedAt:
      typeof accepted.refreshedAt === "string" ? accepted.refreshedAt : null,
    seed: accepted.slotPlanSeedJson ?? null,
  };
}

async function loadSourceSnapshot(input: {
  owner: string;
  sourceMesocycleId: string;
}): Promise<SourceSnapshot> {
  const [{ prisma }, { readNextCycleSeedDraft }] = await Promise.all([
    import("@/lib/db/prisma"),
    import("@/lib/api/mesocycle-handoff"),
  ]);

  const user = await prisma.user.findUnique({
    where: { email: input.owner },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`Owner not found: ${input.owner}`);
  }

  const source = await prisma.mesocycle.findFirst({
    where: {
      id: input.sourceMesocycleId,
      macroCycle: { userId: user.id },
    },
    select: {
      id: true,
      state: true,
      macroCycleId: true,
      mesoNumber: true,
      nextSeedDraftJson: true,
    },
  });
  if (!source) {
    throw new Error(
      `Source mesocycle not found for owner ${input.owner}: ${input.sourceMesocycleId}`,
    );
  }

  const draft = readNextCycleSeedDraft(source.nextSeedDraftJson);
  const accepted = getAcceptedDraftSeed(draft);
  return {
    userId: user.id,
    source: {
      id: source.id,
      state: source.state,
      macroCycleId: source.macroCycleId,
      mesoNumber: source.mesoNumber,
    },
    draftSource: accepted.source,
    draftRefreshedAt: accepted.refreshedAt,
    draftSeedHash: accepted.seed ? stableJsonHash(accepted.seed) : null,
  };
}

async function loadSafetyCounts(input: {
  userId: string;
  macroCycleId: string;
  sourceMesoNumber: number;
}): Promise<SafetyCounts> {
  const { prisma } = await import("@/lib/db/prisma");

  const [
    mesocycleCount,
    successorCount,
    workoutCount,
    setLogCount,
    sessionCheckInCount,
  ] = await Promise.all([
    prisma.mesocycle.count({
      where: { macroCycleId: input.macroCycleId },
    }),
    prisma.mesocycle.count({
      where: {
        macroCycleId: input.macroCycleId,
        mesoNumber: { gt: input.sourceMesoNumber },
      },
    }),
    prisma.workout.count({
      where: {
        userId: input.userId,
        mesocycle: { macroCycleId: input.macroCycleId },
      },
    }),
    prisma.setLog.count({
      where: {
        workoutSet: {
          workoutExercise: {
            workout: {
              userId: input.userId,
              mesocycle: { macroCycleId: input.macroCycleId },
            },
          },
        },
      },
    }),
    prisma.sessionCheckIn.count({
      where: { userId: input.userId },
    }),
  ]);

  return {
    mesocycleCount,
    successorCount,
    workoutCount,
    setLogCount,
    sessionCheckInCount,
  };
}

function formatSafetyCounts(label: string, counts: SafetyCounts): string {
  return `[ops:safety:${label}] mesocycles=${counts.mesocycleCount} successors_after_source=${counts.successorCount} workouts=${counts.workoutCount} set_logs=${counts.setLogCount} session_check_ins=${counts.sessionCheckInCount}`;
}

async function callRefreshRoute(input: {
  origin: string;
  sourceMesocycleId: string;
  fetchImpl?: FetchLike;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = buildRefreshRouteUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text.slice(0, 240);
    throw new Error(`refresh failed status=${response.status} error=${message}`);
  }
  return body;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runAuditCommand(args: string[]): CommandResult {
  const result = spawnSync(npmCommand(), args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertCommandSucceeded(label: string, result: CommandResult): void {
  if (result.status === 0) {
    return;
  }
  const stdoutTail = result.stdout.split(/\r?\n/).slice(-20).join("\n");
  const stderrTail = result.stderr.split(/\r?\n/).slice(-20).join("\n");
  throw new Error(
    `${label} failed with exit ${result.status}\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`,
  );
}

async function closePrismaIfAvailable(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }
  const { closePrismaResourcesForAuditCli } = await import("@/lib/db/prisma");
  await closePrismaResourcesForAuditCli();
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseOpsRefreshNextSeedDraftArgs(argv);
  const env = loadAuditEnv(args.envFile);
  console.log(
    `[ops:preflight] env_file=${env.envFilePath ?? "none"} env_loaded=${boolWord(
      env.envLoaded,
    )}`,
  );

  const originValidation = await validateTrainerOrigin({ origin: args.origin });
  for (const line of formatOriginValidationResult(originValidation)) {
    console.log(line);
  }
  if (!originValidation.ok) {
    return 1;
  }

  const beforeSnapshot = await loadSourceSnapshot({
    owner: args.owner,
    sourceMesocycleId: args.sourceMesocycleId,
  });
  console.log(
    `[ops:source] id=${beforeSnapshot.source.id} state=${beforeSnapshot.source.state} draft_source=${beforeSnapshot.draftSource ?? "none"} refreshed_at=${beforeSnapshot.draftRefreshedAt ?? "none"}`,
  );
  if (beforeSnapshot.source.state !== "AWAITING_HANDOFF") {
    throw new Error(
      `source mesocycle must be AWAITING_HANDOFF, got ${beforeSnapshot.source.state}`,
    );
  }
  if (
    beforeSnapshot.draftSource !== "v2_materialized_seed" &&
    !args.allowNonV2DraftSource
  ) {
    throw new Error(
      `current draft source must be v2_materialized_seed, got ${beforeSnapshot.draftSource ?? "none"}; rerun with --allow-non-v2-draft-source only after intentionally reviewing that starting point`,
    );
  }

  const beforeCounts = await loadSafetyCounts({
    userId: beforeSnapshot.userId,
    macroCycleId: beforeSnapshot.source.macroCycleId,
    sourceMesoNumber: beforeSnapshot.source.mesoNumber,
  });
  console.log(formatSafetyCounts("before", beforeCounts));

  const refreshBody = await callRefreshRoute({
    origin: args.origin,
    sourceMesocycleId: args.sourceMesocycleId,
  });
  const afterRefreshSnapshot = await loadSourceSnapshot({
    owner: args.owner,
    sourceMesocycleId: args.sourceMesocycleId,
  });
  const afterRefreshCounts = await loadSafetyCounts({
    userId: afterRefreshSnapshot.userId,
    macroCycleId: afterRefreshSnapshot.source.macroCycleId,
    sourceMesoNumber: afterRefreshSnapshot.source.mesoNumber,
  });
  console.log(formatSafetyCounts("after_refresh", afterRefreshCounts));
  const refreshSafety = compareSafetyCounts({
    before: beforeCounts,
    after: afterRefreshCounts,
  });
  if (!refreshSafety.ok) {
    throw new Error(
      `unexpected count changes after refresh: ${refreshSafety.violations.join(
        "; ",
      )}`,
    );
  }

  const refreshSummary = summarizeRefreshResponse({
    responseBody: refreshBody,
    beforeDraftSeedHash: beforeSnapshot.draftSeedHash,
    afterDraftSeedHash: afterRefreshSnapshot.draftSeedHash,
    afterDraftSource: afterRefreshSnapshot.draftSource,
    afterDraftRefreshedAt: afterRefreshSnapshot.draftRefreshedAt,
  });
  for (const line of formatRefreshSummary(refreshSummary)) {
    console.log(line);
  }

  const handoffArgs = buildAuditCommandArgs({
    mode: "next-mesocycle-handoff-dry-run",
    owner: args.owner,
    sourceMesocycleId: args.sourceMesocycleId,
    envFile: args.envFile,
  });
  const acceptanceArgs = buildAuditCommandArgs({
    mode: "next-mesocycle-acceptance-gate",
    owner: args.owner,
    sourceMesocycleId: args.sourceMesocycleId,
    envFile: args.envFile,
  });
  console.log(`[ops:audit] npm ${handoffArgs.join(" ")}`);
  const handoff = runAuditCommand(handoffArgs);
  assertCommandSucceeded("next-mesocycle-handoff-dry-run", handoff);
  console.log(`[ops:audit] npm ${acceptanceArgs.join(" ")}`);
  const acceptance = runAuditCommand(acceptanceArgs);
  assertCommandSucceeded("next-mesocycle-acceptance-gate", acceptance);

  const afterAuditCounts = await loadSafetyCounts({
    userId: afterRefreshSnapshot.userId,
    macroCycleId: afterRefreshSnapshot.source.macroCycleId,
    sourceMesoNumber: afterRefreshSnapshot.source.mesoNumber,
  });
  console.log(formatSafetyCounts("after_audits", afterAuditCounts));
  const auditSafety = compareSafetyCounts({
    before: beforeCounts,
    after: afterAuditCounts,
  });
  if (!auditSafety.ok) {
    throw new Error(
      `unexpected count changes after audits: ${auditSafety.violations.join(
        "; ",
      )}`,
    );
  }

  const finalSummary = parseFinalAuditSummary({
    handoffStdout: handoff.stdout,
    acceptanceStdout: acceptance.stdout,
  });
  for (const line of formatFinalAuditSummary(finalSummary)) {
    console.log(line);
  }

  return interpretAcceptanceDecision(finalSummary.acceptanceDecision).exitCode;
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  main()
    .then(async (exitCode) => {
      await closePrismaIfAvailable();
      process.exitCode = exitCode;
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ops:refresh-next-seed-draft] ${message}`);
      try {
        await closePrismaIfAvailable();
      } catch {
        // Ignore teardown failure after the primary error is already reported.
      }
      process.exitCode = 1;
    });
}
