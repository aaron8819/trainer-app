"use client";

import { useState, type FormEvent } from "react";

type ReadinessCheckInFormProps = {
  onSubmit?: (result: FatigueResult) => void;
  isSubmitting?: boolean;
};

type FatigueResult = {
  signal: {
    timestamp: string;
    hasWhoop: boolean;
    subjective: {
      readiness: number;
      motivation: number;
      soreness: Record<string, number>;
      stress?: number;
    };
    performance: {
      rpeDeviation: number;
      stallCount: number;
      volumeComplianceRate: number;
    };
  };
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
  source?: {
    whoopAvailable: boolean;
    sourceMode: string;
  };
};

// Muscle groups for soreness tracking
const MUSCLE_GROUPS = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "shoulders", label: "Shoulders" },
  { key: "legs", label: "Legs" },
  { key: "arms", label: "Arms" },
];

// Soreness levels: 1 = none, 2 = moderate, 3 = very sore
const SORENESS_LEVELS = [
  { value: 1, label: "None", color: "bg-slate-100 text-slate-700" },
  { value: 2, label: "Moderate", color: "bg-amber-100 text-amber-700" },
  { value: 3, label: "Very Sore", color: "bg-red-100 text-red-700" },
];

export default function ReadinessCheckInForm({
  onSubmit,
  isSubmitting = false,
}: ReadinessCheckInFormProps) {
  const [readiness, setReadiness] = useState(3);
  const [motivation, setMotivation] = useState(3);
  const [soreness, setSoreness] = useState<Record<string, number>>({
    chest: 1,
    back: 1,
    shoulders: 1,
    legs: 1,
    arms: 1,
  });
  const [result, setResult] = useState<FatigueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cycleSoreness = (muscle: string) => {
    setSoreness((prev) => {
      const current = prev[muscle] || 1;
      const next = current === 3 ? 1 : (current + 1) as 1 | 2 | 3;
      return { ...prev, [muscle]: next };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/readiness/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjective: {
            readiness,
            motivation,
            soreness,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to submit readiness");
      }

      const data: FatigueResult = await response.json();
      setResult(data);
      onSubmit?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit readiness");
    }
  };

  const getSorenessLevel = (muscle: string) => {
    const level = soreness[muscle] || 1;
    return SORENESS_LEVELS.find((s) => s.value === level) || SORENESS_LEVELS[0];
  };

  const getFatigueColor = (score: number) => {
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
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900">How are you feeling today?</h3>

        {/* Readiness Slider */}
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Overall Readiness</p>
          <div className="mt-2 flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="readiness"
                  value={value}
                  checked={readiness === value}
                  onChange={() => setReadiness(value)}
                  className="sr-only"
                  disabled={isSubmitting}
                />
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition ${
                    readiness === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-700"
                  }`}
                >
                  {value}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">1 = rough, 5 = great</p>
        </div>

        {/* Motivation Slider */}
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Motivation</p>
          <div className="mt-2 flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="motivation"
                  value={value}
                  checked={motivation === value}
                  onChange={() => setMotivation(value)}
                  className="sr-only"
                  disabled={isSubmitting}
                />
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition ${
                    motivation === value
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-200 text-slate-700"
                  }`}
                >
                  {value}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">1 = low, 5 = high</p>
        </div>

        {/* Muscle Soreness Chips */}
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Muscle Soreness</p>
          <p className="mt-1 text-xs text-slate-500">Tap to cycle: None → Moderate → Very Sore</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MUSCLE_GROUPS.map((muscle) => {
              const level = getSorenessLevel(muscle.key);
              return (
                <button
                  key={muscle.key}
                  type="button"
                  onClick={() => cycleSoreness(muscle.key)}
                  className={`min-h-10 rounded-full px-4 text-xs font-medium transition-colors ${level.color}`}
                  disabled={isSubmitting}
                >
                  {muscle.label}: {level.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit Button */}
        <div className="mt-5">
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Analyzing..." : "Submit Check-In"}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </form>

      {/* Fatigue Score Result */}
      {result && (
        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900">Readiness Analysis</h3>

          {/* Overall Fatigue Gauge */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Fatigue Score</p>
              <p
                className={`text-2xl font-bold ${getFatigueColor(result.fatigueScore.overall)}`}
              >
                {(result.fatigueScore.overall * 100).toFixed(0)}%
              </p>
            </div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${
                  result.fatigueScore.overall >= 0.8
                    ? "bg-green-600"
                    : result.fatigueScore.overall >= 0.5
                      ? "bg-yellow-600"
                      : result.fatigueScore.overall >= 0.3
                        ? "bg-orange-600"
                        : "bg-red-600"
                }`}
                style={{ width: `${result.fatigueScore.overall * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Status: {getFatigueLabel(result.fatigueScore.overall)}
            </p>
          </div>

          {/* Signal Breakdown */}
          <div className="mt-4">
            <p className="text-sm font-semibold text-slate-700">Signal Breakdown</p>
            <p className="mt-1 text-xs text-slate-500">
              {result.source?.whoopAvailable
                ? "Using Whoop + subjective + performance signals."
                : "Whoop unavailable: using subjective + performance signals only."}
            </p>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  Whoop ({(result.fatigueScore.weights.whoop * 100).toFixed(0)}%)
                </span>
                <span className="font-semibold text-slate-900">
                  {result.signal.hasWhoop
                    ? (result.fatigueScore.components.whoopContribution * 100).toFixed(0) + "%"
                    : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  Subjective ({(result.fatigueScore.weights.subjective * 100).toFixed(0)}%)
                </span>
                <span className="font-semibold text-slate-900">
                  {(result.fatigueScore.components.subjectiveContribution * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  Performance ({(result.fatigueScore.weights.performance * 100).toFixed(0)}%)
                </span>
                <span className="font-semibold text-slate-900">
                  {(result.fatigueScore.components.performanceContribution * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Performance Signals</p>
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p>
                RPE Deviation:{" "}
                {result.signal.performance.rpeDeviation > 0 ? "+" : ""}
                {result.signal.performance.rpeDeviation.toFixed(1)}
              </p>
              <p>Stalls: {result.signal.performance.stallCount}</p>
              <p>
                Volume Compliance: {(result.signal.performance.volumeComplianceRate * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
