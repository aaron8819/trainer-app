import { describe, expect, it } from "vitest";
import { profileSetupSchema } from "./validation";

const baseProfilePayload = {
  trainingAge: "INTERMEDIATE" as const,
  primaryGoal: "HYPERTROPHY" as const,
  secondaryGoal: "CONDITIONING" as const,
  daysPerWeek: 4,
  sessionMinutes: 55,
};

describe("profileSetupSchema", () => {
  it("accepts payloads when splitType is omitted", () => {
    const parsed = profileSetupSchema.safeParse(baseProfilePayload);
    expect(parsed.success).toBe(true);
  });

  it("still accepts explicit splitType when provided", () => {
    const parsed = profileSetupSchema.safeParse({
      ...baseProfilePayload,
      splitType: "UPPER_LOWER",
    });
    expect(parsed.success).toBe(true);
  });
});
