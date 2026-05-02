import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildMesocycleSlotPlanSeed,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection";
import {
  buildMesocycleSlotSequence,
  type MesocycleSlotSequence,
} from "./mesocycle-slot-contract";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";
import { buildProgramCurrentWeekPlan } from "./program-page";
import type { V2ExerciseMaterializationPlan } from "@/lib/engine/planning/v2/materialization/types";

function materializedPlanToSlotPlanSeedInput(input: {
  materializedPlan: V2ExerciseMaterializationPlan;
  slotSequence: MesocycleSlotSequence;
  exerciseNameById: Record<string, string | undefined>;
}): {
  slotSequence: MesocycleSlotSequence;
  slotPlans: ProjectedSuccessorSlotPlan[];
} {
  if (input.materializedPlan.dryRunOnly !== true) {
    throw new Error("V2_MATERIALIZED_PLAN_NOT_DRY_RUN");
  }
  if (input.materializedPlan.status !== "materialized") {
    throw new Error("V2_MATERIALIZED_PLAN_NOT_MATERIALIZED");
  }
  if (input.materializedPlan.blockers.length > 0) {
    throw new Error("V2_MATERIALIZED_PLAN_HAS_BLOCKERS");
  }
  if (
    input.materializedPlan.slots.length !== input.slotSequence.slots.length ||
    input.materializedPlan.slots.some(
      (slot, index) => slot.slotId !== input.slotSequence.slots[index]?.slotId,
    )
  ) {
    throw new Error("V2_MATERIALIZED_PLAN_SLOT_SEQUENCE_MISMATCH");
  }

  return {
    slotSequence: input.slotSequence,
    slotPlans: input.materializedPlan.slots.map((slot, index) => {
      const sequenceSlot = input.slotSequence.slots[index];
      if (!sequenceSlot) {
        throw new Error("V2_MATERIALIZED_PLAN_SLOT_SEQUENCE_MISMATCH");
      }

      const exerciseIds = new Set<string>();
      return {
        slotId: slot.slotId,
        intent: sequenceSlot.intent,
        exercises: slot.exercises.map((exercise) => {
          if (
            exercise.role !== "CORE_COMPOUND" &&
            exercise.role !== "ACCESSORY"
          ) {
            throw new Error("V2_MATERIALIZED_PLAN_ROLE_INVALID");
          }
          if (
            !Number.isInteger(exercise.setCount) ||
            exercise.setCount <= 0
          ) {
            throw new Error("V2_MATERIALIZED_PLAN_SET_COUNT_INVALID");
          }
          if (exerciseIds.has(exercise.exerciseId)) {
            throw new Error("V2_MATERIALIZED_PLAN_DUPLICATE_EXERCISE");
          }
          exerciseIds.add(exercise.exerciseId);

          const name = input.exerciseNameById[exercise.exerciseId];
          if (!name) {
            throw new Error("V2_MATERIALIZED_PLAN_EXERCISE_NAME_MISSING");
          }

          return {
            exerciseId: exercise.exerciseId,
            name,
            role: exercise.role,
            setCount: exercise.setCount,
          };
        }),
      };
    }),
  };
}

function makeMaterializedPlan(
  overrides: Partial<V2ExerciseMaterializationPlan> = {},
): V2ExerciseMaterializationPlan {
  return {
    version: 1,
    source: "v2_exercise_materialization",
    dryRunOnly: true,
    status: "materialized",
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          {
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            setCount: 4,
            laneIds: ["chest_anchor"],
          },
          {
            exerciseId: "row",
            role: "ACCESSORY",
            setCount: 3,
            laneIds: ["row_anchor"],
          },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          {
            exerciseId: "leg-press",
            role: "CORE_COMPOUND",
            setCount: 5,
            laneIds: ["quad_anchor"],
          },
        ],
      },
    ],
    blockers: [],
    omissions: [
      {
        slotId: "upper_a",
        laneId: "optional_biceps",
        reason: "optional_not_activated",
      },
    ],
    ...overrides,
  };
}

function makeSlotSequence(): MesocycleSlotSequence {
  return buildMesocycleSlotSequence([
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "lower_a", intent: "LOWER" },
  ]);
}

function listSourceTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceTypeScriptFiles(entryPath);
    }
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [entryPath]
      : [];
  });
}

describe("slot-plan seed contract", () => {
  it("keeps projection, seed, and Program read model aligned on exercise order and setCount", () => {
    const slotSequence = buildMesocycleSlotSequence([
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "lower_a", intent: "LOWER" },
    ]);
    const projectedSlotPlans = [
      {
        slotId: "upper_a",
        intent: "UPPER" as const,
        exercises: [
          {
            exerciseId: "incline-db-bench",
            name: "Incline DB Bench",
            role: "CORE_COMPOUND" as const,
            setCount: 4,
          },
          {
            exerciseId: "tbar-row",
            name: "T-Bar Row",
            role: "ACCESSORY" as const,
            setCount: 3,
          },
        ],
      },
      {
        slotId: "lower_a",
        intent: "LOWER" as const,
        exercises: [
          {
            exerciseId: "leg-press",
            name: "Leg Press",
            role: "CORE_COMPOUND" as const,
            setCount: 5,
          },
        ],
      },
    ];

    const seed = buildMesocycleSlotPlanSeed({
      slotSequence,
      slotPlans: projectedSlotPlans,
    });
    const plan = buildProgramCurrentWeekPlan({
      week: 1,
      slotSequenceJson: slotSequence,
      slotPlanSeedJson: seed,
      seedExerciseNameById: {
        "incline-db-bench": "Incline DB Bench",
        "tbar-row": "T-Bar Row",
        "leg-press": "Leg Press",
      },
      weeklySchedule: [],
      currentWeekWorkouts: [],
      nextWorkoutContext: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 2,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 1,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
    });

    expect(seed.source).toBe("handoff_slot_plan_projection");
    expect(seed.slots.map((slot) => slot.slotId)).toEqual(["upper_a", "lower_a"]);
    expect(seed.slots[0]?.exercises.map(({ exerciseId, setCount }) => ({
      exerciseId,
      setCount,
    }))).toEqual([
      { exerciseId: "incline-db-bench", setCount: 4 },
      { exerciseId: "tbar-row", setCount: 3 },
    ]);
    expect(plan?.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises?.map(({ exerciseId, name, setCount }) => ({
        exerciseId,
        name,
        setCount,
      })),
    }))).toEqual([
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "incline-db-bench", name: "Incline DB Bench", setCount: 4 },
          { exerciseId: "tbar-row", name: "T-Bar Row", setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "leg-press", name: "Leg Press", setCount: 5 },
        ],
      },
    ]);
  });

  it("adapts materialized V2 dry-run output into serializer input without preserving debug fields", () => {
    const adapted = materializedPlanToSlotPlanSeedInput({
      materializedPlan: makeMaterializedPlan(),
      slotSequence: makeSlotSequence(),
      exerciseNameById: {
        bench: "Bench Press",
        row: "Chest Supported Row",
        "leg-press": "Leg Press",
      },
    });

    expect(adapted.slotPlans).toEqual([
      {
        slotId: "upper_a",
        intent: "UPPER",
        exercises: [
          {
            exerciseId: "bench",
            name: "Bench Press",
            role: "CORE_COMPOUND",
            setCount: 4,
          },
          {
            exerciseId: "row",
            name: "Chest Supported Row",
            role: "ACCESSORY",
            setCount: 3,
          },
        ],
      },
      {
        slotId: "lower_a",
        intent: "LOWER",
        exercises: [
          {
            exerciseId: "leg-press",
            name: "Leg Press",
            role: "CORE_COMPOUND",
            setCount: 5,
          },
        ],
      },
    ]);

    const seed = buildMesocycleSlotPlanSeed(adapted);
    expect(seed.source).toBe("handoff_slot_plan_projection");
    expect(seed.slots).toEqual([
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
          { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "leg-press", role: "CORE_COMPOUND", setCount: 5 },
        ],
      },
    ]);

    const serializedSeed = JSON.stringify(seed);
    expect(serializedSeed).not.toMatch(
      /laneIds|dryRunOnly|blockers|omissions|status|v2_exercise_materialization|Bench Press|Chest Supported Row|Leg Press/,
    );
    expect(seed.slots[0]?.exercises[0]).not.toHaveProperty("name");
    expect(parseSlotPlanSeedJson(seed)?.slots).toEqual([
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
          {
            exerciseId: "row",
            role: "ACCESSORY",
            setCount: 3,
            hasExplicitName: false,
            hasExplicitSetCount: true,
          },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          {
            exerciseId: "leg-press",
            role: "CORE_COMPOUND",
            setCount: 5,
            hasExplicitName: false,
            hasExplicitSetCount: true,
          },
        ],
      },
    ]);
  });

  it("rejects blocked, non-materialized, and non-dry-run materialization output", () => {
    const slotSequence = makeSlotSequence();
    const exerciseNameById = {
      bench: "Bench Press",
      row: "Chest Supported Row",
      "leg-press": "Leg Press",
    };

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan({
          status: "blocked",
          blockers: [
            {
              slotId: "upper_a",
              laneId: "row_anchor",
              reason: "no_class_match",
            },
          ],
        }),
        slotSequence,
        exerciseNameById,
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_NOT_MATERIALIZED");

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: {
          ...makeMaterializedPlan(),
          status: "pending",
        } as unknown as V2ExerciseMaterializationPlan,
        slotSequence,
        exerciseNameById,
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_NOT_MATERIALIZED");

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: {
          ...makeMaterializedPlan(),
          dryRunOnly: false,
        } as unknown as V2ExerciseMaterializationPlan,
        slotSequence,
        exerciseNameById,
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_NOT_DRY_RUN");

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan({
          blockers: [
            {
              slotId: "upper_a",
              laneId: "row_anchor",
              reason: "no_class_match",
            },
          ],
        }),
        slotSequence,
        exerciseNameById,
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_HAS_BLOCKERS");
  });

  it("rejects materialized output whose slots do not exactly match the slot sequence", () => {
    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan({
          slots: [...makeMaterializedPlan().slots].reverse(),
        }),
        slotSequence: makeSlotSequence(),
        exerciseNameById: {
          bench: "Bench Press",
          row: "Chest Supported Row",
          "leg-press": "Leg Press",
        },
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_SLOT_SEQUENCE_MISMATCH");
  });

  it("rejects duplicate exercise IDs within a slot", () => {
    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan({
          slots: [
            {
              slotId: "upper_a",
              exercises: [
                {
                  exerciseId: "bench",
                  role: "CORE_COMPOUND",
                  setCount: 4,
                  laneIds: ["chest_anchor"],
                },
                {
                  exerciseId: "bench",
                  role: "ACCESSORY",
                  setCount: 3,
                  laneIds: ["secondary_chest"],
                },
              ],
            },
            makeMaterializedPlan().slots[1]!,
          ],
        }),
        slotSequence: makeSlotSequence(),
        exerciseNameById: {
          bench: "Bench Press",
          "leg-press": "Leg Press",
        },
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_DUPLICATE_EXERCISE");
  });

  it("rejects invalid roles, invalid set counts, and missing serializer-required exercise names", () => {
    const slotSequence = makeSlotSequence();

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: {
          ...makeMaterializedPlan(),
          slots: [
            {
              slotId: "upper_a",
              exercises: [
                {
                  exerciseId: "bench",
                  role: "MAIN",
                  setCount: 4,
                  laneIds: ["chest_anchor"],
                },
              ],
            },
            makeMaterializedPlan().slots[1]!,
          ],
        } as unknown as V2ExerciseMaterializationPlan,
        slotSequence,
        exerciseNameById: {
          bench: "Bench Press",
          "leg-press": "Leg Press",
        },
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_ROLE_INVALID");

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan({
          slots: [
            {
              slotId: "upper_a",
              exercises: [
                {
                  exerciseId: "bench",
                  role: "CORE_COMPOUND",
                  setCount: 0,
                  laneIds: ["chest_anchor"],
                },
              ],
            },
            makeMaterializedPlan().slots[1]!,
          ],
        }),
        slotSequence,
        exerciseNameById: {
          bench: "Bench Press",
          "leg-press": "Leg Press",
        },
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_SET_COUNT_INVALID");

    expect(() =>
      materializedPlanToSlotPlanSeedInput({
        materializedPlan: makeMaterializedPlan(),
        slotSequence,
        exerciseNameById: {
          bench: "Bench Press",
          row: "Chest Supported Row",
        },
      }),
    ).toThrow("V2_MATERIALIZED_PLAN_EXERCISE_NAME_MISSING");
  });

  it("keeps the materialization-to-seed adapter test-only with no production callsite", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return text.includes("materializedPlanToSlotPlanSeedInput")
        ? [path.relative(process.cwd(), file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
