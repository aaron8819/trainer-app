export const TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_VARIABLE =
  "TRAINER_EXERCISE_MEASUREMENT_ROLLOUT";
export const TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_ENABLED_VALUE = "enabled";

export function isExerciseMeasurementRolloutEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    environment[TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_VARIABLE] ===
    TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_ENABLED_VALUE
  );
}
