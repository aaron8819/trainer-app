"use client";

import { useEffect, useState } from "react";

type MuscleRecovery = {
  name: string;
  recoveryPercent: number;
  isRecovered: boolean;
  lastTrainedHoursAgo: number | null;
  sraWindowHours: number;
};

const SPLIT_GROUPS: Record<string, string[]> = {
  Push: ["Chest", "Front Delts", "Side Delts", "Triceps"],
  Pull: ["Lats", "Upper Back", "Rear Delts", "Biceps", "Forearms"],
  Legs: ["Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Abductors", "Core", "Lower Back", "Abs"],
};

function recoveryColor(percent: number): string {
  if (percent >= 100) return "bg-emerald-500";
  if (percent >= 75) return "bg-yellow-500";
  if (percent >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function recoveryTextColor(percent: number): string {
  if (percent >= 100) return "text-emerald-700";
  if (percent >= 75) return "text-yellow-700";
  if (percent >= 50) return "text-orange-700";
  return "text-red-700";
}

export function MuscleRecoveryPanel() {
  const [muscles, setMuscles] = useState<MuscleRecovery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/recovery")
      .then((r) => r.json())
      .then((data) => setMuscles(data.muscles ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading recovery data...
      </div>
    );
  }

  if (muscles.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        No recovery data. Complete a workout to see muscle recovery status.
      </div>
    );
  }

  const muscleMap = new Map(muscles.map((m) => [m.name, m]));

  return (
    <div className="space-y-4">
      {Object.entries(SPLIT_GROUPS).map(([group, muscleNames]) => {
        const groupMuscles = muscleNames
          .map((name) => muscleMap.get(name))
          .filter((m): m is MuscleRecovery => m !== undefined && m.lastTrainedHoursAgo !== null);

        if (groupMuscles.length === 0) return null;

        return (
          <div key={group} className="rounded-xl border border-slate-200 p-3.5 sm:p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h4>
            <div className="space-y-2">
              {groupMuscles.map((muscle) => (
                <div key={muscle.name} className="flex items-center gap-3">
                  <span className="w-20 truncate text-xs text-slate-600 sm:w-24">{muscle.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${recoveryColor(muscle.recoveryPercent)}`}
                      style={{ width: `${Math.min(muscle.recoveryPercent, 100)}%` }}
                    />
                  </div>
                  <span className={`w-11 text-right text-xs font-medium ${recoveryTextColor(muscle.recoveryPercent)}`}>
                    {muscle.recoveryPercent}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
