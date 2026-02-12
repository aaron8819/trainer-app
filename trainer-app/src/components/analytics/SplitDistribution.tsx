"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
};

const SPLIT_MAP: Record<string, string> = {
  Chest: "Push", "Front Delts": "Push", "Side Delts": "Push", Triceps: "Push",
  Lats: "Pull", "Upper Back": "Pull", "Rear Delts": "Pull", Biceps: "Pull", Forearms: "Pull",
  Quads: "Legs", Hamstrings: "Legs", Glutes: "Legs", Calves: "Legs",
  Adductors: "Legs", Abductors: "Legs", Core: "Legs", Abs: "Legs", "Lower Back": "Legs",
};

const COLORS = { Push: "#3b82f6", Pull: "#22c55e", Legs: "#f59e0b" };

export function SplitDistribution() {
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
    const params = new URLSearchParams({ weeks: "4" });
    fetch(`/api/analytics/volume?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading split data...
      </div>
    );
  }

  if (!data || data.weeklyVolume.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">No split data available.</div>;
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
  const totalSets = chartData.reduce((sum, item) => sum + item.value, 0);

  if (chartData.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">No split data available.</div>;
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={isCompact ? 220 : 250}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={isCompact ? 42 : 50}
            outerRadius={isCompact ? 76 : 90}
            paddingAngle={3}
            dataKey="value"
            label={
              isCompact
                ? false
                : ({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS] ?? "#94a3b8"} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
        {chartData.map((item) => (
          <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[item.name as keyof typeof COLORS] ?? "#94a3b8" }}
            />
            {item.name} {totalSets > 0 ? Math.round((item.value / totalSets) * 100) : 0}%
          </span>
        ))}
      </div>
    </div>
  );
}
