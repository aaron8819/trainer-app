"use client";

import { IntentWorkoutCard } from "./IntentWorkoutCard";

type DashboardGenerateSectionProps = {
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
};

export function DashboardGenerateSection({ initialIntent }: DashboardGenerateSectionProps) {
  return (
    <section id="generate-workout">
      <IntentWorkoutCard initialIntent={initialIntent} />
    </section>
  );
}
