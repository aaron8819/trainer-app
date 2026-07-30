import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FINISHER_CATALOG_SQL_END,
  FINISHER_CATALOG_SQL_START,
  renderFinisherCatalogMigrationSql,
} from "../prisma/finisher-routine-migration-sql";

const migrationPath = resolve(
  "prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql"
);
const current = readFileSync(migrationPath, "utf8");
const start = current.indexOf(FINISHER_CATALOG_SQL_START);
const end = current.indexOf(FINISHER_CATALOG_SQL_END);
if (start < 0 || end < start) {
  throw new Error("Finisher catalog migration markers are missing or invalid");
}
const expected = renderFinisherCatalogMigrationSql().trimEnd();
const actual = current
  .slice(start, end + FINISHER_CATALOG_SQL_END.length)
  .trimEnd();

if (process.argv.includes("--refresh")) {
  const next =
    current.slice(0, start) +
    expected +
    current.slice(end + FINISHER_CATALOG_SQL_END.length);
  writeFileSync(migrationPath, next);
  console.log("Updated generated Finisher catalog migration SQL.");
} else if (actual !== expected) {
  throw new Error(
    "Finisher catalog migration SQL is stale. Run npm run generate:finisher-catalog -- --refresh."
  );
} else {
  console.log("Finisher catalog migration SQL matches canonical seed data.");
}
