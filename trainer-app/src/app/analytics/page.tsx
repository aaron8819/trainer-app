"use client";

import { useState } from "react";
import { MuscleRecoveryPanel } from "@/components/analytics/MuscleRecoveryPanel";
import { MuscleVolumeChart } from "@/components/analytics/MuscleVolumeChart";
import { WeeklyVolumeTrend } from "@/components/analytics/WeeklyVolumeTrend";
import { SplitDistribution } from "@/components/analytics/SplitDistribution";
import { TemplateStatsSection } from "@/components/analytics/TemplateStatsSection";

const TABS = ["Recovery", "Volume", "Overview", "Templates"] as const;
type Tab = (typeof TABS)[number];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Recovery");

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Analytics</h1>
        <p className="mt-2 text-slate-600">
          Training volume, progress, and readiness trends.
        </p>

        {/* Tab bar */}
        <div className="mt-6 flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-6">
          {activeTab === "Recovery" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Muscle Recovery Status</h2>
              <p className="text-sm text-slate-500">
                Recovery progress based on SRA (Stimulus-Recovery-Adaptation) windows.
              </p>
              <MuscleRecoveryPanel />
            </div>
          )}

          {activeTab === "Volume" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Weekly Volume by Muscle</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Direct and indirect sets per muscle with MEV/MAV/MRV reference lines.
                </p>
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <MuscleVolumeChart />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold">Volume Trend</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Top muscle groups tracked over 8 weeks.
                </p>
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <WeeklyVolumeTrend />
                </div>
              </div>
            </div>
          )}

          {activeTab === "Overview" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Push / Pull / Legs Distribution</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Set distribution across training splits over the past 4 weeks.
                </p>
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <SplitDistribution />
                </div>
              </div>
            </div>
          )}

          {activeTab === "Templates" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Template Usage</h2>
              <p className="text-sm text-slate-500">
                Completion rates and usage frequency for your workout templates.
              </p>
              <TemplateStatsSection />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
