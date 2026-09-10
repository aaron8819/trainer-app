import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { readLegacySource, legacyCaptureLimits } from "../../src/lib/api/trainer2/legacy-source";
import { legacyQueries } from "../../src/lib/api/trainer2/legacy-source-queries";
import { captureSource, compareSourceCaptures, discrepancyReport, renderSourceReport, sourceHash } from "../../src/lib/legacy-history/source";
import type { SourceScope, SourceCapture, SourceAssertion } from "../../src/lib/trainer2-contracts/legacy-source";
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from "../../src/lib/operations/test-environment-preflight";
import { verificationSource } from "./verification-source";

export async function verifyLegacySource() {
  const output = resolve("artifacts/trainer2-legacy"); mkdirSync(output, { recursive: true });
  const source = verificationSource();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const container = `trainer2-legacy-${suffix}`, database = `trainer2_disposable_${suffix}`, password = randomUUID();
  const commands: unknown[] = [], results: string[] = [], pools: Pool[] = [];
  const evidence: Record<string, unknown> = { source, started: new Date().toISOString(), node: process.version, invocation: "node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-legacy-postgres.ts --confirm-disposable" };
  const scrub = (s: string) => s.replaceAll(password, "[disposable-secret]").replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[disposable-target]");
  const command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => {
    const started = new Date().toISOString();
    const result = spawnSync(exe, args, { env, encoding: "utf8", windowsHide: true, maxBuffer: 20_000_000 });
    commands.push({ command: scrub([exe, ...args].join(" ")), started, finished: new Date().toISOString(), status: result.status, stdout: scrub(result.stdout ?? ""), stderr: scrub(result.stderr ?? "") });
    if (result.status !== 0) throw new Error(scrub(`Command failed: ${exe}: ${result.stderr}`));
    return result.stdout.trim();
  };
  const passed = (s: string) => { results.push(s); console.log(`PASS ${s}`); };
  const pool = (url: string) => { const p = new Pool({ connectionString: url, max: 2 }); pools.push(p); return p; };
  try {
    command("docker", ["run", "--pull=never", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "-p", "127.0.0.1::5432", "postgres:17-alpine"]);
    for (let i = 0; ; i++) {
      if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { windowsHide: true }).status === 0) break;
      if (i === 60) throw new Error("Disposable PostgreSQL startup failed");
      await new Promise(r => setTimeout(r, 500));
    }
    const port = command("docker", ["port", container, "5432/tcp"]).match(/:(\d+)$/)?.[1]; assert(port);
    const ownerUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
    const readerUrl = `postgresql://trainer2_legacy_reader:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: ownerUrl, DIRECT_URL: ownerUrl, TEST_DATABASE_URL: ownerUrl };
    assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
    command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    const owner = pool(ownerUrl), reader = pool(readerUrl);
    evidence.postgres = (await owner.query("SELECT version()")).rows[0];
    evidence.docker = command("docker", ["version", "--format", "{{.Server.Version}}"]);
    evidence.pg = JSON.parse(readFileSync(resolve("node_modules/pg/package.json"), "utf8")).version;
    await owner.query(`CREATE ROLE trainer2_legacy_reader LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
      ALTER ROLE trainer2_legacy_reader SET default_transaction_read_only=on;
      GRANT USAGE ON SCHEMA public TO trainer2_legacy_reader;`);
    for (const q of legacyQueries) await owner.query(`GRANT SELECT ON public."${q.family}" TO trainer2_legacy_reader`);
    // Actual migrated schema; source IDs deliberately use legacy text, not UUIDs.
    await owner.query(`INSERT INTO "User" (id,email) VALUES ('legacy-A','a@synthetic.invalid'),('legacy-B','b@synthetic.invalid');
      INSERT INTO "Exercise" (id,name,"jointStress") VALUES ('exercise-A','Synthetic barbell','LOW'),('exercise-B','Foreign secret exercise','LOW');
      INSERT INTO "Workout" (id,"userId","scheduledDate",status,notes) VALUES ('session-A','legacy-A','2026-01-01','IN_PROGRESS','before'),('session-B','legacy-B','2026-01-01','IN_PROGRESS','foreign-secret'),('lookalike-A','legacy-A','2026-01-01','PARTIAL',NULL),('lookalike-B','legacy-A','2026-01-01','PARTIAL',NULL);
      INSERT INTO "WorkoutExercise" (id,"workoutId","exerciseId","orderIndex","isMainLift","measurementProfile","loadConvention","repBasis") VALUES ('position-A','session-A','exercise-A',0,true,'REPS_EXTERNAL_LOAD','BARBELL_TOTAL','TOTAL'),('position-B','session-B','exercise-B',0,true,NULL,NULL,NULL);
      INSERT INTO "WorkoutSet" (id,"workoutExerciseId","setIndex","targetReps","targetLoad") VALUES ('target-A','position-A',0,10,40.125),('target-zero','position-A',1,8,0),('target-null','position-A',2,8,NULL),('target-B','position-B',0,10,999);
      INSERT INTO "SetLog" (id,"workoutSetId","actualReps","actualLoad","actualRpe") VALUES ('log-A','target-A',10,40.125,8.5),('log-zero','target-zero',8,0,NULL),('log-null','target-null',NULL,NULL,NULL),('log-B','target-B',10,999,9);
      INSERT INTO "WorkoutTemplate" (id,"userId",name,"updatedAt") VALUES ('foreign-template','legacy-B','foreign-template-secret',now());
      UPDATE "Workout" SET "templateId"='foreign-template' WHERE id='session-A';`);
    await owner.query(`UPDATE "Workout" SET "selectionMetadata"='null'::jsonb WHERE id='session-A'`);
    await owner.query(`INSERT INTO "MacroCycle" (id,"userId","startDate","endDate","durationWeeks","trainingAge","primaryGoal","updatedAt") VALUES ('plan-A','legacy-A','2026-01-01','2026-02-01',4,'BEGINNER','HYPERTROPHY',now());
      INSERT INTO "HypertrophyPlanDraft" ("macroCycleId",payload,"updatedAt") VALUES ('plan-A','{"synthetic":true,"prescribedLoad":"40.125"}',now());
      INSERT INTO "Mesocycle" (id,"macroCycleId","mesoNumber","startWeek","durationWeeks",focus,"volumeTarget","intensityBias") VALUES ('meso-A','plan-A',1,0,4,'Synthetic','MODERATE','HYPERTROPHY');
      INSERT INTO "MesocycleSeedRevision" (id,"mesocycleId",revision,"seedPayload","provenanceStatus","creationReason") VALUES ('seed-A','meso-A',1,'{"synthetic":true,"prescribedLoad":"40.125"}','legacy_unknown','synthetic-fixture');
      UPDATE "Mesocycle" SET "currentSeedRevisionId"='seed-A' WHERE id='meso-A';
      UPDATE "Workout" SET "mesocycleId"='meso-A',"seedRevisionId"='seed-A',"seedRevisionNumber"=1 WHERE id='session-A';
      INSERT INTO "ExerciseVariation" (id,"exerciseId",name) VALUES ('variation-A','exercise-A','Synthetic variation');
      INSERT INTO "ExerciseAlias" (id,"exerciseId",alias) VALUES ('alias-A','exercise-A','Synthetic alias');`);
    // Corruption fixture only: no owner can be established for this orphan.
    const corruption = await owner.connect();
    try { await corruption.query("SET session_replication_role=replica"); await corruption.query(`INSERT INTO "SetLog" (id,"workoutSetId","actualLoad") VALUES ('orphan-log','missing-target',123)`); }
    finally { await corruption.query("SET session_replication_role=origin"); corruption.release(); }
    const scope: SourceScope = { system: "trainer-legacy-synthetic-v1", account: "legacy-A", kind: "synthetic-postgres", selection: "all-owner-reachable-rows-v1", families: legacyQueries.map(q => q.family), completeness: "complete-within-declared-families" };
    const snapshot = async () => {
      const tables = (await owner.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
      const value: Record<string, unknown> = {};
      for (const { tablename } of tables) value[tablename] = (await owner.query(`SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]')::text AS rows FROM (SELECT to_jsonb(t) v FROM public."${tablename.replaceAll('"', '""')}" t) a`)).rows[0].rows;
      return value;
    };
    const before = await snapshot();
    const first = await readLegacySource(reader, scope), again = await readLegacySource(reader, scope);
    assert.deepEqual(await snapshot(), before);
    assert.equal(first.sourceHash, again.sourceHash); assert.deepEqual(first.references, again.references);
    assert.equal(renderSourceReport(first), renderSourceReport(again));
    const exported = JSON.stringify(first);
    for (const secret of ['foreign-secret','foreign-template-secret','Foreign secret exercise','log-B','orphan-log']) assert(!exported.includes(secret), secret);
    const record = (c: SourceCapture, id: string) => c.references.find(r => r.identity.record === id)!;
    assert(record(first, "session-A").discrepancies.includes("UNAVAILABLE_RELATION:templateId:WorkoutTemplate"));
    assert.equal(record(first, "log-A").raw.fields.actualLoad, "40.125");
    assert.equal(record(first, "log-zero").raw.fields.actualLoad, "0");
    assert.equal(record(first, "log-null").raw.fields.actualLoad, null);
    assert.equal(record(first, "session-A").raw.fields.selectionMetadata, "null");
    assert.equal(record(first, "lookalike-A").raw.fields.selectionMetadata, null);
    assert.equal(record(first, "seed-A").raw.fields.provenanceStatus, "legacy_unknown");
    assert.equal(record(first, "seed-A").interpretation.startingPrescription, "not-verified-start");
    passed("actual migrated PostgreSQL: owner isolation including foreign linked template/catalog/logs; unattributable orphan excluded; all source and Trainer2 table snapshots unchanged; deterministic recapture and raw float/null/zero text");
    const a: SourceAssertion = { schemaVersion: 1, identity: record(first, "log-A").identity, payloadHash: record(first, "log-A").payloadHash, artifactId: "synthetic-population-protocol-v1", artifactText: "Synthetic fixture explicitly represents 10 total reps with 40.125 kg barbell total on synthetic-bar-A on 2026-01-01. This is not an observed real user assertion.", claims: { confirmedPerformance: true, unit: "kg", convention: "BARBELL_TOTAL", repBasis: "TOTAL", equipment: "synthetic-bar-A", performedDate: "2026-01-01" } };
    const asserted = await readLegacySource(reader, scope, [a]);
    assert.equal(record(asserted, "log-A").interpretation.kind, "source-asserted-performance");
    assert.equal(record(asserted, "log-A").interpretation.time.performedInstant, null);
    assert.equal(record(asserted, "log-A").interpretation.quantitativelyQualified, false);
    writeFileSync(resolve(output, "postgres-capture.json"), JSON.stringify(asserted, null, 2));
    passed("synthetic bound provenance preserves known measurement and date-only precision without admission");
    const tables = (await owner.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows;
    for (const { tablename } of tables) {
      const grants = await owner.query(`SELECT has_table_privilege('trainer2_legacy_reader',$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable`, [`public."${tablename}"`]);
      assert.equal(grants.rows[0].writable, false, tablename);
    }
    // Prove permission denial independently of the read-only transaction setting.
    const denied = await reader.connect();
    try {
      await denied.query("SET default_transaction_read_only=off");
      for (const sql of [`UPDATE "SetLog" SET "actualLoad"=1`, `DELETE FROM "Workout"`, `INSERT INTO "User" (id,email) VALUES ('x','x@synthetic.invalid')`, `TRUNCATE "WorkoutSet"`, `UPDATE "Trainer2Plan" SET "tombstonedAt"=now()`])
        await assert.rejects(denied.query(sql), (error: { code?: string }) => error.code === "42501");
      await denied.query("BEGIN READ ONLY");
      await assert.rejects(denied.query(`UPDATE "SetLog" SET "actualLoad"=1`), (error: { code?: string }) => error.code === "25006");
      await denied.query("ROLLBACK");
    } finally { await denied.query("SET default_transaction_read_only=on"); denied.release(); }
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(readLegacySource(owner, scope), /ROLE_INVALID/);
    await owner.query(`GRANT UPDATE (notes) ON "Workout" TO trainer2_legacy_reader`);
    await assert.rejects(readLegacySource(reader, scope), /MUTATION_PRIVILEGES/);
    await owner.query(`REVOKE UPDATE (notes) ON "Workout" FROM trainer2_legacy_reader`);
    await owner.query(`CREATE ROLE synthetic_writer; GRANT UPDATE ON "SetLog" TO synthetic_writer; GRANT synthetic_writer TO trainer2_legacy_reader`);
    await assert.rejects(readLegacySource(reader, scope), /ROLE_MEMBERSHIP/);
    await owner.query(`REVOKE synthetic_writer FROM trainer2_legacy_reader`);
    passed("restricted role cannot mutate legacy or destination tables even outside read-only transactions; transaction independently rejects writes; adapter rejects privileged role and column-write grant");
    let interleaved = false;
    const statements: string[] = [];
    const intercept = { connect: async () => {
      const c = await reader.connect(), query = c.query.bind(c);
      c.query = (async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        const result = await query(sql, values);
        if (!interleaved && sql.includes('FROM public."Workout" t')) {
          interleaved = true;
          await owner.query(`BEGIN; UPDATE "Workout" SET notes='after' WHERE id='session-A'; UPDATE "SetLog" SET "actualLoad"=41.25 WHERE id='log-A'; COMMIT;`);
        }
        return result;
      }) as typeof c.query;
      return c;
    } };
    const consistent = await readLegacySource(intercept, scope);
    assert(interleaved);
    assert.equal(record(consistent, "session-A").raw.fields.notes, "before");
    assert.equal(record(consistent, "log-A").raw.fields.actualLoad, "40.125");
    const changed = await readLegacySource(reader, scope);
    assert.equal(record(changed, "session-A").raw.fields.notes, "after");
    assert.equal(record(changed, "log-A").raw.fields.actualLoad, "41.25");
    assert.notEqual(record(changed, "target-A").revision, record(first, "target-A").revision);
    assert.deepEqual(record(changed, "target-A").identity, record(first, "target-A").identity);
    assert(statements.every(sql => /^(SELECT|BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/.test(sql)));
    evidence.adapterStatements = statements;
    passed("repeatable-read snapshot spans sessions, prescriptions and logs across concurrent committed source mutation; next capture changes included dependency revisions");
    const cliEnv: NodeJS.ProcessEnv = { ...sanitizeDatabaseTargetEnvironment(process.env), TRAINER2_LEGACY_DATABASE_URL: readerUrl };
    delete cliEnv.CI;
    const cliArgs = [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/capture-trainer2-legacy-source.ts", "--confirm-disposable", "--account", "legacy-A", "--source-system", scope.system];
    const cliBefore = await snapshot();
    const cli = JSON.parse(command(process.execPath, cliArgs, cliEnv));
    assert.deepEqual(cli.report, discrepancyReport(changed));
    assert.deepEqual(await snapshot(), cliBefore);
    passed("guarded developer CLI exports the same source-labeled capture/report without table writes");
    // Fixture administration only. Every capture below uses the admitted reader.
    // One pooled connection makes rollback/release and transaction-local reset
    // observable on the very same backend, including after late-family failures.
    const rlsReader = new Pool({ connectionString: readerUrl, max: 1, connectionTimeoutMillis: 5000 });
    pools.push(rlsReader);
    const backend = (await rlsReader.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const rlsResults: unknown[] = [];
    evidence.rls = rlsResults;
    const rejectRls = async (family: string, policy: string | null, account = scope.account) => {
      const captureScope = { ...scope, account };
      const supported = await readLegacySource(rlsReader, captureScope);
      const unchanged = await snapshot();
      await owner.query(`ALTER TABLE public."${family}" ENABLE ROW LEVEL SECURITY`);
      try {
        if (policy !== null) await owner.query(`CREATE POLICY correction_visibility ON public."${family}" FOR SELECT TO trainer2_legacy_reader USING (${policy})`);
        const queries: string[] = [];
        let released = false;
        const observed = { connect: async () => {
          const c = await rlsReader.connect(), query = c.query.bind(c), release = c.release.bind(c);
          c.query = (async (sql: string, values?: unknown[]) => {
            queries.push(sql);
            return query(sql, values);
          }) as typeof c.query;
          c.release = () => { c.query = query; released = true; release(); };
          return c;
        } };
        let comparison: ReturnType<typeof compareSourceCaptures> | undefined;
        let failure: { code?: string; message?: string } | undefined;
        await assert.rejects(async () => {
          const partial = await readLegacySource(observed, captureScope);
          comparison = compareSourceCaptures(supported, partial);
        }, (error: { code?: string; message?: string }) => {
          failure = error;
          return error.code === "42501" && error.message === `query would be affected by row-level security policy for table "${family}"`;
        });
        assert.equal(comparison, undefined, "failed capture cannot produce a disappearance comparison");
        assert.equal(queries.at(-1), "ROLLBACK");
        assert(released);
        assert.equal(rlsReader.idleCount, 1);
        const reset = (await rlsReader.query("SELECT pg_backend_pid() AS pid, current_setting('row_security') AS security")).rows[0];
        assert.equal(reset.pid, backend);
        assert.equal(reset.security, "on");
        const activity = (await owner.query("SELECT state FROM pg_stat_activity WHERE pid=$1", [backend])).rows[0];
        assert.equal(activity.state, "idle");
        const rejectedCli = spawnSync(process.execPath, [...cliArgs.slice(0, -3), account, "--source-system", scope.system], { env: cliEnv, encoding: "utf8", windowsHide: true });
        assert.equal(rejectedCli.status, 1);
        assert.equal(rejectedCli.stdout, "");
        assert.match(rejectedCli.stderr, /^LEGACY_SOURCE_CAPTURE_FAILED:/);
        assert.deepEqual(await snapshot(), unchanged);
        rlsResults.push({ family, policy, account, code: failure?.code, message: failure?.message, failedQuery: queries.at(-2), rollback: true, released, sameBackend: true, rowSecurityReset: reset.security, backendState: activity.state, comparison: "not produced", cli: { status: rejectedCli.status, stdout: rejectedCli.stdout, stderr: scrub(rejectedCli.stderr) } });
      } finally {
        if (policy !== null) await owner.query(`DROP POLICY correction_visibility ON public."${family}"`);
        await owner.query(`ALTER TABLE public."${family}" DISABLE ROW LEVEL SECURITY`);
      }
      const recovered = await readLegacySource(rlsReader, captureScope);
      assert.equal(recovered.sourceHash, supported.sourceHash);
      assert.deepEqual(discrepancyReport(recovered), discrepancyReport(supported));
      assert.deepEqual(compareSourceCaptures(supported, recovered).disappeared, []);
      assert.deepEqual(await snapshot(), unchanged);
    };
    await rejectRls("Workout", "id <> 'session-A'");
    await rejectRls("SetLog", "id <> 'log-A'");
    // WorkoutExercise is both a captured child and an owner-path relation.
    await rejectRls("WorkoutExercise", "id <> 'position-A'");
    await rejectRls("Workout", "id <> 'session-A'", "empty-account");
    for (const q of legacyQueries) await rejectRls(q.family, null);
    passed("RLS: review Workout policy, child and owner-path filtering, empty account and default-deny for all 25 families reject with PostgreSQL 42501; every CLI emits no stdout; no comparison; same-backend rollback/release/reset and supported recovery; all table records unchanged");
    await owner.query(`INSERT INTO "Workout" (id,"userId","scheduledDate") SELECT 'bounded-'||i, 'legacy-A', '2026-01-01'::timestamp FROM generate_series(1,$1) i`, [legacyCaptureLimits.perFamily]);
    await assert.rejects(readLegacySource(reader, scope), /FAMILY_LIMIT:Workout/);
    passed("bounded capture fails closed without returning partial coverage");
    // Resource overflow is intentionally a failure at the developer CLI too.
    const overflow = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/capture-trainer2-legacy-source.ts", "--confirm-disposable", "--account", "legacy-A", "--source-system", "synthetic-cli"], { env: cliEnv, encoding: "utf8", windowsHide: true });
    assert.equal(overflow.status, 1); assert.equal(overflow.stdout, "");
    const fixture = JSON.parse(readFileSync(resolve("src/lib/legacy-history/fixtures/source-matrix.json"), "utf8"));
    const example = captureSource(fixture, { batchId: "synthetic-example-v1", capturedAt: "2026-09-10T12:00:00Z", databaseSnapshot: null });
    writeFileSync(resolve(output, "example-capture.json"), JSON.stringify(example, null, 2));
    writeFileSync(resolve(output, "example-report.json"), JSON.stringify(discrepancyReport(example), null, 2));
    writeFileSync(resolve(output, "example-report.md"), renderSourceReport(example));
    evidence.sourceAfter = verificationSource();
    assert.equal(source.manifestHash, (evidence.sourceAfter as typeof source).manifestHash);
    evidence.status = "passed";
  } catch (error) { evidence.error = scrub(error instanceof Error ? error.stack ?? error.message : String(error)); throw error; }
  finally {
    // Independent cleanup: a failing resource release cannot skip our container.
    evidence.poolCleanup = await Promise.allSettled(pools.map(p => p.end()));
    const cleanup = spawnSync("docker", ["rm", "-f", container], { windowsHide: true, encoding: "utf8" });
    evidence.containerCleanup = { status: cleanup.status, stdout: cleanup.stdout, stderr: cleanup.stderr };
    if (cleanup.status !== 0) evidence.status = "failed-cleanup";
    writeFileSync(resolve(output, "verification.json"), JSON.stringify({ ...evidence, status: evidence.status ?? "failed", results, commands, commandsHash: sourceHash(commands), finished: new Date().toISOString() }, null, 2));
  }
}
