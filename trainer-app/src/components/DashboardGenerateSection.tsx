"use client";

import { IntentWorkoutCard } from "./IntentWorkoutCard";

type DashboardGenerateSectionProps = {
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  initialSlotId?: string | null;
};

export function DashboardGenerateSection({ initialIntent, initialSlotId }: DashboardGenerateSectionProps) {
  return (
    <section id="generate-workout">
      <IntentWorkoutCard initialIntent={initialIntent} initialSlotId={initialSlotId} />
    </section>
  );
}
