"use client";

import { useMemo, useState } from "react";
import {
  analyzeTemplate,
  type AnalysisExerciseInput,
  type TemplateIntent,
} from "@/lib/engine/template-analysis";
import { TemplateScoreBadge } from "./TemplateScoreBadge";
import type { ExerciseListItem } from "@/lib/exercise-library/types";
import { TEMPLATE_METRIC_HELP } from "@/lib/ui/explainability";

type TemplateAnalysisPanelProps = {
  selectedExerciseIds: string[];
  exerciseLibrary: ExerciseListItem[];
  intent?: TemplateIntent;
};

function toAnalysisInput(ex: ExerciseListItem, orderIndex: number): AnalysisExerciseInput {
  const muscles: { name: string; role: "primary" | "secondary" }[] = [];
  for (const m of ex.primaryMuscles) {
    muscles.push({ name: m, role: "primary" });
  }
  for (const m of ex.secondaryMuscles) {
    muscles.push({ name: m, role: "secondary" });
  }
  return {
    isCompound: ex.isCompound,
    isMainLiftEligible: ex.isMainLiftEligible,
    movementPatterns: ex.movementPatterns,
    muscles,
    sfrScore: ex.sfrScore,
    lengthPositionScore: ex.lengthPositionScore,
    fatigueCost: ex.fatigueCost,
    orderIndex,
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
        <span className="text-xs text-slate-600" title={TEMPLATE_METRIC_HELP[label] ?? undefined}>
          {label}
        </span>
        <span className="text-xs font-semibold text-slate-700">{score}</span>
      </div>
      {TEMPLATE_METRIC_HELP[label] ? (
        <p className="text-[11px] text-slate-500">{TEMPLATE_METRIC_HELP[label]}</p>
      ) : null}
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
  intent,
}: TemplateAnalysisPanelProps) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const exerciseMap = useMemo(
    () => new Map(exerciseLibrary.map((e) => [e.id, e])),
    [exerciseLibrary]
  );

  const analysis = useMemo(() => {
    const inputs: AnalysisExerciseInput[] = [];
    for (let i = 0; i < selectedExerciseIds.length; i += 1) {
      const id = selectedExerciseIds[i];
      const ex = exerciseMap.get(id);
      if (ex) {
        inputs.push(toAnalysisInput(ex, i));
      }
    }
    return analyzeTemplate(inputs, { intent });
  }, [selectedExerciseIds, exerciseMap, intent]);
  const visibleSuggestions = showAllSuggestions
    ? analysis.suggestions
    : analysis.suggestions.slice(0, 2);

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
        <ScoreBar label="Exercise Order" score={analysis.exerciseOrder.score} />
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Exercise Order weight for this intent: {Math.round(analysis.exerciseOrderWeight * 100)}%
      </p>
      {analysis.exerciseOrder.mainLiftOrderViolations > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">
          Main-lift priority check: {analysis.exerciseOrder.mainLiftOrderViolations} ordering
          violation{analysis.exerciseOrder.mainLiftOrderViolations === 1 ? "" : "s"} found.
        </p>
      )}

      {analysis.suggestions.length > 0 && (
        <div className="mt-3 space-y-1">
          {visibleSuggestions.map((suggestion, i) => (
            <p key={i} className="text-[11px] leading-tight text-slate-500">
              {suggestion}
            </p>
          ))}
          {analysis.suggestions.length > 2 ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-slate-700"
              onClick={() => setShowAllSuggestions((prev) => !prev)}
            >
              {showAllSuggestions ? "Show less" : `Show ${analysis.suggestions.length - 2} more`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
