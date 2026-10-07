'use client';
import { useState } from 'react';
import { equipmentSetup, type DraftDocument } from '@/lib/trainer2-contracts/draft';
import { pounds } from './pound-display';

type Exercise = DraftDocument['occurrences'][number]['positions'][number]['exercise'];
type Setup = Extract<Exercise, { kind: 'catalogSnapshot' }>['equipmentSetup'];
export function EquipmentResistance({ exercise }: { exercise: Exercise }) {
  const setup = exercise.kind === 'catalogSnapshot' ? exercise.equipmentSetup : undefined;
  return setup ? <p className="break-words text-sm text-slate-600">{setup.label} · Starting resistance: {pounds(setup.startingResistance.value, setup.startingResistance.unit)} lb · separate from added plates</p> : null;
}
export function EquipmentSetupEditor({ exercise, apply }: { exercise: Exercise; apply: (setup: Setup) => void }) {
  const current = exercise.kind === 'catalogSnapshot' ? exercise.equipmentSetup : undefined;
  const [label, setLabel] = useState(current?.label ?? '');
  const [value, setValue] = useState(current ? pounds(current.startingResistance.value, current.startingResistance.unit) : '');
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  if (exercise.kind !== 'catalogSnapshot' || !['machineAddedPlatesTotal', 'machinePlatesPerArm', 'smithPlatesTotal'].includes(exercise.convention)) return null;
  return <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">Equipment starting resistance</summary>
    <p>Optional facts for this specific machine. Identify the equipment before recording its resistance. These facts never add to the plates field.</p>
    <label className="block mt-2">Equipment identifier<input className="block w-full rounded border p-2" maxLength={200} value={label} onChange={e => setLabel(e.target.value)} /></label>
    <label className="block mt-2">Starting resistance · lb<input className="block w-full rounded border p-2" inputMode="decimal" value={value} onChange={e => { setValue(e.target.value); setChanged(true); }} /></label>
    <button type="button" className="min-h-11 underline mr-4" onClick={() => {
      const parsed = equipmentSetup.safeParse({ label, startingResistance: !changed && current ? current.startingResistance : { value, unit: 'lb' } });
      if (!parsed.success) { setError('Identify the equipment and enter a valid starting resistance, including zero.'); return; }
      apply(parsed.data); setError(''); setChanged(false);
    }}>Apply equipment details</button>
    <button type="button" className="min-h-11 underline" onClick={() => { apply(undefined); setLabel(''); setValue(''); setChanged(false); setError(''); }}>Remove equipment details</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
