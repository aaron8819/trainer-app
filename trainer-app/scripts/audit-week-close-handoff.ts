import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertAuditPreflight,
  buildResolvedAuditIdentityRequest,
  loadAuditEnv,
  parseArgs,
  printAuditPreflight,
  runAuditPreflight,
} from "./audit-cli-support";

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function parseInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);

  const [{ resolveWorkoutAuditIdentity }, { prisma }, { runWeekCloseHandoffAudit }] =
    await Promise.all([
      import("@/lib/audit/workout-audit/context-builder"),
      import("@/lib/db/prisma"),
      import("@/lib/audit/workout-audit/week-close-handoff"),
    ]);

  const preflight = await runAuditPreflight({
    args,
    resolveIdentity: resolveWorkoutAuditIdentity,
    checkDb: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    },
  });
  preflight.envFilePath = env.envFilePath;
  preflight.status.env_loaded = env.envLoaded;
  printAuditPreflight("week-close-handoff", preflight);
  assertAuditPreflight("week-close-handoff", preflight);
  const identityRequest = buildResolvedAuditIdentityRequest(args, preflight);

  const request = {
    ...identityRequest,
    targetWeek: parseInteger(args["target-week"]),
    previewOptionalGapFill: args["skip-preview"] === true ? false : true,
    sanitizationLevel: args.sanitization === "pii-safe" ? ("pii-safe" as const) : ("none" as const),
  };

  const artifact = await runWeekCloseHandoffAudit(request);
  const outputDir = path.join(process.cwd(), "artifacts", "audits", "week-close-handoff");
  await mkdir(outputDir, { recursive: true });

  const timestamp = artifact.generatedAt.replace(/[:.]/g, "-");
  const ownerSlug =
    request.sanitizationLevel === "pii-safe"
      ? "redacted"
      : slug(artifact.identity.ownerEmail ?? artifact.identity.userId);
  const fileName = `${timestamp}-${ownerSlug}-week${artifact.target.targetWeek}-week-close-handoff.json`;
  const outputPath = path.join(outputDir, fileName);

  await writeFile(outputPath, JSON.stringify(artifact, null, 2), "utf8");

  console.log(`[week-close-handoff] wrote ${outputPath}`);
  console.log(`[week-close-handoff:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  console.log(
    `[week-close-handoff] week=${artifact.target.targetWeek} expected=${artifact.conclusions.week_close_trigger_expected} observed=${artifact.conclusions.week_close_trigger_observed} pending=${artifact.conclusions.pending_week_close_present} gap_fill_expected=${artifact.conclusions.optional_gap_fill_expected} gap_fill_eligible=${artifact.conclusions.optional_gap_fill_eligible}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[week-close-handoff] ${message}`);
  process.exitCode = 1;
});
