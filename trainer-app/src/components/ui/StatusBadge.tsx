type StatusBadgeTone = "neutral" | "positive" | "warning" | "critical";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusBadgeTone;
  className?: string;
};

const TONE_STYLES: Record<StatusBadgeTone, { badge: string; dot: string }> = {
  neutral: {
    badge:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
    dot: "bg-slate-400",
  },
  positive: {
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    badge:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  critical: {
    badge:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
    dot: "bg-rose-500",
  },
};

function joinClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  const styles = TONE_STYLES[tone];

  return (
    <span
      className={joinClassNames(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold",
        styles.badge,
        className
      )}
    >
      <span className={joinClassNames("size-1.5 rounded-full", styles.dot)} aria-hidden="true" />
      {children}
    </span>
  );
}

export type { StatusBadgeProps, StatusBadgeTone };
