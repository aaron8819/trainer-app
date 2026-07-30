export const TRAINER_FINISHERS_ROLLOUT_VARIABLE =
  "TRAINER_FINISHERS_ROLLOUT";
export const TRAINER_FINISHERS_ROLLOUT_ENABLED_VALUE = "enabled";

export type FinisherRolloutStatus = "DISABLED" | "ENABLED";

export function finisherRolloutStatus(
  environment: Record<string, string | undefined> = process.env,
): FinisherRolloutStatus {
  return environment[TRAINER_FINISHERS_ROLLOUT_VARIABLE] ===
    TRAINER_FINISHERS_ROLLOUT_ENABLED_VALUE
    ? "ENABLED"
    : "DISABLED";
}

export function isFinisherRolloutEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return finisherRolloutStatus(environment) === "ENABLED";
}
