type SectionShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

function joinClassNames(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function SectionShell({
  title,
  eyebrow,
  description,
  action,
  children,
  className,
}: SectionShellProps) {
  return (
    <section
      className={joinClassNames(
        "border-y border-slate-200 py-4 dark:border-slate-800",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-50">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600 dark:text-slate-300">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export type { SectionShellProps };
