"use client";

/**
 * Group modifications by exercise name
 * Returns array of { exerciseName, setCount, representative, modifications }
 */
function groupModificationsByExercise(
  modifications: AutoregulationDisplayProps["modifications"]
) {
  const groups = new Map<
    string,
    AutoregulationDisplayProps["modifications"]
  >();

  modifications.forEach((mod) => {
    const key = mod.exerciseName || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(mod);
  });

  return Array.from(groups.entries()).map(([exerciseName, mods]) => ({
    exerciseName,
    setCount: mods.length,
    representative: mods[0], // Use first mod for display (all sets have same % change)
    modifications: mods,
  }));
}

/**
 * Count unique exercises affected (not total modifications)
 */
function getUniqueExerciseCount(
  modifications: AutoregulationDisplayProps["modifications"]
): number {
  const uniqueExercises = new Set(
    modifications.map((mod) => mod.exerciseName || "unknown")
  );
  return uniqueExercises.size;
}

/**
 * Extract action description from reason string
 * e.g., "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5"
 *      → "from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5"
 */
function extractActionFromReason(reason: string): string {
  // Remove the exercise name prefix (it's already in the header)
  const patterns = [
    /^Scaled up .+ (from .+)$/,
    /^Scaled down .+ (from .+)$/,
    /^Reduced .+ (from .+)$/,
    /^Deload: (.+)$/,
  ];

  for (const pattern of patterns) {
    const match = reason.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Fallback: return as-is if no pattern matches
  return reason;
}

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
            Modifications ({getUniqueExerciseCount(modifications)})
          </p>
          <div className="mt-2 space-y-2">
            {groupModificationsByExercise(modifications).map((group, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                {/* Exercise Name */}
                <p className="font-semibold text-slate-900">
                  {group.exerciseName}
                  {group.setCount > 1 && (
                    <span className="ml-1 text-slate-500">({group.setCount} sets)</span>
                  )}
                </p>

                {/* Intensity Scale */}
                {group.representative.type === "intensity_scale" && (
                  <div className="mt-1 space-y-0.5 text-slate-600">
                    {group.representative.originalLoad !== undefined &&
                      group.representative.adjustedLoad !== undefined && (
                        <p>
                          Load: {group.representative.originalLoad} lbs →{" "}
                          {group.representative.adjustedLoad} lbs (
                          {group.representative.direction === "up" ? "+" : ""}
                          {((group.representative.scalar || 1) - 1) * 100 > 0 ? "+" : ""}
                          {(((group.representative.scalar || 1) - 1) * 100).toFixed(0)}%)
                        </p>
                      )}
                    {group.representative.originalRir !== undefined &&
                      group.representative.adjustedRir !== undefined && (
                        <p>
                          RIR: {group.representative.originalRir} →{" "}
                          {group.representative.adjustedRir}
                        </p>
                      )}
                  </div>
                )}

                {/* Volume Reduction */}
                {group.representative.type === "volume_reduction" && (
                  <div className="mt-1 text-slate-600">
                    <p>
                      Sets: {group.representative.originalSetCount} →{" "}
                      {group.representative.adjustedSetCount} (-
                      {group.representative.setsCut} sets)
                    </p>
                  </div>
                )}

                {/* Deload Trigger */}
                {group.representative.type === "deload_trigger" && (
                  <div className="mt-1 text-orange-700">
                    <p className="font-semibold">⚠️ Deload recommended</p>
                  </div>
                )}

                {/* Reason - Extract action from first modification's reason */}
                <p className="mt-1.5 text-slate-500">
                  {extractActionFromReason(group.representative.reason)}
                </p>
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
