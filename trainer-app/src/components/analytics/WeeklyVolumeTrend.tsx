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
} from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
};

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899"];

export function WeeklyVolumeTrend() {
  const [data, setData] = useState<VolumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const updateCompact = () => setIsCompact(window.innerWidth < 390);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ weeks: "8" });
    fetch(`/api/analytics/volume?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading trend data...
      </div>
    );
  }

  if (!data || data.weeklyVolume.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">No trend data available.</div>;
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
    .slice(0, isCompact ? 3 : 6)
    .map(([m]) => m);

  const chartData = data.weeklyVolume.map((week) => {
    const point: Record<string, string | number> = { week: week.weekStart.slice(5) };
    for (const m of topMuscles) {
      point[m] = week.muscles[m]?.directSets ?? 0;
    }
    return point;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
        {topMuscles.map((muscle, i) => (
          <span
            key={muscle}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            {muscle}
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={isCompact ? 240 : 300}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: isCompact ? 8 : 14, bottom: isCompact ? 8 : 0, left: isCompact ? 2 : 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: isCompact ? 10 : 11 }}
            tickMargin={6}
            interval={isCompact ? "preserveStartEnd" : 0}
          />
          <YAxis tick={{ fontSize: isCompact ? 10 : 11 }} width={isCompact ? 24 : 32} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {topMuscles.map((muscle, i) => (
            <Line
              key={muscle}
              type="monotone"
              dataKey={muscle}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={isCompact ? 2 : 2.25}
              dot={isCompact ? false : { r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
