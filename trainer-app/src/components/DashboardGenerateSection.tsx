"use client";

import { useState } from "react";
import { GenerateFromTemplateCard } from "./GenerateFromTemplateCard";
import { IntentWorkoutCard } from "./IntentWorkoutCard";

type TemplateSummary = {
  id: string;
  name: string;
  exerciseCount: number;
  score?: number;
  scoreLabel?: string;
};

type DashboardGenerateSectionProps = {
  templates: TemplateSummary[];
  defaultMode?: "template" | "intent";
};

export function DashboardGenerateSection({
  templates,
  defaultMode = "template",
}: DashboardGenerateSectionProps) {
  const [mode, setMode] = useState<"template" | "intent">(defaultMode);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            mode === "template"
              ? "bg-slate-900 text-white"
              : "border border-slate-300 text-slate-700"
          }`}
          onClick={() => setMode("template")}
        >
          Template Workout
        </button>
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            mode === "intent"
              ? "bg-slate-900 text-white"
              : "border border-slate-300 text-slate-700"
          }`}
          onClick={() => setMode("intent")}
        >
          Intent Workout
        </button>
      </div>
      {mode === "template" ? (
        <GenerateFromTemplateCard templates={templates} />
      ) : (
        <IntentWorkoutCard />
      )}
    </section>
  );
}
