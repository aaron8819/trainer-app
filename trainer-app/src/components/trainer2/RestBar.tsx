'use client';
import { useEffect, useRef, useState } from 'react';
import { readRest, restRemaining, type RestState } from './rest-state';

function RestProgress({ state, now }: { state: RestState; now: number }) {
  const [startedAt] = useState(now);
  const bar = useRef<HTMLDivElement>(null);
  const startingFraction = Math.min(1, Math.max(0, (state.deadline - startedAt) / state.duration));
  const fraction = Math.min(1, Math.max(0, (state.deadline - now) / state.duration));
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = bar.current?.animate(
      [{ transform: `scaleX(${startingFraction})` }, { transform: 'scaleX(0)' }],
      { duration: Math.max(0, state.deadline - startedAt), easing: 'linear', fill: 'forwards' },
    );
    return () => animation?.cancel();
  }, [startedAt, startingFraction, state.deadline]);
  return <div className="h-1.5 bg-slate-700" aria-hidden="true"><div ref={bar} className="h-full origin-left bg-emerald-400" style={{ transform: `scaleX(${fraction})` }} /></div>;
}

export function RestBar({ storageKey, state, onChange }: { storageKey: string; state: RestState | null; onChange: (state: RestState | null) => void }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick(); const interval = setInterval(tick, 500);
    const sync = (event: StorageEvent) => { if (event.key === storageKey) onChange(readRest(event.newValue)); };
    window.addEventListener('storage', sync); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', tick); };
  }, [storageKey, onChange]);
  if (!state || !now || !restRemaining(state, now)) return null;
  const remaining = restRemaining(state, now);
  function adjust(delta: number, at: number) {
    if (!state) return;
    const deadline = Math.max(at, state.deadline + delta);
    const next = { ...state, deadline, duration: Math.max(state.duration, deadline - state.recordedAt) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Advisory timer remains usable in memory. */ }
    onChange(next);
  }
  return <aside aria-label="Rest timer" className="sticky top-0 z-30 mb-2 flex h-[72px] flex-col overflow-hidden rounded-xl bg-slate-900 text-white shadow-sm">
    <div className="flex flex-1 items-center justify-between gap-3 px-3"><div><span className="mr-3 text-xs font-medium text-slate-300">Rest</span><span className="text-2xl font-semibold tabular-nums" aria-label="Rest remaining">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></div>
      <div className="flex shrink-0 gap-2">{[-30000, 30000].map(delta => <button type="button" className="h-11 w-11 rounded-full border border-slate-500 text-xs font-semibold hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400" aria-label={delta > 0 ? '+30 seconds' : '−30 seconds'} key={delta} onClick={() => adjust(delta, Date.now())}>{delta > 0 ? '+30' : '−30'}</button>)}<button type="button" aria-label="Dismiss rest timer" className="h-11 w-11 rounded-full text-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-emerald-400" onClick={() => adjust(-Number.MAX_SAFE_INTEGER, Date.now())}>×</button></div></div>
    <RestProgress key={`${state.event}:${state.deadline}`} state={state} now={now} />
  </aside>;
}
