import { describe, expect, it } from "vitest";
import {
  createFinisherRoutineSchema,
  duplicateFinisherRoutineSchema,
  editFinisherRoutineSchema,
  finisherRoutineDefinitionSchema,
  reorderFinisherLibrarySchema,
} from "./validation";

const definition = {
  name: "Core reset",
  description: "A short controlled core sequence.",
  category: "CORE" as const,
  difficulty: "MODERATE" as const,
  fatigueCost: "LOW" as const,
  impactLevel: "LOW" as const,
  bodyRegions: ["core"] as const,
  limitationTags: ["lower_back"] as const,
  preparationSeconds: 10,
  includesFinalRecovery: false,
  steps: [
    {
      movementName: "Dead bug",
      workSeconds: 40,
      recoverySeconds: 20,
      techniqueCues: ["Keep the back flat"],
      alternatives: ["Heel tap dead bug"],
    },
  ],
};

describe("Finisher library validation", () => {
  it("accepts only the supported fixed timed-routine fields", () => {
    expect(createFinisherRoutineSchema.parse({ definition })).toEqual({
      definition,
    });
    expect(
      createFinisherRoutineSchema.safeParse({
        definition: { ...definition, equipmentRequirements: ["BAND"] },
      }).success,
    ).toBe(false);
    expect(
      createFinisherRoutineSchema.safeParse({
        definition: { ...definition, placement: "PRE_WORKOUT" },
      }).success,
    ).toBe(false);
  });

  it("enforces controlled regions, canonical limitations, step limits, and child limits", () => {
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        bodyRegions: ["chest"],
      }).success,
    ).toBe(false);
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        limitationTags: ["sore_everywhere"],
      }).success,
    ).toBe(false);
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        steps: [],
      }).success,
    ).toBe(false);
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        steps: [{ ...definition.steps[0], techniqueCues: ["1", "2", "3", "4"] }],
      }).success,
    ).toBe(false);
  });

  it("computes the recovery-aware duration and caps it at 30 minutes", () => {
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        includesFinalRecovery: true,
        steps: Array.from({ length: 3 }, (_, index) => ({
          ...definition.steps[0],
          movementName: `Step ${index + 1}`,
          workSeconds: 300,
          recoverySeconds: 300,
        })),
      }).success,
    ).toBe(true);
    expect(
      finisherRoutineDefinitionSchema.safeParse({
        ...definition,
        includesFinalRecovery: true,
        steps: Array.from({ length: 4 }, (_, index) => ({
          ...definition.steps[0],
          movementName: `Step ${index + 1}`,
          workSeconds: 300,
          recoverySeconds: 300,
        })),
      }).success,
    ).toBe(false);
  });

  it("requires CAS revisions and an exact duplicate-free reorder identity list", () => {
    expect(
      editFinisherRoutineSchema.safeParse({
        expectedRevision: 0,
        definition,
      }).success,
    ).toBe(true);
    const routineId = "00000000-0000-4000-8000-000000000001";
    expect(
      duplicateFinisherRoutineSchema.safeParse({
        expectedRoutineVersionId: routineId,
      }).success,
    ).toBe(true);
    expect(duplicateFinisherRoutineSchema.safeParse({}).success).toBe(false);
    expect(
      reorderFinisherLibrarySchema.safeParse({
        items: [
          { routineId, expectedRevision: 1 },
          { routineId, expectedRevision: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});
