"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
};

const SPLIT_MAP: Record<string, string> = {
  Chest: "Push", "Front Delts": "Push", "Side Delts": "Push", Triceps: "Push",
  Back: "Pull", "Upper Back": "Pull", "Rear Delts": "Pull", Biceps: "Pull", Forearms: "Pull",
  Quads: "Legs", Hamstrings: "Legs", Glutes: "Legs", Calves: "Legs",
  Adductors: "Legs", "Hip Flexors": "Legs", Core: "Legs", "Lower Back": "Legs",
};

const COLORS = { Push: "#3b82f6", Pull: "#22c55e", Legs: "#f59e0b" };

export function SplitDistribution({ userId }: { userId?: string }) {
  const [data, setData] = useState<VolumeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ weeks: "4" });
    if (userId) params.set("userId", userId);
    fetch(`/api/analytics/volume?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <div className="animate-pulse rounded-2xl border border-slate-200 p-6 text-sm text-slate-400">Loading split data...</div>;
  }

  if (!data || data.weeklyVolume.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No split data available.</div>;
  }

  const splitTotals: Record<string, number> = { Push: 0, Pull: 0, Legs: 0 };
  for (const week of data.weeklyVolume) {
    for (const [muscle, vol] of Object.entries(week.muscles)) {
      const split = SPLIT_MAP[muscle] ?? "Legs";
      splitTotals[split] += vol.directSets;
    }
  }

  const chartData = Object.entries(splitTotals)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  if (chartData.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No split data available.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={3}
          dataKey="value"
          label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
        >
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS] ?? "#94a3b8"} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
