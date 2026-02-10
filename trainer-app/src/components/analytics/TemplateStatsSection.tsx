"use client";

import { useEffect, useState } from "react";

type TemplateStat = {
  templateId: string;
  templateName: string;
  totalWorkouts: number;
  completedWorkouts: number;
  completionRate: number;
  lastUsed: string | null;
  avgFrequencyDays: number | null;
};

export function TemplateStatsSection() {
  const [templates, setTemplates] = useState<TemplateStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="animate-pulse rounded-2xl border border-slate-200 p-6 text-sm text-slate-400">Loading template stats...</div>;
  }

  if (templates.length === 0) {
    return <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No template usage data. Use templates to generate workouts and see stats here.</div>;
  }

  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <div key={t.templateId} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">{t.templateName}</h4>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {t.completionRate}% completion
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-slate-500">
            <div>
              <span className="block text-slate-400">Workouts</span>
              <span className="font-medium text-slate-700">{t.completedWorkouts}/{t.totalWorkouts}</span>
            </div>
            <div>
              <span className="block text-slate-400">Last used</span>
              <span className="font-medium text-slate-700">
                {t.lastUsed ? new Date(t.lastUsed).toLocaleDateString() : "Never"}
              </span>
            </div>
            <div>
              <span className="block text-slate-400">Avg frequency</span>
              <span className="font-medium text-slate-700">
                {t.avgFrequencyDays !== null ? `${t.avgFrequencyDays}d` : "N/A"}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
