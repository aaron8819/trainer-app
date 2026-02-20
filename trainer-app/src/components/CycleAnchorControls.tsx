"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Action = "deload" | "extend_phase" | "skip_phase" | "reset";

const ACTION_LABELS: Record<Action, string> = {
  deload: "Take a deload",
  extend_phase: "Extend this phase (+1 wk)",
  skip_phase: "Skip ahead one week",
  reset: "Reset mesocycle",
};

const ACTION_DESCRIPTIONS: Record<Action, string> = {
  deload: "Marks the next session as a deload — lighter loads and reduced volume.",
  extend_phase: "Adds one more week to the current phase before advancing.",
  skip_phase: "Advances your session count by one full training week.",
  reset: "Resets session count to week 1. Use if you're starting fresh.",
};

export function CycleAnchorControls() {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const apply = (action: Action) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to apply action");
      } else {
        setConfirming(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adjust Cycle</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["deload", "extend_phase", "skip_phase", "reset"] as Action[]).map((action) => (
          <button
            key={action}
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-500 hover:text-slate-900 disabled:opacity-50"
            disabled={isPending}
            onClick={() => setConfirming(confirming === action ? null : action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-700">{ACTION_DESCRIPTIONS[confirming]}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
              disabled={isPending}
              onClick={() => apply(confirming)}
            >
              {isPending ? "Applying..." : "Confirm"}
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
