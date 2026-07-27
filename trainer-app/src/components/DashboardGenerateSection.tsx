"use client";

import { IntentWorkoutCard } from "./IntentWorkoutCard";
import type { HomeDecisionSummary } from "@/lib/api/home-page";
import type { HomeEligibleSession } from "@/lib/api/program";

type DashboardGenerateSectionProps = {
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  initialSlotId?: string | null;
  eligibleAlternativeSessions?: HomeEligibleSession[];
  primaryAction: { label: string; state: "planned"; mode: "generate" };
  nextSessionLabel: HomeDecisionSummary["nextSessionLabel"];
  nextSessionDescription: HomeDecisionSummary["nextSessionDescription"];
};

export function DashboardGenerateSection({
  initialIntent,
  initialSlotId,
  eligibleAlternativeSessions,
  primaryAction,
  nextSessionLabel,
  nextSessionDescription,
}: DashboardGenerateSectionProps) {
  return (
    <section id="generate-workout">
      <IntentWorkoutCard
        initialIntent={initialIntent}
        initialSlotId={initialSlotId}
        eligibleAlternativeSessions={eligibleAlternativeSessions}
        primaryAction={primaryAction}
        nextSessionLabel={nextSessionLabel}
        nextSessionDescription={nextSessionDescription}
      />
    </section>
  );
}
