import type { QueryResult, QueryResultRow } from "pg";
import type {
  CatalogSnapshot,
  CatalogRowFact,
  ColumnPrivilegeFact,
  ColumnFact,
  ConstraintFact,
  DefaultPrivilegeFact,
  FunctionFact,
  IndexFact,
  LedgerRow,
  PrivilegeFact,
  RoleFact,
  RoleMembershipFact,
  TableSecurityFact,
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
    const tableSecurityRows = await safeSelect<{
      table_name: string;
      owner_name: string;
      privileges: PrivilegeFact[];
    }>("tableSecurity", `
      SELECT c.relname AS table_name,
        owner.rolname AS owner_name,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
              'grantor', grantor.rolname,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            ORDER BY COALESCE(grantee.rolname, 'PUBLIC'),
              privilege.privilege_type, grantor.rolname
          )
          FROM pg_catalog.aclexplode(
            COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
          ) privilege
          LEFT JOIN pg_catalog.pg_roles grantee
            ON grantee.oid = privilege.grantee
          JOIN pg_catalog.pg_roles grantor
            ON grantor.oid = privilege.grantor
        ), '[]'::jsonb) AS privileges
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `);
    const columnPrivilegeRows = await safeSelect<{
      table_name: string;
      column_name: string;
      grantee_name: string;
      grantor_name: string;
      privilege_type: string;
      is_grantable: boolean;
    }>("columnPrivileges", `
      SELECT c.relname AS table_name,
        a.attname AS column_name,
        COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
        grantor.rolname AS grantor_name,
        privilege.privilege_type,
        privilege.is_grantable
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) privilege
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attacl IS NOT NULL
      ORDER BY c.relname, a.attname, grantee_name, privilege.privilege_type
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
      access_method: string;
      include_columns: string[];
    }>("indexes", `
      SELECT tab.relname AS table_name,
        idx.relname AS index_name,
        i.indisunique AS is_unique,
        i.indnullsnotdistinct AS nulls_not_distinct,
        i.indisvalid AS is_valid,
        i.indisready AS is_ready,
        i.indislive AS is_live,
        am.amname AS access_method,
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
        ARRAY(
          SELECT pg_catalog.pg_get_indexdef(i.indexrelid, position, true)
          FROM generate_series(i.indnkeyatts + 1, i.indnatts) AS position
          ORDER BY position
        ) AS include_columns,
        pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_catalog.pg_class tab ON tab.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = tab.relnamespace
      JOIN pg_catalog.pg_am am ON am.oid = idx.relam
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
      is_validated: boolean;
      is_deferrable: boolean;
      is_initially_deferred: boolean;
    }>("constraints", `
      SELECT c.relname AS table_name,
        con.conname AS constraint_name,
        con.contype::text AS constraint_type,
        pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
        con.convalidated AS is_validated,
        con.condeferrable AS is_deferrable,
        con.condeferred AS is_initially_deferred
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
      enabled: string;
      function_name: string;
      function_owner: string;
    }>("triggers", `
      SELECT c.relname AS table_name,
        t.tgname AS trigger_name,
        pg_catalog.pg_get_triggerdef(t.oid, true) AS definition,
        t.tgenabled::text AS enabled,
        p.proname AS function_name,
        owner.rolname AS function_owner
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
    const functionRows = await safeSelect<{
      function_name: string;
      definition: string;
      language_name: string;
      identity_arguments: string;
      result_type: string;
      volatility: string;
      security_definer: boolean;
      leakproof: boolean;
      is_strict: boolean;
      parallel_safety: string;
      body: string;
      configuration: string[] | null;
      public_execute: boolean;
      owner_name: string;
      privileges: PrivilegeFact[];
      referenced_relations: string[];
      referenced_functions: string[];
      trigger_tables: string[];
    }>("functions", `
      SELECT p.proname AS function_name,
        pg_catalog.pg_get_functiondef(p.oid) AS definition,
        l.lanname AS language_name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_catalog.format_type(p.prorettype, NULL) AS result_type,
        p.provolatile::text AS volatility,
        p.prosecdef AS security_definer,
        p.proleakproof AS leakproof,
        p.proisstrict AS is_strict,
        p.proparallel::text AS parallel_safety,
        p.prosrc AS body,
        p.proconfig AS configuration,
        owner.rolname AS owner_name,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              p.proacl,
              pg_catalog.acldefault('f', p.proowner)
            )
          ) privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ) AS public_execute,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
              'grantor', grantor.rolname,
              'privilege', privilege.privilege_type,
              'grantable', privilege.is_grantable
            )
            ORDER BY COALESCE(grantee.rolname, 'PUBLIC'),
              privilege.privilege_type, grantor.rolname
          )
          FROM pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) privilege
          LEFT JOIN pg_catalog.pg_roles grantee
            ON grantee.oid = privilege.grantee
          JOIN pg_catalog.pg_roles grantor
            ON grantor.oid = privilege.grantor
        ), '[]'::jsonb) AS privileges,
        ARRAY(
          SELECT DISTINCT relation_namespace.nspname || '.' || relation.relname
          FROM pg_catalog.pg_depend dependency
          JOIN pg_catalog.pg_class relation
            ON relation.oid = dependency.refobjid
          JOIN pg_catalog.pg_namespace relation_namespace
            ON relation_namespace.oid = relation.relnamespace
          WHERE dependency.classid = 'pg_catalog.pg_proc'::regclass
            AND dependency.objid = p.oid
            AND dependency.refclassid = 'pg_catalog.pg_class'::regclass
          ORDER BY relation_namespace.nspname || '.' || relation.relname
        ) AS referenced_relations,
        ARRAY(
          SELECT DISTINCT referenced.proname ||
            '(' || pg_catalog.pg_get_function_identity_arguments(referenced.oid) || ')'
          FROM pg_catalog.pg_depend dependency
          JOIN pg_catalog.pg_proc referenced
            ON referenced.oid = dependency.refobjid
          WHERE dependency.classid = 'pg_catalog.pg_proc'::regclass
            AND dependency.objid = p.oid
            AND dependency.refclassid = 'pg_catalog.pg_proc'::regclass
            AND referenced.oid <> p.oid
          ORDER BY referenced.proname ||
            '(' || pg_catalog.pg_get_function_identity_arguments(referenced.oid) || ')'
        ) AS referenced_functions,
        ARRAY(
          SELECT DISTINCT trigger_table.relname::text
          FROM pg_catalog.pg_trigger trigger
          JOIN pg_catalog.pg_class trigger_table
            ON trigger_table.oid = trigger.tgrelid
          JOIN pg_catalog.pg_namespace trigger_namespace
            ON trigger_namespace.oid = trigger_table.relnamespace
          WHERE trigger.tgfoid = p.oid
            AND NOT trigger.tgisinternal
            AND trigger_namespace.nspname = 'public'
          ORDER BY trigger_table.relname::text
        ) AS trigger_tables
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
      WHERE n.nspname = 'public' AND p.prokind = 'f'
      ORDER BY p.proname, p.oid
    `);
    const roleRows = await safeSelect<{
      role_name: string;
      can_login: boolean;
      inherits_privileges: boolean;
      is_superuser: boolean;
      can_create_role: boolean;
      can_create_db: boolean;
      can_replicate: boolean;
      bypasses_rls: boolean;
      public_schema_create: boolean;
    }>("roles", `
      SELECT role.rolname AS role_name,
        role.rolcanlogin AS can_login,
        role.rolinherit AS inherits_privileges,
        role.rolsuper AS is_superuser,
        role.rolcreaterole AS can_create_role,
        role.rolcreatedb AS can_create_db,
        role.rolreplication AS can_replicate,
        role.rolbypassrls AS bypasses_rls,
        pg_catalog.has_schema_privilege(
          role.rolname,
          'public',
          'CREATE'
        ) AS public_schema_create
      FROM pg_catalog.pg_roles role
      ORDER BY role.rolname
    `);
    const roleMembershipRows = await safeSelect<{
      role_name: string;
      member_name: string;
      grantor_name: string;
      admin_option: boolean;
    }>("roleMemberships", `
      SELECT granted.rolname AS role_name,
        member.rolname AS member_name,
        grantor.rolname AS grantor_name,
        membership.admin_option
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
      ORDER BY granted.rolname, member.rolname, grantor.rolname
    `);
    const defaultPrivilegeRows = await safeSelect<{
      owner_name: string;
      schema_name: string | null;
      object_type: string;
      grantee_name: string;
      grantor_name: string;
      privilege_type: string;
      is_grantable: boolean;
    }>("defaultPrivileges", `
      SELECT owner.rolname AS owner_name,
        namespace.nspname AS schema_name,
        defaults.defaclobjtype::text AS object_type,
        COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
        grantor.rolname AS grantor_name,
        privilege.privilege_type,
        privilege.is_grantable
      FROM pg_catalog.pg_default_acl defaults
      JOIN pg_catalog.pg_roles owner ON owner.oid = defaults.defaclrole
      LEFT JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
      ORDER BY owner_name, schema_name, object_type, grantee_name,
        privilege.privilege_type
    `);
    const finisherDefinitionTables = [
      "FinisherRoutine",
      "FinisherRoutineVersion",
      "FinisherRoutineStep",
      "FinisherRoutineStepAlternative",
    ];
    const catalogRows = finisherDefinitionTables.every((name) =>
      tableRows.some((row) => row.name === name),
    )
      ? await safeSelect<{
          table_name: string;
          row_key: string;
          values: Record<string, unknown>;
        }>("finisherCatalogRows", `
          SELECT 'FinisherRoutine' AS table_name, r."id" AS row_key,
            to_jsonb(r) - 'createdAt' AS values
          FROM "FinisherRoutine" r
          UNION ALL
          SELECT 'FinisherRoutineVersion', v."id",
            (to_jsonb(v) - 'createdAt' - 'sealedAt')
              || jsonb_build_object('sealed', v."sealedAt" IS NOT NULL)
          FROM "FinisherRoutineVersion" v
          UNION ALL
          SELECT 'FinisherRoutineStep', s."id", to_jsonb(s)
          FROM "FinisherRoutineStep" s
          UNION ALL
          SELECT 'FinisherRoutineStepAlternative', a."id", to_jsonb(a)
          FROM "FinisherRoutineStepAlternative" a
          ORDER BY table_name, row_key
        `)
      : [];

    const enumValues = new Map<string, string[]>();
    for (const row of enumRows) enumValues.set(row.enum_name, [...(enumValues.get(row.enum_name) ?? []), row.enum_value]);
    const publicRelationNames = tableRows.map((row) => row.name);
    const publicFunctionNames = functionRows.map((row) => row.function_name);
    const staticReferences = (body: string, names: string[]) =>
      names.filter(
        (name) =>
          body.includes(`"${name}"`) ||
          new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
            body,
          ),
      );

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
          accessMethod: row.access_method,
          includeColumns: row.include_columns,
        })),
        constraints: constraintRows.map((row): ConstraintFact => ({
          table: row.table_name,
          name: row.constraint_name,
          type: row.constraint_type,
          definition: row.definition,
          validated: row.is_validated,
          deferrable: row.is_deferrable,
          initiallyDeferred: row.is_initially_deferred,
        })),
        triggers: triggerRows.map((row): TriggerFact => ({
          table: row.table_name,
          name: row.trigger_name,
          definition: row.definition,
          enabled: row.enabled,
          functionName: row.function_name,
          functionOwner: row.function_owner,
        })),
        functions: functionRows.map((row): FunctionFact => {
          const referencedRelations = [
            ...new Set([
              ...row.referenced_relations,
              ...staticReferences(row.body, publicRelationNames).map(
                (name) => `public.${name}`,
              ),
            ]),
          ].sort();
          const referencedFunctions = [
            ...new Set([
              ...row.referenced_functions,
              ...staticReferences(row.body, publicFunctionNames)
                .filter((name) => name !== row.function_name)
                .map((name) => `${name}()`),
            ]),
          ].sort();
          return {
            name: row.function_name,
            definition: row.definition,
            language: row.language_name,
            arguments: row.identity_arguments,
            resultType: row.result_type,
            volatility: row.volatility,
            securityDefiner: row.security_definer,
            leakproof: row.leakproof,
            strict: row.is_strict,
            parallel: row.parallel_safety,
            body: row.body,
            configuration: row.configuration,
            publicExecute: row.public_execute,
            owner: row.owner_name,
            privileges: row.privileges,
            referencedRelations,
            referencedFunctions,
            triggerTables: row.trigger_tables,
            mutationCapability:
              /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/i.test(
                row.body,
              ),
          };
        }),
        tableSecurity: tableSecurityRows.map(
          (row): TableSecurityFact => ({
            table: row.table_name,
            owner: row.owner_name,
            privileges: row.privileges,
          }),
        ),
        columnPrivileges: columnPrivilegeRows.map(
          (row): ColumnPrivilegeFact => ({
            table: row.table_name,
            column: row.column_name,
            grantee: row.grantee_name,
            grantor: row.grantor_name,
            privilege: row.privilege_type,
            grantable: row.is_grantable,
          }),
        ),
        roles: roleRows.map(
          (row): RoleFact => ({
            name: row.role_name,
            canLogin: row.can_login,
            inherit: row.inherits_privileges,
            superuser: row.is_superuser,
            createRole: row.can_create_role,
            createDb: row.can_create_db,
            replication: row.can_replicate,
            bypassRls: row.bypasses_rls,
            publicSchemaCreate: row.public_schema_create,
          }),
        ),
        roleMemberships: roleMembershipRows.map(
          (row): RoleMembershipFact => ({
            role: row.role_name,
            member: row.member_name,
            grantor: row.grantor_name,
            adminOption: row.admin_option,
          }),
        ),
        defaultPrivileges: defaultPrivilegeRows.map(
          (row): DefaultPrivilegeFact => ({
            owner: row.owner_name,
            schema: row.schema_name,
            objectType: row.object_type,
            grantee: row.grantee_name,
            grantor: row.grantor_name,
            privilege: row.privilege_type,
            grantable: row.is_grantable,
          }),
        ),
        catalogRows: catalogRows.map(
          (row): CatalogRowFact => ({
            table: row.table_name,
            key: row.row_key,
            values: row.values,
          }),
        ),
        unableToVerify,
      },
      writes: 0,
    };
  } catch (error) {
    await transactionStatement(client, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}
