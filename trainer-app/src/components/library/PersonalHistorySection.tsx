"use client";

import { useEffect, useState } from "react";

type ExerciseSession = {
  date: string;
  sets: { setIndex: number; reps: number; load: number | null; rpe: number | null }[];
};

type PersonalBests = {
  maxLoad: number | null;
  maxReps: number | null;
  maxVolume: number | null;
};

type HistoryData = {
  sessions: ExerciseSession[];
  personalBests: PersonalBests;
  trend: string;
};

const TREND_LABELS: Record<string, { label: string; color: string }> = {
  improving: { label: "Improving", color: "text-emerald-600" },
  stable: { label: "Stable", color: "text-blue-600" },
  declining: { label: "Declining", color: "text-amber-600" },
  insufficient_data: { label: "Not enough data", color: "text-slate-500" },
};

export function PersonalHistorySection({ exerciseId }: { exerciseId: string }) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [prevExerciseId, setPrevExerciseId] = useState(exerciseId);

  if (exerciseId !== prevExerciseId) {
    setPrevExerciseId(exerciseId);
    setLoading(true);
    setData(null);
  }

  useEffect(() => {
    fetch(`/api/exercises/${exerciseId}/history?limit=3`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [exerciseId]);

  if (loading) {
    return <p className="animate-pulse text-xs text-slate-500">Loading history...</p>;
  }

  if (!data || data.sessions.length === 0) {
    return <p className="text-xs text-slate-500">No workout history yet.</p>;
  }

  const trend = TREND_LABELS[data.trend] ?? TREND_LABELS.insufficient_data;

  return (
    <div className="space-y-3">
      {/* Trend & Personal Bests */}
      <div className="flex items-center gap-3">
        <span className={`text-xs font-semibold ${trend.color}`}>
          {data.trend === "improving" ? "\u2191" : data.trend === "declining" ? "\u2193" : "\u2192"} {trend.label}
        </span>
        <div className="flex gap-2 text-[10px] text-slate-500">
          {data.personalBests.maxLoad !== null && (
            <span>Best load: {data.personalBests.maxLoad}lb</span>
          )}
          {data.personalBests.maxReps !== null && (
            <span>Best reps: {data.personalBests.maxReps}</span>
          )}
        </div>
      </div>

      {/* Recent Sessions */}
      {data.sessions.map((session, si) => (
        <div key={si} className="rounded-lg border border-slate-100 p-2.5">
          <p className="mb-1.5 text-[10px] font-medium text-slate-500">
            {new Date(session.date).toLocaleDateString()}
          </p>
          <div className="space-y-0.5">
            {session.sets.map((set) => (
              <div key={set.setIndex} className="flex gap-3 text-xs text-slate-600">
                <span className="w-8 text-slate-500">Set {set.setIndex + 1}</span>
                <span>{set.reps} reps</span>
                {set.load !== null && <span>{set.load}lb</span>}
                {set.rpe !== null && <span className="text-slate-500">@{set.rpe}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
