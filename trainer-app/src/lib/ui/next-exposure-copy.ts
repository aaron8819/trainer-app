import type { NextExposureDecision } from "@/lib/engine/explainability";

export type CanonicalNextExposureCopy = {
  badge: string;
  summary: string;
  resultClause: string;
  actionPhrase: string;
  nextTimeImperative: string;
};

export function getCanonicalNextExposureCopy(
  action: NextExposureDecision["action"]
): CanonicalNextExposureCopy {
  switch (action) {
    case "increase":
      return {
        badge: "Increase next time",
        summary: "Next exposure: increase load.",
        resultClause: "points to an increase next time",
        actionPhrase: "Increase load",
        nextTimeImperative: "Increase load next time.",
      };
    case "recalibrated_increase":
      return {
        badge: "Recalibrated increase",
        summary: "Next exposure: recalibrated increase.",
        resultClause: "points to a recalibrated increase from the performed anchor",
        actionPhrase: "Use a recalibrated increase",
        nextTimeImperative: "Increase from today's performed anchor while recalibrating the written target.",
      };
    case "hold_at_recalibrated_anchor":
      return {
        badge: "Recalibrated hold",
        summary: "Next exposure: hold at recalibrated anchor.",
        resultClause: "points to a hold at the recalibrated performed anchor",
        actionPhrase: "Hold the recalibrated anchor",
        nextTimeImperative: "Hold the performed anchor next time because the written target was too low.",
      };
    case "decrease":
      return {
        badge: "Reduce next time",
        summary: "Next exposure: reduce load.",
        resultClause: "points to a reduction next time",
        actionPhrase: "Reduce load",
        nextTimeImperative: "Reduce load next time.",
      };
    case "recalibrate":
      return {
        badge: "Recalibrate target",
        summary: "Next exposure: recalibrate target.",
        resultClause: "needs target recalibration before increasing",
        actionPhrase: "Recalibrate target",
        nextTimeImperative: "Recalibrate the written target before increasing.",
      };
    case "target_too_high":
      return {
        badge: "Target too high",
        summary: "Next exposure: target likely too high.",
        resultClause: "shows the written target was likely too high",
        actionPhrase: "Lower the written target",
        nextTimeImperative: "Lower or rebuild the written target before increasing.",
      };
    case "insufficient_evidence":
      return {
        badge: "Insufficient evidence",
        summary: "Next exposure: not enough clean evidence.",
        resultClause: "does not give enough clean evidence for a load increase",
        actionPhrase: "Hold for cleaner evidence",
        nextTimeImperative: "Hold or review manually until cleaner set evidence is available.",
      };
    case "caution_review_manually":
      return {
        badge: "Review manually",
        summary: "Next exposure: review manually.",
        resultClause: "needs manual review before increasing",
        actionPhrase: "Review before increasing",
        nextTimeImperative: "Review the set log before increasing.",
      };
    default:
      return {
        badge: "Hold next time",
        summary: "Next exposure: hold load.",
        resultClause: "points to a hold next time",
        actionPhrase: "Hold load",
        nextTimeImperative: "Hold load next time.",
      };
  }
}
