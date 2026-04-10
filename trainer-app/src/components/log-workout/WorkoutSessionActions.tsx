"use client";

import { useState } from "react";
import Link from "next/link";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";

type WorkoutSessionActionsProps = {
  loggedCount: number;
  totalSets: number;
  completed: boolean;
  skipped: boolean;
  showFinishBar: boolean;
  finishActionLabel?: string;
  showSkipOptions: boolean;
  skipReason: string;
  sessionActionPending: boolean;
  onFinish: () => void;
  onLeaveForNow: () => void;
  onToggleSkipOptions: () => void;
  onSkipReasonChange: (value: string) => void;
  onConfirmSkip: () => void;
};

export function WorkoutSessionActions({
  loggedCount,
  totalSets,
  completed,
  skipped,
  showFinishBar,
  finishActionLabel = "Finish workout",
  showSkipOptions,
  skipReason,
  sessionActionPending,
  onFinish,
  onLeaveForNow,
  onToggleSkipOptions,
  onSkipReasonChange,
  onConfirmSkip,
}: WorkoutSessionActionsProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const canLeaveForNow = loggedCount > 0;

  if (skipped) {
    return (
      <div className="text-sm text-slate-600">
        <Link className="font-semibold text-slate-900" href="/">
          Generate a replacement session
        </Link>
      </div>
    );
  }

  if (completed) {
    return null;
  }

  return (
    <>
      {!showFinishBar ? (
        <div className="flex flex-wrap justify-center gap-3">
          {canLeaveForNow ? (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700 disabled:opacity-60"
              onClick={onLeaveForNow}
              disabled={sessionActionPending}
              type="button"
            >
              Leave for now
            </button>
          ) : null}
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700 disabled:opacity-60"
            onClick={() => setOptionsOpen(true)}
            disabled={sessionActionPending}
            type="button"
          >
            ... Workout options
          </button>
        </div>
      ) : null}

      <SlideUpSheet isOpen={optionsOpen} onClose={() => setOptionsOpen(false)} title="Workout options">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {loggedCount}/{totalSets} sets logged. Skip controls live here so logging stays primary.
          </p>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-rose-300 px-6 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
              onClick={onToggleSkipOptions}
              disabled={sessionActionPending}
              type="button"
            >
              {showSkipOptions ? "Hide skip option" : "Skip workout"}
            </button>
            {showSkipOptions ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-slate-500">
                  Skip reason (optional)
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                    placeholder="Travel, low energy, time constraints"
                    value={skipReason}
                    onChange={(event) => onSkipReasonChange(event.target.value)}
                  />
                </label>
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  onClick={() => {
                    setOptionsOpen(false);
                    onConfirmSkip();
                  }}
                  disabled={sessionActionPending}
                  type="button"
                >
                  Confirm skip workout
                </button>
                <p className="text-[11px] text-rose-700">
                  Skipping will not count this session toward progression.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-rose-700">
                Skipping ends the session and excludes it from progression.
              </p>
            )}
          </div>
        </div>
      </SlideUpSheet>

      {showFinishBar ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          {canLeaveForNow ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto sm:px-5"
              onClick={onLeaveForNow}
              disabled={sessionActionPending}
              type="button"
            >
              Leave for now
            </button>
          ) : null}
          <button
            className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white disabled:opacity-60"
            onClick={onFinish}
            disabled={sessionActionPending}
            type="button"
          >
            {finishActionLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}
