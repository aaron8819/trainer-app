import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAuditEnv, parseArgs } from "./audit-cli-support";

function stringArg(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function boolArg(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

function artifactTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(stringArg(args["env-file"]));
  const write = boolArg(args.write);
  const explicitDryRun = boolArg(args["dry-run"]);

  if (write && explicitDryRun) {
    throw new Error("BACKFILL_WEEK1_DRY_RUN_AND_WRITE_ARE_MUTUALLY_EXCLUSIVE");
  }

  const [{ backfillWeek1PerformedSessions }, { closePrismaResourcesForAuditCli }] =
    await Promise.all([
      import("@/lib/api/backfill-week1-performed-sessions"),
      import("@/lib/db/prisma"),
    ]);

  try {
    const result = await backfillWeek1PerformedSessions({
      ownerEmail: stringArg(args.owner) ?? "",
      mesocycleId: stringArg(args["mesocycle-id"]) ?? "",
      backfillWeek1PerformedSessions: boolArg(args["backfill-week1-performed-sessions"]),
      write,
      confirmBackfill: boolArg(args["confirm-backfill"]),
    });

    const artifactsDir = resolve(process.cwd(), "artifacts", "audits");
    await mkdir(artifactsDir, { recursive: true });
    const artifactPath = resolve(
      artifactsDir,
      `${artifactTimestamp()}-backfill-week1-performed-sessions.json`,
    );
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          env: {
            envLoaded: env.envLoaded,
            envFilePath: env.envFilePath,
          },
          result,
        },
        null,
        2,
      ),
      "utf8",
    );
    const artifactSize = (await stat(artifactPath)).size;

    console.log(`[backfill-week1] artifact=${artifactPath}`);
    console.log(`[backfill-week1] artifact_bytes=${artifactSize}`);
    console.log(
      `[backfill-week1] eligible=${result.safety.eligible} write_requested=${result.write.requested} db_write_occurred=${result.write.dbWriteOccurred}`,
    );
    console.log(
      `[backfill-week1] blockers=${JSON.stringify(result.safety.blockers)}`,
    );
    console.log(
      `[backfill-week1] expected_rows=${JSON.stringify(result.dryRunSummary.totals)}`,
    );
    console.log(
      `[backfill-week1] seed_boundary=${JSON.stringify(result.seedSlotSequenceBoundary)}`,
    );

    if (write && !result.write.dbWriteOccurred) {
      process.exitCode = 1;
    }
  } finally {
    await closePrismaResourcesForAuditCli();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
