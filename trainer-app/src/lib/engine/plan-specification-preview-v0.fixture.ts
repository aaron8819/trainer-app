import type {
  HypertrophyAuthoringExercise,
  HypertrophyPlanDraftV1,
} from "./hypertrophy-plan-authoring";
import {
  adaptHypertrophyPlanDraftToPlanSpecificationPreviewV0,
  type PlanSpecificationPreviewV0PlacementMetadata,
} from "./plan-specification-preview-v0";

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS = {
  squat: "fixture-barbell-back-squat",
  pullUp: "fixture-pull-up",
  chestSupportedRow: "fixture-chest-supported-t-bar-row",
  cableCrunch: "fixture-cable-crunch",
  legCurl: "fixture-lying-leg-curl",
  splitSquat: "fixture-bulgarian-split-squat",
} as const;

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG: HypertrophyAuthoringExercise[] = [
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
    name: "Barbell Back Squat",
    movementPatterns: ["squat"],
    primaryMuscleIds: ["quads", "glutes"],
    secondaryMuscleIds: ["hamstrings", "core"],
    stimulusByMuscleId: { quads: 1, glutes: 1, hamstrings: 0.5, core: 0.5 },
    equipment: ["barbell", "rack"],
    contraindicationKeys: ["knee", "low_back"],
    isCompound: true,
    isMainLiftEligible: true,
    timePerSetSec: 75,
  },
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
    name: "Pull-Up",
    movementPatterns: ["vertical_pull"],
    primaryMuscleIds: ["lats", "biceps"],
    secondaryMuscleIds: ["upper_back", "forearms"],
    stimulusByMuscleId: { lats: 1, biceps: 1, upper_back: 0.5, forearms: 0.5 },
    equipment: ["bodyweight"],
    contraindicationKeys: ["shoulder"],
    isCompound: true,
    isMainLiftEligible: true,
    timePerSetSec: 35,
  },
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
    name: "Chest-Supported T-Bar Row",
    movementPatterns: ["horizontal_pull"],
    primaryMuscleIds: ["lats", "upper_back"],
    secondaryMuscleIds: ["biceps", "forearms"],
    stimulusByMuscleId: { lats: 1, upper_back: 1, biceps: 0.5, forearms: 0.5 },
    equipment: ["machine"],
    contraindicationKeys: [],
    isCompound: true,
    isMainLiftEligible: false,
    timePerSetSec: 55,
  },
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
    name: "Cable Crunch",
    movementPatterns: ["flexion"],
    primaryMuscleIds: ["abs"],
    secondaryMuscleIds: [],
    stimulusByMuscleId: { abs: 1 },
    equipment: ["cable"],
    contraindicationKeys: [],
    isCompound: false,
    isMainLiftEligible: false,
    timePerSetSec: 35,
  },
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.legCurl,
    name: "Lying Leg Curl",
    movementPatterns: ["isolation"],
    primaryMuscleIds: ["hamstrings"],
    secondaryMuscleIds: [],
    stimulusByMuscleId: { hamstrings: 1 },
    equipment: ["machine"],
    contraindicationKeys: [],
    isCompound: false,
    isMainLiftEligible: false,
    timePerSetSec: 45,
  },
  {
    id: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.splitSquat,
    name: "Bulgarian Split Squat",
    movementPatterns: ["lunge"],
    primaryMuscleIds: ["quads", "glutes"],
    secondaryMuscleIds: ["hamstrings", "core"],
    stimulusByMuscleId: { quads: 1, glutes: 1, hamstrings: 0.5, core: 0.5 },
    equipment: ["dumbbell", "bench"],
    contraindicationKeys: ["knee"],
    isCompound: true,
    isMainLiftEligible: false,
    timePerSetSec: 60,
  },
];

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_DRAFT: HypertrophyPlanDraftV1 = {
  version: 1,
  settings: {
    equipmentProfile: "FULL_GYM",
    sessionDurationMinutes: 60,
  },
  sessions: [
    {
      slotId: "upper-1",
      name: "Upper 1",
      focus: "UPPER",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
          workingSets: 4,
          intent: {
            userRole: "PRIMARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "vertical_pull" },
          },
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
          workingSets: 3,
          intent: {
            userRole: "SECONDARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "horizontal_pull" },
          },
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
          workingSets: 3,
          intent: {
            userRole: "ACCESSORY",
            target: { kind: "muscle", muscleId: "abs" },
          },
        },
      ],
    },
    {
      slotId: "lower-1",
      name: "Lower 1",
      focus: "LOWER",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
          workingSets: 4,
          intent: {
            userRole: "PRIMARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "squat" },
          },
        },
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.legCurl,
          workingSets: 3,
          intent: {
            userRole: "MUSCLE_ISOLATION",
            target: { kind: "muscle", muscleId: "hamstrings" },
          },
        },
      ],
    },
    {
      slotId: "upper-2",
      name: "Upper 2",
      focus: "UPPER",
      exercises: [
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
          workingSets: 4,
          intent: {
            userRole: "PRIMARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "horizontal_pull" },
          },
        },
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
          workingSets: 3,
          intent: {
            userRole: "SECONDARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "vertical_pull" },
          },
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
          workingSets: 3,
          intent: {
            userRole: "ACCESSORY",
            target: { kind: "muscle", muscleId: "abs" },
          },
        },
      ],
    },
    {
      slotId: "lower-2",
      name: "Lower 2",
      focus: "LOWER",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
          workingSets: 3,
          intent: {
            userRole: "PRIMARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "squat" },
          },
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.splitSquat,
          workingSets: 3,
          intent: {
            userRole: "SECONDARY_LIFT",
            target: { kind: "movement_pattern", movementPattern: "lunge" },
          },
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
          workingSets: 2,
          intent: {
            userRole: "ACCESSORY",
            target: { kind: "muscle", muscleId: "abs" },
          },
        },
      ],
    },
  ],
};

const placementMetadata: PlanSpecificationPreviewV0PlacementMetadata[] = [
  { candidatePlacementId: "upper-1-pull-up", continuity: "ANCHOR", priorityIds: ["upper-back"] },
  { candidatePlacementId: "upper-1-row", continuity: "ANCHOR", priorityIds: ["upper-back"] },
  { candidatePlacementId: "upper-1-core", continuity: "ANCHOR", priorityIds: ["core"] },
  { candidatePlacementId: "lower-1-squat", continuity: "ANCHOR", priorityIds: ["squat-skill", "lower-body"] },
  { candidatePlacementId: "lower-1-curl", priorityIds: ["lower-body"] },
  { candidatePlacementId: "upper-2-row", continuity: "ANCHOR", priorityIds: ["upper-back"] },
  { candidatePlacementId: "upper-2-pull-up", continuity: "ANCHOR", priorityIds: ["upper-back"] },
  { candidatePlacementId: "upper-2-core", continuity: "ANCHOR", priorityIds: ["core"] },
  { candidatePlacementId: "lower-2-squat", continuity: "ANCHOR", priorityIds: ["squat-skill", "lower-body"] },
  { candidatePlacementId: "lower-2-split-squat", priorityIds: ["lower-body"] },
  { candidatePlacementId: "lower-2-core", continuity: "ANCHOR", priorityIds: ["core"] },
];

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE =
  adaptHypertrophyPlanDraftToPlanSpecificationPreviewV0({
    draft: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_DRAFT,
    metadata: {
      planName: "Plan Specification Preview V0 Upper/Lower Proof",
      authoringSource: "USER_AUTHORED",
    },
    priorities: [
      {
        priorityId: "squat-skill",
        rank: 1,
        kind: "LIFT_SKILL",
        targetId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
        objective: "SPECIALIZE",
      },
      {
        priorityId: "lower-body",
        rank: 2,
        kind: "MUSCLE_OR_REGION",
        targetId: "lower-body",
        objective: "SPECIALIZE",
      },
      {
        priorityId: "upper-back",
        rank: 3,
        kind: "MUSCLE_OR_REGION",
        targetId: "upper-back",
        objective: "DEVELOP",
      },
      {
        priorityId: "core",
        rank: 4,
        kind: "MUSCLE_OR_REGION",
        targetId: "core",
        objective: "DEVELOP",
      },
    ],
    placementMetadata,
  });
