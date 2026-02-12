"use client";

import { useState, type FormEvent } from "react";

type PainKey = "shoulder" | "elbow" | "low_back" | "knee" | "wrist";

type CheckInPayload = {
  readiness: number;
  painFlags: Record<PainKey, 0 | 2>;
  notes?: string;
};

type SessionCheckInFormProps = {
  onSubmit: (payload: CheckInPayload) => void;
  onSkip: () => void;
  isSubmitting?: boolean;
};

const PAIN_OPTIONS: { key: PainKey; label: string }[] = [
  { key: "shoulder", label: "Shoulder" },
  { key: "elbow", label: "Elbow" },
  { key: "low_back", label: "Low back" },
  { key: "knee", label: "Knee" },
  { key: "wrist", label: "Wrist" },
];

export default function SessionCheckInForm({
  onSubmit,
  onSkip,
  isSubmitting = false,
}: SessionCheckInFormProps) {
  const [readiness, setReadiness] = useState(3);
  const [notes, setNotes] = useState("");
  const [pain, setPain] = useState<Record<PainKey, boolean>>({
    shoulder: false,
    elbow: false,
    low_back: false,
    knee: false,
    wrist: false,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const painFlags = PAIN_OPTIONS.reduce<Record<PainKey, 0 | 2>>((acc, option) => {
      acc[option.key] = pain[option.key] ? 2 : 0;
      return acc;
    }, {} as Record<PainKey, 0 | 2>);

    onSubmit({
      readiness,
      painFlags,
      notes: notes.trim() ? notes.trim() : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-2xl border border-slate-200 p-5">
      <h3 className="text-base font-semibold text-slate-900">How are you feeling today?</h3>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">Readiness</p>
        <div className="mt-2 flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="readiness"
                value={value}
                checked={readiness === value}
                onChange={() => setReadiness(value)}
                className="sr-only"
                disabled={isSubmitting}
              />
              <span
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition ${
                  readiness === value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-700"
                }`}
              >
                {value}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">1 = rough, 5 = great</p>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">Any pain?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PAIN_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={pain[option.key]}
                onChange={(event) =>
                  setPain((prev) => ({ ...prev, [option.key]: event.target.checked }))
                }
                disabled={isSubmitting}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-sm font-semibold text-slate-700" htmlFor="checkin-notes">
          Notes (optional)
        </label>
        <textarea
          id="checkin-notes"
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Generating..." : "Generate Workout"}
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold disabled:opacity-60"
          onClick={onSkip}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Generating..." : "Skip"}
        </button>
      </div>
    </form>
  );
}
