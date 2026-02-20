/**
 * Protects: Intent generation is intent-aligned (push/pull/legs/upper/lower/full_body/body_part(targetMuscles)) with diagnostics.
 * Why it matters: Request validation is the first contract guard for intent-specific generation semantics.
 */
import { describe, expect, it } from "vitest";
import { generateFromIntentSchema, generateFromTemplateSchema } from "./validation";

describe("generate workout schemas", () => {
  it("accepts template generation auto-fill fields", () => {
    const parsed = generateFromTemplateSchema.parse({
      templateId: "template-1",
      pinnedExerciseIds: ["bench", "row"],
      autoFillUnpinned: true,
    });

    expect(parsed.templateId).toBe("template-1");
    expect(parsed.pinnedExerciseIds).toEqual(["bench", "row"]);
    expect(parsed.autoFillUnpinned).toBe(true);
  });

  it("requires targetMuscles for body_part intent", () => {
    const parsed = generateFromIntentSchema.safeParse({
      intent: "body_part",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts non-body_part intent without targetMuscles", () => {
    const parsed = generateFromIntentSchema.parse({
      intent: "push",
      pinnedExerciseIds: ["bench"],
    });

    expect(parsed.intent).toBe("push");
  });
});
