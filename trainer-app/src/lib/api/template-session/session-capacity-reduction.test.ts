import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import {
  fingerprintSessionCapacityExecutableRows,
  type SessionCapacityReductionManifest,
} from "@/lib/engine/planning/v2";
import {
  applySessionCapacityReduction,
  fingerprintSessionCapacityWorkout,
} from "./session-capacity-reduction";

function exercise(
  exerciseId: string,
  setCount: number,
  role: "main" | "accessory",
): WorkoutExercise {
  return {
    id: exerciseId,
    exercise: {
      id: exerciseId,
      name: exerciseId.toUpperCase(),
      movementPatterns: [],
      splitTags: [],
      jointStress: "low",
      equipment: [],
    },
    orderIndex: 0,
    isMainLift: role === "main",
    role,
    sets: Array.from({ length: setCount }, (_, index) => ({
      setIndex: index,
      targetReps: 10,
      targetRpe: 8,
      targetLoad: 50,
      restSeconds: 90,
    })),
  };
}

const plannedWorkout: WorkoutPlan = {
  id: "workout-1",
  scheduledDate: "2026-07-25",
  warmup: [],
  mainLifts: [exercise("anchor", 3, "main")],
  accessories: [
    exercise("optional", 3, "accessory"),
    exercise("biceps", 2, "accessory"),
    exercise("rear", 4, "accessory"),
    exercise("side", 3, "accessory"),
  ],
  estimatedMinutes: 60,
};
const executableSeedSlots = [
  {
    slotId: "upper_b",
    exercises: [
      { exerciseId: "anchor", role: "CORE_COMPOUND" as const, setCount: 3 },
      { exerciseId: "optional", role: "ACCESSORY" as const, setCount: 3 },
      { exerciseId: "biceps", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "rear", role: "ACCESSORY" as const, setCount: 4 },
      { exerciseId: "side", role: "ACCESSORY" as const, setCount: 3 },
    ],
  },
];
const manifest: SessionCapacityReductionManifest = {
  version: 1,
  transformVersion: "short_today_v1",
  seedRevisionNumber: 1,
  executableRowsHash:
    fingerprintSessionCapacityExecutableRows(executableSeedSlots),
  variants: [
    {
      week: 1,
      phase: "entry_calibration",
      slotId: "upper_b",
      rows: [
        {
          exerciseId: "anchor",
          plannedSetCount: 3,
          shortSetCount: 3,
          omissionClass: "none",
          yieldOrder: null,
          protectedClaims: [
            { kind: "primary_anchor", minimumRetainedSetCount: 3 },
          ],
        },
        {
          exerciseId: "optional",
          plannedSetCount: 3,
          shortSetCount: 0,
          omissionClass: "optional_top_up",
          yieldOrder: 1,
          protectedClaims: [],
        },
        {
          exerciseId: "biceps",
          plannedSetCount: 2,
          shortSetCount: 0,
          omissionClass: "preferred_surplus",
          yieldOrder: 2,
          protectedClaims: [],
        },
        {
          exerciseId: "rear",
          plannedSetCount: 4,
          shortSetCount: 2,
          omissionClass: "preferred_surplus",
          yieldOrder: 3,
          protectedClaims: [
            { kind: "direct_exposure", minimumRetainedSetCount: 1 },
          ],
        },
        {
          exerciseId: "side",
          plannedSetCount: 3,
          shortSetCount: 3,
          omissionClass: "none",
          yieldOrder: null,
          protectedClaims: [
            { kind: "direct_exposure", minimumRetainedSetCount: 1 },
          ],
        },
      ],
      sessionProtectionProof: {
        anchorsRetained: true,
        requiredRolesRetained: true,
        directFloorsRetained: true,
        exposureRowsRetained: true,
        minimumSessionValidityRetained: true,
      },
    },
  ],
};

function apply(
  overrides: Partial<Parameters<typeof applySessionCapacityReduction>[0]> = {},
) {
  return applySessionCapacityReduction({
    plannedWorkout,
    acceptedReductionManifest: manifest,
    mode: "short_today",
    week: 1,
    slotId: "upper_b",
    isAccumulationPrimary: true,
    seedRevision: {
      id: "revision-1",
      revision: 1,
      payloadHash: "seed-hash",
    },
    executableSeedSlots,
    ...overrides,
  });
}

describe("applySessionCapacityReduction", () => {
  it("returns the deterministic accepted variant without mutating planned truth", () => {
    const before = structuredClone(plannedWorkout);
    const first = apply();
    const second = apply();
    expect(first).toEqual(second);
    expect(plannedWorkout).toEqual(before);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.workout.mainLifts.map((row) => row.exercise.id)).toEqual([
      "anchor",
    ]);
    expect(first.workout.accessories.map((row) => row.exercise.id)).toEqual([
      "rear",
      "side",
    ]);
    expect(first.evidence.omitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "optional",
          retainedSetCount: 0,
          omissionClass: "optional_top_up",
        }),
        expect.objectContaining({
          exerciseId: "rear",
          retainedSetCount: 2,
        }),
      ]),
    );
    expect(first.evidence.plannedStructureFingerprint).toBe(
      fingerprintSessionCapacityWorkout(plannedWorkout),
    );
    expect(first.preview.redistributionNotice).toContain(
      "will automatically move",
    );
  });

  it("keeps As planned as an exact no-op", () => {
    expect(apply({ mode: "as_planned" })).toEqual({
      status: "as_planned",
      workout: plannedWorkout,
    });
  });

  it.each([
    [{ seedRevision: { id: "revision-2", revision: 2, payloadHash: "x" } }, "stale_manifest"],
    [{ hasPainOrEquipmentConflict: true }, "pain_or_equipment_conflict"],
    [{ isAccumulationPrimary: false }, "unsupported_session"],
    [{ isWorkoutUncreated: false }, "must_select_before_start"],
    [{ acceptedReductionManifest: undefined }, "older_plan"],
  ] as const)("fails closed for %o", (overrides, reason) => {
    expect(apply(overrides)).toMatchObject({
      status: "unavailable",
      reason,
      workout: plannedWorkout,
    });
  });

  it("reports already streamlined when the accepted delta is not meaningful", () => {
    const streamlined: SessionCapacityReductionManifest = {
      ...manifest,
      variants: manifest.variants.map((variant) => ({
        ...variant,
        rows: variant.rows.map((row) =>
          row.exerciseId === "rear"
            ? {
                ...row,
                shortSetCount: 3,
              }
            : {
                ...row,
                shortSetCount: row.plannedSetCount,
                omissionClass: "none" as const,
                yieldOrder: null,
              },
        ),
      })),
    };
    expect(
      apply({ acceptedReductionManifest: streamlined }),
    ).toMatchObject({
      status: "unavailable",
      reason: "already_streamlined",
    });
  });

  it("keeps the explicit runtime path free of planner, repair, audit, and future-session policy", () => {
    const source = readFileSync(
      "src/lib/api/template-session/session-capacity-reduction.ts",
      "utf8",
    );
    expect(source).not.toContain("buildV2PlannerMesocyclePolicy");
    expect(source).not.toContain("selectionCapacityPlan");
    expect(source).not.toContain("weeklyDemand");
    expect(source).not.toContain("repair");
    expect(source).not.toContain("@/lib/audit");
    expect(source).not.toContain("future session");
    expect(source).not.toContain("completed-week");
  });
});
