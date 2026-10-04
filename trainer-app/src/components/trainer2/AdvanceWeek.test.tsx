import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { AdvanceWeek } from './AdvanceWeek';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import type { AdvanceWeekCommand } from '@/lib/trainer2-contracts/advance-week';

const occurrence=createHypertrophyPlan().occurrences[0];
const next: NextWorkoutRead={accountId:'synthetic-advance',planId:randomUUID(),revisionId:randomUUID(),acceptedSequence:'2',instructionEpoch:0,
  lifecycle:'Active',occurrence:null,execution:null,eligibleOccurrenceIds:[],
  week:{index:0,firstOccurrenceId:occurrence.id,occurrenceIds:[occurrence.id],ready:true,final:false},
  occurrences:[{occurrenceId:occurrence.id,name:occurrence.name,stageName:'Week 1',status:'Finished',skip:null}]};
const key=`trainer2-advance:${next.accountId}:${next.planId}`;
const updated: NextWorkoutRead={...next,acceptedSequence:'3',week:{...next.week!,index:1}};
const props={next,ownershipEpoch:0,blocked:false,refresh:vi.fn(),onLock:vi.fn()};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
function accepted(body:string,final=false) {
  const command: AdvanceWeekCommand=JSON.parse(body);
  return {replayed:true,outcomeCursor:'3',outcome:{status:'Accepted',commandType:'AdvanceWeek',actionId:command.actionId,acceptedSequence:'3',
    result:{planId:command.target.planId,revisionId:command.expected.planRevisionId,fromWeek:0,toWeek:final?0:1,planCompleted:final}}};
}
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requires deliberate continue and binds the exact authoritative week',async()=>{
  const fetch=vi.fn((_url,init)=>Promise.resolve(response(accepted(init.body))));vi.stubGlobal('fetch',fetch);props.refresh.mockResolvedValue(updated);
  render(<AdvanceWeek {...props}/>);const button=await screen.findByRole('button',{name:'Continue to next week'});
  await waitFor(()=>expect(button).toBeEnabled());expect(fetch).not.toHaveBeenCalled();fireEvent.click(button);
  await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());
  expect(JSON.parse(fetch.mock.calls[0][1].body).expected).toEqual({planRevisionId:next.revisionId,acceptedSequence:'2',weekIndex:0,firstOccurrenceId:occurrence.id});
});
it('retains lost delivery across reload and retries the original identity after a later week read',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new TypeError('lost')).mockImplementation((_url,init)=>Promise.resolve(response(accepted(init.body))));vi.stubGlobal('fetch',fetch);
  const view=render(<AdvanceWeek {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Continue to next week'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check continue again'})).toBeEnabled());const exact=sessionStorage.getItem(key)!;
  view.unmount();props.refresh.mockResolvedValue({...updated,acceptedSequence:'8',week:{...updated.week!,index:2}});
  render(<AdvanceWeek {...props} next={{...updated,acceptedSequence:'8',week:{...updated.week!,index:2}}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Check continue again'}));await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());
  expect(fetch.mock.calls[1][1].body).toBe(exact);
});
it('retains acceptance until authoritative readback succeeds',async()=>{
  vi.stubGlobal('fetch',vi.fn((_url,init)=>Promise.resolve(response(accepted(init.body)))));props.refresh.mockResolvedValue(next);
  render(<AdvanceWeek {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Continue to next week'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check continue again'})).toBeEnabled());expect(sessionStorage.getItem(key)).not.toBeNull();
});
it.each(['blocked','unresolved','completed'] as const)('does not submit for %s state',async kind=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const value={...next,...(kind==='completed'?{lifecycle:'Completed' as const}:{}),week:{...next.week!,ready:kind!=='unresolved'}};
  render(<AdvanceWeek {...props} next={value} blocked={kind==='blocked'}/>);
  await waitFor(()=>expect(props.onLock).toHaveBeenCalledWith(false));
  const button=screen.queryByRole('button',{name:'Continue to next week'});if(button)expect(button).toBeDisabled();expect(fetch).not.toHaveBeenCalled();
});
it('completes the final program week without inventing a next week',async()=>{
  vi.stubGlobal('fetch',vi.fn((_url,init)=>Promise.resolve(response(accepted(init.body,true)))));props.refresh.mockResolvedValue({...next,acceptedSequence:'3',lifecycle:'Completed'});
  render(<AdvanceWeek {...props} next={{...next,week:{...next.week!,final:true}}}/>);fireEvent.click(await screen.findByRole('button',{name:'Complete program'}));
  await screen.findByText('Program complete.');expect(sessionStorage.getItem(key)).toBeNull();
});
