import assert from "node:assert/strict";
import { type Pool } from "pg";
import { assertConnectionPrivileges, closeTrainer2Connections, connectionRoles, databaseFor } from "../../src/lib/api/trainer2/database";

/** Invoked only inside the principal harness's classified, task-owned database. */
export async function verifyRoleCorrections(owner: Pool, pools: readonly [Pool, Pool, Pool], url: (role: string) => string, pass: (name: string) => void) {
  const oldEnvironment = { ...process.env };
  Object.assign(process.env, {
    TRAINER2_IDENTITY_CONNECTION_STRING: url(connectionRoles.identity),
    TRAINER2_READ_CONNECTION_STRING: url(connectionRoles.read),
    TRAINER2_WRITE_CONNECTION_STRING: url(connectionRoles.write),
  });
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const { tablename } of (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows)
      rows[tablename] = (await owner.query(`SELECT to_jsonb(t)::text AS row FROM public."${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`)).rows;
    return rows;
  };
  const before = await snapshot();
  try {
    for (const [index, purpose] of (["identity", "read", "write"] as const).entries()) {
      const role = connectionRoles[purpose], pool = pools[index];
      const admitted = () => databaseFor(purpose, true);
      const unsafe = async (grant: string, revoke: string) => {
        await owner.query(grant);
        try { await assert.rejects(admitted(), /DATABASE_ROLE_UNSAFE/); }
        finally { await owner.query(revoke); }
        await admitted();
      };
      await admitted();
      const client = await pool.connect();
      try {
        await client.query("SET statement_timeout='15s'; SET application_name='role-correction-control'");
        await assertConnectionPrivileges(client, purpose);
        await assert.rejects(client.query("SET session_replication_role=replica"), { code: "42501" });
        if (purpose === "write") await assert.rejects(client.query('INSERT INTO "Trainer2AccountTrainingState" ("accountId") VALUES (\'missing-account\')'), { code: "23503" });
        await owner.query(`GRANT SET ON PARAMETER session_replication_role TO ${role}`);
        await client.query("SET session_replication_role=replica");
        await owner.query(`REVOKE SET ON PARAMETER session_replication_role FROM ${role}`);
        assert.equal((await client.query("SELECT has_parameter_privilege(current_user,'session_replication_role','SET') AS capability")).rows[0].capability, false);
        await assert.rejects(assertConnectionPrivileges(client, purpose), /DATABASE_ROLE_UNSAFE/);
        // Restoration is administrator-owned fixture work, never checker repair.
        await owner.query(`GRANT SET ON PARAMETER session_replication_role TO ${role}`);
        await client.query("SET session_replication_role=origin");
        await owner.query(`REVOKE SET ON PARAMETER session_replication_role FROM ${role}`);
        await client.query("SET row_security=off");
        await assert.rejects(assertConnectionPrivileges(client, purpose), /DATABASE_ROLE_UNSAFE/);
        await client.query("SET row_security=on");
        await assertConnectionPrivileges(client, purpose);
      } finally { client.release(true); }
      for (const grantee of [role, "PUBLIC"]) {
        for (const [privilege, parameter] of [["SET", "session_replication_role"], ["SET", "log_statement"], ["SET", "correction.unloaded"], ["ALTER SYSTEM", "statement_timeout"]])
          await unsafe(`GRANT ${privilege} ON PARAMETER ${parameter} TO ${grantee}`, `REVOKE ${privilege} ON PARAMETER ${parameter} FROM ${grantee}`);
      }
      // Both user and backend contexts are configurable by ordinary users in
      // PostgreSQL 17 (backend settings only at connection startup).
      const ordinary = ["statement_timeout", ...(await owner.query("SELECT name FROM pg_settings WHERE context='backend'")).rows.map(r => r.name as string)];
      for (const parameter of ordinary) {
        assert.match(parameter, /^[a-z_]+$/);
        await owner.query(`GRANT SET ON PARAMETER ${parameter} TO ${role}`);
        try { await admitted(); } finally { await owner.query(`REVOKE SET ON PARAMETER ${parameter} FROM ${role}`); }
      }
      pass(`${purpose}: ordinary settings pass; SET controls, direct/PUBLIC elevated SET and ALTER SYSTEM, revoked-capability unsafe state rejected`);

      for (const schema of ["public", "correction_other"]) {
        if (schema !== "public") await owner.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO PUBLIC`);
        await owner.query(`CREATE MATERIALIZED VIEW ${schema}.correction_cache AS SELECT 1 AS value`);
        await assert.rejects(pool.query(`REFRESH MATERIALIZED VIEW ${schema}.correction_cache`), { code: "42501" });
        for (const grantee of [role, "PUBLIC"])
          await unsafe(`GRANT MAINTAIN ON ${schema}.correction_cache TO ${grantee}`, `REVOKE MAINTAIN ON ${schema}.correction_cache FROM ${grantee}`);
        await owner.query(`DROP MATERIALIZED VIEW ${schema}.correction_cache`);
        if (schema !== "public") await owner.query(`DROP SCHEMA ${schema}`);
      }
      pass(`${purpose}: refresh denied without MAINTAIN; direct/PUBLIC MAINTAIN rejected in public and another schema`);

      const database = (await owner.query("SELECT current_database() AS name")).rows[0].name;
      await owner.query("CREATE SEQUENCE public.correction_sequence; CREATE FUNCTION public.correction_function() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      for (const [privilege, object] of [
        ["SELECT", 'TABLE "Trainer2AccountPrincipal"'],
        ['SELECT("accountId")', 'TABLE "Trainer2AccountPrincipal"'],
        ["CONNECT", `DATABASE ${database}`], ["TEMPORARY", `DATABASE ${database}`],
        ["USAGE", "SCHEMA public"], ["EXECUTE", "FUNCTION public.correction_function()"],
        ["SELECT", "SEQUENCE public.correction_sequence"], ["SET", "PARAMETER statement_timeout"],
      ]) await unsafe(`GRANT ${privilege} ON ${object} TO ${role} WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR ${privilege} ON ${object} FROM ${role}`);
      if (purpose === "write") {
        for (const privilege of ['INSERT("accountId")', 'UPDATE("ownershipEpoch")'])
          await unsafe(`GRANT ${privilege} ON "Trainer2AccountTrainingState" TO ${role} WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR ${privilege} ON "Trainer2AccountTrainingState" FROM ${role}`);
      }
      await owner.query(`REVOKE SET ON PARAMETER statement_timeout FROM ${role}; DROP SEQUENCE public.correction_sequence; DROP FUNCTION public.correction_function()`);
      pass(`${purpose}: table/column, database, schema, function, sequence and ordinary parameter delegation rejected before client return`);

      // A fresh poisoned session must be evicted on failed admission, not reused
      // after the administrator restores the role default.
      await closeTrainer2Connections();
      await owner.query(`ALTER ROLE ${role} SET session_replication_role=replica`);
      try { await assert.rejects(admitted(), /DATABASE_ROLE_UNSAFE/); }
      finally { await owner.query(`ALTER ROLE ${role} RESET session_replication_role`); }
      const recovered = await admitted();
      assert.deepEqual(await recovered.$queryRawUnsafe("SELECT current_setting('session_replication_role') AS mode"), [{ mode: "origin" }]);
      pass(`${purpose}: unsafe pooled session rejected and discarded; safe connection recovery without grant repair`);
    }
    assert.deepEqual(await snapshot(), before);
    pass("all correction admission failures and recovery leave application rows unchanged; ALTER SYSTEM was never executed");
  } finally {
    await closeTrainer2Connections();
    for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key];
    Object.assign(process.env, oldEnvironment);
  }
}
