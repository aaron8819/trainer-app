"use client";

import Link from "next/link";

type NavLinkProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
};

export function NavLink({ href, label, icon, isActive }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors md:flex-row md:gap-2 md:px-4 md:py-2 md:text-sm md:rounded-lg ${
        isActive
          ? "text-slate-900 font-semibold md:bg-slate-100"
          : "text-slate-500 hover:text-slate-700 md:hover:bg-slate-50"
      }`}
    >
      <span className="h-5 w-5 md:h-4 md:w-4">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
