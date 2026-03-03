"use client";

import type { CoachMessage } from "@/lib/engine/explainability";

type Props = {
  message: CoachMessage;
};

export function CoachMessageCard({ message }: Props) {
  const config = {
    warning: {
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      textColor: "text-red-900",
      label: "Watch for",
      labelColor: "text-red-700",
    },
    encouragement: {
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-200",
      textColor: "text-emerald-900",
      label: "Keep in mind",
      labelColor: "text-emerald-700",
    },
    milestone: {
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      textColor: "text-blue-900",
      label: "Progress note",
      labelColor: "text-blue-700",
    },
    tip: {
      bgColor: "bg-amber-50",
      borderColor: "border-amber-200",
      textColor: "text-amber-900",
      label: "Helpful note",
      labelColor: "text-amber-700",
    },
  }[message.type];

  return (
    <div className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-3 text-sm sm:p-4`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${config.labelColor}`}>
        {config.label}
        {message.priority === "high" ? (
          <span className="ml-2 inline-block rounded bg-white/70 px-2 py-0.5 text-[11px] font-medium">
            High priority
          </span>
        ) : null}
      </p>
      <p className={`mt-1 ${config.textColor}`}>{message.message}</p>
    </div>
  );
}
