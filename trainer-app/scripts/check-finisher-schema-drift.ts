import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { inspectFinisherSchemaDiff } from "../src/lib/operations/finisher-schema-drift";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is required and must identify a fully migrated disposable PostgreSQL database.",
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--script",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "");
  console.error(`Prisma schema diff failed with exit code ${result.status}.`);
  process.exit(result.status ?? 1);
}

const report = inspectFinisherSchemaDiff(result.stdout ?? "");
if (report.intentionalDatabaseOnlyExtensions.length > 0) {
  console.log(
    `Intentional database-only Finisher relationships retained: ${report.intentionalDatabaseOnlyExtensions.join(", ")}`,
  );
}
if (report.issues.length > 0) {
  for (const issue of report.issues) console.error(issue);
  process.exit(1);
}

console.log(
  "Prisma diff contains no unexpected schema statements.",
);
