import { describe, expect, it } from "vitest";

import {
  buildV2AcceptedPlannerIntentDto,
  buildV2PlannerMesocyclePolicy,
} from "@/lib/engine/planning/v2";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";

describe("parseSlotPlanSeedJson", () => {
  const reductionManifest = {
    version: 1 as const,
    transformVersion: "short_today_v1" as const,
    seedRevisionNumber: 1 as const,
    executableRowsHash: "a".repeat(64),
    variants: [
      {
        week: 1,
        phase: "entry_calibration" as const,
        slotId: "upper_a",
        rows: ["bench", "row", "side"].map((exerciseId) => ({
          exerciseId,
          plannedSetCount: 3,
          shortSetCount: 3,
          omissionClass: "none" as const,
          yieldOrder: null,
          protectedClaims: [
            {
              kind: "minimum_session" as const,
              minimumRetainedSetCount: 1,
            },
          ],
        })),
        sessionProtectionProof: {
          anchorsRetained: true as const,
          requiredRolesRetained: true as const,
          directFloorsRetained: true as const,
          exposureRowsRetained: true as const,
          minimumSessionValidityRetained: true as const,
        },
      },
    ],
  };
  it("parses and normalizes the canonical slot-plan seed shape", () => {
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: " upper_a ",
            exercises: [
              { exerciseId: " bench ", name: " Incline DB Bench ", role: "CORE_COMPOUND", setCount: 4 },
              { exerciseId: " row ", name: " T-Bar Row ", role: "ACCESSORY", setCount: 3 },
            ],
          },
        ],
      })
    ).toEqual({
      version: 1,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              name: "Incline DB Bench",
              role: "CORE_COMPOUND",
              setCount: 4,
              hasExplicitName: true,
              hasExplicitSetCount: true,
            },
            {
              exerciseId: "row",
              name: "T-Bar Row",
              role: "ACCESSORY",
              setCount: 3,
              hasExplicitName: true,
              hasExplicitSetCount: true,
            },
          ],
        },
      ],
    });
  });

  it("round-trips a valid reduction manifest while legacy intent remains valid", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      slots: [],
      acceptedPlannerIntent: {
        ...acceptedPlannerIntent,
        sessionCapacityReductionManifest: reductionManifest,
      },
    });
    expect(
      parsed?.acceptedPlannerIntent?.sessionCapacityReductionManifest,
    ).toEqual(reductionManifest);
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [],
        acceptedPlannerIntent,
      })?.acceptedPlannerIntent,
    ).toEqual(acceptedPlannerIntent);
  });

  it("drops malformed reduction evidence without breaking As-planned parsing", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      slots: [],
      acceptedPlannerIntent: {
        ...acceptedPlannerIntent,
        sessionCapacityReductionManifest: {
          ...reductionManifest,
          executableRowsHash: "altered",
        },
      },
    });
    expect(parsed?.acceptedPlannerIntent).toEqual(acceptedPlannerIntent);
    expect(
      parsed?.acceptedPlannerIntent?.sessionCapacityReductionManifest,
    ).toBeUndefined();
  });

  it("keeps source and setCount optional so callers own legacy fallback behavior", () => {
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
        ],
      })
    ).toEqual({
      version: 1,
      source: undefined,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            hasExplicitName: false,
            hasExplicitSetCount: false,
          }],
        },
      ],
    });
  });

  it("parses and exposes valid optional accepted planner intent metadata", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();

    expect(
      parseSlotPlanSeedJson({
        version: 1,
        source: "handoff_slot_plan_projection",
        acceptedPlannerIntent,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
          },
        ],
      })?.acceptedPlannerIntent
    ).toEqual(acceptedPlannerIntent);
  });

  it("round-trips capacity explanation without changing executable rows", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto(
      buildV2PlannerMesocyclePolicy({
        directVolumeCapacityProfile: "moderate",
      }),
      {
        productChoice: "balanced",
        internalProfileId: "moderate",
        recommendationReason: "Balanced is the default recommendation.",
        recommendationAccepted: true,
        representativeProfileSummary:
          "Representative Week 2 workload: about 59 direct sets across 19 exercises.",
        durationDisclaimer:
          "Session duration is a planning priority, not an exact guarantee.",
      },
    );
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
        },
      ],
    });

    expect(parsed?.acceptedPlannerIntent?.capacitySelection).toEqual(
      acceptedPlannerIntent.capacitySelection,
    );
    expect(parsed?.slots[0]?.exercises[0]).toMatchObject({
      exerciseId: "bench",
      role: "CORE_COMPOUND",
      setCount: 4,
    });
    expect(parsed?.slots[0]?.exercises[0]).not.toHaveProperty(
      "capacitySelection",
    );
  });

  it("keeps legacy accepted planner metadata readable without inventing direct-volume fields", () => {
    const current = buildV2AcceptedPlannerIntentDto();
    const legacy = {
      ...current,
      muscleTargets: current.muscleTargets.map((row) => {
        const target = { ...row };
        delete target.preferredDirectSets;
        delete target.capacityFloorDirectSets;
        delete target.minimumDirectExposures;
        delete target.preferredDirectExposures;
        delete target.requiredRoleIntents;
        delete target.collateralRule;
        return target;
      }),
      weekPolicies: current.weekPolicies.map((week) => ({
        ...week,
        slots: week.slots.map((slot) => ({
          ...slot,
          lanes: slot.lanes.map((row) => {
            const lane = { ...row };
            delete lane.optionalTopUpStatus;
            return lane;
          }),
        })),
      })),
    };

    expect(
      parseSlotPlanSeedJson({
        version: 1,
        source: "handoff_slot_plan_projection",
        acceptedPlannerIntent: legacy,
        slots: [],
      })?.acceptedPlannerIntent,
    ).toEqual(legacy);
  });

  it("parses V2 source labels while keeping planner metadata outside executable rows", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
      ],
    });

    expect(parsed).toMatchObject({
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              role: "CORE_COMPOUND",
              setCount: 4,
              hasExplicitName: false,
              hasExplicitSetCount: true,
            },
          ],
        },
      ],
    });
    expect(parsed?.slots[0]?.exercises[0]).not.toHaveProperty(
      "acceptedPlannerIntent",
    );
  });

  it("ignores malformed optional accepted planner intent metadata while parsing valid slots", () => {
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      source: "handoff_slot_plan_projection",
      acceptedPlannerIntent: {
        version: 1,
        source: "v2_planner_policy",
        targetSkeletonId: "upper_lower_4x_v2",
        weekPolicies: "malformed",
      },
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
      ],
    });

    expect(parsed?.slots[0]?.exercises[0]).toMatchObject({
      exerciseId: "bench",
      role: "CORE_COMPOUND",
      setCount: 4,
    });
    expect(parsed?.acceptedPlannerIntent).toBeUndefined();
  });

  it("rejects invalid version, slots, ids, and roles", () => {
    expect(parseSlotPlanSeedJson(null)).toBeNull();
    expect(parseSlotPlanSeedJson({ version: 2, slots: [] })).toBeNull();
    expect(parseSlotPlanSeedJson({ version: 1, slots: null })).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [{ slotId: " ", exercises: [] }],
      })
    ).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "MAIN" }],
          },
        ],
      })
    ).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "", role: "ACCESSORY" }],
          },
        ],
      })
    ).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "ACCESSORY", setCount: 0 }],
          },
        ],
      })
    ).toBeNull();
  });
});
