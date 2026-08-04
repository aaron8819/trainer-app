import type { MovementPatternV2, TrainingAge } from "./types";
import {
  EQUIPMENT_PROFILE_VALUES,
  isEquipmentProfileCompatible,
  type EquipmentProfile,
} from "./equipment-profile";
import {
  estimateStrengthSessionTiming,
  type StrengthTimingExercise,
} from "./strength-session-timing";

export const STRENGTH_EMPHASIS_VALUES = [
  "BALANCED",
  "SQUAT",
  "BENCH",
  "DEADLIFT",
] as const;
export type StrengthEmphasis = (typeof STRENGTH_EMPHASIS_VALUES)[number];

export const STRENGTH_EQUIPMENT_PROFILE_VALUES = EQUIPMENT_PROFILE_VALUES;
export type StrengthEquipmentProfile = EquipmentProfile;

export const STRENGTH_LIMITATION_KEYS = [
  "low_back",
  "knee",
  "shoulder",
  "hip",
  "elbow",
  "wrist",
] as const;
export type StrengthLimitationKey =
  (typeof STRENGTH_LIMITATION_KEYS)[number];

export class StrengthLimitationValidationError extends Error {
  constructor(readonly limitation: string) {
    super(`STRENGTH_PLAN_UNCLASSIFIED_LIMITATION:${limitation}`);
    this.name = "StrengthLimitationValidationError";
  }
}

export class StrengthPlanInfeasibilityError extends Error {
  constructor(
    readonly reason:
      | "REQUIRED_LANE_UNAVAILABLE"
      | "PRIMARY_LIFT_UNAVAILABLE",
    context: string,
  ) {
    super(`STRENGTH_PLAN_${reason}:${context}`);
    this.name = "StrengthPlanInfeasibilityError";
  }
}

export const STRENGTH_SQUAT_PREFERENCE_VALUES = [
  "AUTO",
  "BACK_SQUAT",
  "FRONT_SQUAT",
  "LEG_PRESS",
  "GOBLET_SQUAT",
] as const;
export type StrengthSquatPreference =
  (typeof STRENGTH_SQUAT_PREFERENCE_VALUES)[number];

export const STRENGTH_PRESS_PREFERENCE_VALUES = [
  "AUTO",
  "BARBELL_BENCH",
  "DUMBBELL_BENCH",
  "OVERHEAD_PRESS",
  "MACHINE_PRESS",
] as const;
export type StrengthPressPreference =
  (typeof STRENGTH_PRESS_PREFERENCE_VALUES)[number];

export const STRENGTH_HINGE_PREFERENCE_VALUES = [
  "AUTO",
  "CONVENTIONAL_DEADLIFT",
  "TRAP_BAR_DEADLIFT",
  "ROMANIAN_DEADLIFT",
] as const;
export type StrengthHingePreference =
  (typeof STRENGTH_HINGE_PREFERENCE_VALUES)[number];

export type StrengthPlanConfiguration = {
  emphasis: StrengthEmphasis;
  daysPerWeek: 2 | 3 | 4 | 5;
  sessionDurationMinutes: 45 | 60 | 75 | 90;
  equipmentProfile: StrengthEquipmentProfile;
  preferredLifts: {
    squat: StrengthSquatPreference;
    press: StrengthPressPreference;
    hinge: StrengthHingePreference;
  };
};

export type StrengthExerciseCandidate = {
  id: string;
  name: string;
  movementPatterns: MovementPatternV2[];
  equipment: string[];
  contraindications: string[];
  isMainLiftEligible: boolean;
  isCompound: boolean;
  fatigueCost: number;
};

export type StrengthSeedExercise = {
  exerciseId: string;
  name: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
};

export type StrengthPolicySlot = {
  slotId: string;
  label: string;
  intent: "UPPER" | "LOWER" | "FULL_BODY";
  estimatedMinutes: number;
  exercises: StrengthSeedExercise[];
};

export type StrengthPlanPolicy = {
  version: 1;
  source: "strength_plan_policy_v1";
  mesocycleWeeks: number;
  focus: string;
  sessionsPerWeek: number;
  splitType: "UPPER_LOWER" | "FULL_BODY" | "CUSTOM";
  configuration: StrengthPlanConfiguration;
  resolvedPrimaryLifts: {
    squat: string;
    press: string;
    hinge: string;
  };
  substitutions: string[];
  slots: StrengthPolicySlot[];
  rirByWeek: Array<{ week: number; min: number; max: number }>;
};

type LaneKind =
  | "squat"
  | "hinge"
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "single_leg"
  | "posterior_assistance"
  | "upper_assistance"
  | "core";

type Lane = {
  kind: LaneKind;
  role: "CORE_COMPOUND" | "ACCESSORY";
  required?: boolean;
};

type SlotTemplate = {
  slotId: string;
  label: string;
  intent: StrengthPolicySlot["intent"];
  lanes: Lane[];
};

const PREFERRED_LIFT_NAME: Record<
  Exclude<
    StrengthSquatPreference | StrengthPressPreference | StrengthHingePreference,
    "AUTO"
  >,
  string
> = {
  BACK_SQUAT: "Barbell Back Squat",
  FRONT_SQUAT: "Front Squat",
  LEG_PRESS: "Leg Press",
  GOBLET_SQUAT: "Goblet Squat",
  BARBELL_BENCH: "Barbell Bench Press",
  DUMBBELL_BENCH: "Dumbbell Bench Press",
  OVERHEAD_PRESS: "Barbell Overhead Press",
  MACHINE_PRESS: "Machine Chest Press",
  CONVENTIONAL_DEADLIFT: "Conventional Deadlift",
  TRAP_BAR_DEADLIFT: "Trap Bar Deadlift",
  ROMANIAN_DEADLIFT: "Romanian Deadlift",
};

const LANE_NAME_PRIORITY: Record<LaneKind, string[]> = {
  squat: [
    "Barbell Back Squat",
    "Front Squat",
    "Trap Bar Deadlift",
    "Hack Squat",
    "Leg Press",
    "Goblet Squat",
    "Sissy Squat",
  ],
  hinge: [
    "Conventional Deadlift",
    "Trap Bar Deadlift",
    "Sumo Deadlift",
    "Romanian Deadlift",
    "Stiff-Legged Deadlift",
    "Good Morning",
    "Barbell Hip Thrust",
    "Machine Hip Thrust",
    "Glute Bridge",
  ],
  horizontal_push: [
    "Barbell Bench Press",
    "Dumbbell Bench Press",
    "Machine Chest Press",
    "Incline Barbell Bench Press",
    "Incline Dumbbell Bench Press",
    "Push-Up",
  ],
  vertical_push: [
    "Barbell Overhead Press",
    "Dumbbell Overhead Press",
    "Machine Shoulder Press",
    "Landmine Press",
    "Dip (Triceps Emphasis)",
    "Pike Push-Up",
  ],
  horizontal_pull: [
    "Barbell Row",
    "Pendlay Row",
    "Chest-Supported T-Bar Row",
    "One-Arm Dumbbell Row",
    "Dumbbell Row",
    "Seated Cable Row",
    "Inverted Row",
  ],
  vertical_pull: [
    "Weighted Pull-Up",
    "Pull-Up",
    "Chin-Up",
    "Neutral Grip Pull-Up",
    "Lat Pulldown",
  ],
  single_leg: [
    "Bulgarian Split Squat",
    "Reverse Lunge",
    "Walking Lunge",
  ],
  posterior_assistance: [
    "Lying Leg Curl",
    "Seated Leg Curl",
    "Nordic Hamstring Curl",
    "Back Extension",
    "Glute Bridge",
  ],
  upper_assistance: [
    "Face Pull",
    "Reverse Pec Deck",
    "Cable Triceps Pushdown",
    "Dumbbell Lateral Raise",
    "Dumbbell Curl",
  ],
  core: [
    "Ab Wheel Rollout",
    "Pallof Press",
    "RKC Plank",
    "Plank",
    "Side Plank",
  ],
};

const SLOT_TEMPLATES: Record<2 | 3 | 4 | 5, SlotTemplate[]> = {
  2: [
    {
      slotId: "strength_full_body_a",
      label: "Full Body A · Squat + Press",
      intent: "FULL_BODY",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_pull", role: "ACCESSORY", required: true },
        { kind: "posterior_assistance", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_full_body_b",
      label: "Full Body B · Hinge + Press",
      intent: "FULL_BODY",
      lanes: [
        { kind: "hinge", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "ACCESSORY", required: true },
        { kind: "single_leg", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
  ],
  3: [
    {
      slotId: "strength_full_body_a",
      label: "Full Body A · Squat",
      intent: "FULL_BODY",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_pull", role: "ACCESSORY", required: true },
        { kind: "posterior_assistance", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_full_body_b",
      label: "Full Body B · Hinge",
      intent: "FULL_BODY",
      lanes: [
        { kind: "hinge", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "ACCESSORY", required: true },
        { kind: "single_leg", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_full_body_c",
      label: "Full Body C · Practice + Balance",
      intent: "FULL_BODY",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "ACCESSORY", required: true },
        { kind: "hinge", role: "ACCESSORY" },
        { kind: "upper_assistance", role: "ACCESSORY" },
      ],
    },
  ],
  4: [
    {
      slotId: "strength_lower_a",
      label: "Lower A · Squat",
      intent: "LOWER",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "hinge", role: "ACCESSORY", required: true },
        { kind: "single_leg", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_upper_a",
      label: "Upper A · Bench",
      intent: "UPPER",
      lanes: [
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_pull", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_push", role: "ACCESSORY" },
        { kind: "vertical_pull", role: "ACCESSORY" },
        { kind: "upper_assistance", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_lower_b",
      label: "Lower B · Hinge",
      intent: "LOWER",
      lanes: [
        { kind: "hinge", role: "CORE_COMPOUND", required: true },
        { kind: "squat", role: "ACCESSORY", required: true },
        { kind: "posterior_assistance", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_upper_b",
      label: "Upper B · Overhead + Pull",
      intent: "UPPER",
      lanes: [
        { kind: "vertical_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "ACCESSORY" },
        { kind: "horizontal_pull", role: "ACCESSORY" },
        { kind: "upper_assistance", role: "ACCESSORY" },
      ],
    },
  ],
  5: [
    {
      slotId: "strength_lower_a",
      label: "Lower A · Squat",
      intent: "LOWER",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "hinge", role: "ACCESSORY" },
        { kind: "single_leg", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_upper_a",
      label: "Upper A · Bench",
      intent: "UPPER",
      lanes: [
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_pull", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "ACCESSORY" },
        { kind: "upper_assistance", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_full_body_practice",
      label: "Full Body · Technique",
      intent: "FULL_BODY",
      lanes: [
        { kind: "squat", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_lower_b",
      label: "Lower B · Hinge",
      intent: "LOWER",
      lanes: [
        { kind: "hinge", role: "CORE_COMPOUND", required: true },
        { kind: "single_leg", role: "ACCESSORY" },
        { kind: "posterior_assistance", role: "ACCESSORY" },
        { kind: "core", role: "ACCESSORY" },
      ],
    },
    {
      slotId: "strength_upper_b",
      label: "Upper B · Overhead + Pull",
      intent: "UPPER",
      lanes: [
        { kind: "vertical_push", role: "CORE_COMPOUND", required: true },
        { kind: "vertical_pull", role: "CORE_COMPOUND", required: true },
        { kind: "horizontal_push", role: "ACCESSORY" },
        { kind: "horizontal_pull", role: "ACCESSORY" },
        { kind: "upper_assistance", role: "ACCESSORY" },
      ],
    },
  ],
};

const LIMITATION_WORD_TO_KEY: Readonly<
  Record<string, Exclude<StrengthLimitationKey, "low_back">>
> = {
  knee: "knee",
  knees: "knee",
  shoulder: "shoulder",
  shoulders: "shoulder",
  hip: "hip",
  hips: "hip",
  elbow: "elbow",
  elbows: "elbow",
  wrist: "wrist",
  wrists: "wrist",
};

const LIMITATION_CONTEXT_WORDS = new Set([
  "left",
  "right",
  "both",
  "bilateral",
  "and",
  "or",
  "but",
  "in",
  "of",
  "with",
  "around",
  "near",
  "at",
  "on",
  "my",
  "the",
  "a",
  "an",
  "history",
  "previous",
  "previously",
  "prior",
  "past",
  "old",
  "current",
  "chronic",
  "acute",
  "pain",
  "painful",
  "ache",
  "aches",
  "aching",
  "hurt",
  "hurts",
  "hurting",
  "injury",
  "injuries",
  "injured",
  "issue",
  "issues",
  "limitation",
  "limitations",
  "discomfort",
  "impingement",
  "syndrome",
  "problem",
  "problems",
  "soreness",
  "sore",
  "strain",
  "strains",
  "sprain",
  "sprains",
  "surgery",
  "post",
]);

function limitationWords(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[_\W]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function canonicalizeStrengthLimitations(
  limitations: readonly string[],
): StrengthLimitationKey[] {
  const canonical = new Set<StrengthLimitationKey>();

  for (const rawLimitation of limitations) {
    const words = limitationWords(rawLimitation);
    let recognized = false;

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index]!;
      const next = words[index + 1];
      if (
        (word === "low" || word === "lower") &&
        next === "back"
      ) {
        canonical.add("low_back");
        recognized = true;
        index += 1;
        continue;
      }
      if (word === "lowback" || word === "lowerback") {
        canonical.add("low_back");
        recognized = true;
        continue;
      }
      if (word === "rotator" && next === "cuff") {
        canonical.add("shoulder");
        recognized = true;
        index += 1;
        continue;
      }
      const key = LIMITATION_WORD_TO_KEY[word];
      if (key) {
        canonical.add(key);
        recognized = true;
        continue;
      }
      if (LIMITATION_CONTEXT_WORDS.has(word)) {
        continue;
      }
      throw new StrengthLimitationValidationError(rawLimitation);
    }

    if (!recognized) {
      throw new StrengthLimitationValidationError(rawLimitation);
    }
  }

  return [...canonical];
}

function isEquipmentCompatible(
  exercise: StrengthExerciseCandidate,
  profile: StrengthEquipmentProfile,
): boolean {
  return isEquipmentProfileCompatible(exercise.equipment, profile);
}

function isLimitationCompatible(
  exercise: StrengthExerciseCandidate,
  limitations: ReadonlySet<StrengthLimitationKey>,
): boolean {
  return !exercise.contraindications.some((contraindication) =>
    limitations.has(contraindication as StrengthLimitationKey),
  );
}

function matchesLane(
  exercise: StrengthExerciseCandidate,
  lane: LaneKind,
): boolean {
  const patterns = new Set(exercise.movementPatterns);
  const name = exercise.name.toLowerCase();
  switch (lane) {
    case "squat":
    case "hinge":
    case "horizontal_push":
    case "vertical_push":
    case "horizontal_pull":
    case "vertical_pull":
      return patterns.has(lane);
    case "single_leg":
      return patterns.has("lunge");
    case "posterior_assistance":
      return (
        name.includes("leg curl") ||
        name.includes("nordic") ||
        name.includes("back extension") ||
        name.includes("glute bridge")
      );
    case "upper_assistance":
      return (
        name.includes("face pull") ||
        name.includes("rear delt") ||
        name.includes("triceps") ||
        name.includes("lateral raise") ||
        name.includes("curl")
      );
    case "core":
      return (
        patterns.has("anti_rotation") ||
        name.includes("plank") ||
        name.includes("ab wheel") ||
        name.includes("pallof")
      );
  }
}

function preferenceForLane(
  configuration: StrengthPlanConfiguration,
  lane: LaneKind,
): string | null {
  let preference:
    | StrengthSquatPreference
    | StrengthPressPreference
    | StrengthHingePreference = "AUTO";
  if (lane === "squat") {
    preference = configuration.preferredLifts.squat;
  } else if (lane === "hinge") {
    preference = configuration.preferredLifts.hinge;
  } else if (lane === "horizontal_push") {
    const press = configuration.preferredLifts.press;
    preference = press === "OVERHEAD_PRESS" ? "AUTO" : press;
  } else if (lane === "vertical_push") {
    preference =
      configuration.preferredLifts.press === "OVERHEAD_PRESS"
        ? "OVERHEAD_PRESS"
        : "AUTO";
  }
  return preference === "AUTO" ? null : PREFERRED_LIFT_NAME[preference];
}

function emphasisBoost(
  emphasis: StrengthEmphasis,
  lane: LaneKind,
): number {
  if (emphasis === "SQUAT" && lane === "squat") return 30;
  if (
    emphasis === "BENCH" &&
    (lane === "horizontal_push" || lane === "vertical_push")
  ) {
    return lane === "horizontal_push" ? 30 : 5;
  }
  if (emphasis === "DEADLIFT" && lane === "hinge") return 30;
  return 0;
}

function rankCandidate(
  exercise: StrengthExerciseCandidate,
  lane: LaneKind,
  configuration: StrengthPlanConfiguration,
): number {
  const preferredName = preferenceForLane(configuration, lane);
  const nameIndex = LANE_NAME_PRIORITY[lane].indexOf(exercise.name);
  return (
    (exercise.name === preferredName ? 100 : 0) +
    emphasisBoost(configuration.emphasis, lane) +
    (exercise.isMainLiftEligible ? 20 : 0) +
    (exercise.isCompound ? 5 : 0) +
    (nameIndex >= 0 ? 15 - nameIndex : 0) -
    exercise.fatigueCost * 0.1
  );
}

function selectCandidate(input: {
  candidates: StrengthExerciseCandidate[];
  lane: Lane;
  configuration: StrengthPlanConfiguration;
  limitations: ReadonlySet<StrengthLimitationKey>;
  selectedIds: Set<string>;
}): StrengthExerciseCandidate | null {
  return (
    input.candidates
      .filter((candidate) => !input.selectedIds.has(candidate.id))
      .filter((candidate) => matchesLane(candidate, input.lane.kind))
      .filter((candidate) =>
        isEquipmentCompatible(candidate, input.configuration.equipmentProfile),
      )
      .filter((candidate) =>
        isLimitationCompatible(candidate, input.limitations),
      )
      .sort((left, right) => {
        const scoreDelta =
          rankCandidate(right, input.lane.kind, input.configuration) -
          rankCandidate(left, input.lane.kind, input.configuration);
        return (
          scoreDelta ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id)
        );
      })[0] ?? null
  );
}

function setCountForLane(input: {
  lane: Lane;
  trainingAge: TrainingAge;
  emphasis: StrengthEmphasis;
  sessionDurationMinutes: StrengthPlanConfiguration["sessionDurationMinutes"];
}): number {
  if (input.lane.role === "ACCESSORY") return 2;
  if (input.sessionDurationMinutes === 45) return 3;
  const base = input.trainingAge === "beginner" ? 3 : 4;
  const emphasized =
    (input.emphasis === "SQUAT" && input.lane.kind === "squat") ||
    (input.emphasis === "BENCH" && input.lane.kind === "horizontal_push") ||
    (input.emphasis === "DEADLIFT" && input.lane.kind === "hinge");
  return emphasized ? Math.max(4, base) : base;
}

type PlannedStrengthExercise = StrengthSeedExercise & {
  required: boolean;
  isCompound: boolean;
  fatigueCost: number;
};

function estimateMinutes(
  exercises: PlannedStrengthExercise[],
  trainingAge: TrainingAge,
): number {
  return estimateStrengthSessionTiming({
    trainingAge,
    exercises,
  }).estimatedMinutes;
}

export function estimateStrengthSeedSessionMinutes(input: {
  trainingAge: TrainingAge;
  exercises: readonly StrengthSeedExercise[];
  catalog: readonly StrengthExerciseCandidate[];
}): number {
  const classificationById = new Map(
    input.catalog.map((exercise) => [exercise.id, exercise]),
  );
  const timingExercises: StrengthTimingExercise[] = input.exercises.map(
    (exercise) => {
      const classification = classificationById.get(exercise.exerciseId);
      if (!classification) {
        throw new Error(
          `STRENGTH_PLAN_TIMING_CLASSIFICATION_MISSING:${exercise.exerciseId}`,
        );
      }
      return {
        role: exercise.role,
        setCount: exercise.setCount,
        isCompound: classification.isCompound,
        fatigueCost: classification.fatigueCost,
      };
    },
  );
  return estimateStrengthSessionTiming({
    trainingAge: input.trainingAge,
    exercises: timingExercises,
  }).estimatedMinutes;
}

function fitSessionToDuration(input: {
  slotId: string;
  requestedMinutes: StrengthPlanConfiguration["sessionDurationMinutes"];
  trainingAge: TrainingAge;
  exercises: PlannedStrengthExercise[];
}): {
  exercises: StrengthSeedExercise[];
  estimatedMinutes: number;
} {
  const exercises = input.exercises.map((exercise) => ({ ...exercise }));
  const withinBudget = () =>
    estimateMinutes(exercises, input.trainingAge) <=
    input.requestedMinutes;

  while (!withinBudget()) {
    const removableIndex = exercises.findLastIndex(
      (exercise) =>
        !exercise.required && exercise.role === "ACCESSORY",
    );
    if (removableIndex < 0) break;
    exercises.splice(removableIndex, 1);
  }

  while (!withinBudget()) {
    const reducible = [...exercises]
      .reverse()
      .find(
        (exercise) =>
          exercise.role === "ACCESSORY" && exercise.setCount > 1,
      );
    if (!reducible) break;
    reducible.setCount -= 1;
  }

  if (!withinBudget()) {
    throw new Error(
      `STRENGTH_PLAN_DURATION_UNACHIEVABLE:${input.slotId}:${input.requestedMinutes}`,
    );
  }

  return {
    exercises: exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      role: exercise.role,
      setCount: exercise.setCount,
    })),
    estimatedMinutes: estimateMinutes(exercises, input.trainingAge),
  };
}

function mesocycleWeeksForAge(trainingAge: TrainingAge): number {
  switch (trainingAge) {
    case "beginner":
      return 4;
    case "intermediate":
      return 5;
    case "advanced":
      return 6;
  }
}

export function getStrengthRirTarget(input: {
  blockType: "accumulation" | "intensification" | "realization" | "deload";
  weekInBlock: number;
}): { min: number; max: number } {
  switch (input.blockType) {
    case "accumulation":
      return input.weekInBlock <= 1 ? { min: 3, max: 4 } : { min: 2, max: 3 };
    case "intensification":
      return input.weekInBlock <= 1 ? { min: 2, max: 3 } : { min: 1, max: 2 };
    case "realization":
      return { min: 1, max: 2 };
    case "deload":
      return { min: 4, max: 5 };
  }
}

export function buildStrengthPlanPolicy(input: {
  configuration: StrengthPlanConfiguration;
  trainingAge: TrainingAge;
  limitations: string[];
  exercises: StrengthExerciseCandidate[];
}): StrengthPlanPolicy {
  const templates = SLOT_TEMPLATES[input.configuration.daysPerWeek];
  const limitationKeys = new Set(
    canonicalizeStrengthLimitations(input.limitations),
  );
  const candidates = input.exercises.map((exercise) => ({
    ...exercise,
    contraindications: canonicalizeStrengthLimitations(
      exercise.contraindications,
    ),
  }));
  const substitutions = new Set<string>();
  const slots = templates.map((template) => {
    const selectedIds = new Set<string>();
    const plannedExercises: PlannedStrengthExercise[] = [];
    for (const lane of template.lanes) {
      const selected = selectCandidate({
        candidates,
        lane,
        configuration: input.configuration,
        limitations: limitationKeys,
        selectedIds,
      });
      if (!selected) {
        if (lane.required) {
          throw new StrengthPlanInfeasibilityError(
            "REQUIRED_LANE_UNAVAILABLE",
            `${template.slotId}:${lane.kind}`,
          );
        }
        continue;
      }
      selectedIds.add(selected.id);
      const preferredName = preferenceForLane(input.configuration, lane.kind);
      if (preferredName && selected.name !== preferredName) {
        substitutions.add(`${preferredName} → ${selected.name}`);
      }
      plannedExercises.push({
        exerciseId: selected.id,
        name: selected.name,
        role: lane.role,
        required: lane.required === true,
        isCompound: selected.isCompound,
        fatigueCost: selected.fatigueCost,
        setCount: setCountForLane({
          lane,
          trainingAge: input.trainingAge,
          emphasis: input.configuration.emphasis,
          sessionDurationMinutes:
            input.configuration.sessionDurationMinutes,
        }),
      });
    }
    const fitted = fitSessionToDuration({
      slotId: template.slotId,
      requestedMinutes: input.configuration.sessionDurationMinutes,
      trainingAge: input.trainingAge,
      exercises: plannedExercises,
    });
    const exercises = fitted.exercises;
    if (
      exercises.filter((exercise) => exercise.role === "CORE_COMPOUND")
        .length === 0
    ) {
      throw new StrengthPlanInfeasibilityError(
        "PRIMARY_LIFT_UNAVAILABLE",
        template.slotId,
      );
    }
    return {
      slotId: template.slotId,
      label: template.label,
      intent: template.intent,
      exercises,
      estimatedMinutes: fitted.estimatedMinutes,
    };
  });

  const primaryName = (kind: "squat" | "press" | "hinge") => {
    const laneKinds =
      kind === "press"
        ? ["horizontal_push", "vertical_push"]
        : [kind];
    return (
      slots
        .flatMap((slot) => slot.exercises)
        .find((exercise) => {
          const candidate = candidates.find(
            (entry) => entry.id === exercise.exerciseId,
          );
          return candidate
            ? laneKinds.some((lane) =>
                matchesLane(candidate, lane as LaneKind),
              )
            : false;
        })?.name ?? "Equipment-compatible substitute"
    );
  };

  const mesocycleWeeks = mesocycleWeeksForAge(input.trainingAge);
  const rirByWeek = Array.from({ length: mesocycleWeeks }, (_, index) => {
    const week = index + 1;
    const isDeload = week === mesocycleWeeks;
    const isIntensification =
      !isDeload && week > Math.max(2, mesocycleWeeks - 3);
    const target = getStrengthRirTarget({
      blockType: isDeload
        ? "deload"
        : isIntensification
          ? "intensification"
          : "accumulation",
      weekInBlock: isIntensification
        ? week - Math.max(2, mesocycleWeeks - 3)
        : week,
    });
    return { week, ...target };
  });

  return {
    version: 1,
    source: "strength_plan_policy_v1",
    mesocycleWeeks,
    focus:
      input.configuration.emphasis === "BALANCED"
        ? "Balanced Strength"
        : `${input.configuration.emphasis[0]}${input.configuration.emphasis
            .slice(1)
            .toLowerCase()} Strength Emphasis`,
    sessionsPerWeek: input.configuration.daysPerWeek,
    splitType:
      input.configuration.daysPerWeek <= 3
        ? "FULL_BODY"
        : input.configuration.daysPerWeek === 4
          ? "UPPER_LOWER"
          : "CUSTOM",
    configuration: input.configuration,
    resolvedPrimaryLifts: {
      squat: primaryName("squat"),
      press: primaryName("press"),
      hinge: primaryName("hinge"),
    },
    substitutions: [...substitutions].sort(),
    slots,
    rirByWeek,
  };
}

export function toStrengthSlotSequence(policy: StrengthPlanPolicy) {
  return {
    version: 1,
    source: policy.source,
    sequenceMode: "ordered_flexible",
    strengthConfiguration: {
      version: 1,
      ...policy.configuration,
      resolvedPrimaryLifts: policy.resolvedPrimaryLifts,
      substitutions: policy.substitutions,
    },
    slots: policy.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      label: slot.label,
      estimatedMinutes: slot.estimatedMinutes,
    })),
  };
}

export function toStrengthSlotPlanSeed(policy: StrengthPlanPolicy) {
  return {
    version: 1,
    source: policy.source,
    slots: policy.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises,
    })),
  };
}
