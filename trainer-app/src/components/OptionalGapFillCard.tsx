"use client";

import type { GapFillSupportData } from "@/lib/api/program";
import { OptionalWeekCompletion } from "./OptionalWeekCompletion";

type OptionalGapFillCardProps = {
  gapFill: GapFillSupportData;
};

export function OptionalGapFillCard({ gapFill }: OptionalGapFillCardProps) {
  return (
    <OptionalWeekCompletion
      activeWeek={gapFill.targetWeek ?? gapFill.anchorWeek}
      gapFill={gapFill}
    />
  );
}
