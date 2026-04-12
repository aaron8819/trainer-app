import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";

type MetricCardTone = "default" | "warning";

type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  supportingText?: string;
  badge?: string;
  badgeTone?: StatusBadgeTone;
  tone?: MetricCardTone;
  className?: string;
};

const TONE_STYLES: Record<MetricCardTone, string> = {
  default:
    "border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50",
  warning:
    "border-amber-200 bg-amber-50 text-slate-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50",
};

function joinClassNames(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function MetricCard({
  label,
  value,
  supportingText,
  badge,
  badgeTone = "neutral",
  tone = "default",
  className,
}: MetricCardProps) {
  const isWarning = tone === "warning";

  return (
    <div
      className={joinClassNames(
        "rounded-lg border p-4 shadow-sm",
        TONE_STYLES[tone],
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={joinClassNames(
            "text-xs font-semibold uppercase",
            isWarning ? "text-amber-800 dark:text-amber-200" : "text-slate-500 dark:text-slate-400"
          )}
        >
          {label}
        </p>
        {badge ? <StatusBadge tone={badgeTone}>{badge}</StatusBadge> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none tabular-nums">{value}</p>
      {supportingText ? (
        <p
          className={joinClassNames(
            "mt-2 text-sm leading-5",
            isWarning ? "text-amber-900 dark:text-amber-100" : "text-slate-600 dark:text-slate-300"
          )}
        >
          {supportingText}
        </p>
      ) : null}
    </div>
  );
}

export type { MetricCardProps, MetricCardTone };
