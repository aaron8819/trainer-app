import { describe, expect, it } from "vitest";
import { createTemplateSchema, updateTemplateSchema } from "./validation";

describe("template schemas", () => {
  it("defaults intent to CUSTOM on template create", () => {
    const parsed = createTemplateSchema.parse({
      name: "My Template",
      exercises: [{ exerciseId: "ex-1", orderIndex: 0 }],
    });

    expect(parsed.intent).toBe("CUSTOM");
  });

  it("accepts intent and supersetGroup on template create", () => {
    const parsed = createTemplateSchema.parse({
      name: "Upper A",
      intent: "UPPER_LOWER",
      exercises: [{ exerciseId: "ex-1", orderIndex: 0, supersetGroup: 1 }],
    });

    expect(parsed.intent).toBe("UPPER_LOWER");
    expect(parsed.exercises[0].supersetGroup).toBe(1);
  });

  it("rejects invalid supersetGroup values", () => {
    const invalid = createTemplateSchema.safeParse({
      name: "Upper A",
      exercises: [{ exerciseId: "ex-1", orderIndex: 0, supersetGroup: 0 }],
    });

    expect(invalid.success).toBe(false);
  });

  it("allows partial update with intent only", () => {
    const parsed = updateTemplateSchema.parse({
      intent: "BODY_PART",
    });

    expect(parsed.intent).toBe("BODY_PART");
  });
});
