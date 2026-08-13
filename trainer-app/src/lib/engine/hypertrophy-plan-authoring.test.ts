import { describe, expect, it, vi } from "vitest";
import exerciseCatalog from "../../../prisma/exercises_comprehensive.json";
import { parseCanonicalExerciseFactsV1 } from "../exercise-library/canonical-exercise-facts";
import { getMusclePolicyByDisplayName } from "./muscle-policy";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
} from "./planning/v2";
import type { V2MaterializationExercise } from "./planning/v2/materialization/types";
import { getEffectiveStimulusByMuscleId } from "./stimulus";
import {
  adaptV2MaterializedPlanToDraft,
  assertAcceptedCompatibilityAlignment,
  buildAcceptedCompatibilityProjections,
  buildManualHypertrophyDraft,
  compileAcceptedHypertrophySeed,
  compileAcceptedHypertrophySeedV3,
  equipmentForCustomHypertrophyProfile,
  evaluateHypertrophyPlanHealth,
  evaluateHypertrophySemanticIntent,
  isExerciseAvailableForHypertrophyPlan,
  isExerciseEligibleForIntent,
  parseAcceptedHypertrophySeedV2,
  parseAcceptedHypertrophySeedV3,
  parseHypertrophyPlanDraft,
  projectExecutableSeed,
  projectExecutableSeedV3,
  type AcceptedHypertrophySeedV2,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanDraftV1,
} from "./hypertrophy-plan-authoring";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import {
  toAuthoringExercise as toProductionAuthoringExercise,
  type HypertrophyPlanDraftExerciseRow,
} from "../api/hypertrophy-plan-drafts";

const settings = {
  equipmentProfile: "FULL_GYM" as const,
  sessionDurationMinutes: 60 as const,
};

type ShippedCatalogExercise = (typeof exerciseCatalog.exercises)[number];

function shippedCatalogExercise(name: string): ShippedCatalogExercise {
  const exercise = exerciseCatalog.exercises.find(
    (candidate) => candidate.name === name,
  );
  if (!exercise) throw new Error(`Missing shipped exercise: ${name}`);
  return exercise;
}

function shippedExerciseId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toMaterializationExercise(
  exercise: ShippedCatalogExercise,
): V2MaterializationExercise {
  return {
    exerciseId: shippedExerciseId(exercise.name),
    name: exercise.name,
    aliases: [],
    movementPatterns: exercise.movementPatterns.map((pattern) =>
      pattern.toLowerCase(),
    ),
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment.map((item) => item.toLowerCase()),
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    fatigueCost: exercise.fatigueCost,
    stimulusByMusclePerSet: Object.fromEntries([
      ...exercise.primaryMuscles.map((muscle) => [muscle, 1] as const),
      ...exercise.secondaryMuscles.map((muscle) => [muscle, 0.5] as const),
    ]),
  };
}

function toAuthoringExercise(
  exercise: ShippedCatalogExercise,
): HypertrophyAuthoringExercise {
  const primaryMuscleIds = exercise.primaryMuscles.flatMap((muscle) => {
    const id = getMusclePolicyByDisplayName(muscle)?.id;
    return id ? [id] : [];
  });
  const secondaryMuscleIds = exercise.secondaryMuscles.flatMap((muscle) => {
    const id = getMusclePolicyByDisplayName(muscle)?.id;
    return id ? [id] : [];
  });
  return {
    id: shippedExerciseId(exercise.name),
    name: exercise.name,
    aliases: [],
    movementPatterns: exercise.movementPatterns.map((pattern) =>
      pattern.toLowerCase(),
    ) as HypertrophyAuthoringExercise["movementPatterns"],
    primaryMuscleIds,
    secondaryMuscleIds,
    equipment: exercise.equipment.map((item) => item.toLowerCase()),
    contraindicationKeys: Object.entries(
      exercise.contraindications ?? {},
    ).flatMap(([key, enabled]) => (enabled === true ? [key] : [])),
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    timePerSetSec: exercise.timePerSetSec,
  };
}

function toProductionAuthoringRow(
  exercise: ShippedCatalogExercise,
): HypertrophyPlanDraftExerciseRow {
  const exerciseMuscles = (
    names: readonly string[],
    role: "PRIMARY" | "SECONDARY",
  ) =>
    names.map((muscleName) => {
      const policy = getMusclePolicyByDisplayName(muscleName);
      if (!policy) throw new Error(`Missing canonical muscle: ${muscleName}`);
      return { role, muscle: { id: policy.id, name: muscleName } };
    });

  return {
    id: exercise.catalogKey,
    name: exercise.name,
    aliases: [],
    movementPatterns: exercise.movementPatterns,
    contraindications: exercise.contraindications ?? null,
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    fatigueCost: exercise.fatigueCost,
    timePerSetSec: exercise.timePerSetSec,
    measurementProfile:
      "measurementProfile" in exercise ? exercise.measurementProfile : null,
    loadConvention:
      "loadConvention" in exercise ? exercise.loadConvention : null,
    repBasis: "repBasis" in exercise ? exercise.repBasis : null,
    exerciseEquipment: exercise.equipment.map((type) => ({
      equipment: { type },
    })),
    exerciseMuscles: [
      ...exerciseMuscles(exercise.primaryMuscles, "PRIMARY"),
      ...exerciseMuscles(exercise.secondaryMuscles, "SECONDARY"),
    ],
  } as HypertrophyPlanDraftExerciseRow;
}

function toConsumerReadyAuthoringExercise(
  exercise: ShippedCatalogExercise,
): HypertrophyAuthoringExercise {
  const facts = parseCanonicalExerciseFactsV1(exercise.facts);
  if (facts.stimulus.disposition !== "COMPLETE") {
    throw new Error("Canonical stimulus is not consumer-ready");
  }

  const authoringExercise = toProductionAuthoringExercise(
    toProductionAuthoringRow(exercise),
  );
  if (!authoringExercise.measurement) {
    throw new Error("Parsed measurement is not consumer-ready");
  }
  if (!authoringExercise.stimulusByMuscleId) {
    throw new Error("Projected stimulus is not consumer-ready");
  }

  const canonicalStimulus = Object.entries(facts.stimulus.profile).sort();
  const projectedStimulus = Object.entries(
    authoringExercise.stimulusByMuscleId,
  ).sort();
  if (JSON.stringify(projectedStimulus) !== JSON.stringify(canonicalStimulus)) {
    throw new Error("Projected stimulus does not match canonical facts");
  }

  return authoringExercise;
}

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
    equipment: ["machine"],
    contraindicationKeys: [],
    isCompound: false,
    isMainLiftEligible: false,
    timePerSetSec: 90,
  },
];

const lowAxialHipThrust: HypertrophyAuthoringExercise = {
  id: "hip-thrust",
  name: "Machine Hip Thrust",
  movementPatterns: ["hinge"],
  primaryMuscleIds: ["glutes"],
  secondaryMuscleIds: ["hamstrings"],
  equipment: ["machine"],
  contraindicationKeys: [],
  isCompound: true,
  isMainLiftEligible: false,
  timePerSetSec: 120,
};

const romanianDeadlift: HypertrophyAuthoringExercise = {
  id: "rdl",
  name: "Romanian Deadlift",
  movementPatterns: ["hinge"],
  primaryMuscleIds: ["hamstrings", "glutes"],
  secondaryMuscleIds: ["lower_back"],
  equipment: ["barbell"],
  contraindicationKeys: [],
  isCompound: true,
  isMainLiftEligible: true,
  timePerSetSec: 150,
};

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
    const generatedExercises = generated.sessions.flatMap(
      (slot) => slot.exercises,
    );
    const lowAxial = generatedExercises.find(
      (exercise) => exercise.exerciseId === "exercise-hinge_anchor",
    );
    expect(lowAxial?.intent).toEqual({
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern: "hinge" },
      requiredExerciseClass: "low_axial_hip_extension_anchor",
    });
    for (const exercise of generatedExercises.filter(
      (candidate) => candidate !== lowAxial,
    )) {
      expect(Object.keys(exercise.intent).sort()).toEqual(["target", "userRole"]);
    }
    expect(
      compileAcceptedHypertrophySeed(generated).slots
        .flatMap((slot) => slot.exercises)
        .find((exercise) => exercise.exerciseId === "exercise-hinge_anchor")
        ?.intent,
    ).toEqual(lowAxial?.intent);
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
                    : {
                        ...exercise,
                        intent: {
                          ...exercise.intent,
                          requiredExerciseClass: "hinge_compound",
                        },
                      },
                ),
              },
        ),
      }),
    ).toThrow();
  });

  it("preserves the editable envelope in V3 and emits a source-neutral V2 projection", () => {
    const source = draft();
    const ids = source.sessions.flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    );
    const measurementByExerciseId = new Map(
      ids.map((exerciseId) => [
        exerciseId,
        {
          profile: "REPS_EXTERNAL_LOAD" as const,
          loadConvention: "BARBELL_TOTAL" as const,
          repBasis: "TOTAL" as const,
        },
      ]),
    );
    const accepted = compileAcceptedHypertrophySeedV3({
      draft: source,
      measurementByExerciseId,
    });
    expect(parseAcceptedHypertrophySeedV3(accepted).settings).toEqual(source.settings);
    expect(
      accepted.slots.map(({ slotId, name, focus }) => ({ slotId, name, focus })),
    ).toEqual(
      source.sessions.map(({ slotId, name, focus }) => ({ slotId, name, focus })),
    );
    expect(projectExecutableSeedV3(accepted)).toEqual({
      version: 2,
      slots: accepted.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map(
          ({ exerciseId, role, setCount, measurement }) => ({
            exerciseId,
            role,
            setCount,
            measurement,
          }),
        ),
      })),
    });
    measurementByExerciseId.delete(ids[0]!);
    expect(() =>
      compileAcceptedHypertrophySeedV3({
        draft: source,
        measurementByExerciseId,
      }),
    ).toThrow(/CUSTOM_PLAN_MEASUREMENT_UNCLASSIFIED/);
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

  it("uses runtime stimulus math for Plan Health while rounding only its readout", () => {
    const health = evaluateHypertrophyPlanHealth({
      draft: draft(),
      exercises: catalog,
      limitationKeys: [],
    });
    const bench = catalog[0]!;
    const runtimeContribution = getEffectiveStimulusByMuscleId(
      {
        id: bench.id,
        name: bench.name,
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
      },
      4,
      { logFallback: false },
    );
    const byMuscle = new Map(
      health.muscles.map((muscle) => [muscle.muscleId, muscle]),
    );

    expect(byMuscle.get("chest")).toMatchObject({
      directSets: 4,
      effectiveSets: runtimeContribution.get("chest"),
    });
    expect(byMuscle.get("triceps")).toMatchObject({
      directSets: 0,
      effectiveSets: runtimeContribution.get("triceps"),
    });
    expect(byMuscle.get("front_delts")).toMatchObject({
      directSets: 0,
      effectiveSets: runtimeContribution.get("front_delts"),
    });
    expect(runtimeContribution.get("triceps")).toBe(1.8);
    expect(runtimeContribution.get("front_delts")).toBe(1.2);
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
    expect(
      isExerciseEligibleForIntent({
        exercise: catalog[0]!,
        intent: draft().sessions[0]!.exercises[0]!.intent,
        equipmentProfile: "BODYWEIGHT",
        limitationKeys: [],
      }),
    ).toBe(false);
  });

  it("evaluates accepted Hypertrophy semantics without treating catalog main-lift eligibility as plan intent", () => {
    const primaryCases = [
      ["Incline Machine Press", "horizontal_push"],
      ["Chest-Supported Dumbbell Row", "horizontal_pull"],
      ["Iso-Lateral Front Lat Pulldown", "vertical_pull"],
      ["Cable Pull-Through", "hinge"],
    ] as const;

    for (const [name, movementPattern] of primaryCases) {
      const exercise = shippedCatalogExercise(name);
      const authoringExercise = toAuthoringExercise(exercise);
      expect(exercise.isMainLiftEligible).toBe(false);
      const intent = {
        userRole: "PRIMARY_LIFT" as const,
        target: { kind: "movement_pattern" as const, movementPattern },
      };
      const semanticDecision = evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(exercise),
        intent,
      });
      expect(semanticDecision).toEqual({ eligible: true });
      expect(
        isExerciseEligibleForIntent({
          exercise: authoringExercise,
          intent,
          equipmentProfile: "FULL_GYM",
          limitationKeys: [],
        }),
      ).toBe(semanticDecision.eligible);
    }

    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(
          shippedCatalogExercise("Romanian Deadlift"),
        ),
        intent: {
          userRole: "PRIMARY_LIFT",
          target: { kind: "movement_pattern", movementPattern: "hinge" },
          requiredExerciseClass: "low_axial_hip_extension_anchor",
        },
      }),
    ).toEqual({
      eligible: false,
      reasonCode: "REQUIRED_EXERCISE_CLASS_MISMATCH",
    });
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(
          shippedCatalogExercise("Leg Extension"),
        ),
        intent: {
          userRole: "PRIMARY_LIFT",
          target: { kind: "movement_pattern", movementPattern: "extension" },
        },
      }),
    ).toEqual({ eligible: false, reasonCode: "ROLE_REQUIRES_COMPOUND" });
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(
          shippedCatalogExercise("Chest-Supported Dumbbell Row"),
        ),
        intent: {
          userRole: "PRIMARY_LIFT",
          target: { kind: "movement_pattern", movementPattern: "vertical_pull" },
        },
      }),
    ).toEqual({ eligible: false, reasonCode: "MOVEMENT_TARGET_MISMATCH" });
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(
          shippedCatalogExercise("Leg Extension"),
        ),
        intent: {
          userRole: "MUSCLE_ISOLATION",
          target: { kind: "muscle", muscleId: "hamstrings" },
        },
      }),
    ).toEqual({ eligible: false, reasonCode: "MUSCLE_TARGET_MISMATCH" });
  });

  it("makes Cable Pallof Press eligible for a full-gym anti-rotation accessory intent", () => {
    const exercise = shippedCatalogExercise("Cable Pallof Press");
    const authoringExercise = toConsumerReadyAuthoringExercise(exercise);
    const intent = {
      userRole: "ACCESSORY" as const,
      target: {
        kind: "movement_pattern" as const,
        movementPattern: "anti_rotation" as const,
      },
    };

    expect(authoringExercise.id).toBe("cable-pallof-press");
    expect(authoringExercise.equipment).toEqual(["cable"]);
    expect(authoringExercise.movementPatterns).toEqual(["anti_rotation"]);
    expect(authoringExercise.stimulusByMuscleId).toEqual({ core: 1 });
    expect(authoringExercise.measurement).toEqual({
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "PER_SIDE",
    });
    expect(
      isExerciseAvailableForHypertrophyPlan({
        exercise: authoringExercise,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(exercise),
        intent,
      }),
    ).toEqual({ eligible: true });
    expect(
      isExerciseEligibleForIntent({
        exercise: authoringExercise,
        intent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);
  });

  it("accepts anti-extension intent and resolves Ab Wheel through the production authoring boundary", () => {
    const abWheel = shippedCatalogExercise("Ab Wheel Rollout");
    const cablePallof = shippedCatalogExercise("Cable Pallof Press");
    const legacyPallof = shippedCatalogExercise("Pallof Press");
    const authoringExercise = toConsumerReadyAuthoringExercise(abWheel);
    const antiExtensionIntent = {
      userRole: "ACCESSORY" as const,
      target: {
        kind: "movement_pattern" as const,
        movementPattern: "anti_extension" as const,
      },
    };
    const antiRotationIntent = {
      userRole: "ACCESSORY" as const,
      target: {
        kind: "movement_pattern" as const,
        movementPattern: "anti_rotation" as const,
      },
    };
    const draft = buildManualHypertrophyDraft({
      settings,
      sessionsPerWeek: 4,
      preset: "UPPER_LOWER_4",
      createSlotId: (() => {
        let index = 0;
        return () => `anti-extension-${++index}`;
      })(),
    });
    draft.sessions[0]!.exercises.push({
      exerciseId: abWheel.catalogKey,
      workingSets: 3,
      intent: antiExtensionIntent,
    });

    expect(
      parseHypertrophyPlanDraft(draft).sessions[0]!.exercises[0]!.intent,
    ).toEqual(antiExtensionIntent);
    expect(authoringExercise.movementPatterns).toEqual(["anti_extension"]);
    expect(authoringExercise.measurement).toEqual({
      profile: "REPS_BODYWEIGHT",
      repBasis: "TOTAL",
    });
    expect(authoringExercise.stimulusByMuscleId).toEqual({ core: 1 });
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(abWheel),
        intent: antiExtensionIntent,
      }),
    ).toEqual({ eligible: true });
    expect(
      isExerciseEligibleForIntent({
        exercise: authoringExercise,
        intent: antiExtensionIntent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);
    expect(
      evaluateHypertrophySemanticIntent({
        exercise: toMaterializationExercise(abWheel),
        intent: antiRotationIntent,
      }),
    ).toEqual({ eligible: false, reasonCode: "MOVEMENT_TARGET_MISMATCH" });
    expect(cablePallof.movementPatterns).toEqual(["anti_rotation"]);
    expect(legacyPallof.movementPatterns).toEqual(["anti_rotation"]);
  });

  it("rejects Cable Pallof Press when canonical stimulus readiness is absent or incomplete", () => {
    const missingFacts = structuredClone(
      shippedCatalogExercise("Cable Pallof Press"),
    ) as unknown as Record<string, unknown>;
    delete missingFacts.facts;
    const exercise = {
      ...shippedCatalogExercise("Cable Pallof Press"),
      facts: { version: 1, stimulus: { disposition: "MISSING" } },
    } as unknown as ShippedCatalogExercise;

    expect(() =>
      toConsumerReadyAuthoringExercise(
        missingFacts as unknown as ShippedCatalogExercise,
      ),
    ).toThrow("CANONICAL_FACTS_NOT_OBJECT");
    expect(() => toConsumerReadyAuthoringExercise(exercise)).toThrow(
      "Canonical stimulus is not consumer-ready",
    );
  });

  it("rejects Cable Pallof Press when parsed measurement readiness is absent or invalid", () => {
    const exercise = shippedCatalogExercise("Cable Pallof Press");
    const missingMeasurement = structuredClone(exercise) as unknown as Record<
      string,
      unknown
    >;
    delete missingMeasurement.measurementProfile;
    delete missingMeasurement.loadConvention;
    delete missingMeasurement.repBasis;

    expect(() =>
      toConsumerReadyAuthoringExercise(
        missingMeasurement as unknown as ShippedCatalogExercise,
      ),
    ).toThrow("Parsed measurement is not consumer-ready");
    expect(() =>
      toConsumerReadyAuthoringExercise({
        ...exercise,
        loadConvention: "DISPLAYED_ASSISTANCE",
      } as unknown as ShippedCatalogExercise),
    ).toThrow(/loadConvention/);
  });

  it("makes all accepted semantic mismatches plan-health blockers", () => {
    const invalid = structuredClone(draft());
    invalid.sessions[0]!.exercises[0]!.intent.target = {
      kind: "movement_pattern",
      movementPattern: "vertical_push",
    };

    const health = evaluateHypertrophyPlanHealth({
      draft: invalid,
      exercises: catalog,
      limitationKeys: [],
    });
    expect(health.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ROLE_TARGET_MISMATCH",
          exerciseId: "bench",
        }),
      ]),
    );
    expect(health.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ROLE_TARGET_MISMATCH",
          exerciseId: "bench",
        }),
      ]),
    );
  });

  it("keeps shipped-catalog low-axial candidates consistent across V2 materialization, picker, and health", () => {
    const constrainedIntent = {
      userRole: "PRIMARY_LIFT" as const,
      target: { kind: "movement_pattern" as const, movementPattern: "hinge" as const },
      requiredExerciseClass: "low_axial_hip_extension_anchor" as const,
    };
    const policy = buildV2PlannerMesocyclePolicy();
    const shippedAuthoringCatalog = exerciseCatalog.exercises.map(
      toAuthoringExercise,
    );
    const materializedPlan = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      inventory: exerciseCatalog.exercises.map(toMaterializationExercise),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      constraints: {
        avoidExerciseIds: [],
        favoriteExerciseIds: [],
        painConflictExerciseIds: [],
        availableEquipment: [
          ...(equipmentForCustomHypertrophyProfile("MACHINES") ?? []),
        ],
      },
    });
    expect(materializedPlan.status).toBe("materialized");
    if (materializedPlan.status !== "materialized") {
      throw new Error("Expected shipped MACHINES catalog to materialize");
    }
    const generated = adaptV2MaterializedPlanToDraft({
      settings: {
        equipmentProfile: "MACHINES",
        sessionDurationMinutes: 60,
      },
      plannerPolicy: policy,
      materializedPlan,
    });
    const shippedById = new Map(
      shippedAuthoringCatalog.map((exercise) => [exercise.id, exercise]),
    );
    for (const row of generated.sessions
      .flatMap((session) => session.exercises)
      .filter((exercise) => exercise.intent.userRole === "PRIMARY_LIFT")) {
      const exercise = shippedById.get(row.exerciseId);
      if (!exercise) throw new Error(`Missing generated exercise ${row.exerciseId}`);
      expect(
        isExerciseEligibleForIntent({
          exercise,
          intent: row.intent,
          equipmentProfile: "MACHINES",
          limitationKeys: [],
        }),
      ).toBe(true);
    }
    expect(
      evaluateHypertrophyPlanHealth({
        draft: generated,
        exercises: shippedAuthoringCatalog,
        limitationKeys: [],
      }).blockers.filter((finding) =>
        [
          "REQUIRED_EXERCISE_CLASS_MISMATCH",
          "ROLE_TARGET_MISMATCH",
        ].includes(finding.code),
      ),
    ).toEqual([]);
    const constrainedRow = generated.sessions
      .flatMap((session) => session.exercises)
      .find(
        (exercise) =>
          exercise.intent.requiredExerciseClass ===
          "low_axial_hip_extension_anchor",
      );
    expect(constrainedRow).toBeDefined();

    const cablePullThrough = toAuthoringExercise(
      shippedCatalogExercise("Cable Pull-Through"),
    );
    const machineHipThrust = toAuthoringExercise(
      shippedCatalogExercise("Machine Hip Thrust"),
    );
    const shippedRomanianDeadlift = toAuthoringExercise(
      shippedCatalogExercise("Romanian Deadlift"),
    );
    expect(constrainedRow?.exerciseId).toBe(cablePullThrough.id);
    expect(cablePullThrough.isMainLiftEligible).toBe(false);
    expect(machineHipThrust.isMainLiftEligible).toBe(false);

    const eligibleMachineCandidates = [cablePullThrough, machineHipThrust].filter(
      (exercise) =>
        isExerciseEligibleForIntent({
          exercise,
          intent: constrainedIntent,
          equipmentProfile: "MACHINES",
          limitationKeys: [],
        }),
    );
    expect(eligibleMachineCandidates.map((exercise) => exercise.name)).toEqual([
      "Cable Pull-Through",
      "Machine Hip Thrust",
    ]);
    expect(
      eligibleMachineCandidates.some(
        (exercise) => exercise.id !== constrainedRow?.exerciseId,
      ),
    ).toBe(true);

    for (const exercise of eligibleMachineCandidates) {
      const candidateDraft = structuredClone(generated);
      const candidateRow = candidateDraft.sessions
        .flatMap((session) => session.exercises)
        .find(
          (row) =>
            row.intent.requiredExerciseClass ===
            "low_axial_hip_extension_anchor",
        );
      if (!candidateRow) throw new Error("Missing constrained draft row");
      candidateRow.exerciseId = exercise.id;
      const health = evaluateHypertrophyPlanHealth({
        draft: candidateDraft,
        exercises: shippedAuthoringCatalog,
        limitationKeys: [],
      });
      expect(
        health.blockers.filter((finding) => finding.exerciseId === exercise.id),
      ).toEqual([]);
      expect(
        health.warnings.filter(
          (finding) =>
            finding.exerciseId === exercise.id &&
            finding.code === "ROLE_TARGET_MISMATCH",
        ),
      ).toEqual([]);
    }

    expect(
      isExerciseEligibleForIntent({
        exercise: shippedRomanianDeadlift,
        intent: constrainedIntent,
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(false);
    expect(
      isExerciseEligibleForIntent({
        exercise: machineHipThrust,
        intent: {
          userRole: "PRIMARY_LIFT",
          target: { kind: "movement_pattern", movementPattern: "hinge" },
        },
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);
    expect(
      isExerciseEligibleForIntent({
        exercise: shippedRomanianDeadlift,
        intent: {
          userRole: "PRIMARY_LIFT",
          target: { kind: "movement_pattern", movementPattern: "hinge" },
        },
        equipmentProfile: "FULL_GYM",
        limitationKeys: [],
      }),
    ).toBe(true);

    const invalid = structuredClone(generated);
    invalid.settings.equipmentProfile = "FULL_GYM";
    const invalidRow = invalid.sessions
      .flatMap((session) => session.exercises)
      .find(
        (exercise) =>
          exercise.intent.requiredExerciseClass ===
          "low_axial_hip_extension_anchor",
      );
    if (!invalidRow) throw new Error("Missing constrained draft row");
    invalidRow.exerciseId = shippedRomanianDeadlift.id;
    expect(
      evaluateHypertrophyPlanHealth({
        draft: invalid,
        exercises: shippedAuthoringCatalog,
        limitationKeys: [],
      }).blockers,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REQUIRED_EXERCISE_CLASS_MISMATCH",
          exerciseId: shippedRomanianDeadlift.id,
        }),
      ]),
    );
  });

  it("keeps custom-only equipment additions out of the shared legacy profile", () => {
    expect(equipmentForCustomHypertrophyProfile("BARBELL_HOME")).toEqual(
      expect.arrayContaining(["ez_bar", "trap_bar"]),
    );
    expect(equipmentForCustomHypertrophyProfile("MACHINES")).toContain("band");
    expect(
      isExerciseAvailableForHypertrophyPlan({
        exercise: { ...romanianDeadlift, equipment: ["trap_bar"] },
        equipmentProfile: "BARBELL_HOME",
        limitationKeys: [],
      }),
    ).toBe(true);
    expect(
      isExerciseAvailableForHypertrophyPlan({
        exercise: { ...lowAxialHipThrust, equipment: ["band"] },
        equipmentProfile: "MACHINES",
        limitationKeys: [],
      }),
    ).toBe(true);
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
