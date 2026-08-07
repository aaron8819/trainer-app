import type { PlanSpecificationPreviewV0 } from "./plan-specification-preview-v0";

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS = {
  squat: "fixture-barbell-back-squat",
  pullUp: "fixture-pull-up",
  chestSupportedRow: "fixture-chest-supported-t-bar-row",
  cableCrunch: "fixture-cable-crunch",
  legCurl: "fixture-lying-leg-curl",
  splitSquat: "fixture-bulgarian-split-squat",
} as const;

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS = Object.values(
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS,
);

export const PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE: PlanSpecificationPreviewV0 = {
  version: 0,
  slots: [
    {
      slotId: "upper-1",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
          role: "CORE_COMPOUND",
          setCount: 4,
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
          role: "ACCESSORY",
          setCount: 3,
        },
      ],
    },
    {
      slotId: "lower-1",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
          role: "CORE_COMPOUND",
          setCount: 4,
        },
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.legCurl,
          role: "ACCESSORY",
          setCount: 3,
        },
      ],
    },
    {
      slotId: "upper-2",
      exercises: [
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
          role: "CORE_COMPOUND",
          setCount: 4,
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
          role: "ACCESSORY",
          setCount: 3,
        },
      ],
    },
    {
      slotId: "lower-2",
      exercises: [
        {
          exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat,
          role: "CORE_COMPOUND",
          setCount: 3,
        },
        {
          exerciseId:
            PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.splitSquat,
          role: "ACCESSORY",
          setCount: 3,
        },
      ],
    },
  ],
};
