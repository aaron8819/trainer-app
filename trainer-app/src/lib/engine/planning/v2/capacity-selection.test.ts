import { describe, expect, it } from "vitest";
import {
  buildV2CapacitySelectionExplanation,
  isSupportedV2CapacityTopology,
  mapV2CapacityChoiceToProfile,
  recommendV2CapacityChoice,
  V2_CAPACITY_PRODUCT_CHOICES,
  V2_CAPACITY_PRODUCT_OPTIONS,
} from "./capacity-selection";

describe("V2 capacity selection", () => {
  it("owns the exhaustive product-choice to planner-profile mapping", () => {
    expect(
      Object.fromEntries(
        V2_CAPACITY_PRODUCT_CHOICES.map((choice) => [
          choice,
          mapV2CapacityChoiceToProfile(choice),
        ]),
      ),
    ).toEqual({
      efficient: "minimal",
      balanced: "moderate",
      full: "preferred",
    });
  });

  it("keeps public labels aligned without exposing internal profile ids", () => {
    expect(V2_CAPACITY_PRODUCT_OPTIONS.map((option) => option.label)).toEqual([
      "Efficient",
      "Balanced",
      "Full",
    ]);
    expect(JSON.stringify(V2_CAPACITY_PRODUCT_OPTIONS)).not.toMatch(
      /minimal|moderate|preferred/,
    );
  });

  it("defaults no preference to Balanced", () => {
    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: true,
        trainingAge: "intermediate",
      }),
    ).toMatchObject({ choice: "balanced" });
  });

  it("recommends Efficient for a strict approximately 45-minute priority", () => {
    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: true,
        timePriority: "strict_45",
        trainingAge: "advanced",
        recoveryTolerance: "high",
      }),
    ).toMatchObject({ choice: "efficient" });
  });

  it("recommends Full only with explicit time, volume, experience, and recovery eligibility", () => {
    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: true,
        timePriority: "full_60_plus_high_volume",
        trainingAge: "intermediate",
        recoveryTolerance: "normal",
      }),
    ).toMatchObject({ choice: "full" });

    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: true,
        timePriority: "full_60_plus_high_volume",
        trainingAge: "beginner",
        recoveryTolerance: "high",
      }),
    ).toMatchObject({ choice: "balanced" });
    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: true,
        timePriority: "full_60_plus_high_volume",
        trainingAge: "advanced",
        recoveryTolerance: "low",
      }),
    ).toMatchObject({ choice: "balanced" });
  });

  it("allows an explicit override while preserving recommendation explanation", () => {
    const recommendation = recommendV2CapacityChoice({
      supportedFourDayUpperLower: true,
      timePriority: "strict_45",
    });
    expect(recommendation).not.toBeNull();

    expect(
      buildV2CapacitySelectionExplanation({
        productChoice: "balanced",
        recommendation: recommendation!,
      }),
    ).toMatchObject({
      productChoice: "balanced",
      internalProfileId: "moderate",
      recommendationAccepted: false,
    });
  });

  it("accepts only the balanced four-day Upper/Lower topology", () => {
    expect(
      isSupportedV2CapacityTopology({
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        slots: [
          { intent: "UPPER" },
          { intent: "LOWER" },
          { intent: "UPPER" },
          { intent: "LOWER" },
        ],
      }),
    ).toBe(true);
    expect(
      isSupportedV2CapacityTopology({
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        slots: [
          { intent: "UPPER" },
          { intent: "LOWER" },
          { intent: "UPPER" },
        ],
      }),
    ).toBe(false);
    expect(
      recommendV2CapacityChoice({
        supportedFourDayUpperLower: false,
        timePriority: "strict_45",
      }),
    ).toBeNull();
  });
});
