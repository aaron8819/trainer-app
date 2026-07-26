import { describe, expect, it } from "vitest";
import { buildV2AcceptedPlannerIntentDto } from "./accepted-planner-intent-dto";
import {
  buildSessionCapacityReductionManifest,
  fingerprintSessionCapacityExecutableRows,
  sanitizeSessionCapacityReductionManifest,
} from "./session-capacity-reduction-manifest";
import type { V2ExerciseMaterializationPlan } from "./materialization/types";

const executableSlots = [
  {
    slotId: "upper_b",
    exercises: [
      { exerciseId: "press", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "pull", role: "CORE_COMPOUND" as const, setCount: 3 },
      { exerciseId: "chest", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "row", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "side", role: "ACCESSORY" as const, setCount: 3 },
      { exerciseId: "biceps", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "triceps", role: "ACCESSORY" as const, setCount: 3 },
    ],
  },
];

const materializedPlan: V2ExerciseMaterializationPlan = {
  version: 1,
  source: "v2_exercise_materialization",
  dryRunOnly: true,
  status: "materialized",
  slots: [
    {
      slotId: "upper_b",
      exercises: [
        { exerciseId: "press", role: "ACCESSORY", setCount: 2, laneIds: ["vertical_press"] },
        { exerciseId: "pull", role: "CORE_COMPOUND", setCount: 3, laneIds: ["vertical_pull_anchor"] },
        { exerciseId: "chest", role: "ACCESSORY", setCount: 2, laneIds: ["chest_second_exposure"] },
        { exerciseId: "row", role: "ACCESSORY", setCount: 2, laneIds: ["row_support"] },
        { exerciseId: "side", role: "ACCESSORY", setCount: 3, laneIds: ["side_delt_isolation"] },
        { exerciseId: "biceps", role: "ACCESSORY", setCount: 2, laneIds: ["biceps"] },
        {
          exerciseId: "triceps",
          role: "ACCESSORY",
          setCount: 3,
          laneIds: ["optional_triceps_if_under_target"],
        },
      ],
    },
  ],
  blockers: [],
  omissions: [],
};

function acceptedIntent(choice: "full" | "balanced" | "efficient") {
  return buildV2AcceptedPlannerIntentDto(undefined, {
    productChoice: choice,
    internalProfileId:
      choice === "full" ? "preferred" : choice === "balanced" ? "moderate" : "minimal",
    recommendationReason: "test",
    recommendationAccepted: true,
    representativeProfileSummary: "test",
    durationDisclaimer: "estimate",
  });
}

describe("session capacity reduction manifest", () => {
  it("authors exact full, balanced, and efficient variants from concrete rows", () => {
    const full = buildSessionCapacityReductionManifest({
      executableSlots,
      materializedPlan,
      acceptedIntent: acceptedIntent("full"),
    })!;
    const balanced = buildSessionCapacityReductionManifest({
      executableSlots,
      materializedPlan,
      acceptedIntent: acceptedIntent("balanced"),
    })!;
    const efficient = buildSessionCapacityReductionManifest({
      executableSlots,
      materializedPlan,
      acceptedIntent: acceptedIntent("efficient"),
    })!;

    expect(full.executableRowsHash).toBe(
      fingerprintSessionCapacityExecutableRows(executableSlots),
    );
    expect(full.variants).toHaveLength(4);
    expect(full.variants[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "triceps",
          shortSetCount: 0,
          omissionClass: "optional_top_up",
          yieldOrder: 1,
        }),
        expect.objectContaining({
          exerciseId: "biceps",
          shortSetCount: 0,
          omissionClass: "preferred_surplus",
          yieldOrder: 2,
        }),
        expect.objectContaining({
          exerciseId: "side",
          shortSetCount: 1,
          omissionClass: "preferred_surplus",
        }),
        expect.objectContaining({
          exerciseId: "pull",
          shortSetCount: 3,
          omissionClass: "none",
        }),
      ]),
    );
    expect(
      balanced.variants[0]?.rows.find((row) => row.exerciseId === "side")
        ?.shortSetCount,
    ).toBe(3);
    expect(
      efficient.variants[0]?.rows.every(
        (row) => row.shortSetCount === row.plannedSetCount,
      ),
    ).toBe(true);
    expect(full.variants[0]?.rows).toEqual(full.variants[3]?.rows);
  });

  it("round-trips valid evidence and rejects altered bindings", () => {
    const manifest = buildSessionCapacityReductionManifest({
      executableSlots,
      materializedPlan,
      acceptedIntent: acceptedIntent("full"),
    })!;
    expect(sanitizeSessionCapacityReductionManifest(manifest)).toEqual(manifest);
    expect(
      sanitizeSessionCapacityReductionManifest({
        ...manifest,
        executableRowsHash: "altered",
      }),
    ).toBeUndefined();
  });

  it("fails authoring when a concrete materialized row does not match the seed", () => {
    expect(() =>
      buildSessionCapacityReductionManifest({
        executableSlots,
        materializedPlan: {
          ...materializedPlan,
          slots: [
            {
              ...materializedPlan.slots[0]!,
              exercises: materializedPlan.slots[0]!.exercises.map((row) =>
                row.exerciseId === "biceps" ? { ...row, setCount: 1 } : row,
              ),
            },
          ],
        },
        acceptedIntent: acceptedIntent("full"),
      }),
    ).toThrow("SESSION_CAPACITY_MANIFEST_ROW_BINDING_INVALID");
  });

  it("retains the only direct rear-delt, side-delt, calf, and hamstring-role exposures", () => {
    const protectedExecutableSlots = [
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "chest-anchor", role: "CORE_COMPOUND" as const, setCount: 3 },
          { exerciseId: "row-anchor", role: "CORE_COMPOUND" as const, setCount: 3 },
          { exerciseId: "vertical-pull", role: "ACCESSORY" as const, setCount: 2 },
          { exerciseId: "rear-only", role: "ACCESSORY" as const, setCount: 4 },
          { exerciseId: "side-only", role: "ACCESSORY" as const, setCount: 6 },
          { exerciseId: "triceps", role: "ACCESSORY" as const, setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "squat-anchor", role: "CORE_COMPOUND" as const, setCount: 3 },
          { exerciseId: "quad", role: "ACCESSORY" as const, setCount: 2 },
          { exerciseId: "curl-only", role: "ACCESSORY" as const, setCount: 3 },
          { exerciseId: "hinge-support", role: "ACCESSORY" as const, setCount: 2 },
          { exerciseId: "calf-only", role: "ACCESSORY" as const, setCount: 5 },
        ],
      },
      {
        slotId: "lower_b",
        exercises: [
          { exerciseId: "hinge-only", role: "CORE_COMPOUND" as const, setCount: 4 },
          { exerciseId: "knee-flexion-only", role: "ACCESSORY" as const, setCount: 4 },
          { exerciseId: "quad-support", role: "ACCESSORY" as const, setCount: 2 },
          { exerciseId: "calf-b", role: "ACCESSORY" as const, setCount: 4 },
          { exerciseId: "core", role: "ACCESSORY" as const, setCount: 2 },
        ],
      },
    ];
    const protectedMaterializedPlan: V2ExerciseMaterializationPlan = {
      version: 1,
      source: "v2_exercise_materialization",
      dryRunOnly: true,
      status: "materialized",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            ["chest-anchor", "CORE_COMPOUND", 3, "chest_anchor"],
            ["row-anchor", "CORE_COMPOUND", 3, "row_anchor"],
            ["vertical-pull", "ACCESSORY", 2, "vertical_pull_support"],
            ["rear-only", "ACCESSORY", 4, "rear_delt"],
            ["side-only", "ACCESSORY", 6, "side_delt_isolation"],
            ["triceps", "ACCESSORY", 3, "triceps"],
          ].map(([exerciseId, role, setCount, laneId]) => ({
            exerciseId: exerciseId as string,
            role: role as "CORE_COMPOUND" | "ACCESSORY",
            setCount: setCount as number,
            laneIds: [laneId as string],
          })),
        },
        {
          slotId: "lower_a",
          exercises: [
            ["squat-anchor", "CORE_COMPOUND", 3, "squat_anchor"],
            ["quad", "ACCESSORY", 2, "quad_isolation"],
            ["curl-only", "ACCESSORY", 3, "hamstring_curl"],
            ["hinge-support", "ACCESSORY", 2, "secondary_hinge"],
            ["calf-only", "ACCESSORY", 5, "calves"],
          ].map(([exerciseId, role, setCount, laneId]) => ({
            exerciseId: exerciseId as string,
            role: role as "CORE_COMPOUND" | "ACCESSORY",
            setCount: setCount as number,
            laneIds: [laneId as string],
          })),
        },
        {
          slotId: "lower_b",
          exercises: [
            ["hinge-only", "CORE_COMPOUND", 4, "hinge_anchor"],
            ["knee-flexion-only", "ACCESSORY", 4, "knee_flexion_curl"],
            ["quad-support", "ACCESSORY", 2, "quad_support"],
            ["calf-b", "ACCESSORY", 4, "calves"],
            ["core", "ACCESSORY", 2, "optional_glute_core_if_recoverable"],
          ].map(([exerciseId, role, setCount, laneId]) => ({
            exerciseId: exerciseId as string,
            role: role as "CORE_COMPOUND" | "ACCESSORY",
            setCount: setCount as number,
            laneIds: [laneId as string],
          })),
        },
      ],
      blockers: [],
      omissions: [],
    };
    const manifest = buildSessionCapacityReductionManifest({
      executableSlots: protectedExecutableSlots,
      materializedPlan: protectedMaterializedPlan,
      acceptedIntent: acceptedIntent("full"),
    })!;
    const rows = new Map(
      manifest.variants
        .filter((variant) => variant.week === 1)
        .flatMap((variant) =>
          variant.rows.map((row) => [row.exerciseId, row] as const),
        ),
    );

    expect(rows.get("rear-only")).toMatchObject({
      shortSetCount: 2,
      protectedClaims: expect.arrayContaining([
        { kind: "direct_exposure", minimumRetainedSetCount: 1 },
      ]),
    });
    expect(rows.get("side-only")).toMatchObject({
      shortSetCount: 4,
      protectedClaims: expect.arrayContaining([
        { kind: "direct_floor", minimumRetainedSetCount: 4 },
      ]),
    });
    expect(rows.get("calf-only")).toMatchObject({
      shortSetCount: 3,
      protectedClaims: expect.arrayContaining([
        { kind: "calf_exposure", minimumRetainedSetCount: 3 },
      ]),
    });
    expect(rows.get("curl-only")).toMatchObject({
      shortSetCount: 1,
      protectedClaims: expect.arrayContaining([
        { kind: "hamstring_knee_flexion", minimumRetainedSetCount: 1 },
      ]),
    });
    expect(rows.get("hinge-only")).toMatchObject({
      shortSetCount: 4,
      protectedClaims: expect.arrayContaining([
        { kind: "hamstring_hinge", minimumRetainedSetCount: 3 },
      ]),
    });
    expect(rows.get("knee-flexion-only")).toMatchObject({
      shortSetCount: 3,
      protectedClaims: expect.arrayContaining([
        { kind: "hamstring_knee_flexion", minimumRetainedSetCount: 3 },
      ]),
    });
  });
});
