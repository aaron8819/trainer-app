"use client";

import Link from "next/link";
import { IntentWorkoutCard } from "./IntentWorkoutCard";

type DashboardGenerateSectionProps = {
  templateCount: number;
};

export function DashboardGenerateSection({ templateCount }: DashboardGenerateSectionProps) {
  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
        <p>
          Templates moved to their own area to keep generation simple.
          {templateCount > 0 ? ` ${templateCount} template${templateCount === 1 ? "" : "s"} available.` : " No templates yet."}
        </p>
        <Link className="mt-2 inline-block font-semibold text-slate-900" href="/templates">
          Go to templates
        </Link>
      </div>
      <IntentWorkoutCard />
    </section>
  );
}
