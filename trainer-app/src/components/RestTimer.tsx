"use client";

import { useEffect, useState } from "react";

type RestTimerProps = {
  durationSeconds: number;
  onDismiss: () => void;
  onAdjust?: (deltaSeconds: number) => void;
};

export function RestTimer({ durationSeconds, onDismiss, onAdjust }: RestTimerProps) {
  const [remaining, setRemaining] = useState(durationSeconds);

  useEffect(() => {
    setRemaining(durationSeconds);
  }, [durationSeconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onDismiss();
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, onDismiss]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = durationSeconds > 0 ? remaining / durationSeconds : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rest</p>
      <p className="mt-2 text-4xl font-bold tabular-nums text-slate-900">
        {minutes}:{String(seconds).padStart(2, "0")}
      </p>
      <div className="mx-auto mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-900 transition-all duration-1000"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {onAdjust ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
            onClick={() => onAdjust(-15)}
            type="button"
          >
            -15s
          </button>
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
            onClick={() => onAdjust(15)}
            type="button"
          >
            +15s
          </button>
        </div>
      ) : null}
      <button
        className="mt-4 inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700"
        onClick={onDismiss}
        type="button"
      >
        Skip rest
      </button>
    </section>
  );
}
