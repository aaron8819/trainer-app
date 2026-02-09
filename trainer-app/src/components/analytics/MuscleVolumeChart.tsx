"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
  landmarks: Record<string, { mv: number; mev: number; mav: number; mrv: number }>;
};

export function MuscleVolumeChart({ userId }: { userId?: string }) {
  const [data, setData] = useState<VolumeData | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string>("Chest");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ weeks: "4" });
    if (userId) params.set("userId", userId);
    fetch(`/api/analytics/volume?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // Select first muscle with data
        if (d.weeklyVolume?.length > 0) {
          const firstWeek = d.weeklyVolume[0];
          const muscles = Object.keys(firstWeek.muscles);
          if (muscles.length > 0 && !muscles.includes(selectedMuscle)) {
            setSelectedMuscle(muscles[0]);
          }
        }
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return <div className="animate-pulse rounded-2xl border border-slate-200 p-6 text-sm text-slate-400">Loading volume data...</div>;
  }

  if (!data || data.weeklyVolume.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No volume data. Complete workouts to track muscle volume.</div>;
  }

  // Get all muscles with data
  const allMuscles = new Set<string>();
  for (const week of data.weeklyVolume) {
    for (const m of Object.keys(week.muscles)) allMuscles.add(m);
  }
  const muscleList = Array.from(allMuscles).sort();

  const chartData = data.weeklyVolume.map((week) => ({
    week: week.weekStart.slice(5), // MM-DD
    direct: week.muscles[selectedMuscle]?.directSets ?? 0,
    indirect: week.muscles[selectedMuscle]?.indirectSets ?? 0,
  }));

  const landmark = data.landmarks[selectedMuscle];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {muscleList.map((m) => (
          <button
            key={m}
            onClick={() => setSelectedMuscle(m)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              m === selectedMuscle
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: "Sets", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="direct" name="Direct sets" fill="#3b82f6" stackId="vol" />
          <Bar dataKey="indirect" name="Indirect sets" fill="#93c5fd" stackId="vol" />
          {landmark && (
            <>
              <ReferenceLine y={landmark.mev} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "MEV", position: "right", fontSize: 10 }} />
              <ReferenceLine y={landmark.mav} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "MAV", position: "right", fontSize: 10 }} />
              <ReferenceLine y={landmark.mrv} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "MRV", position: "right", fontSize: 10 }} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
