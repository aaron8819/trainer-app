import type { QueryResult, QueryResultRow } from "pg";
import type {
  CatalogSnapshot,
  ColumnFact,
  ConstraintFact,
  FunctionFact,
  IndexFact,
  LedgerRow,
  TriggerFact,
} from "./migration-integrity";

type ReadOnlyClient = {
  query<R extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<R>>;
};

const READ_ONLY_STATEMENT = /^(?:SELECT|WITH|SHOW|BEGIN\b.*\bREAD ONLY\b|COMMIT\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b)/i;

export function assertReadOnlyStatement(sql: string): void {
  const normalized = sql.replace(/^\s*(?:--[^\n]*\n\s*)*/, "").trim();
  if (!READ_ONLY_STATEMENT.test(normalized)) {
    throw new Error("MIGRATION_INTEGRITY_MUTATING_QUERY_BLOCKED");
  }
}

async function readQuery<R extends QueryResultRow>(client: ReadOnlyClient, sql: string): Promise<QueryResult<R>> {
  assertReadOnlyStatement(sql);
  return client.query<R>(sql);
}

async function transactionStatement(client: ReadOnlyClient, sql: string): Promise<void> {
  assertReadOnlyStatement(sql);
  await client.query(sql);
}

export async function inspectMigrationDatabase(client: ReadOnlyClient): Promise<{
  ledgerRows: LedgerRow[];
  catalog: CatalogSnapshot;
  writes: 0;
}> {
  const unableToVerify: string[] = [];
  let probe = 0;
  await transactionStatement(client, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

  async function safeSelect<R extends QueryResultRow>(label: string, sql: string): Promise<R[]> {
    probe += 1;
    const savepoint = `migration_integrity_probe_${probe}`;
    await transactionStatement(client, `SAVEPOINT ${savepoint}`);
    try {
      const result = await readQuery<R>(client, sql);
      await transactionStatement(client, `RELEASE SAVEPOINT ${savepoint}`);
      return result.rows;
    } catch {
      await transactionStatement(client, `ROLLBACK TO SAVEPOINT ${savepoint}`);
      await transactionStatement(client, `RELEASE SAVEPOINT ${savepoint}`);
      unableToVerify.push(label);
      return [];
    }
  }

  try {
    const ledger = await safeSelect<{
      id: string;
      migration_name: string;
      checksum: string | null;
      finished_at: string | null;
      rolled_back_at: string | null;
      logs: string | null;
      applied_steps_count: number;
    }>("ledger", `
      SELECT id, migration_name, checksum,
        finished_at::text AS finished_at,
        rolled_back_at::text AS rolled_back_at,
        logs,
        applied_steps_count
      FROM public._prisma_migrations
      ORDER BY migration_name, started_at, id
    `);
    const tableRows = await safeSelect<{ name: string }>("tables", `
      SELECT c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `);
    const columnRows = await safeSelect<{
      table_name: string;
      column_name: string;
      data_type: string;
      nullable: boolean;
      default_value: string | null;
    }>("columns", `
      SELECT c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        NOT a.attnotnull AS nullable,
        pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);
    const enumRows = await safeSelect<{ enum_name: string; enum_value: string }>("enums", `
      SELECT t.typname AS enum_name, e.enumlabel AS enum_value
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
    `);
    const indexRows = await safeSelect<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      columns: string[];
      predicate: string | null;
      nulls_not_distinct: boolean;
      is_valid: boolean;
      is_ready: boolean;
      is_live: boolean;
      constraint_name: string | null;
      constraint_type: string | null;
    }>("indexes", `
      SELECT tab.relname AS table_name,
        idx.relname AS index_name,
        i.indisunique AS is_unique,
        i.indnullsnotdistinct AS nulls_not_distinct,
        i.indisvalid AS is_valid,
        i.indisready AS is_ready,
        i.indislive AS is_live,
        con.conname AS constraint_name,
        con.contype::text AS constraint_type,
        ARRAY(
          SELECT pg_catalog.pg_get_indexdef(i.indexrelid, position, true)
            || CASE WHEN (i.indoption[position - 1] & 1) = 1 THEN ' DESC' ELSE '' END
            || CASE
              WHEN (i.indoption[position - 1] & 1) = 1 AND (i.indoption[position - 1] & 2) = 0 THEN ' NULLS LAST'
              WHEN (i.indoption[position - 1] & 1) = 0 AND (i.indoption[position - 1] & 2) = 2 THEN ' NULLS FIRST'
              ELSE ''
            END
          FROM generate_series(1, i.indnkeyatts) AS position
          ORDER BY position
        ) AS columns,
        pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_catalog.pg_class tab ON tab.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = tab.relnamespace
      LEFT JOIN pg_catalog.pg_constraint con
        ON con.conindid = i.indexrelid AND con.conrelid = i.indrelid
      WHERE n.nspname = 'public'
      ORDER BY tab.relname, idx.relname
    `);
    const constraintRows = await safeSelect<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      definition: string;
    }>("constraints", `
      SELECT c.relname AS table_name,
        con.conname AS constraint_name,
        con.contype::text AS constraint_type,
        pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, con.conname
    `);
    const triggerRows = await safeSelect<{
      table_name: string;
      trigger_name: string;
      definition: string;
    }>("triggers", `
      SELECT c.relname AS table_name,
        t.tgname AS trigger_name,
        pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
    const functionRows = await safeSelect<{ function_name: string; definition: string }>("functions", `
      SELECT p.proname AS function_name,
        pg_catalog.pg_get_functiondef(p.oid) AS definition
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
      ORDER BY p.proname, p.oid
    `);

    const enumValues = new Map<string, string[]>();
    for (const row of enumRows) enumValues.set(row.enum_name, [...(enumValues.get(row.enum_name) ?? []), row.enum_value]);

    await transactionStatement(client, "COMMIT");
    return {
      ledgerRows: ledger.map((row) => ({
        id: row.id,
        migrationName: row.migration_name,
        checksum: row.checksum,
        finishedAt: row.finished_at,
        rolledBackAt: row.rolled_back_at,
        logs: row.logs,
        appliedStepsCount: Number(row.applied_steps_count),
      })),
      catalog: {
        tables: tableRows.map((row) => row.name),
        columns: columnRows.map((row): ColumnFact => ({ table: row.table_name, name: row.column_name, type: row.data_type, nullable: row.nullable, default: row.default_value })),
        enums: [...enumValues.entries()].map(([name, values]) => ({ name, values })),
        indexes: indexRows.map((row): IndexFact => ({
          table: row.table_name,
          name: row.index_name,
          unique: row.is_unique,
          columns: row.columns,
          predicate: row.predicate,
          nullsNotDistinct: row.nulls_not_distinct,
          valid: row.is_valid,
          ready: row.is_ready,
          live: row.is_live,
          constraintName: row.constraint_name,
          constraintType: row.constraint_type,
        })),
        constraints: constraintRows.map((row): ConstraintFact => ({ table: row.table_name, name: row.constraint_name, type: row.constraint_type, definition: row.definition })),
        triggers: triggerRows.map((row): TriggerFact => ({ table: row.table_name, name: row.trigger_name, definition: row.definition })),
        functions: functionRows.map((row): FunctionFact => ({ name: row.function_name, definition: row.definition })),
        unableToVerify,
      },
      writes: 0,
    };
  } catch (error) {
    await transactionStatement(client, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}
