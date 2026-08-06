export const TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_VARIABLE =
  "TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT";
export const TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_ENABLED_VALUE =
  "enabled";

export function isCustomHypertrophyPlanRolloutEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    environment[TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_VARIABLE] ===
    TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_ENABLED_VALUE
  );
}
