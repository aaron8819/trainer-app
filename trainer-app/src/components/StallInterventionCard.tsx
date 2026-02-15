"use client";

import { useState } from "react";

type InterventionLevel =
  | "none"
  | "microload"
  | "deload"
  | "variation"
  | "volume_reset"
  | "goal_reassess";

type StallInterventionCardProps = {
  exerciseId: string;
  exerciseName: string;
  weeksWithoutProgress: number;
  interventionLevel: InterventionLevel;
  action: string;
  rationale: string;
  onApply?: (exerciseId: string) => void;
  onDismiss?: (exerciseId: string) => void;
};

export function StallInterventionCard({
  exerciseId,
  exerciseName,
  weeksWithoutProgress,
  interventionLevel,
  action,
  rationale,
  onApply,
  onDismiss,
}: StallInterventionCardProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply?.(exerciseId);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      await onDismiss?.(exerciseId);
    } finally {
      setIsDismissing(false);
    }
  };

  const getLevelColor = (level: InterventionLevel) => {
    switch (level) {
      case "microload":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "deload":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "variation":
        return "bg-orange-100 text-orange-700 border-orange-200";
      case "volume_reset":
        return "bg-red-100 text-red-700 border-red-200";
      case "goal_reassess":
        return "bg-purple-100 text-purple-700 border-purple-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const getLevelLabel = (level: InterventionLevel) => {
    switch (level) {
      case "microload":
        return "Microload";
      case "deload":
        return "Deload";
      case "variation":
        return "Variation";
      case "volume_reset":
        return "Volume Reset";
      case "goal_reassess":
        return "Goal Reassess";
      default:
        return "No Action";
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">{exerciseName}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {weeksWithoutProgress} {weeksWithoutProgress === 1 ? "week" : "weeks"} without progress
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${getLevelColor(interventionLevel)}`}
        >
          {getLevelLabel(interventionLevel)}
        </span>
      </div>

      {/* Action */}
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-700">Suggested Action</p>
        <p className="mt-1 text-sm text-slate-900">{action}</p>
      </div>

      {/* Rationale */}
      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-700">Rationale</p>
        <p className="mt-1 text-xs text-slate-600">{rationale}</p>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {onApply && (
          <button
            onClick={handleApply}
            disabled={isApplying || isDismissing}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isApplying ? "Applying..." : "Apply Intervention"}
          </button>
        )}
        {onDismiss && (
          <button
            onClick={handleDismiss}
            disabled={isApplying || isDismissing}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {isDismissing ? "Dismissing..." : "Dismiss"}
          </button>
        )}
      </div>
    </div>
  );
}
