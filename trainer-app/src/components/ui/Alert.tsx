import type { HTMLAttributes, ReactNode } from "react";

type AlertTone = "neutral" | "info" | "warning" | "success" | "critical";

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: AlertTone;
  eyebrow?: string;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
};

const TONE_STYLES: Record<AlertTone, { container: string; eyebrow: string; title: string; body: string }> = {
  neutral: {
    container:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
    eyebrow: "text-slate-500 dark:text-slate-400",
    title: "text-slate-950 dark:text-slate-50",
    body: "text-slate-600 dark:text-slate-300",
  },
  info: {
    container:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
    eyebrow: "text-sky-700 dark:text-sky-300",
    title: "text-sky-950 dark:text-sky-50",
    body: "text-sky-800 dark:text-sky-100",
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    eyebrow: "text-amber-700 dark:text-amber-300",
    title: "text-slate-950 dark:text-amber-50",
    body: "text-amber-900 dark:text-amber-100",
  },
  success: {
    container:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    eyebrow: "text-emerald-700 dark:text-emerald-300",
    title: "text-emerald-950 dark:text-emerald-50",
    body: "text-emerald-900 dark:text-emerald-100",
  },
  critical: {
    container:
      "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100",
    eyebrow: "text-rose-700 dark:text-rose-300",
    title: "text-rose-950 dark:text-rose-50",
    body: "text-rose-800 dark:text-rose-100",
  },
};

function joinClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function Alert({
  tone = "neutral",
  eyebrow,
  title,
  action,
  children,
  className,
  ...props
}: AlertProps) {
  const styles = TONE_STYLES[tone];

  return (
    <div
      className={joinClassNames("rounded-lg border p-4 shadow-sm", styles.container, className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className={joinClassNames("text-xs font-semibold uppercase", styles.eyebrow)}>
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <p className={joinClassNames(eyebrow ? "mt-1" : undefined, "text-sm font-semibold", styles.title)}>
              {title}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? (
        <div className={joinClassNames(title || eyebrow ? "mt-2" : undefined, "text-sm leading-5", styles.body)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export type { AlertProps, AlertTone };
