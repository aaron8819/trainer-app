"use client";

import Link from "next/link";

type NavLinkProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  mode: "mobile" | "desktop";
};

export function NavLink({ href, label, icon, isActive, mode }: NavLinkProps) {
  const baseClassName =
    mode === "desktop"
      ? "flex min-h-0 min-w-0 flex-none flex-row items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
      : "flex min-h-11 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-xs leading-tight transition-colors";

  const stateClassName = isActive
    ? mode === "desktop"
      ? "font-semibold text-slate-900 bg-slate-100"
      : "font-semibold text-slate-900"
    : mode === "desktop"
      ? "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      : "text-slate-500 hover:text-slate-700";

  const iconClassName = mode === "desktop" ? "h-4 w-4" : "h-5 w-5";

  return (
    <Link
      href={href}
      className={`${baseClassName} ${stateClassName}`}
    >
      <span className={iconClassName}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
