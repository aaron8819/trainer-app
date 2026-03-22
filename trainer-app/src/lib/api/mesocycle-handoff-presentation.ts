import type {
  NextCycleSeedDraft,
  NextMesocycleDesign,
} from "./mesocycle-handoff-contract";

export type FrozenRecommendationPresentation = {
  summary: string;
  structureReasons: string[];
  carryForwardSummary: string;
  slotOrderSummary: string;
  startingPointSummary: string;
  startingPointReasons: string[];
};

function formatSplitType(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function humanizeReasonCode(code: string): string {
  switch (code) {
    case "preferred_frequency_honored":
      return "Preferred weekly frequency was carried forward.";
    case "preferred_frequency_capped_by_constraints":
      return "Weekly frequency was capped by current availability constraints.";
    case "default_frequency_cap_applied":
      return "Weekly frequency stayed on the supported handoff cap for this recommendation.";
    case "weekly_schedule_split_preference_honored":
      return "The prior weekly schedule topology stayed compatible and informed the split.";
    case "preferred_split_honored":
      return "Preferred split was carried forward.";
    case "default_upper_lower_for_four_plus_sessions":
      return "Upper / lower best fit the recommended four-plus-session schedule.";
    case "default_ppl_for_three_sessions":
      return "Push / pull / legs best fit the recommended three-session schedule.";
    case "default_full_body_for_low_frequency":
      return "Full body best fit the recommended lower-frequency schedule.";
    case "explicit_weekly_schedule_order_honored":
      return "The prior slot order stayed compatible and was preserved.";
    case "legacy_pending_handoff_fallback":
      return "This recommendation was reconstructed from the stored draft because the original design record was unavailable.";
    case "user_edited_structure":
      return "The editable draft changed the original handoff structure.";
    case "conservative_entry_after_deload_boundary":
      return "The next cycle re-enters accumulation conservatively after the deload boundary.";
    case "carry_forward_mesocycle_profile_default":
      return "Focus and mesocycle profile were carried forward as the recommended continuation.";
    default:
      return code
        .replaceAll("_", " ")
        .replace(/\b\w/g, (match) => match.toUpperCase())
        .concat(".");
    }
}

function formatReasonList(reasonCodes: string[]): string[] {
  const seen = new Set<string>();

  return reasonCodes.flatMap((reasonCode) => {
    const message = humanizeReasonCode(reasonCode);
    if (seen.has(message)) {
      return [];
    }
    seen.add(message);
    return [message];
  });
}

function buildCarryForwardSummary(recommendationDraft: NextCycleSeedDraft): string {
  const keepCount = recommendationDraft.carryForwardSelections.filter(
    (selection) => selection.action === "keep"
  ).length;
  const rotateCount = recommendationDraft.carryForwardSelections.filter(
    (selection) => selection.action === "rotate"
  ).length;
  const dropCount = recommendationDraft.carryForwardSelections.filter(
    (selection) => selection.action === "drop"
  ).length;

  return `Carry-forward decisions at handoff: ${keepCount} keep, ${rotateCount} rotate, ${dropCount} drop.`;
}

export function buildFrozenRecommendationPresentation(input: {
  recommendationDraft: NextCycleSeedDraft;
  recommendedDesign?: NextMesocycleDesign;
}): FrozenRecommendationPresentation {
  return {
    summary: `${input.recommendationDraft.structure.sessionsPerWeek}x/week ${formatSplitType(
      input.recommendationDraft.structure.splitType
    )}. This frozen recommendation is the evidence-based design baseline saved at handoff close.`,
    structureReasons: formatReasonList(
      input.recommendedDesign?.explainability.structureReasonCodes ?? []
    ),
    carryForwardSummary: buildCarryForwardSummary(input.recommendationDraft),
    slotOrderSummary:
      "Ordered-flexible keeps the slot order fixed while still allowing week-to-week scheduling flexibility.",
    startingPointSummary:
      "The next cycle re-enters accumulation from a conservative baseline chosen from the closeout evidence, rather than carrying deload forward.",
    startingPointReasons: formatReasonList(
      input.recommendedDesign?.explainability.startingPointReasonCodes ?? []
    ),
  };
}
