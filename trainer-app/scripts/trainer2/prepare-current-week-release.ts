import { mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runCleanupCommand } from './disposable-cleanup';
import { authWebPlatformEnvironment } from './auth-web-environment';

// Keep released source and its separately generated client outside the app's
// TypeScript inputs. The exact released reader is also used by compatibility probes.
export async function prepareCurrentWeekRelease() {
  const base='d9dcfad5ce87769635469929c2f60241db23163a', directory=resolve('../.verification');
  mkdirSync(resolve(directory,'released-source'),{recursive:true});
  mkdirSync(resolve(directory,'released-schema'),{recursive:true});
  writeFileSync(resolve(directory,'.gitignore'),'*\n');
  const run=async(file:string,args:string[])=>{
    const result=await runCleanupCommand(file,args,120_000,{...authWebPlatformEnvironment(process.env),NODE_ENV:'test'});
    assert.equal(result.status,0,result.error??result.stderr);return result.stdout;
  };
  await run('git',['-C',resolve('..'),'archive','--format=tar','--output='+resolve(directory,'released-source.tar'),base,'trainer-app/src','trainer-app/prisma']);
  await run('tar',['-xf',resolve(directory,'released-source.tar'),'-C',resolve(directory,'released-source')]);
  for(const link of [resolve(directory,'node_modules'),resolve(directory,'released-source/trainer-app/node_modules')])
    if(!existsSync(link))symlinkSync(resolve('node_modules'),link,'junction');
  const schema=(await run('git',['show',base+':trainer-app/prisma/schema.prisma']))
    .replace('provider = "prisma-client-js"','provider = "prisma-client-js"\n  output = "../released-client"');
  assert(schema.includes('output = "../released-client"'));
  writeFileSync(resolve(directory,'released-schema/schema.prisma'),schema);
  await run(process.execPath,[resolve('node_modules/prisma/build/index.js'),'generate','--schema',resolve(directory,'released-schema/schema.prisma')]);
  await run(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),'-e',`const x=require(${JSON.stringify(resolve(directory,'released-source/trainer-app/src/lib/api/trainer2/execution.ts'))});require('node:assert/strict').equal(typeof x.startOccurrence,'function');`]);
}
