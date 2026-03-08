"use client";

import { useState } from "react";
import { AnalyticsSummaryPanel } from "@/components/analytics/AnalyticsSummaryPanel";
import { SurfaceGuideCard } from "@/components/SurfaceGuideCard";
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
          Longer-term trend review for volume, stimulus recency, and follow-through. Use Program for live decisions and History for individual sessions.
        </p>

        <section className="mt-5">
          <SurfaceGuideCard current="analytics" />
        </section>

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
              <h2 className="text-base font-semibold sm:text-lg">Muscle Stimulus Recency</h2>
              <p className="text-sm text-slate-500">
                SRA-style recency view of when each muscle was last meaningfully stimulated, plus a 7-day weighted stimulus pattern. This is analytics context, not dashboard opportunity or a go-train signal.
              </p>
              <MuscleRecoveryPanel />
            </div>
          )}

          {activeTab === "Volume" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Weekly Volume by Muscle</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Performed direct and indirect sets grouped into rolling ISO weeks with MEV/MAV/MRV reference lines.
                </p>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 p-3.5 sm:mt-4 sm:p-4">
                  <MuscleVolumeChart />
                </div>
              </div>
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Volume Trend</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Top direct-set muscle trends across the rolling 8-week analytics window.
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
                <h2 className="text-base font-semibold sm:text-lg">Workout Summary</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Generated, performed, and completed workout counts use one shared analytics vocabulary.
                </p>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 p-3.5 sm:mt-4 sm:p-4">
                  <AnalyticsSummaryPanel />
                </div>
              </div>
              <div>
                <h2 className="text-base font-semibold sm:text-lg">Push / Pull / Legs Distribution</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Direct performed sets grouped into Push / Pull / Legs across the rolling 4-week volume window.
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
                Generated template workouts, plus performed and completed follow-through rates.
              </p>
              <TemplateStatsSection />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
