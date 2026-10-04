import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { advanceWeek } from './advance-week';
const mocks=vi.hoisted(()=>({source:vi.fn(),resolution:vi.fn(),tx:{trainer2AccountTrainingState:{findUniqueOrThrow:vi.fn()},
  trainer2Execution:{findFirst:vi.fn()},trainer2WeekAdvance:{create:vi.fn()},trainer2Plan:{update:vi.fn()}}}));
vi.mock('./execution',()=>({activeSource:mocks.source}));
vi.mock('./occurrence-resolution',()=>({readOccurrenceResolution:mocks.resolution}));
vi.mock('./command',async original=>({...await original<typeof import('./command')>(),acceptCommand:(_db:unknown,_principal:unknown,_input:unknown,_command:unknown,apply:(tx:unknown)=>unknown)=>apply(mocks.tx)}));
const planId=randomUUID(),revisionId=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()],stages=[randomUUID(),randomUUID()];
const command={schemaVersion:1,commandType:'AdvanceWeek',actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:'synthetic',ownershipEpoch:0,dependsOn:[],
  target:{planId},expected:{planRevisionId:revisionId,acceptedSequence:'7',weekIndex:0,firstOccurrenceId:ids[0]},intent:{}};
beforeEach(()=>{
  vi.resetAllMocks();mocks.source.mockResolvedValue({plan:{id:planId,currentWeekIndex:0},revision:{id:revisionId},intent:{occurrences:ids.map((id,i)=>({id,stageId:stages[i===2?1:0]}))}});
  mocks.tx.trainer2AccountTrainingState.findUniqueOrThrow.mockResolvedValue({acceptedSequence:BigInt(7)});
  mocks.resolution.mockResolvedValue({resolvedIds:new Set(ids.slice(0,2))});mocks.tx.trainer2Execution.findFirst.mockResolvedValue(null);
});
it.each(['revision','sequence','week','firstOccurrence'] as const)('rejects stale %s binding without cursor or fact writes',async field=>{
  const expected={...command.expected};if(field==='revision')expected.planRevisionId=randomUUID();if(field==='sequence')expected.acceptedSequence='6';if(field==='week')expected.weekIndex=1;if(field==='firstOccurrence')expected.firstOccurrenceId=ids[1];
  await expect(advanceWeek({} as never,{accountId:'synthetic',sessionId:randomUUID()},{...command,expected})).rejects.toThrow('STALE_WEEK_BINDING');
  expect(mocks.tx.trainer2WeekAdvance.create).not.toHaveBeenCalled();expect(mocks.tx.trainer2Plan.update).not.toHaveBeenCalled();
});
it.each(['unresolved','open'] as const)('rejects %s state before writing',async state=>{
  if(state==='unresolved')mocks.resolution.mockResolvedValue({resolvedIds:new Set([ids[0]])});else mocks.tx.trainer2Execution.findFirst.mockResolvedValue({id:randomUUID()});
  await expect(advanceWeek({} as never,{accountId:'synthetic',sessionId:randomUUID()},command)).rejects.toThrow(state==='open'?'OPEN_EXECUTION_CONFLICT':'WEEK_UNRESOLVED');
  expect(mocks.tx.trainer2WeekAdvance.create).not.toHaveBeenCalled();expect(mocks.tx.trainer2Plan.update).not.toHaveBeenCalled();
});
