import { describe, expect, it } from "vitest";
import {
  deriveLoadEntryPolicy,
  formatFrozenLoadValue,
  isPositiveLoadProgressionEligible,
} from "./load-entry-policy";

describe("frozen load-entry policy", () => {
  it("derives the two explicit zero meanings without enabling machine progression", () => {
    const bulgarian = {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "IMPLEMENT_WEIGHT" as const,
        repBasis: "PER_SIDE" as const,
      },
      zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD" as const,
    };
    const hack = {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "MACHINE_DISPLAYED" as const,
        repBasis: "TOTAL" as const,
      },
      zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
    };

    expect(deriveLoadEntryPolicy(bulgarian)).toMatchObject({
      showLoadField: true,
      blankAllowedForPerformedSet: false,
      zeroAllowed: true,
      zeroDisplayLabel: "Bodyweight",
      positiveLoadProgressionEligible: true,
    });
    expect(deriveLoadEntryPolicy(hack)).toMatchObject({
      zeroAllowed: true,
      zeroDisplayLabel: "Machine default / no added load",
      positiveLoadProgressionEligible: false,
    });
    expect(isPositiveLoadProgressionEligible(bulgarian, 0)).toBe(false);
    expect(isPositiveLoadProgressionEligible(bulgarian, 20)).toBe(true);
    expect(isPositiveLoadProgressionEligible(hack, 20)).toBe(false);
    expect(
      deriveLoadEntryPolicy({
        measurement: {
          profile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
      }).zeroAllowed,
    ).toBe(false);
  });

  it("keeps legacy zero neutral and formats capability-backed zero labels", () => {
    const legacy = { measurement: null, zeroLoadMeaning: null };
    expect(formatFrozenLoadValue({ load: 0, snapshot: legacy }, (load) => `${load} lb`)).toBe("0 lb");
    expect(
      formatFrozenLoadValue(
        {
          load: 0,
          snapshot: {
            measurement: null,
            zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
          },
        },
        (load) => `${load} lb`,
      ),
    ).toBe("0 lb");
    expect(
      formatFrozenLoadValue(
        {
          load: 0,
          snapshot: {
            measurement: null,
            zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD",
          },
        },
        (load) => `${load} lb`,
      ),
    ).toBe("0 lb");
  });

  it("hides bodyweight-only load and treats bodyweight-plus-load zero as bodyweight", () => {
    expect(
      deriveLoadEntryPolicy({
        measurement: { profile: "REPS_BODYWEIGHT", repBasis: "TOTAL" },
        zeroLoadMeaning: null,
      }).showLoadField,
    ).toBe(false);
    expect(
      formatFrozenLoadValue(
        {
          load: 0,
          snapshot: {
            measurement: {
              profile: "REPS_BODYWEIGHT_PLUS_LOAD",
              loadConvention: "ADDED_EXTERNAL_LOAD",
              repBasis: "TOTAL",
            },
            zeroLoadMeaning: null,
          },
        },
        String,
      ),
    ).toBe("Bodyweight");
  });
});
