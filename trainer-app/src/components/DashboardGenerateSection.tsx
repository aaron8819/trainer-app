"use client";

import { useState } from "react";
import GenerateWorkoutCard from "./GenerateWorkoutCard";
import { GenerateFromTemplateCard } from "./GenerateFromTemplateCard";

type TemplateSummary = {
  id: string;
  name: string;
  exerciseCount: number;
};

type DashboardGenerateSectionProps = {
  nextAutoLabel?: string;
  queuePreview?: string;
  templates: TemplateSummary[];
};

export function DashboardGenerateSection({
  nextAutoLabel,
  queuePreview,
  templates,
}: DashboardGenerateSectionProps) {
  const [mode, setMode] = useState<"ppl" | "template">("ppl");

  return (
    <div>
      <div className="mb-4 flex rounded-full border border-slate-200 p-0.5">
        <button
          onClick={() => setMode("ppl")}
          className={`flex-1 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === "ppl"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          PPL Auto
        </button>
        <button
          onClick={() => setMode("template")}
          className={`flex-1 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === "template"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Template
        </button>
      </div>

      {mode === "ppl" ? (
        <GenerateWorkoutCard nextAutoLabel={nextAutoLabel} queuePreview={queuePreview} />
      ) : (
        <GenerateFromTemplateCard templates={templates} />
      )}
    </div>
  );
}
