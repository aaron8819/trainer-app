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
      <div className="page-shell max-w-5xl">
        <h1 className="page-title">Analytics</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Training volume, progress, and readiness trends.
        </p>

        {/* Tab bar */}
        <div className="mt-5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex min-w-full gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`min-h-10 min-w-[7rem] flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="mt-5 sm:mt-6">
          {activeTab === "Recovery" && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold sm:text-lg">Muscle Recovery Status</h2>
              <p className="text-sm text-slate-500">
                Recovery progress based on SRA (Stimulus-Recovery-Adaptation) windows.
              </p>
              <MuscleRecoveryPanel />
            </div>
          )}

          {activeTab === "Volume" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Weekly Volume by Muscle</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Direct and indirect sets per muscle with MEV/MAV/MRV reference lines.
                </p>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 p-3.5 sm:mt-4 sm:p-4">
                  <MuscleVolumeChart />
                </div>
              </div>
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Volume Trend</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Top muscle groups tracked over 8 weeks.
                </p>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 p-3.5 sm:mt-4 sm:p-4">
                  <WeeklyVolumeTrend />
                </div>
              </div>
            </div>
          )}

          {activeTab === "Overview" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Push / Pull / Legs Distribution</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Set distribution across training splits over the past 4 weeks.
                </p>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 p-3.5 sm:mt-4 sm:p-4">
                  <SplitDistribution />
                </div>
              </div>
            </div>
          )}

          {activeTab === "Templates" && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold sm:text-lg">Template Usage</h2>
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
