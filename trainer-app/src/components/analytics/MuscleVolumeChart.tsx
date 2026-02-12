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
} from "recharts";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number }>;
  }[];
  landmarks: Record<string, { mv: number; mev: number; mav: number; mrv: number }>;
};

export function MuscleVolumeChart() {
  const [data, setData] = useState<VolumeData | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string>("Chest");
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
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading volume data...
      </div>
    );
  }

  if (!data || data.weeklyVolume.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        No volume data. Complete workouts to track muscle volume.
      </div>
    );
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
  const chartHeight = isCompact ? 240 : 280;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap gap-2">
        {muscleList.map((m) => (
          <button
            key={m}
            onClick={() => setSelectedMuscle(m)}
            className={`min-h-9 rounded-full px-3 text-[11px] font-medium transition-colors ${
              m === selectedMuscle
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">Direct sets</span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">Indirect sets</span>
        {landmark && (
          <>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">MEV {landmark.mev}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">MAV {landmark.mav}</span>
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">MRV {landmark.mrv}</span>
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: isCompact ? 6 : 18, bottom: isCompact ? 8 : 0, left: isCompact ? 2 : 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: isCompact ? 10 : 11 }}
            tickMargin={6}
            interval={isCompact ? "preserveStartEnd" : 0}
          />
          <YAxis
            tick={{ fontSize: isCompact ? 10 : 11 }}
            width={isCompact ? 24 : 32}
            label={
              isCompact ? undefined : { value: "Sets", angle: -90, position: "insideLeft", fontSize: 11 }
            }
          />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="direct" name="Direct sets" fill="#3b82f6" stackId="vol" />
          <Bar dataKey="indirect" name="Indirect sets" fill="#93c5fd" stackId="vol" />
          {landmark && (
            <>
              <ReferenceLine
                y={landmark.mev}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={isCompact ? undefined : { value: "MEV", position: "right", fontSize: 10 }}
              />
              <ReferenceLine
                y={landmark.mav}
                stroke="#22c55e"
                strokeDasharray="4 4"
                label={isCompact ? undefined : { value: "MAV", position: "right", fontSize: 10 }}
              />
              <ReferenceLine
                y={landmark.mrv}
                stroke="#ef4444"
                strokeDasharray="4 4"
                label={isCompact ? undefined : { value: "MRV", position: "right", fontSize: 10 }}
              />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
