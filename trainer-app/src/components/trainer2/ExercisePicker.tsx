"use client";

import { useEffect, useRef, useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { browseCatalog, catalogExercise, equipmentOptions, library, matchesCatalogSearch } from '@/lib/engine/trainer2/catalog';
import { control } from './DraftEditor';
type Exercise = DraftDocument['occurrences'][number]['positions'][number]['exercise'];
export function ExercisePicker({
  qualifiedOnly = false,
  current,
  trigger,
  fallback,
  equipment,
  choose,
  close
}: {
  qualifiedOnly?: boolean;
  current?: Exercise;
  trigger: HTMLElement;
  fallback: () => HTMLElement | null;
  equipment: string[];
  choose: (e: Exercise) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef({ trigger, fallback });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [custom, setCustom] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    const { trigger, fallback } = returnFocus.current;
    element.showModal();
    return () => {
      element.close();
      // Restore after React commits the edited row and removes the dialog.
      requestAnimationFrame(() => {
        if (element.isConnected && element.open) return;
        if (document.querySelector('dialog[open]')) return;
        const destination = trigger.isConnected && !trigger.matches(':disabled') ? trigger : fallback();
        destination?.focus();
      });
    };
  }, []);
  const results = browseCatalog(query, equipment, current).filter(e => !filter || e.equipment.includes(filter));
  const unavailable = library.filter(e => !e.selectable && matchesCatalogSearch(e, query) &&
    (!equipment.length || e.equipment.every(x => equipment.includes(x))) && (!filter || e.equipment.includes(filter)));
  return <dialog ref={dialog} onCancel={close} aria-label={current ? 'Swap exercise' : 'Add exercise'} className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-xl rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40">
    <div className="sticky top-0 z-10 space-y-3 border-b bg-white p-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">{current ? 'Swap exercise' : 'Add exercise'}</h2><button type="button" className={control} onClick={close}>Close picker</button></div>
      {current && <p className="text-sm text-slate-600">Replacing {current.name}. Compatible sets and reps stay; weight is cleared. Different movements use their own rep defaults.</p>}
      <input autoFocus aria-label="Search exercises" placeholder="Search exercises or aliases" className={`${control} w-full`} value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Filter picker equipment" className={`${control} w-full`} value={filter} onChange={e => setFilter(e.target.value)}><option value="">All available equipment</option>{equipmentOptions.map(e => <option key={e}>{e}</option>)}</select>
    </div>
    <div className="space-y-2 p-4" onKeyDown={e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-exercise]'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      e.preventDefault();
      buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}>
      {!results.length && <p role="status" className="py-6 text-slate-600">No matching exercises. Clear the search or broaden equipment preferences. Timed, distance, and unreviewed measurement variants are not included.</p>}
      {results.map(e => <button type="button" data-exercise key={e.id} className="block min-h-16 w-full rounded-xl border p-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600" onClick={() => choose(catalogExercise(e))}>
        <span className="font-medium">{e.name}</span><span className="block text-sm text-slate-500">{e.equipment.join(' + ')} · {e.repBasis === 'perSide' ? 'reps per side' : 'total reps'}{e.loadKind === 'assistance' ? ' · displayed assistance' : ''}{current?.kind === 'catalogSnapshot' && e.purpose === current.purpose ? ' · Suggested alternative' : ''}</span>
      </button>)}
      {unavailable.map(e => <div key={e.catalogId} className="rounded-xl border p-3 text-sm text-slate-500">
        <span className="font-medium">{e.name}</span><span className="block">{e.unavailableReason}</span>
      </div>)}
      {!qualifiedOnly && <details className="border-t pt-4"><summary className="cursor-pointer text-sm">Create custom exercise</summary><p className="my-2 text-sm text-slate-600">Saved as your description, with no catalog match. Review its rep and measurement details.</p><input aria-label="Custom exercise name" className={`${control} w-full`} value={custom} maxLength={200} onChange={e => setCustom(e.target.value)} /><button type="button" className={`${control} mt-2`} disabled={!custom.trim()} onClick={() => choose({
          kind: 'authoredDescription',
          name: custom.trim(),
          variation: ''
        })}>Use custom exercise</button></details>}
    </div>
  </dialog>;
}
