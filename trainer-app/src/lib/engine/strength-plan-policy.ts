import type { MovementPatternV2, TrainingAge } from "./types";

export const STRENGTH_EMPHASIS_VALUES = [
  "BALANCED",
  "SQUAT",
  "BENCH",
  "DEADLIFT",
] as const;
export type StrengthEmphasis = (typeof STRENGTH_EMPHASIS_VALUES)[number];

export const STRENGTH_EQUIPMENT_PROFILE_VALUES = [
  "FULL_GYM",
  "BARBELL_HOME",
  "DUMBBELLS",
  "MACHINES",
  "BODYWEIGHT",
] as const;
export type StrengthEquipmentProfile =
  (typeof STRENGTH_EQUIPMENT_PROFILE_VALUES)[number];

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

const EQUIPMENT_BY_PROFILE: Record<
  StrengthEquipmentProfile,
  ReadonlySet<string> | null
> = {
  FULL_GYM: null,
  BARBELL_HOME: new Set([
    "barbell",
    "rack",
    "bench",
    "dumbbell",
    "bodyweight",
    "band",
  ]),
  DUMBBELLS: new Set(["dumbbell", "bench", "bodyweight", "band"]),
  MACHINES: new Set(["machine", "cable", "bodyweight"]),
  BODYWEIGHT: new Set(["bodyweight", "band"]),
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

function normalizedToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isEquipmentCompatible(
  exercise: StrengthExerciseCandidate,
  profile: StrengthEquipmentProfile,
): boolean {
  const allowed = EQUIPMENT_BY_PROFILE[profile];
  if (!allowed) return true;
  return exercise.equipment.some((item) => allowed.has(normalizedToken(item)));
}

function isLimitationCompatible(
  exercise: StrengthExerciseCandidate,
  limitations: readonly string[],
): boolean {
  const blocked = new Set(exercise.contraindications.map(normalizedToken));
  return !limitations.some((limitation) => blocked.has(normalizedToken(limitation)));
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
  limitations: string[];
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

function maxExercisesForDuration(
  duration: StrengthPlanConfiguration["sessionDurationMinutes"],
): number {
  switch (duration) {
    case 45:
      return 4;
    case 60:
      return 5;
    case 75:
      return 6;
    case 90:
      return 7;
  }
}

function setCountForLane(input: {
  lane: Lane;
  trainingAge: TrainingAge;
  emphasis: StrengthEmphasis;
}): number {
  if (input.lane.role === "ACCESSORY") return 2;
  const base = input.trainingAge === "beginner" ? 3 : 4;
  const emphasized =
    (input.emphasis === "SQUAT" && input.lane.kind === "squat") ||
    (input.emphasis === "BENCH" && input.lane.kind === "horizontal_push") ||
    (input.emphasis === "DEADLIFT" && input.lane.kind === "hinge");
  return emphasized ? Math.max(4, base) : base;
}

function estimateMinutes(
  exercises: StrengthSeedExercise[],
): number {
  const seconds = exercises.reduce((total, exercise) => {
    const rest = exercise.role === "CORE_COMPOUND" ? 270 : 120;
    return total + exercise.setCount * (rest + 45);
  }, 8 * 60);
  return Math.ceil(seconds / 60 / 5) * 5;
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
  const exerciseCap = maxExercisesForDuration(
    input.configuration.sessionDurationMinutes,
  );
  const substitutions = new Set<string>();
  const slots = templates.map((template) => {
    const selectedIds = new Set<string>();
    const exercises: StrengthSeedExercise[] = [];
    for (const lane of template.lanes.slice(0, exerciseCap)) {
      const selected = selectCandidate({
        candidates: input.exercises,
        lane,
        configuration: input.configuration,
        limitations: input.limitations,
        selectedIds,
      });
      if (!selected) {
        if (lane.required) {
          throw new Error(
            `STRENGTH_PLAN_REQUIRED_LANE_UNAVAILABLE:${template.slotId}:${lane.kind}`,
          );
        }
        continue;
      }
      selectedIds.add(selected.id);
      const preferredName = preferenceForLane(input.configuration, lane.kind);
      if (preferredName && selected.name !== preferredName) {
        substitutions.add(`${preferredName} → ${selected.name}`);
      }
      exercises.push({
        exerciseId: selected.id,
        name: selected.name,
        role: lane.role,
        setCount: setCountForLane({
          lane,
          trainingAge: input.trainingAge,
          emphasis: input.configuration.emphasis,
        }),
      });
    }
    if (
      exercises.filter((exercise) => exercise.role === "CORE_COMPOUND")
        .length === 0
    ) {
      throw new Error(`STRENGTH_PLAN_PRIMARY_LIFT_UNAVAILABLE:${template.slotId}`);
    }
    return {
      slotId: template.slotId,
      label: template.label,
      intent: template.intent,
      exercises,
      estimatedMinutes: estimateMinutes(exercises),
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
          const candidate = input.exercises.find(
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
