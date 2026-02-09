"use client";

import { useMemo } from "react";
import { analyzeTemplate, type AnalysisExerciseInput } from "@/lib/engine/template-analysis";
import { TemplateScoreBadge } from "./TemplateScoreBadge";
import type { ExerciseListItem } from "@/lib/exercise-library/types";

type TemplateAnalysisPanelProps = {
  selectedExerciseIds: string[];
  exerciseLibrary: ExerciseListItem[];
};

function toAnalysisInput(ex: ExerciseListItem): AnalysisExerciseInput {
  const muscles: { name: string; role: "primary" | "secondary" }[] = [];
  for (const m of ex.primaryMuscles) {
    muscles.push({ name: m, role: "primary" });
  }
  for (const m of ex.secondaryMuscles) {
    muscles.push({ name: m, role: "secondary" });
  }
  return {
    isCompound: ex.isCompound,
    movementPatterns: ex.movementPatterns,
    muscles,
    sfrScore: ex.sfrScore,
    lengthPositionScore: ex.lengthPositionScore,
  };
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const barColor =
    score >= 75
      ? "bg-emerald-500"
      : score >= 60
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600">{label}</span>
        <span className="text-xs font-semibold text-slate-700">{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div
          className={`h-1.5 rounded-full transition-all ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export function TemplateAnalysisPanel({
  selectedExerciseIds,
  exerciseLibrary,
}: TemplateAnalysisPanelProps) {
  const exerciseMap = useMemo(
    () => new Map(exerciseLibrary.map((e) => [e.id, e])),
    [exerciseLibrary]
  );

  const analysis = useMemo(() => {
    const inputs: AnalysisExerciseInput[] = [];
    for (const id of selectedExerciseIds) {
      const ex = exerciseMap.get(id);
      if (ex) {
        inputs.push(toAnalysisInput(ex));
      }
    }
    return analyzeTemplate(inputs);
  }, [selectedExerciseIds, exerciseMap]);

  if (selectedExerciseIds.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Template Score
        </span>
        <TemplateScoreBadge
          score={analysis.overallScore}
          label={analysis.overallLabel}
          size="md"
        />
      </div>

      <div className="mt-3 space-y-2.5">
        <ScoreBar label="Muscle Coverage" score={analysis.muscleCoverage.score} />
        <ScoreBar label="Push/Pull Balance" score={analysis.pushPullBalance.score} />
        <ScoreBar
          label="Compound/Isolation"
          score={analysis.compoundIsolationRatio.score}
        />
        <ScoreBar
          label="Movement Diversity"
          score={analysis.movementPatternDiversity.score}
        />
        <ScoreBar label="Stretch Position" score={analysis.lengthPosition.score} />
        <ScoreBar label="Fatigue Efficiency" score={analysis.sfrEfficiency.score} />
      </div>

      {analysis.suggestions.length > 0 && (
        <div className="mt-3 space-y-1">
          {analysis.suggestions.map((suggestion, i) => (
            <p key={i} className="text-[11px] leading-tight text-slate-500">
              {suggestion}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
