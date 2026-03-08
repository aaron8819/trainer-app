"use client";

import { useEffect, useState } from "react";

type MuscleRecovery = {
  name: string;
  recoveryPercent: number;
  isRecovered: boolean;
  lastTrainedHoursAgo: number | null;
  sraWindowHours: number;
  timeline: Array<{
    date: string;
    effectiveSets: number;
    intensityBand: 0 | 1 | 2 | 3;
  }>;
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

function timelineCellColor(intensityBand: 0 | 1 | 2 | 3): string {
  if (intensityBand === 3) return "bg-slate-700";
  if (intensityBand === 2) return "bg-slate-500";
  if (intensityBand === 1) return "bg-slate-300";
  return "bg-slate-100";
}

function formatTimelineLabel(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
  });
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
        Loading stimulus recency data...
      </div>
    );
  }

  if (muscles.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        No stimulus recency data. Complete a workout to review recent local stimulus.
      </div>
    );
  }

  const muscleMap = new Map(muscles.map((m) => [m.name, m]));
  const timelineLabels =
    muscles.find((muscle) => muscle.timeline.length > 0)?.timeline.map((day) => day.date) ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:p-4">
        <p>
          Percent shows how much of a muscle&apos;s SRA window has elapsed since its last meaningful stimulus. Lower values mean more recent local stimulus. Higher values mean more time since exposure.
        </p>
        <p className="mt-2">
          Use this screen to review patterns. It is not a training prescription, a safety signal, or the same thing as dashboard opportunity.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">More recent stimulus</span>
          <span className="rounded-full bg-yellow-100 px-2 py-1 text-yellow-700">Mid-window</span>
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Longer since last stimulus</span>
        </div>
      </div>
      {Object.entries(SPLIT_GROUPS).map(([group, muscleNames]) => {
        const groupMuscles = muscleNames
          .map((name) => muscleMap.get(name))
          .filter((m): m is MuscleRecovery => m !== undefined && m.lastTrainedHoursAgo !== null);

        if (groupMuscles.length === 0) return null;

        return (
          <div key={group} className="rounded-xl border border-slate-200 p-3.5 sm:p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h4>
            {timelineLabels.length > 0 && (
              <div className="mb-2 grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3 text-[10px] uppercase tracking-wide text-slate-400 sm:grid-cols-[6rem_minmax(0,1fr)_3rem]">
                <span />
                <div className="grid grid-cols-7 gap-1">
                  {timelineLabels.map((date) => (
                    <span key={date} className="text-center">
                      {formatTimelineLabel(date)}
                    </span>
                  ))}
                </div>
                <span />
              </div>
            )}
            <div className="space-y-3">
              {groupMuscles.map((muscle) => (
                <div key={muscle.name} className="space-y-1.5">
                  <div className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_3rem]">
                    <span className="truncate text-xs text-slate-600">{muscle.name}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${recoveryColor(muscle.recoveryPercent)}`}
                        style={{ width: `${Math.min(muscle.recoveryPercent, 100)}%` }}
                      />
                    </div>
                    <span className={`text-right text-xs font-medium ${recoveryTextColor(muscle.recoveryPercent)}`}>
                      {muscle.recoveryPercent}%
                    </span>
                  </div>
                  <div className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_3rem]">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">7d trend</span>
                    <div className="grid grid-cols-7 gap-1">
                      {muscle.timeline.map((day) => (
                        <div
                          key={day.date}
                          data-testid={`timeline-cell-${muscle.name}-${day.date}`}
                          aria-label={`${muscle.name} stimulus on ${day.date}: ${day.effectiveSets} effective sets`}
                          className={`h-3 rounded-sm ${timelineCellColor(day.intensityBand)}`}
                          title={`${day.date}: ${day.effectiveSets} weighted effective sets`}
                        />
                      ))}
                    </div>
                    <span className="text-right text-[10px] text-slate-400">
                      {muscle.lastTrainedHoursAgo}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
