export type ProgressionAnchorStrategy = "top_set" | "modal";

export function resolveProgressionAnchorStrategy(input: {
  isMainLiftEligible?: boolean | null;
}): ProgressionAnchorStrategy {
  return input.isMainLiftEligible ? "top_set" : "modal";
}
