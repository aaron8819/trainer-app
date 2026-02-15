"use client";

type AutoregulationDisplayProps = {
  fatigueScore: {
    overall: number;
    perMuscle?: Record<string, number>;
    weights: { whoop: number; subjective: number; performance: number };
    components: {
      whoopContribution: number;
      subjectiveContribution: number;
      performanceContribution: number;
    };
  };
  modifications: Array<{
    type: "intensity_scale" | "volume_reduction" | "deload_trigger";
    exerciseId?: string;
    exerciseName?: string;
    direction?: "up" | "down";
    scalar?: number;
    originalLoad?: number;
    adjustedLoad?: number;
    originalRir?: number;
    adjustedRir?: number;
    setsCut?: number;
    originalSetCount?: number;
    adjustedSetCount?: number;
    reason: string;
  }>;
  rationale: string;
  wasAutoregulated: boolean;
};

export function AutoregulationDisplay({
  fatigueScore,
  modifications,
  rationale,
  wasAutoregulated,
}: AutoregulationDisplayProps) {
  const getFatigueColor = (score: number) => {
    if (score >= 0.8) return "bg-green-600";
    if (score >= 0.5) return "bg-yellow-600";
    if (score >= 0.3) return "bg-orange-600";
    return "bg-red-600";
  };

  const getFatigueTextColor = (score: number) => {
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.5) return "text-yellow-600";
    if (score >= 0.3) return "text-orange-600";
    return "text-red-600";
  };

  const getFatigueLabel = (score: number) => {
    if (score >= 0.8) return "Very Fresh";
    if (score >= 0.5) return "Recovered";
    if (score >= 0.3) return "Moderately Fatigued";
    return "Exhausted";
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">Autoregulation</h3>
        {wasAutoregulated && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Applied
          </span>
        )}
      </div>

      {/* Fatigue Score Gauge */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Fatigue Score</p>
          <p className={`text-2xl font-bold ${getFatigueTextColor(fatigueScore.overall)}`}>
            {(fatigueScore.overall * 100).toFixed(0)}%
          </p>
        </div>
        <div className="mt-2 h-4 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full transition-all duration-500 ${getFatigueColor(fatigueScore.overall)}`}
            style={{ width: `${fatigueScore.overall * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-600">Status: {getFatigueLabel(fatigueScore.overall)}</p>
      </div>

      {/* Signal Breakdown - Stacked Bar */}
      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">Signal Breakdown</p>
        <div className="mt-2 flex h-6 overflow-hidden rounded-full bg-slate-100">
          {/* Whoop Component */}
          {fatigueScore.weights.whoop > 0 && (
            <div
              className="bg-blue-500"
              style={{
                width: `${(fatigueScore.components.whoopContribution * 100).toFixed(1)}%`,
              }}
              title={`Whoop: ${(fatigueScore.components.whoopContribution * 100).toFixed(1)}%`}
            />
          )}
          {/* Subjective Component */}
          <div
            className="bg-purple-500"
            style={{
              width: `${(fatigueScore.components.subjectiveContribution * 100).toFixed(1)}%`,
            }}
            title={`Subjective: ${(fatigueScore.components.subjectiveContribution * 100).toFixed(1)}%`}
          />
          {/* Performance Component */}
          <div
            className="bg-amber-500"
            style={{
              width: `${(fatigueScore.components.performanceContribution * 100).toFixed(1)}%`,
            }}
            title={`Performance: ${(fatigueScore.components.performanceContribution * 100).toFixed(1)}%`}
          />
        </div>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {fatigueScore.weights.whoop > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-blue-500" />
              <span className="text-slate-600">
                Whoop ({(fatigueScore.weights.whoop * 100).toFixed(0)}%)
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-purple-500" />
            <span className="text-slate-600">
              Subjective ({(fatigueScore.weights.subjective * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-amber-500" />
            <span className="text-slate-600">
              Performance ({(fatigueScore.weights.performance * 100).toFixed(0)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Rationale */}
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-700">Rationale</p>
        <p className="mt-1 text-xs text-slate-600">{rationale}</p>
      </div>

      {/* Modifications List */}
      {modifications.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">
            Modifications ({modifications.length})
          </p>
          <div className="mt-2 space-y-2">
            {modifications.map((mod, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                {/* Exercise Name */}
                {mod.exerciseName && (
                  <p className="font-semibold text-slate-900">{mod.exerciseName}</p>
                )}

                {/* Intensity Scale */}
                {mod.type === "intensity_scale" && (
                  <div className="mt-1 space-y-0.5 text-slate-600">
                    {mod.originalLoad !== undefined && mod.adjustedLoad !== undefined && (
                      <p>
                        Load: {mod.originalLoad} lbs → {mod.adjustedLoad} lbs (
                        {mod.direction === "up" ? "+" : ""}
                        {((mod.scalar || 1) - 1) * 100 > 0 ? "+" : ""}
                        {(((mod.scalar || 1) - 1) * 100).toFixed(0)}%)
                      </p>
                    )}
                    {mod.originalRir !== undefined && mod.adjustedRir !== undefined && (
                      <p>
                        RIR: {mod.originalRir} → {mod.adjustedRir}
                      </p>
                    )}
                  </div>
                )}

                {/* Volume Reduction */}
                {mod.type === "volume_reduction" && (
                  <div className="mt-1 text-slate-600">
                    <p>
                      Sets: {mod.originalSetCount} → {mod.adjustedSetCount} (-{mod.setsCut} sets)
                    </p>
                  </div>
                )}

                {/* Deload Trigger */}
                {mod.type === "deload_trigger" && (
                  <div className="mt-1 text-orange-700">
                    <p className="font-semibold">⚠️ Deload recommended</p>
                  </div>
                )}

                {/* Reason */}
                <p className="mt-1.5 text-slate-500">{mod.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Modifications */}
      {modifications.length === 0 && !wasAutoregulated && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">No adjustments needed. Proceed as planned.</p>
        </div>
      )}
    </div>
  );
}
