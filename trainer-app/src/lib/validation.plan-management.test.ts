import { describe, expect, it } from "vitest";
import {
  activatePlanSchema,
  createHypertrophyPlanSchema,
  createPlanSchema,
  renamePlanSchema,
} from "./validation";

describe("plan management validation", () => {
  it("normalizes plan names consistently for create and rename", () => {
    const create = createHypertrophyPlanSchema.parse({
      name: "  Summer   Hypertrophy  ",
      startDate: "2026-08-01",
      durationWeeks: 24,
    });
    const rename = renamePlanSchema.parse({
      name: "  Summer   Hypertrophy  ",
      expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
    });

    expect(create.name).toBe("Summer Hypertrophy");
    expect(rename.name).toBe("Summer Hypertrophy");
  });

  it("rejects blank and overlong names", () => {
    expect(
      renamePlanSchema.safeParse({
        name: "   ",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      renamePlanSchema.safeParse({
        name: "x".repeat(61),
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit active-plan compare-and-swap value", () => {
    expect(
      activatePlanSchema.safeParse({
        expectedActiveMacroCycleId: null,
      }).success,
    ).toBe(true);
    expect(activatePlanSchema.safeParse({}).success).toBe(false);
  });

  it("preserves the legacy hypertrophy creation contract", () => {
    expect(
      createPlanSchema.parse({
        name: "Existing Hypertrophy Flow",
        startDate: "2026-08-01",
        durationWeeks: 24,
      }),
    ).toMatchObject({
      planType: "HYPERTROPHY",
      name: "Existing Hypertrophy Flow",
      durationWeeks: 24,
    });
  });

  it("accepts a complete strength configuration", () => {
    expect(
      createPlanSchema.parse({
        planType: "STRENGTH",
        name: "  Fall   Strength  ",
        startDate: "2026-08-01",
        configuration: {
          emphasis: "BENCH",
          daysPerWeek: 4,
          sessionDurationMinutes: 60,
          equipmentProfile: "FULL_GYM",
          preferredLifts: {
            squat: "BACK_SQUAT",
            press: "BARBELL_BENCH",
            hinge: "CONVENTIONAL_DEADLIFT",
          },
        },
      }),
    ).toMatchObject({
      planType: "STRENGTH",
      name: "Fall Strength",
      configuration: {
        emphasis: "BENCH",
        daysPerWeek: 4,
        sessionDurationMinutes: 60,
      },
    });
  });

  it("rejects partial, unknown, and over-posted plan configurations", () => {
    const base = {
      planType: "STRENGTH",
      name: "Strength",
      startDate: "2026-08-01",
      configuration: {
        emphasis: "BALANCED",
        daysPerWeek: 4,
        sessionDurationMinutes: 60,
        equipmentProfile: "FULL_GYM",
        preferredLifts: {
          squat: "AUTO",
          press: "AUTO",
          hinge: "AUTO",
        },
      },
    };

    expect(
      createPlanSchema.safeParse({
        ...base,
        configuration: {
          ...base.configuration,
          preferredLifts: undefined,
        },
      }).success,
    ).toBe(false);
    expect(
      createPlanSchema.safeParse({ ...base, planType: "CONDITIONING" }).success,
    ).toBe(false);
    expect(
      createPlanSchema.safeParse({ ...base, unsupported: true }).success,
    ).toBe(false);
  });
});
