import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type Args = Record<string, string | boolean>;

type ColumnRecord = {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  is_nullable: "YES" | "NO";
  data_type: string;
  udt_name: string;
  column_default: string | null;
};

type TableSnapshot = {
  table: string;
  schema: string | null;
  exists: boolean;
  columns: Array<{
    name: string;
    position: number;
    nullable: boolean;
    dataType: string;
    databaseType: string;
    default: string | null;
  }>;
};

const DEFAULT_TABLES = [
  "MacroCycle",
  "Constraints",
  "Mesocycle",
  "MesocycleWeekClose",
  "MesocycleExerciseRole",
  "Workout",
  "WorkoutExercise",
  "WorkoutSet",
  "SetLog",
  "FilteredExercise",
  "ExerciseExposure",
] as const;

function parseArgs(argv: string[]): Args {
  const output: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      output[key] = true;
      continue;
    }
    output[key] = value;
    index += 1;
  }
  return output;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function resolveTables(args: Args): string[] {
  if (typeof args.table !== "string") {
    return [...DEFAULT_TABLES];
  }
  return args.table
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function inspectTables(tables: string[]): Promise<TableSnapshot[]> {
  const columns = await prisma.$queryRaw<ColumnRecord[]>(Prisma.sql`
    SELECT
      table_schema,
      table_name,
      column_name,
      ordinal_position,
      is_nullable,
      data_type,
      udt_name,
      column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${Prisma.join(tables)})
    ORDER BY table_name, ordinal_position
  `);

  return tables.map((table) => {
    const tableColumns = columns.filter((column) => column.table_name === table);
    return {
      table,
      schema: tableColumns[0]?.table_schema ?? null,
      exists: tableColumns.length > 0,
      columns: tableColumns.map((column) => ({
        name: column.column_name,
        position: column.ordinal_position,
        nullable: column.is_nullable === "YES",
        dataType: column.data_type,
        databaseType: column.udt_name,
        default: column.column_default,
      })),
    };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tables = resolveTables(args);
  const snapshot = await inspectTables(tables);

  for (const table of snapshot) {
    if (!table.exists) {
      console.log(`[audit-schema] ${table.table}: missing in current schema`);
      continue;
    }

    console.log(`[audit-schema] ${table.schema}.${table.table} (${table.columns.length} columns)`);
    for (const column of table.columns) {
      const nullable = column.nullable ? "null" : "not-null";
      const defaultValue = column.default ? ` default=${column.default}` : "";
      console.log(
        `  ${String(column.position).padStart(2, "0")} ${column.name} ${column.dataType} (${column.databaseType}) ${nullable}${defaultValue}`
      );
    }
  }

  const shouldWriteJson = args.json === true || typeof args.output === "string";
  if (shouldWriteJson) {
    const outputDir = path.join(process.cwd(), "artifacts", "audits", "schema");
    await mkdir(outputDir, { recursive: true });
    const outputPath =
      typeof args.output === "string"
        ? path.resolve(process.cwd(), args.output)
        : path.join(
            outputDir,
            `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(tables.join("-"))}-schema.json`
          );

    await writeFile(
      outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          tables: snapshot,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log(`[audit-schema] wrote ${outputPath}`);
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[audit-schema] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
