"use client";

import { IntentWorkoutCard } from "./IntentWorkoutCard";
import type { HomeDecisionSummary } from "@/lib/api/home-page";

type DashboardGenerateSectionProps = {
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  initialSlotId?: string | null;
  primaryAction: { label: string; state: "planned"; mode: "generate" };
  nextSessionLabel: HomeDecisionSummary["nextSessionLabel"];
  nextSessionDescription: HomeDecisionSummary["nextSessionDescription"];
};

export function DashboardGenerateSection({
  initialIntent,
  initialSlotId,
  primaryAction,
  nextSessionLabel,
  nextSessionDescription,
}: DashboardGenerateSectionProps) {
  return (
    <section id="generate-workout">
      <IntentWorkoutCard
        initialIntent={initialIntent}
        initialSlotId={initialSlotId}
        primaryAction={primaryAction}
        nextSessionLabel={nextSessionLabel}
        nextSessionDescription={nextSessionDescription}
      />
    </section>
  );
}
