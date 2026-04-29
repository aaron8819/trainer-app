import type {
  V2ExerciseClassId,
  V2ExerciseClassMatch,
  V2ExerciseClassTaxonomy,
  V2MaterializationExercise,
} from "./types";

export const V2_EXERCISE_CLASS_ORDER: V2ExerciseClassId[] = [
  "knee_flexion_curl",
  "distinct_chest_press_or_fly",
  "low_axial_hip_extension_anchor",
  "calf_isolation",
  "lateral_raise",
  "rear_delt_isolation",
  "triceps_isolation",
  "biceps_isolation",
  "horizontal_pull_support",
  "vertical_pull",
  "hinge_compound",
  "squat_pattern",
];

export const DEFAULT_V2_EXERCISE_CLASS_TAXONOMY: V2ExerciseClassTaxonomy = {
  version: 1,
  source: "v2_exercise_class_taxonomy",
  classOrder: V2_EXERCISE_CLASS_ORDER,
  classAliases: {
    knee_flexion_curl: ["knee_flexion_curl"],
    hamstring_curl: ["knee_flexion_curl"],
    leg_curl: ["knee_flexion_curl"],
    distinct_chest_press_or_fly: ["distinct_chest_press_or_fly"],
    horizontal_press: ["distinct_chest_press_or_fly"],
    slight_incline_press: ["distinct_chest_press_or_fly"],
    machine_press: ["distinct_chest_press_or_fly"],
    cable_press: ["distinct_chest_press_or_fly"],
    fly: ["distinct_chest_press_or_fly"],
    low_axial_hip_extension_anchor: ["low_axial_hip_extension_anchor"],
    low_dose_hinge: [
      "low_axial_hip_extension_anchor",
      "hinge_compound",
    ],
    calf_isolation: ["calf_isolation"],
    lateral_raise: ["lateral_raise"],
    low_collateral_side_delt: ["lateral_raise"],
    rear_delt_isolation: ["rear_delt_isolation"],
    triceps_isolation: ["triceps_isolation"],
    pressdown: ["triceps_isolation"],
    biceps_isolation: ["biceps_isolation"],
    horizontal_pull_support: ["horizontal_pull_support"],
    chest_supported_row: ["horizontal_pull_support"],
    cable_row: ["horizontal_pull_support"],
    t_bar_row: ["horizontal_pull_support"],
    vertical_pull: ["vertical_pull"],
    hinge_compound: ["hinge_compound"],
    squat_pattern: ["squat_pattern"],
    squat: ["squat_pattern"],
    leg_press: ["squat_pattern"],
    lunge: ["squat_pattern"],
    quad_isolation: ["squat_pattern"],
    leg_extension: ["squat_pattern"],
  },
};

export function resolveV2ExerciseClassIds(
  taxonomy: V2ExerciseClassTaxonomy,
  classNames: string[],
): V2ExerciseClassId[] {
  const resolved = new Set<V2ExerciseClassId>();
  for (const className of classNames) {
    for (const classId of taxonomy.classAliases[normalizeToken(className)] ?? []) {
      resolved.add(classId);
    }
  }
  return taxonomy.classOrder.filter((classId) => resolved.has(classId));
}

export function matchV2ExerciseClasses(
  exercise: V2MaterializationExercise,
  taxonomy: V2ExerciseClassTaxonomy = DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
): V2ExerciseClassMatch[] {
  return taxonomy.classOrder
    .flatMap((classId, rank) =>
      matchesClass(exercise, classId)
        ? [
            {
              classId,
              directMuscles: directMusclesForClass(exercise, classId),
              duplicateFamily: duplicateFamilyForClass(exercise, classId),
              rank,
            },
          ]
        : [],
    )
    .sort((left, right) => left.rank - right.rank || left.classId.localeCompare(right.classId));
}

export function normalizeV2MaterializationText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeToken(value: string): string {
  return normalizeV2MaterializationText(value).replace(/\s+/g, "_");
}

function normalizedFields(exercise: V2MaterializationExercise): string {
  return [
    exercise.name,
    ...(exercise.aliases ?? []),
    ...exercise.movementPatterns,
    ...exercise.equipment,
  ]
    .map(normalizeV2MaterializationText)
    .join(" ");
}

function normalizedMuscles(values: string[]): string[] {
  return values.map(normalizeV2MaterializationText);
}

function hasPrimaryMuscle(
  exercise: V2MaterializationExercise,
  muscle: string,
): boolean {
  return normalizedMuscles(exercise.primaryMuscles).includes(
    normalizeV2MaterializationText(muscle),
  );
}

function hasAnyText(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    text.includes(normalizeV2MaterializationText(pattern)),
  );
}

function hasAnyPattern(
  exercise: V2MaterializationExercise,
  patterns: string[],
): boolean {
  const normalizedPatterns = normalizedMuscles(exercise.movementPatterns);
  return patterns.some((pattern) =>
    normalizedPatterns.includes(normalizeV2MaterializationText(pattern)),
  );
}

function lowerBackStimulus(exercise: V2MaterializationExercise): number {
  const entry = Object.entries(exercise.stimulusByMusclePerSet).find(
    ([muscle]) => normalizeV2MaterializationText(muscle) === "lower back",
  );
  return entry?.[1] ?? 0;
}

function matchesClass(
  exercise: V2MaterializationExercise,
  classId: V2ExerciseClassId,
): boolean {
  const text = normalizedFields(exercise);
  switch (classId) {
    case "knee_flexion_curl":
      return (
        hasPrimaryMuscle(exercise, "Hamstrings") &&
        (hasAnyPattern(exercise, ["flexion", "isolation"]) ||
          hasAnyText(text, ["leg curl", "hamstring curl", "nordic"])) &&
        !hasAnyText(text, ["back extension", "deadlift", "rdl", "sldl", "good morning"]) &&
        !hasAnyPattern(exercise, ["hinge"])
      );
    case "distinct_chest_press_or_fly":
      return (
        hasPrimaryMuscle(exercise, "Chest") &&
        (hasAnyPattern(exercise, ["press", "fly", "horizontal_press"]) ||
          hasAnyText(text, ["press", "fly"]))
      );
    case "low_axial_hip_extension_anchor":
      return (
        (hasPrimaryMuscle(exercise, "Glutes") ||
          hasPrimaryMuscle(exercise, "Hamstrings")) &&
        hasAnyText(text, [
          "glute bridge",
          "hip thrust",
          "pull through",
          "reverse hyper",
        ]) &&
        lowerBackStimulus(exercise) <= 0.5 &&
        !hasAnyText(text, ["deadlift", "rdl", "sldl"])
      );
    case "calf_isolation":
      return (
        hasPrimaryMuscle(exercise, "Calves") &&
        (hasAnyPattern(exercise, ["isolation"]) || hasAnyText(text, ["calf", "raise"]))
      );
    case "lateral_raise":
      return (
        hasPrimaryMuscle(exercise, "Side Delts") &&
        (hasAnyPattern(exercise, ["isolation"]) || hasAnyText(text, ["lateral raise"]))
      );
    case "rear_delt_isolation":
      return (
        hasPrimaryMuscle(exercise, "Rear Delts") &&
        (hasAnyPattern(exercise, ["isolation"]) ||
          hasAnyText(text, ["rear delt", "reverse fly", "face pull"]))
      );
    case "triceps_isolation":
      return (
        hasPrimaryMuscle(exercise, "Triceps") &&
        hasAnyText(text, ["extension", "pressdown", "pushdown", "skullcrusher"]) &&
        (!hasAnyText(text, ["press"]) || hasAnyText(text, ["pressdown"]))
      );
    case "biceps_isolation":
      return (
        hasPrimaryMuscle(exercise, "Biceps") &&
        hasAnyText(text, ["curl"]) &&
        !hasAnyText(text, ["pull up", "pullup", "chin", "row"])
      );
    case "horizontal_pull_support":
      return (
        (hasPrimaryMuscle(exercise, "Upper Back") ||
          hasPrimaryMuscle(exercise, "Lats")) &&
        (hasAnyPattern(exercise, ["row", "horizontal_pull"]) ||
          hasAnyText(text, ["row"]))
      );
    case "vertical_pull":
      return (
        hasPrimaryMuscle(exercise, "Lats") &&
        (hasAnyPattern(exercise, ["vertical_pull"]) ||
          hasAnyText(text, ["pulldown", "pull up", "pullup", "assisted pull", "chin"]))
      );
    case "hinge_compound":
      return (
        exercise.isCompound &&
        (hasAnyPattern(exercise, ["hinge"]) ||
          hasAnyText(text, ["deadlift", "rdl", "sldl", "good morning"])) &&
        !hasAnyText(text, ["glute bridge", "hip thrust", "back extension"])
      );
    case "squat_pattern":
      return (
        hasPrimaryMuscle(exercise, "Quads") &&
        (hasAnyPattern(exercise, ["squat", "lunge", "leg_press"]) ||
          hasAnyText(text, ["squat", "lunge", "leg press", "leg extension"]))
      );
  }
}

function directMusclesForClass(
  exercise: V2MaterializationExercise,
  classId: V2ExerciseClassId,
): string[] {
  const directByClass: Record<V2ExerciseClassId, string[]> = {
    knee_flexion_curl: ["Hamstrings"],
    distinct_chest_press_or_fly: ["Chest"],
    low_axial_hip_extension_anchor: ["Glutes", "Hamstrings"],
    calf_isolation: ["Calves"],
    lateral_raise: ["Side Delts"],
    rear_delt_isolation: ["Rear Delts"],
    triceps_isolation: ["Triceps"],
    biceps_isolation: ["Biceps"],
    horizontal_pull_support: ["Upper Back", "Lats"],
    vertical_pull: ["Lats"],
    hinge_compound: ["Hamstrings", "Glutes"],
    squat_pattern: ["Quads"],
  };
  const primary = normalizedMuscles(exercise.primaryMuscles);
  return directByClass[classId].filter((muscle) =>
    primary.includes(normalizeV2MaterializationText(muscle)),
  );
}

function duplicateFamilyForClass(
  exercise: V2MaterializationExercise,
  classId: V2ExerciseClassId,
): string {
  return `${classId}:${normalizeV2MaterializationText(exercise.name)}`;
}
