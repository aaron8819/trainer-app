'use client';
import { useState } from 'react';
import type { InstructionCommand, InstructionSnapshot, RestrictionIssue } from '@/lib/trainer2-contracts/activation';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { catalog } from '@/lib/engine/trainer2/catalog';
import { control } from './DraftEditor';

export function Instructions({ snapshot, issues, planId, revisionId, document, disabled, onCommand }: {
  snapshot: InstructionSnapshot; issues: RestrictionIssue[]; planId: string; revisionId: string; document: DraftDocument; disabled: boolean;
  onCommand: (intent: InstructionCommand['intent']) => void;
}) {
  const [exercise, setExercise] = useState(catalog[0].id);
  const [accountScope, setAccountScope] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState('');
  return <div className="space-y-3 border-t border-slate-200 pt-4">
    <h3 className="font-semibold">Exercise exclusions</h3>
    <p className="text-sm text-slate-600">These are your explicit instructions. Custom exercises need your decision when their relationship to an exclusion is unknown.</p>
    {snapshot.document.restrictions.filter(r => !r.cleared && (!r.planId || r.planId === planId)).map(r => <div key={r.revisionId} className="flex flex-wrap items-center gap-2 text-sm"><span>{r.instruction} · {r.planId ? 'This plan' : 'All plans'}</span><button disabled={disabled} className={control} onClick={() => onCommand({ operation: 'ClearRestriction', restrictionRevisionId: r.revisionId, newRevisionId: crypto.randomUUID() })}>Clear exclusion</button></div>)}
    <details onToggle={event => setAdding(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Add an exercise exclusion</summary>{adding && <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="min-w-0 text-sm">Exercise<select aria-label="Excluded exercise" className={`${control} block w-full max-w-xs`} disabled={disabled} value={exercise} onChange={e => setExercise(e.target.value)}>{catalog.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="text-sm"><input type="checkbox" disabled={disabled} checked={accountScope} onChange={e => setAccountScope(e.target.checked)} /> Apply to all my plans</label>
      <button className={control} disabled={disabled} onClick={() => onCommand({ operation: 'AddRestriction', restriction: { id: crypto.randomUUID(), revisionId: crypto.randomUUID(), catalogId: exercise,
        instruction: `Exclude ${catalog.find(e => e.id === exercise)!.name}`, planId: accountScope ? null : planId, from: new Date().toISOString(), until: null, cleared: false } })}>Add exclusion</button>
    </div>}</details>
    {issues.length > 0 && <div className="space-y-3 rounded-lg bg-amber-50 p-3"><p className="font-medium">Resolve these exclusions</p>
      <label className="block text-sm">Reason for an exception<input aria-label="Reason for an exception" className={`${control} mt-1 block w-full`} disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>
      {issues.map(i => { const r = snapshot.document.restrictions.find(r => r.revisionId === i.restrictionRevisionId)!;
        const position = document.occurrences.flatMap(o => o.positions).find(p => p.id === i.positionId)!;
        return <div key={`${i.restrictionRevisionId}:${i.positionId}`} className="space-y-2 border-t border-amber-200 pt-2"><p className="text-sm">{i.message}</p><button className={control} disabled={disabled || !reason.trim()} onClick={() => onCommand({ operation: 'AddScopedException', exception: {
          id: crypto.randomUUID(), restrictionRevisionId: r.revisionId, planId, planRevisionId: revisionId, positionIds: [position.id], reason: reason.trim(), from: new Date().toISOString(), until: r.until,
        } })}>Allow this exercise in this workout</button></div>;
      })}
    </div>}
  </div>;
}
