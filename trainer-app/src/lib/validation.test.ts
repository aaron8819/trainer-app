import { describe, expect, it } from "vitest";
import {
  generateFromIntentSchema,
  generateFromTemplateSchema,
  profileSetupSchema,
  createTemplateSchema,
  updateTemplateSchema,
  saveWorkoutSchema,
} from "./validation";

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

describe("profileSetupSchema", () => {
  const baseProfilePayload = {
    trainingAge: "INTERMEDIATE" as const,
    primaryGoal: "HYPERTROPHY" as const,
    secondaryGoal: "CONDITIONING" as const,
    daysPerWeek: 4,
    sessionMinutes: 55,
  };

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

  it("accepts weekly schedule intent arrays", () => {
    const parsed = profileSetupSchema.safeParse({
      ...baseProfilePayload,
      weeklySchedule: ["PUSH", "PULL", "LEGS", "UPPER"],
    });
    expect(parsed.success).toBe(true);
  });
});

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

describe("saveWorkoutSchema", () => {
  it("accepts optional targetRepRange on sets", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-1",
      exercises: [
        {
          exerciseId: "exercise-1",
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepRange: { min: 10, max: 15 },
            },
          ],
        },
      ],
    });

    expect(parsed.exercises?.[0].sets[0].targetRepRange).toEqual({ min: 10, max: 15 });
  });

  it("rejects invalid targetRepRange bounds", () => {
    const parsed = saveWorkoutSchema.safeParse({
      workoutId: "workout-1",
      exercises: [
        {
          exerciseId: "exercise-1",
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepRange: { min: 15, max: 10 },
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts intent persistence metadata", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-1",
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: {
        selectedExerciseIds: ["curl", "preacher"],
      },
    });

    expect(parsed.selectionMode).toBe("INTENT");
    expect(parsed.sessionIntent).toBe("BODY_PART");
  });
});
