"use client";

import Link from "next/link";
import { IntentWorkoutCard } from "./IntentWorkoutCard";

type DashboardGenerateSectionProps = {
  templateCount: number;
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
};

export function DashboardGenerateSection({ templateCount, initialIntent }: DashboardGenerateSectionProps) {
  return (
    <section className="space-y-3" id="generate-workout">
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
        <p>
          Templates moved to their own area to keep generation simple.
          {templateCount > 0 ? ` ${templateCount} template${templateCount === 1 ? "" : "s"} available.` : " No templates yet."}
        </p>
        <Link className="mt-2 inline-block font-semibold text-slate-900" href="/templates">
          Go to templates
        </Link>
      </div>
      <IntentWorkoutCard initialIntent={initialIntent} />
    </section>
  );
}
