"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  buildMuscleVolumeChartData,
  groupMusclesForVolumeSelector,
  shouldShowVolumeLandmarks,
  type VolumeChartMode,
} from "./volume-chart-utils";

type VolumeData = {
  weeklyVolume: {
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>;
  }[];
  landmarks: Record<string, { mv: number; mev: number; mav: number; mrv: number }>;
};

export function MuscleVolumeChart() {
  const [data, setData] = useState<VolumeData | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string>("Chest");
  const [mode, setMode] = useState<VolumeChartMode>("effective");
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
  const muscleGroups = groupMusclesForVolumeSelector(muscleList);
  const chartData = buildMuscleVolumeChartData(data.weeklyVolume, selectedMuscle, mode);
  const latestPoint = chartData[chartData.length - 1];

  const landmark = data.landmarks[selectedMuscle];
  const chartHeight = isCompact ? 240 : 280;
  const showLandmarks = shouldShowVolumeLandmarks(mode);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: "effective", label: "Effective Sets" },
          { value: "combined", label: "Direct + Indirect" },
          { value: "direct", label: "Direct Only" },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setMode(option.value as VolumeChartMode)}
            className={`min-h-9 rounded-full px-3 text-[11px] font-medium transition-colors ${
              mode === option.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
        {showLandmarks ? (
          <p>
            Effective sets use the same weighted stimulus accounting as the planner and dashboard.
            MEV, MAV, and MRV lines only appear in this mode because those landmarks apply to
            weighted volume.
          </p>
        ) : (
          <p>
            Direct and indirect modes are structural set counts. Landmark lines are hidden here so
            direct-count bars are not mistaken for weighted volume targets.
          </p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          {muscleGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.muscles.map((muscle) => (
                  <button
                    key={muscle}
                    onClick={() => setSelectedMuscle(muscle)}
                    className={`min-h-9 rounded-full px-3 text-[11px] font-medium transition-colors ${
                      muscle === selectedMuscle
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Latest Week
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {latestPoint ? latestPoint.primaryValue.toFixed(mode === "effective" ? 1 : 0) : "0"}
            </p>
            <p className="mt-1 text-xs text-slate-500">{selectedMuscle}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              3-Week Avg
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {latestPoint ? latestPoint.rollingAverage.toFixed(1) : "0.0"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Trailing rolling average</p>
          </div>
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reference
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {landmark ? `MEV ${landmark.mev} / MAV ${landmark.mav} / MRV ${landmark.mrv}` : "No landmark"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Shared volume landmarks from the planning model.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
        {(mode === "direct" || mode === "combined") && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">Direct sets</span>
        )}
        {mode === "combined" && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">Indirect sets</span>
        )}
        {mode === "effective" && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
            Weighted effective sets
          </span>
        )}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
          3-week rolling average
        </span>
        {showLandmarks && landmark && (
          <>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">MEV {landmark.mev}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">MAV {landmark.mav}</span>
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">MRV {landmark.mrv}</span>
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart
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
              isCompact
                ? undefined
                : {
                    value: mode === "effective" ? "Effective Sets" : "Sets",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                  }
            }
          />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {mode === "combined" && (
            <>
              <Bar dataKey="direct" name="Direct sets" fill="#3b82f6" stackId="vol" />
              <Bar dataKey="indirect" name="Indirect sets" fill="#93c5fd" stackId="vol" />
            </>
          )}
          {mode === "direct" && <Bar dataKey="direct" name="Direct sets" fill="#3b82f6" />}
          {mode === "effective" && (
            <Bar dataKey="effective" name="Effective sets" fill="#7c3aed" radius={[4, 4, 0, 0]} />
          )}
          <Line
            type="monotone"
            dataKey="rollingAverage"
            name="3-week average"
            stroke="#0f172a"
            strokeDasharray="5 4"
            strokeWidth={isCompact ? 1.75 : 2}
            dot={isCompact ? false : { r: 2.5 }}
          />
          {showLandmarks && landmark && (
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
