import { readdirSync } from "node:fs";
import { Client } from "pg";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

type MigrationRow = {
  migration_name: string;
  finished: boolean;
  rolled_back: boolean;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  await runWithRolloutEnvironment({
    argv,
    allowWrite: false,
    requiredVariables: ["DATABASE_URL", "DIRECT_URL"],
  }, async (environment) => {
    const directUrl = process.env.DIRECT_URL;
    if (!directUrl) {
      throw new Error("The explicitly named environment file must define DIRECT_URL.");
    }
    const directTargetClass = classifyRolloutTarget(
      directUrl,
      argv.includes("--confirm-disposable"),
    );
    if (directTargetClass !== environment.targetClass) {
      throw new Error("DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.");
    }

    const checkedIn = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 5_000 });
    let rows: MigrationRow[] = [];
    try {
      await client.connect();
      try {
        const result = await client.query<MigrationRow>(`
          SELECT migration_name,
            finished_at IS NOT NULL AS finished,
            rolled_back_at IS NOT NULL AS rolled_back
          FROM _prisma_migrations
          ORDER BY migration_name
        `);
        rows = result.rows;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code !== "42P01") throw error;
      }
    } finally {
      await client.end().catch(() => undefined);
    }

    const applied = new Set(
      rows.filter((row) => row.finished && !row.rolled_back).map((row) => row.migration_name),
    );
    const failed = rows
      .filter((row) => !row.finished && !row.rolled_back)
      .map((row) => row.migration_name);
    const pending = checkedIn.filter((name) => !applied.has(name));
    console.log(JSON.stringify({
      environment: sanitizedRolloutEnvironment(environment),
      directTargetClass,
      checkedIn: checkedIn.length,
      applied: applied.size,
      pending,
      failed,
      migrationAuthorized: false,
      writes: 0,
    }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage =
    message.startsWith("The explicitly named environment file") ||
    message.startsWith("DATABASE_URL and DIRECT_URL")
      ? message
      : "Migration status inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
  console.error(safeMessage);
  process.exitCode = 1;
});
