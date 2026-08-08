import { describe, expect, it } from "vitest";
import {
  isExerciseMeasurementRolloutEnabled,
  TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_VARIABLE,
} from "./exercise-measurement-rollout";

describe("exercise measurement acceptance rollout", () => {
  it("is disabled by default and requires the exact enabled value", () => {
    expect(isExerciseMeasurementRolloutEnabled({})).toBe(false);
    expect(
      isExerciseMeasurementRolloutEnabled({
        [TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_VARIABLE]: "true",
      }),
    ).toBe(false);
    expect(
      isExerciseMeasurementRolloutEnabled({
        [TRAINER_EXERCISE_MEASUREMENT_ROLLOUT_VARIABLE]: "enabled",
      }),
    ).toBe(true);
  });
});
