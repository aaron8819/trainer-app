/**
 * CoachMessageCard - Display coach messages
 *
 * Phase 4.6: Show warnings, encouragement, milestones, tips
 *
 * Sorted by priority (high → medium → low)
 */

"use client";

import type { CoachMessage } from "@/lib/engine/explainability";

type Props = {
  message: CoachMessage;
};

export function CoachMessageCard({ message }: Props) {
  // Map message type to icon and color
  const config = {
    warning: {
      icon: "⚠️",
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      textColor: "text-red-900",
      label: "Warning",
      labelColor: "text-red-700",
    },
    encouragement: {
      icon: "💪",
      bgColor: "bg-green-50",
      borderColor: "border-green-200",
      textColor: "text-green-900",
      label: "Encouragement",
      labelColor: "text-green-700",
    },
    milestone: {
      icon: "🎯",
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      textColor: "text-blue-900",
      label: "Milestone",
      labelColor: "text-blue-700",
    },
    tip: {
      icon: "💡",
      bgColor: "bg-yellow-50",
      borderColor: "border-yellow-200",
      textColor: "text-yellow-900",
      label: "Tip",
      labelColor: "text-yellow-700",
    },
  }[message.type];

  const priorityBadge = message.priority === "high" && (
    <span className="ml-2 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      High Priority
    </span>
  );

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-3 text-sm sm:p-4`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" role="img" aria-label={message.type}>
          {config.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold uppercase tracking-wide ${config.labelColor}`}>
            {config.label}
            {priorityBadge}
          </p>
          <p className={`mt-1 ${config.textColor}`}>{message.message}</p>
        </div>
      </div>
    </div>
  );
}
