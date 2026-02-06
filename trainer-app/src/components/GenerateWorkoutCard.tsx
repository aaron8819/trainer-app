"use client";

import { useState } from "react";
import Link from "next/link";
import SessionCheckInForm from "@/components/SessionCheckInForm";

type WorkoutSet = {
  setIndex: number;
  targetReps: number;
  targetRpe?: number;
  targetLoad?: number;
  restSeconds?: number;
};

type WorkoutExercise = {
  id: string;
  orderIndex: number;
  isMainLift: boolean;
  exercise: { id: string; name: string };
  sets: WorkoutSet[];
};

type WorkoutPlan = {
  id: string;
  scheduledDate: string;
  warmup: WorkoutExercise[];
  mainLifts: WorkoutExercise[];
  accessories: WorkoutExercise[];
  estimatedMinutes: number;
  notes?: string;
};

type SessionCheckInPayload = {
  readiness: number;
  painFlags: Record<"shoulder" | "elbow" | "low_back" | "knee" | "wrist", 0 | 2>;
  notes?: string;
};

type SavePayload = {
  workoutId: string;
  scheduledDate?: string;
  estimatedMinutes?: number;
  selectionMode?: "AUTO" | "MANUAL" | "BONUS";
  forcedSplit?: "PUSH" | "PULL" | "LEGS" | "UPPER" | "LOWER" | "FULL_BODY";
  advancesSplit?: boolean;
  exercises: {
    section?: "WARMUP" | "MAIN" | "ACCESSORY";
    exerciseId: string;
    sets: WorkoutSet[];
  }[];
};

export default function GenerateWorkoutCard({
  nextAutoLabel,
  queuePreview,
}: {
  nextAutoLabel?: string;
  queuePreview?: string;
}) {
  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"AUTO" | "MANUAL" | "BONUS">("AUTO");
  const [forcedSplit, setForcedSplit] = useState<"PUSH" | "PULL" | "LEGS">("PUSH");
  const [advanceSplit, setAdvanceSplit] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);

  const buildGeneratePayload = () => {
    const shouldAdvance =
      selectionMode === "AUTO" ? true : selectionMode === "BONUS" ? false : advanceSplit;
    return selectionMode === "AUTO"
      ? { selectionMode: "AUTO" as const, advancesSplit: shouldAdvance }
      : {
          selectionMode,
          forcedSplit,
          advancesSplit: shouldAdvance,
        };
  };

  const generateWorkout = async () => {
    const bodyPayload = buildGeneratePayload();
    const response = await fetch("/api/workouts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate workout");
      return false;
    }

    const body = await response.json();
    setWorkout(body.workout as WorkoutPlan);
    return true;
  };

  const handleGenerateClick = () => {
    setError(null);
    setSavedId(null);
    setWorkout(null);
    setShowCheckIn(true);
  };

  const handleCheckInSubmit = async (payload: SessionCheckInPayload) => {
    setLoading(true);
    setError(null);
    setSavedId(null);

    const response = await fetch("/api/session-checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save check-in");
      setLoading(false);
      return;
    }

    const generated = await generateWorkout();
    setLoading(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleCheckInSkip = async () => {
    setLoading(true);
    setError(null);
    setSavedId(null);

    const generated = await generateWorkout();
    setLoading(false);
    if (generated) {
      setShowCheckIn(false);
    }
  };

  const handleSave = async () => {
    if (!workout) {
      return;
    }

    setSaving(true);
    setError(null);

    const payload: SavePayload = {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode,
      forcedSplit: selectionMode === "AUTO" ? undefined : forcedSplit,
      advancesSplit:
        selectionMode === "AUTO" ? true : selectionMode === "BONUS" ? false : advanceSplit,
      exercises: [
        ...workout.warmup.map((exercise) => ({ ...exercise, section: "WARMUP" as const })),
        ...workout.mainLifts.map((exercise) => ({ ...exercise, section: "MAIN" as const })),
        ...workout.accessories.map((exercise) => ({ ...exercise, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: (exercise as { section: "WARMUP" | "MAIN" | "ACCESSORY" }).section,
        exerciseId: exercise.exercise.id,
        sets: exercise.sets.map((set) => ({
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
          restSeconds: set.restSeconds,
        })),
      })),
    };

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save workout");
      setSaving(false);
      return;
    }

    const body = await response.json().catch(() => ({}));
    setSavedId(body.workoutId ?? workout.id);
    setSaving(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Generate Today&apos;s Workout</h2>
      <p className="mt-2 text-slate-600">
        One tap to build a session based on your goals, recovery, and equipment.
      </p>
      {nextAutoLabel ? (
        <p className="mt-2 text-xs text-slate-500">
          Next auto day: <span className="font-semibold text-slate-700">{nextAutoLabel}</span>
          {queuePreview ? ` · Queue: ${queuePreview}` : ""}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 text-sm text-slate-700">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session mode</span>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value as "AUTO" | "MANUAL" | "BONUS")}
          >
            <option value="AUTO">Auto (follow split queue)</option>
            <option value="MANUAL">Pick push / pull / legs</option>
            <option value="BONUS">Bonus session (does not advance split)</option>
          </select>
        </label>

        {selectionMode !== "AUTO" ? (
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Focus today</span>
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={forcedSplit}
              onChange={(event) => setForcedSplit(event.target.value as "PUSH" | "PULL" | "LEGS")}
            >
              <option value="PUSH">Push</option>
              <option value="PULL">Pull</option>
              <option value="LEGS">Legs</option>
            </select>
          </label>
        ) : null}

        {selectionMode === "MANUAL" ? (
          <div className="space-y-1 text-sm text-slate-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={advanceSplit}
                onChange={(event) => setAdvanceSplit(event.target.checked)}
              />
              Advance split after this session
            </label>
            <p className="text-xs text-slate-500">
              Leave unchecked to keep the skipped day next in your queue.
            </p>
          </div>
        ) : selectionMode === "BONUS" ? (
          <p className="text-xs text-slate-500">
            Bonus sessions are logged for fatigue and analytics but do not advance your split queue.
          </p>
        ) : null}
      </div>
      {showCheckIn ? (
        <SessionCheckInForm
          onSubmit={handleCheckInSubmit}
          onSkip={handleCheckInSkip}
          isSubmitting={loading}
        />
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={handleGenerateClick}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate Workout"}
          </button>
          <Link className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold" href="/onboarding">
            Update Profile
          </Link>
          {workout ? (
            <button
              className="rounded-full border border-slate-900 px-5 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Workout"}
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {savedId ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-emerald-600">Saved!</span>
          <Link className="font-semibold text-slate-900" href={`/workout/${savedId}`}>
            View workout
          </Link>
          <Link className="font-semibold text-slate-900" href={`/log/${savedId}`}>
            Start logging
          </Link>
        </div>
      ) : null}

      {workout ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">Estimated time</p>
            <p className="text-lg font-semibold">{workout.estimatedMinutes} minutes</p>
          </div>
          {[
            { label: "Main Lifts", items: workout.mainLifts },
            { label: "Accessories", items: workout.accessories },
          ].map((section) => (
            <div key={section.label} className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {section.label}
              </h3>
              <div className="mt-3 space-y-3">
                {section.items.map((exercise) => (
                  <div key={exercise.id} className="rounded-lg border border-slate-100 p-3">
                    <p className="text-sm font-semibold">{exercise.exercise.name}</p>
                    <p className="text-xs text-slate-500">
                      {exercise.sets.length} sets · {exercise.sets[0]?.targetReps ?? ""} reps
                      {exercise.sets[0]?.targetLoad ? ` · ${exercise.sets[0].targetLoad} lbs` : ""}
                      {exercise.sets[0]?.targetRpe ? ` · RPE ${exercise.sets[0].targetRpe}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
