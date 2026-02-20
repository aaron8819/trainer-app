import { describe, expect, it } from "vitest";
import { setLogSchema } from "./validation";

describe("setLogSchema", () => {
  it("accepts valid half-step RPE and non-negative load", () => {
    const parsed = setLogSchema.parse({
      workoutSetId: "set-1",
      actualReps: 8,
      actualRpe: 8.5,
      actualLoad: 135,
      wasSkipped: false,
    });

    expect(parsed.actualRpe).toBe(8.5);
    expect(parsed.actualLoad).toBe(135);
  });

  it("rejects RPE outside range", () => {
    const parsed = setLogSchema.safeParse({
      workoutSetId: "set-1",
      actualRpe: 10.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects RPE values that are not 0.5 increments", () => {
    const parsed = setLogSchema.safeParse({
      workoutSetId: "set-1",
      actualRpe: 8.25,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative loads", () => {
    const parsed = setLogSchema.safeParse({
      workoutSetId: "set-1",
      actualLoad: -5,
    });
    expect(parsed.success).toBe(false);
  });
});
