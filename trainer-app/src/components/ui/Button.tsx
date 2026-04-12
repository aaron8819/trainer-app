import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "touch";

type ButtonClassNameOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonClassNameOptions;

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white",
  secondary:
    "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900",
  ghost:
    "border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900",
  danger:
    "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 dark:border-rose-500 dark:bg-rose-600 dark:hover:bg-rose-500",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
  touch: "min-h-11 px-5 py-2 text-sm",
};

function joinClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonClassNameOptions = {}) {
  return joinClassNames(
    "inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    VARIANT_STYLES[variant],
    SIZE_STYLES[size],
    className
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClassName({ variant, size, className })}
      type={type}
      {...props}
    />
  );
}

export type { ButtonProps, ButtonSize, ButtonVariant };
