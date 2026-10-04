import { beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runCleanupCommand } from '../../../scripts/trainer2/disposable-cleanup';
import { authWebPlatformEnvironment } from '../../../scripts/trainer2/auth-web-environment';
import { resolve } from 'node:path';
import { prepareCurrentWeekRelease } from '../../../scripts/trainer2/prepare-current-week-release';
import { createHypertrophyPlan } from '../engine/trainer2/plan-builder';
import { nextWorkoutRead, startOccurrenceCommand } from './execution';
import { skipOccurrenceCommand } from './skip-occurrence';
import { canonicalJson } from './canonical-json';

const occurrences=createHypertrophyPlan().occurrences.slice(0,2);
const old={accountId:'synthetic-older-reader',planId:randomUUID(),revisionId:randomUUID(),acceptedSequence:'2',instructionEpoch:0,lifecycle:'Active',
  occurrence:occurrences[0],execution:null,occurrences:occurrences.map(o=>({occurrenceId:o.id,name:o.name,stageName:'Week 1',status:'Pending',skip:null}))};
const envelope={schemaVersion:1,actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:old.accountId,ownershipEpoch:0,dependsOn:[],target:{planId:old.planId,occurrenceId:occurrences[0].id},intent:{}};
const start={...envelope,commandType:'StartOccurrence',expected:{planRevisionId:old.revisionId,instructionEpoch:0}};
const skip={...envelope,actionId:randomUUID(),commandType:'SkipOccurrence',expected:{planRevisionId:old.revisionId,acceptedSequence:'2'}};
const ready={...old,occurrence:null,eligibleOccurrenceIds:[],occurrences:old.occurrences.map(o=>({...o,status:'Finished'})),
  week:{index:0,firstOccurrenceId:occurrences[0].id,occurrenceIds:occurrences.map(o=>o.id),ready:true,final:false}};
const stripped={...ready,week:undefined,eligibleOccurrenceIds:undefined};
let released: {old:{success:boolean};newer:{success:boolean;error?:{issues:{code:string}[]}};stripped:{success:boolean};start:unknown;skip:unknown};
beforeAll(async()=>{
  await prepareCurrentWeekRelease();
  const directory=resolve('../.verification/released-source/trainer-app/src/lib/trainer2-contracts');
  const code=`const x=require(${JSON.stringify(resolve(directory,'execution.ts'))}),s=require(${JSON.stringify(resolve(directory,'skip-occurrence.ts'))});
    const parse=(schema,input)=>{const r=schema.safeParse(input);return r.success?{success:true}:{success:false,error:{issues:r.error.issues}}};
    console.log(JSON.stringify({old:parse(x.nextWorkoutRead,${JSON.stringify(old)}),newer:parse(x.nextWorkoutRead,${JSON.stringify({...old,eligibleOccurrenceIds:occurrences.map(o=>o.id)})}),
    stripped:parse(x.nextWorkoutRead,${JSON.stringify(stripped)}),start:x.startOccurrenceCommand.parse(${JSON.stringify(start)}),skip:s.skipOccurrenceCommand.parse(${JSON.stringify(skip)})}));`;
  const result=await runCleanupCommand(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),'-e',code],120_000,{...authWebPlatformEnvironment(process.env),NODE_ENV:'test'});
  expect(result.status,result.error??result.stderr).toBe(0);released=JSON.parse(result.stdout);
},120_000);
it('proves the exact released strict reader rejects new-server fields while the new reader accepts old responses',()=>{
  expect(released.old.success).toBe(true);expect(nextWorkoutRead.safeParse(old).success).toBe(true);
  expect(released.newer.success).toBe(false);expect(released.newer.error?.issues.some(i=>i.code==='unrecognized_keys')).toBe(true);
  expect(nextWorkoutRead.safeParse({...old,eligibleOccurrenceIds:occurrences.map(o=>o.id),unexpected:true}).success).toBe(false);
});
it('demonstrates that stripping new keys cannot represent a completed week awaiting Continue',()=>{
  expect(nextWorkoutRead.safeParse(ready).success).toBe(true);expect(released.stripped.success).toBe(false);
});
it('retains exact released pending Start and Skip envelopes for recovery after refresh',()=>{
  expect(canonicalJson(startOccurrenceCommand.parse(start))).toBe(canonicalJson(released.start));
  expect(canonicalJson(skipOccurrenceCommand.parse(skip))).toBe(canonicalJson(released.skip));
});
