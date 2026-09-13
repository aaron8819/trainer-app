import { useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { progressionLabel, progressionMeaning } from '@/lib/engine/trainer2/plan-review';
import { control } from './DraftEditor';

export function Progression({ document, disabled, onChange }: { document: DraftDocument; disabled: boolean; onChange: (d: DraftDocument) => void }) {
  const [editing, setEditing] = useState(false);
  return <section id="progression" tabIndex={-1} className="scroll-mt-4 space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-4">
    <div className="flex items-center justify-between"><h2 className="font-semibold">Progression</h2><button className="text-sm underline" disabled={disabled} aria-label="Edit progression" onClick={() => setEditing(!editing)}>Edit</button></div>
    <p className="font-medium">{document.progression ? progressionLabel : 'Choose how to follow this plan'}</p>
    <p className="text-sm text-slate-700">{document.progression ? progressionMeaning : 'This saved plan has no selected progression method. Choose one explicitly; its existing prescriptions stay as authored.'}</p>
    {editing && <label className="flex flex-col gap-2 text-sm">Progression method<select className={control} disabled={disabled} value={document.progression?.mode ?? ''} onChange={e => {
      const next = structuredClone(document);
      if (e.target.value) next.progression = { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} };
      else delete next.progression;
      onChange(next);
    }}><option value="">Choose a method</option><option value="plannedPrescriptions">{progressionLabel}</option></select><span>Edit sets, reps and weekly effort in the workouts below.</span></label>}
  </section>;
}
