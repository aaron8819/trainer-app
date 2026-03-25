"use client";

import { IntentWorkoutCard } from "./IntentWorkoutCard";

type DashboardGenerateSectionProps = {
  initialIntent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  initialSlotId?: string | null;
  recommendedReasonLabel?: string | null;
  recommendedReasonDetail?: string | null;
};

export function DashboardGenerateSection({
  initialIntent,
  initialSlotId,
  recommendedReasonLabel,
  recommendedReasonDetail,
}: DashboardGenerateSectionProps) {
  return (
    <section id="generate-workout">
      <IntentWorkoutCard
        initialIntent={initialIntent}
        initialSlotId={initialSlotId}
        recommendedReasonLabel={recommendedReasonLabel}
        recommendedReasonDetail={recommendedReasonDetail}
      />
    </section>
  );
}
