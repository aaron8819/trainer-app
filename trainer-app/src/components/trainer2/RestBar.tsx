'use client';
import { useEffect, useState } from 'react';
import { readRest, restRemaining, type RestState } from './rest-state';

export function RestBar({ storageKey, state, onChange }: { storageKey: string; state: RestState | null; onChange: (state: RestState | null) => void }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick(); const interval = setInterval(tick, 500);
    const sync = (event: StorageEvent) => { if (event.key === storageKey) onChange(readRest(event.newValue)); };
    window.addEventListener('storage', sync); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', tick); };
  }, [storageKey, onChange]);
  if (!state || !now || !restRemaining(state, now)) return <div aria-hidden="true" className="h-[72px]" />;
  const remaining = restRemaining(state, now);
  function adjust(delta: number, at: number) {
    if (!state) return;
    const deadline = Math.max(at, state.deadline + delta);
    const next = { ...state, deadline, duration: Math.max(state.duration, deadline - state.recordedAt) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Advisory timer remains usable in memory. */ }
    onChange(next);
  }
  return <aside aria-label="Rest timer" className="flex h-[72px] flex-col justify-between overflow-hidden rounded-xl bg-slate-900 text-white">
    <div className="flex items-center justify-between gap-3 px-3 py-2"><div><span className="mr-3 text-xs text-slate-300">Rest</span><span className="text-2xl font-semibold tabular-nums" aria-label="Rest remaining">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></div>
      <div className="flex shrink-0 gap-2">{[-30000, 30000].map(delta => <button type="button" className="h-11 w-11 rounded-full border border-slate-500 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400" aria-label={delta > 0 ? '+30 seconds' : '−30 seconds'} key={delta} onClick={() => adjust(delta, Date.now())}>{delta > 0 ? '+30' : '−30'}</button>)}<button type="button" aria-label="Dismiss rest timer" className="h-11 w-11 rounded-full text-lg focus-visible:outline-2 focus-visible:outline-emerald-400" onClick={() => adjust(-Number.MAX_SAFE_INTEGER, Date.now())}>×</button></div></div>
    <div className="h-1 bg-slate-700"><div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, remaining * 100000 / state.duration)}%` }} /></div>
  </aside>;
}
