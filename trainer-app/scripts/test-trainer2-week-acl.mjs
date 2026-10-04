import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import sourceModule from './trainer2/verification-source.ts';
const {verificationSource}=sourceModule;
import cleanupModule from './trainer2/disposable-cleanup.ts';
const {runCleanupCommand}=cleanupModule;
import environmentModule from './trainer2/auth-web-environment.ts';
const {authWebPlatformEnvironment}=environmentModule;
import preflightModule from '../src/lib/operations/test-environment-preflight.ts';
const {parseExactDisposableConfirmationArgs}=preflightModule;

assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid, 'Expected exactly --confirm-disposable');
const owner=randomUUID(), name='trainer2-week-acl-'+owner.slice(0,8), password=randomUUID();
const artifact=resolve('artifacts/trainer2/corrections'); mkdirSync(artifact,{recursive:true});
const report={source:verificationSource(),container:name,owner,checks:[],cleanup:[],status:'incomplete'};
let pool, created=false;
const run=async(file,args,env,timeout=120_000)=>{
  const result=await runCleanupCommand(file,args,timeout,env);
  assert.equal(result.status,0,(result.error??result.stderr).replaceAll(password,'[secret]')); return result.stdout.trim();
};
const helpers=['trainer2_current_week_eligible(text,uuid,jsonb,text)','trainer2_authored_weeks(jsonb)','trainer2_week_guard()','trainer2_week_seal()'];
try {
  await run('docker',['run','--pull=never','--rm','-d','--name',name,'--label','trainer2.week-acl.owner='+owner,'-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=trainer2_disposable_week_acl','-p','127.0.0.1::5432','postgres:17-alpine']);created=true;
  for(let i=0;i<60;i++) { if((await runCleanupCommand('docker',['exec',name,'pg_isready','-U','postgres'],5000)).status===0)break; await new Promise(r=>setTimeout(r,500)); }
  const port=(await run('docker',['port',name,'5432/tcp'])).split(':').at(-1);
  const url='postgresql://postgres:'+password+'@127.0.0.1:'+port+'/trainer2_disposable_week_acl';
  pool=new pg.Pool({connectionString:url});
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE trainer2_unrelated; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  const env={...authWebPlatformEnvironment(process.env),NODE_ENV:'test',DATABASE_URL:url,DIRECT_URL:url};
  await run(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],env);
  await run(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],env);
  report.checks.push('Fresh complete migration chain and repeated deploy');
  for(const helper of helpers) {
    const row=(await pool.query('SELECT prosecdef,proacl::text FROM pg_proc WHERE oid=$1::regprocedure',['public.'+helper])).rows[0];
    assert.equal(row.prosecdef,false);assert(!/(^|[,{])=/.test(row.proacl));
    for(const role of ['anon','authenticated','service_role','trainer2_unrelated'])assert.equal((await pool.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,'public.'+helper])).rows[0].ok,false);
  }
  for(const role of ['anon','authenticated','service_role','trainer2_unrelated'])assert.equal((await pool.query('SELECT has_table_privilege($1,\'"Trainer2WeekAdvance"\',\'SELECT,INSERT,UPDATE,DELETE\') ok',[role])).rows[0].ok,false);
  report.checks.push('New helpers invoker; explicit PUBLIC/provider/default-privilege denial before grants');
  await pool.query('BEGIN;'+readFileSync('prisma/trainer2-runtime-grants.sql','utf8')+'COMMIT;');
  for(const role of ['anon','authenticated','service_role','trainer2_unrelated']) {
    assert.equal((await pool.query("SELECT count(*)::int n FROM pg_class WHERE relname LIKE 'Trainer2%' AND relkind='r' AND has_table_privilege($1,oid,'SELECT,INSERT,UPDATE,DELETE')",[role])).rows[0].n,0);
    for(const helper of helpers)assert.equal((await pool.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,'public.'+helper])).rows[0].ok,false);
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_class WHERE relname LIKE 'Trainer2%' AND relkind='r' AND NOT relrowsecurity")).rows[0].n,0);
  for(const role of ['trainer2_draft_reader','trainer2_identity_runtime'])for(const helper of helpers)assert.equal((await pool.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,'public.'+helper])).rows[0].ok,false);
  for(const helper of helpers.slice(0,2))assert.equal((await pool.query("SELECT has_function_privilege('trainer2_draft_runtime',$1,'EXECUTE') ok",['public.'+helper])).rows[0].ok,true);
  for(const helper of helpers.slice(2))assert.equal((await pool.query("SELECT has_function_privilege('trainer2_draft_runtime',$1,'EXECUTE') ok",['public.'+helper])).rows[0].ok,false);
  report.checks.push('Fresh full grants, all Trainer2 RLS, provider/PUBLIC denial and restricted helper boundary');
  for(const role of ['anon','authenticated','service_role','trainer2_unrelated','trainer2_draft_reader','trainer2_identity_runtime']) {
    const client=await pool.connect();
    try {
      await client.query('SET ROLE '+role);
      await assert.rejects(client.query("SELECT trainer2_authored_weeks('{\"occurrences\":[]}'::jsonb)"),e=>e.code==='42501');
      if(role!=='trainer2_draft_reader')await assert.rejects(client.query('SELECT * FROM "Trainer2WeekAdvance"'),e=>e.code==='42501');
    } finally { await client.query('RESET ROLE');client.release(); }
  }
  report.status='passed';
} catch(error) { report.status='failed';report.firstFailure=String(error).replaceAll(password,'[secret]');process.exitCode=1; }
finally {
  await pool?.end();
  if(created)try {
    const label=await run('docker',['inspect','--format','{{ index .Config.Labels "trainer2.week-acl.owner" }}',name],undefined,5000);assert.equal(label,owner);
    await run('docker',['rm','-f',name],undefined,10_000);
    const after=await runCleanupCommand('docker',['inspect',name],5000);assert(after.status!==0&&/no such (?:container|object)/i.test(after.stderr));
    report.cleanup.push({name:'owned container absence',status:'passed'});
  } catch(error){report.cleanup.push({name:'owned container absence',status:'failed',error:String(error)});process.exitCode=1;}
  writeFileSync(resolve(artifact,'acl-fresh.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
