"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
};

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899"];

export function WeeklyVolumeTrend({ userId }: { userId?: string }) {
  const [data, setData] = useState<VolumeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ weeks: "8" });
    if (userId) params.set("userId", userId);
    fetch(`/api/analytics/volume?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <div className="animate-pulse rounded-2xl border border-slate-200 p-6 text-sm text-slate-400">Loading trend data...</div>;
  }

  if (!data || data.weeklyVolume.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No trend data available.</div>;
  }

  // Find top 6 muscles by total volume
  const muscleTotals = new Map<string, number>();
  for (const week of data.weeklyVolume) {
    for (const [muscle, vol] of Object.entries(week.muscles)) {
      muscleTotals.set(muscle, (muscleTotals.get(muscle) ?? 0) + vol.directSets);
    }
  }
  const topMuscles = Array.from(muscleTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([m]) => m);

  const chartData = data.weeklyVolume.map((week) => {
    const point: Record<string, string | number> = { week: week.weekStart.slice(5) };
    for (const m of topMuscles) {
      point[m] = week.muscles[m]?.directSets ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {topMuscles.map((muscle, i) => (
          <Line
            key={muscle}
            type="monotone"
            dataKey={muscle}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
