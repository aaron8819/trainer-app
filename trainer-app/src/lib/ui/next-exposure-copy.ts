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
    case "decrease":
      return {
        badge: "Reduce next time",
        summary: "Next exposure: reduce load.",
        resultClause: "points to a reduction next time",
        actionPhrase: "Reduce load",
        nextTimeImperative: "Reduce load next time.",
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
