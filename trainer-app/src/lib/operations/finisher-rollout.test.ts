import { describe, expect, it } from "vitest";
import {
  finisherRolloutStatus,
  isFinisherRolloutEnabled,
  TRAINER_FINISHERS_ROLLOUT_ENABLED_VALUE,
  TRAINER_FINISHERS_ROLLOUT_VARIABLE,
} from "./finisher-rollout";

describe("Finisher rollout setting", () => {
  it.each([undefined, "", "false", "disabled", "ENABLED", " enabled ", "1"])(
    "fails closed when the configured value is %s",
    (value) => {
      const environment = { [TRAINER_FINISHERS_ROLLOUT_VARIABLE]: value };

      expect(finisherRolloutStatus(environment)).toBe("DISABLED");
      expect(isFinisherRolloutEnabled(environment)).toBe(false);
    },
  );

  it("enables only the exact explicit value", () => {
    const environment = {
      [TRAINER_FINISHERS_ROLLOUT_VARIABLE]:
        TRAINER_FINISHERS_ROLLOUT_ENABLED_VALUE,
    };

    expect(finisherRolloutStatus(environment)).toBe("ENABLED");
    expect(isFinisherRolloutEnabled(environment)).toBe(true);
  });
});
