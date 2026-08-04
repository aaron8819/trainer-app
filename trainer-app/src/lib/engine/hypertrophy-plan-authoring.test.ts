import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "./planning/v2";
import {
  adaptV2MaterializedPlanToDraft,
  assertAcceptedCompatibilityAlignment,
  buildAcceptedCompatibilityProjections,
  buildManualHypertrophyDraft,
  compileAcceptedHypertrophySeed,
  evaluateHypertrophyPlanHealth,
  isExerciseEligibleForIntent,
  parseAcceptedHypertrophySeedV2,
  parseHypertrophyPlanDraft,
  projectExecutableSeed,
  type AcceptedHypertrophySeedV2,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanDraftV1,
} from "./hypertrophy-plan-authoring";

const settings = {
  equipmentProfile: "FULL_GYM" as const,
  sessionDurationMinutes: 60 as const,
};

type MutableProjections = {
  slotSequenceJson: {
    slots: Array<{ slotId: string; intent: string; label: string }>;
  };
  slotPlanSeedJson: {
    slots: Array<{
      slotId: string;
      exercises: Array<{
        exerciseId: string;
        role: "CORE_COMPOUND" | "ACCESSORY";
        setCount: number;
      }>;
    }>;
  };
};

function draft(): HypertrophyPlanDraftV1 {
  return {
    version: 1,
    settings,
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER",
        exercises: [
          {
            exerciseId: "bench",
            workingSets: 4,
            intent: {
              userRole: "PRIMARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_push",
              },
            },
          },
          {
            exerciseId: "row",
            workingSets: 3,
            intent: {
              userRole: "SECONDARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_pull",
              },
            },
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER",
        exercises: [
          {
            exerciseId: "extension",
            workingSets: 3,
            intent: {
              userRole: "MUSCLE_ISOLATION",
              target: { kind: "muscle", muscleId: "quads" },
            },
          },
          {
            exerciseId: "curl",
            workingSets: 3,
            intent: {
              userRole: "ACCESSORY",
              target: { kind: "muscle", muscleId: "hamstrings" },
            },
          },
        ],
      },
    ],
  };
}

const catalog: HypertrophyAuthoringExercise[] = [
  {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["horizontal_push"],
    primaryMuscleIds: ["chest"],
    secondaryMuscleIds: ["triceps"],
    stimulusByMuscleId: { chest: 1, triceps: 0.5 },
    equipment: ["barbell", "bench"],
    contraindicationKeys: [],
    isCompound: true,
    isMainLiftEligible: true,
    timePerSetSec: 180,
  },
  {
    id: "row",
    name: "Cable Row",
    movementPatterns: ["horizontal_pull"],
    primaryMuscleIds: ["lats", "upper_back"],
    secondaryMuscleIds: ["biceps"],
    stimulusByMuscleId: { lats: 1, upper_back: 1, biceps: 0.5 },
    equipment: ["cable"],
    contraindicationKeys: [],
    isCompound: true,
    isMainLiftEligible: false,
    timePerSetSec: 150,
  },
  {
    id: "extension",
    name: "Leg Extension",
    movementPatterns: ["extension"],
    primaryMuscleIds: ["quads"],
    secondaryMuscleIds: [],
    stimulusByMuscleId: { quads: 1 },
    equipment: ["machine"],
    contraindicationKeys: ["knee"],
    isCompound: false,
    isMainLiftEligible: false,
    timePerSetSec: 90,
  },
  {
    id: "curl",
    name: "Leg Curl",
    movementPatterns: ["flexion"],
    primaryMuscleIds: ["hamstrings"],
    secondaryMuscleIds: [],
    stimulusByMuscleId: { hamstrings: 1 },
    equipment: ["machine"],
    contraindicationKeys: [],
    isCompound: false,
    isMainLiftEligible: false,
    timePerSetSec: 90,
  },
];

describe("custom hypertrophy authoring contracts", () => {
  it("normalizes manual and V2 authoring into the same minimal draft contract", () => {
    const manual = buildManualHypertrophyDraft({
      settings,
      sessionsPerWeek: 4,
      preset: "UPPER_LOWER_4",
      createSlotId: (() => {
        let index = 0;
        return () => `manual-${++index}`;
      })(),
    });
    const policy = buildV2PlannerMesocyclePolicy();
    const slots = policy.exerciseSelectionPlan.weeks[0]!.slots;
    const generated = adaptV2MaterializedPlanToDraft({
      settings,
      plannerPolicy: policy,
      materializedPlan: {
        version: 1,
        source: "v2_exercise_materialization",
        dryRunOnly: true,
        status: "materialized",
        slots: slots.map((slot) => ({
          slotId: slot.slotId,
          exercises: slot.lanes.map((lane) => ({
            exerciseId: `exercise-${lane.laneId}`,
            role: lane.role === "anchor" ? "CORE_COMPOUND" : "ACCESSORY",
            setCount: 3,
            laneIds: [lane.laneId],
          })),
        })),
        blockers: [],
        omissions: [],
      },
    });

    expect(parseHypertrophyPlanDraft(manual)).toEqual(manual);
    expect(parseHypertrophyPlanDraft(generated)).toEqual(generated);
    expect(JSON.stringify(generated)).not.toMatch(
      /laneId|ranking|fallback|fatigue|capacity|diagnostic/i,
    );
    for (const exercise of generated.sessions.flatMap((slot) => slot.exercises)) {
      expect(Object.keys(exercise.intent).sort()).toEqual(["target", "userRole"]);
    }
  });

  it("compiles all four user roles deterministically and rejects policy leakage", () => {
    const accepted = compileAcceptedHypertrophySeed(draft());
    expect(
      accepted.slots.flatMap((slot) => slot.exercises.map((row) => row.role)),
    ).toEqual(["CORE_COMPOUND", "ACCESSORY", "ACCESSORY", "ACCESSORY"]);

    const leaked = structuredClone(accepted) as AcceptedHypertrophySeedV2 & {
      rankingPolicy: string;
    };
    leaked.rankingPolicy = "planner-owned";
    expect(() => parseAcceptedHypertrophySeedV2(leaked)).toThrow();
    expect(() =>
      parseAcceptedHypertrophySeedV2({
        ...accepted,
        slots: accepted.slots.map((slot, index) =>
          index
            ? slot
            : {
                ...slot,
                exercises: slot.exercises.map((exercise, exerciseIndex) =>
                  exerciseIndex
                    ? exercise
                    : { ...exercise, laneId: "chest_anchor" },
                ),
              },
        ),
      }),
    ).toThrow();
  });

  it("separates hard execution blockers from advisory plan-health findings", () => {
    const health = evaluateHypertrophyPlanHealth({
      draft: draft(),
      exercises: catalog,
      limitationKeys: ["knee"],
    });
    expect(health.blockers.map((finding) => finding.code)).toContain(
      "LIMITATION_CONFLICT",
    );
    expect(health.warnings.map((finding) => finding.code)).toContain(
      "MISSING_COVERAGE",
    );
    expect(health.warnings.map((finding) => finding.code)).not.toContain(
      "LIMITATION_CONFLICT",
    );
  });

  it("derives role-and-target eligibility from catalog, equipment, and limitations", () => {
    expect(
      isExerciseEligibleForIntent({
        exercise: catalog[0]!,
        intent: draft().sessions[0]!.exercises[0]!.intent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);
    expect(
      isExerciseEligibleForIntent({
        exercise: catalog[1]!,
        intent: draft().sessions[0]!.exercises[0]!.intent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(false);
    expect(
      isExerciseEligibleForIntent({
        exercise: catalog[2]!,
        intent: draft().sessions[1]!.exercises[0]!.intent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: ["knee"],
      }),
    ).toBe(false);
  });

  it("derives aligned compatibility projections and rejects every material drift class", () => {
    const acceptedSeed = compileAcceptedHypertrophySeed(draft());
    const projections = buildAcceptedCompatibilityProjections(acceptedSeed);
    expect(() =>
      assertAcceptedCompatibilityAlignment({ acceptedSeed, ...projections }),
    ).not.toThrow();

    const mutations: Array<(value: MutableProjections) => void> = [
      (value) => { value.slotSequenceJson.slots.reverse(); },
      (value) => { value.slotSequenceJson.slots[0]!.intent = "PULL"; },
      (value) => { value.slotSequenceJson.slots[0]!.label = "Changed"; },
      (value) => { value.slotPlanSeedJson.slots[0]!.exercises.reverse(); },
      (value) =>
        (value.slotPlanSeedJson.slots[0]!.exercises[0]!.exerciseId = "changed"),
      (value) =>
        (value.slotPlanSeedJson.slots[0]!.exercises[0]!.role = "ACCESSORY"),
      (value) =>
        (value.slotPlanSeedJson.slots[0]!.exercises[0]!.setCount = 9),
      (value) => { value.slotPlanSeedJson.slots.pop(); },
      (value) =>
        (value.slotPlanSeedJson.slots.push({
          slotId: "extra",
          exercises: [],
        })),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(projections) as unknown as MutableProjections;
      mutate(changed);
      expect(() =>
        assertAcceptedCompatibilityAlignment({
          acceptedSeed,
          ...changed,
        }),
      ).toThrow(/CUSTOM_PLAN_COMPATIBILITY/);
    }
    const projectionView = projections as unknown as MutableProjections;
    expect(projectExecutableSeed(acceptedSeed)).toEqual({
      version: 1,
      slots: projectionView.slotPlanSeedJson.slots,
    });
  });
});
