'use client';
import { useEffect, useState } from 'react';
import styles from './Logger.module.css';
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
  if (!state || !now || !restRemaining(state, now)) return null;
  const remaining = restRemaining(state, now);
  function adjust(delta: number, at: number) {
    if (!state) return;
    const deadline = Math.max(at, state.deadline + delta);
    const next = { ...state, deadline, duration: Math.max(state.duration, deadline - state.recordedAt) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Advisory timer remains usable in memory. */ }
    onChange(next);
  }
  return <aside aria-label="Rest timer" className={styles.timer}>
    <div className={styles.timerContent}><div className={styles.timerReadout}><svg className={styles.timerIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2h4M12 2v3M18.5 6.5l1-1" /><circle cx="12" cy="14" r="8" /><path d="M12 9v5l3-2" /></svg><div><span className={styles.timerLabel}>Rest timer</span><span className={styles.time} aria-label="Rest remaining">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></div></div>
      <div className={styles.timerControls}>{[-30000, 30000].map(delta => <button type="button" className="h-11 w-11 rounded-full border border-slate-500 text-xs font-semibold hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400" aria-label={delta > 0 ? '+30 seconds' : '−30 seconds'} key={delta} onClick={() => adjust(delta, Date.now())}>{delta > 0 ? '+30' : '−30'}</button>)}<button type="button" aria-label="Dismiss rest timer" className={styles.dismiss} onClick={() => adjust(-Number.MAX_SAFE_INTEGER, Date.now())}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div></div>
  </aside>;
}
