import type { HTMLAttributes } from "react";

type ProgressBarTone = "default" | "success" | "warning" | "danger";
type ProgressBarSize = "default" | "compact";

type ProgressBarProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  max?: number;
  tone?: ProgressBarTone;
  size?: ProgressBarSize;
};

const TONE_STYLES: Record<ProgressBarTone, string> = {
  default: "bg-slate-900 dark:bg-slate-100",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
};

const SIZE_STYLES: Record<ProgressBarSize, string> = {
  default: "h-2",
  compact: "h-1.5",
};

function joinClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ProgressBar({
  value,
  max = 100,
  tone = "default",
  size = "default",
  className,
  ...props
}: ProgressBarProps) {
  const boundedMax = max > 0 ? max : 100;
  const boundedValue = clamp(value, 0, boundedMax);
  const percent = (boundedValue / boundedMax) * 100;

  return (
    <div
      aria-valuemax={boundedMax}
      aria-valuemin={0}
      aria-valuenow={boundedValue}
      className={joinClassNames(
        "w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800",
        SIZE_STYLES[size],
        className
      )}
      role="progressbar"
      {...props}
    >
      <div
        className={joinClassNames("h-full rounded-full transition-all", TONE_STYLES[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export type { ProgressBarProps, ProgressBarSize, ProgressBarTone };
