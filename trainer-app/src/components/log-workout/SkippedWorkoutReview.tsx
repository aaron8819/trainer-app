"use client";

import Link from "next/link";

export function SkippedWorkoutReview() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <p className="font-semibold text-amber-900">Workout skipped</p>
        <p className="mt-2 text-sm text-amber-800">This workout was skipped.</p>
      </section>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="text-sm font-semibold text-slate-900">What&apos;s next</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white"
            href="/"
          >
            Generate a replacement session
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700"
            href="/"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
