import type {
  V2ExerciseClassId,
  V2ExerciseClassMatch,
  V2ExerciseClassTaxonomy,
  V2MaterializationExercise,
} from "./types";

export const V2_EXERCISE_CLASS_ORDER: V2ExerciseClassId[] = [
  "knee_flexion_curl",
  "distinct_chest_press_or_fly",
  "vertical_press",
  "low_axial_hip_extension_anchor",
  "calf_isolation",
  "lateral_raise",
  "rear_delt_isolation",
  "triceps_isolation",
  "biceps_isolation",
  "horizontal_pull_support",
  "vertical_pull",
  "hinge_compound",
  "quad_isolation",
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
    vertical_press: ["vertical_press"],
    overhead_press: ["vertical_press"],
    shoulder_press: ["vertical_press"],
    ohp: ["vertical_press"],
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
    quad_isolation: ["quad_isolation"],
    leg_extension: ["quad_isolation"],
    squat_pattern: ["squat_pattern"],
    squat: ["squat_pattern"],
    leg_press: ["squat_pattern"],
    lunge: ["squat_pattern"],
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

export type V2AnchorLaneQualityTier = "ideal" | "fallback" | "ineligible";

export type V2AnchorLaneQuality = {
  tier: V2AnchorLaneQualityTier;
  laneFamily:
    | "chest_anchor"
    | "squat_anchor"
    | "hinge_anchor"
    | "vertical_pull"
    | "row"
    | "not_anchor_quality_checked";
  reasons: string[];
};

export function isV2AnchorLaneQualityChecked(laneId: string): boolean {
  return anchorLaneFamily(laneId) !== "not_anchor_quality_checked";
}

export function evaluateV2AnchorLaneQuality(
  laneId: string,
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  const family = anchorLaneFamily(laneId);
  if (family === "not_anchor_quality_checked") {
    return { tier: "ideal", laneFamily: family, reasons: [] };
  }

  switch (family) {
    case "chest_anchor":
      return evaluateChestAnchorQuality(exercise, match);
    case "squat_anchor":
      return evaluateSquatAnchorQuality(exercise, match);
    case "hinge_anchor":
      return evaluateHingeAnchorQuality(exercise, match);
    case "vertical_pull":
      return evaluateVerticalPullQuality(exercise, match);
    case "row":
      return evaluateRowQuality(exercise, match);
  }
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

function stimulusForMuscle(
  exercise: V2MaterializationExercise,
  muscle: string,
): number {
  const normalizedMuscle = normalizeV2MaterializationText(muscle);
  return (
    Object.entries(exercise.stimulusByMusclePerSet).find(
      ([entryMuscle]) =>
        normalizeV2MaterializationText(entryMuscle) === normalizedMuscle,
    )?.[1] ?? 0
  );
}

function hasRelevantDirectMuscle(
  exercise: V2MaterializationExercise,
  muscle: string,
): boolean {
  return hasPrimaryMuscle(exercise, muscle) || stimulusForMuscle(exercise, muscle) >= 0.75;
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

function anchorLaneFamily(
  laneId: string,
): V2AnchorLaneQuality["laneFamily"] {
  if (laneId === "chest_anchor") {
    return "chest_anchor";
  }
  if (laneId === "squat_anchor") {
    return "squat_anchor";
  }
  if (laneId === "hinge_anchor") {
    return "hinge_anchor";
  }
  if (laneId === "vertical_pull_anchor" || laneId === "vertical_pull_support") {
    return "vertical_pull";
  }
  if (laneId === "row_anchor" || laneId === "row_support") {
    return "row";
  }
  return "not_anchor_quality_checked";
}

function hasLoadabilitySignal(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    hasAnyText(text, [
      "barbell",
      "dumbbell",
      "db",
      "machine",
      "smith",
      "cable",
      "selectorized",
      "plate loaded",
      "leg press",
      "hack squat",
      "t bar",
      "chest supported",
      "seated",
    ]) ||
    hasAnyPattern(exercise, ["leg_press"]) ||
    hasAnyText(
      exercise.equipment.map(normalizeV2MaterializationText).join(" "),
      ["barbell", "dumbbell", "machine", "smith", "cable"],
    )
  );
}

function isFlyOnlyChestExercise(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    hasAnyPattern(exercise, ["fly"]) ||
    hasAnyText(text, ["fly", "crossover", "pec deck"])
  );
}

function isPressLikeChestExercise(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    hasAnyPattern(exercise, [
      "press",
      "horizontal_press",
      "slight_incline_press",
      "incline_press",
    ]) ||
    hasAnyText(text, [
      "press",
      "bench",
      "push up",
      "pushup",
      "dip",
    ])
  );
}

function isLoadableSquatAnchor(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    hasAnyPattern(exercise, ["leg_press"]) ||
    hasAnyText(text, [
      "hack squat",
      "leg press",
      "smith squat",
      "smith machine squat",
      "front squat",
      "high bar squat",
      "low bar squat",
      "back squat",
      "barbell squat",
      "safety bar squat",
      "ssb squat",
      "belt squat",
      "pendulum squat",
      "machine squat",
    ])
  );
}

function isSupportOnlySquat(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return hasAnyText(text, [
    "goblet squat",
    "sissy squat",
    "split squat",
    "lunge",
    "step up",
    "bodyweight squat",
  ]);
}

function isTrueHingeAnchor(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    (hasAnyPattern(exercise, ["hinge"]) ||
      hasAnyText(text, [
        "deadlift",
        "romanian deadlift",
        "rdl",
        "stiff leg",
        "stiff-legged",
        "sldl",
        "good morning",
      ])) &&
    !hasAnyText(text, [
      "pull through",
      "pull-through",
      "glute bridge",
      "hip thrust",
      "reverse hyper",
      "back extension",
    ])
  );
}

function isStableLoadableRow(exercise: V2MaterializationExercise): boolean {
  const text = normalizedFields(exercise);
  return (
    hasAnyText(text, [
      "chest supported row",
      "chest-supported row",
      "seated cable row",
      "cable row",
      "machine row",
      "t bar row",
      "t-bar row",
      "dumbbell row",
      "barbell row",
      "seal row",
    ]) ||
    (hasAnyText(text, ["row"]) &&
      hasLoadabilitySignal(exercise) &&
      !hasAnyText(text, ["inverted row", "bodyweight row", "trx row"]))
  );
}

function quality(
  tier: V2AnchorLaneQualityTier,
  laneFamily: V2AnchorLaneQuality["laneFamily"],
  reasons: string[],
): V2AnchorLaneQuality {
  return { tier, laneFamily, reasons };
}

function evaluateChestAnchorQuality(
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  if (!hasRelevantDirectMuscle(exercise, "Chest")) {
    return quality("ineligible", "chest_anchor", ["missing_direct_chest"]);
  }
  if (isFlyOnlyChestExercise(exercise)) {
    return quality("ineligible", "chest_anchor", ["chest_fly_only"]);
  }
  if (!isPressLikeChestExercise(exercise)) {
    return quality("ineligible", "chest_anchor", ["missing_press_pattern"]);
  }
  if (!exercise.isCompound || !hasLoadabilitySignal(exercise)) {
    return quality("fallback", "chest_anchor", [
      "press_like_but_lacks_compound_loadability",
    ]);
  }
  return quality("ideal", "chest_anchor", [
    match?.classId ? `class:${match.classId}` : "press_like_loadable_compound",
  ]);
}

function evaluateSquatAnchorQuality(
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  if (match?.classId !== "squat_pattern" || !hasRelevantDirectMuscle(exercise, "Quads")) {
    return quality("ineligible", "squat_anchor", ["missing_squat_quad_class"]);
  }
  if (isLoadableSquatAnchor(exercise) && exercise.isCompound) {
    return quality("ideal", "squat_anchor", [
      "loadable_squat_or_leg_press_anchor",
    ]);
  }
  return quality("fallback", "squat_anchor", [
    isSupportOnlySquat(exercise)
      ? "support_only_squat_pattern"
      : "squat_pattern_lacks_loadability_signal",
  ]);
}

function evaluateHingeAnchorQuality(
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  const hamstringBiased =
    hasRelevantDirectMuscle(exercise, "Hamstrings") ||
    stimulusForMuscle(exercise, "Hamstrings") >= 0.75;
  if (
    match?.classId === "hinge_compound" &&
    exercise.isCompound &&
    hamstringBiased &&
    isTrueHingeAnchor(exercise)
  ) {
    return quality("ideal", "hinge_anchor", [
      "true_hamstring_biased_hinge_compound",
    ]);
  }
  if (match?.classId === "low_axial_hip_extension_anchor") {
    return quality("fallback", "hinge_anchor", [
      "low_axial_hip_extension_support",
    ]);
  }
  return quality("ineligible", "hinge_anchor", [
    "missing_true_hamstring_biased_hinge",
  ]);
}

function evaluateVerticalPullQuality(
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  return match?.classId === "vertical_pull" && hasRelevantDirectMuscle(exercise, "Lats")
    ? quality("ideal", "vertical_pull", ["true_vertical_pull"])
    : quality("ineligible", "vertical_pull", ["missing_true_vertical_pull"]);
}

function evaluateRowQuality(
  exercise: V2MaterializationExercise,
  match?: V2ExerciseClassMatch,
): V2AnchorLaneQuality {
  if (
    match?.classId !== "horizontal_pull_support" ||
    (!hasRelevantDirectMuscle(exercise, "Upper Back") &&
      !hasRelevantDirectMuscle(exercise, "Lats"))
  ) {
    return quality("ineligible", "row", ["missing_horizontal_pull_class"]);
  }
  if (isStableLoadableRow(exercise)) {
    return quality("ideal", "row", ["stable_loadable_row"]);
  }
  return quality("fallback", "row", ["row_lacks_loadability_signal"]);
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
    case "vertical_press":
      return (
        exercise.isCompound &&
        (hasRelevantDirectMuscle(exercise, "Front Delts") ||
          hasRelevantDirectMuscle(exercise, "Side Delts")) &&
        (hasAnyPattern(exercise, [
          "vertical_press",
          "overhead_press",
          "shoulder_press",
        ]) ||
          hasAnyText(text, [
            "vertical press",
            "overhead press",
            "shoulder press",
            "ohp",
          ])) &&
        !hasAnyText(text, [
          "chest press",
          "bench press",
          "pressdown",
          "pushdown",
          "lateral raise",
          "pulldown",
          "pull down",
          "pull up",
          "pullup",
          "chin up",
          "chinup",
          "triceps extension",
          "skullcrusher",
        ]) &&
        !hasAnyPattern(exercise, ["vertical_pull", "isolation"])
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
        hasAnyText(text, [
          "pulldown",
          "pull down",
          "pull up",
          "pullup",
          "assisted pull",
          "chin up",
          "chinup",
        ]) &&
        !hasAnyText(text, ["row", "pullover", "pull over"])
      );
    case "hinge_compound":
      return (
        exercise.isCompound &&
        hasRelevantDirectMuscle(exercise, "Hamstrings") &&
        isTrueHingeAnchor(exercise)
      );
    case "quad_isolation":
      return (
        hasPrimaryMuscle(exercise, "Quads") &&
        (hasAnyText(text, ["leg extension", "quad extension", "knee extension"]) ||
          (hasAnyPattern(exercise, ["isolation"]) && hasAnyText(text, ["extension"]))) &&
        !hasAnyText(text, ["squat", "lunge", "leg press"])
      );
    case "squat_pattern":
      return (
        hasPrimaryMuscle(exercise, "Quads") &&
        (hasAnyPattern(exercise, ["squat", "lunge", "leg_press"]) ||
          hasAnyText(text, ["squat", "lunge", "leg press"])) &&
        !hasAnyText(text, ["leg extension"])
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
    vertical_press: ["Front Delts", "Side Delts"],
    low_axial_hip_extension_anchor: ["Glutes", "Hamstrings"],
    calf_isolation: ["Calves"],
    lateral_raise: ["Side Delts"],
    rear_delt_isolation: ["Rear Delts"],
    triceps_isolation: ["Triceps"],
    biceps_isolation: ["Biceps"],
    horizontal_pull_support: ["Upper Back", "Lats"],
    vertical_pull: ["Lats"],
    hinge_compound: ["Hamstrings", "Glutes"],
    quad_isolation: ["Quads"],
    squat_pattern: ["Quads"],
  };
  const primary = normalizedMuscles(exercise.primaryMuscles);
  return directByClass[classId].filter((muscle) => {
    const normalizedMuscle = normalizeV2MaterializationText(muscle);
    return (
      primary.includes(normalizedMuscle) ||
      (classId === "vertical_press" &&
        stimulusForMuscle(exercise, muscle) >= 0.75)
    );
  });
}

function duplicateFamilyForClass(
  exercise: V2MaterializationExercise,
  classId: V2ExerciseClassId,
): string {
  if (classId === "distinct_chest_press_or_fly") {
    return `${classId}:${chestVariantFamily(exercise)}`;
  }
  return `${classId}:${normalizeV2MaterializationText(exercise.name)}`;
}

function chestVariantFamily(exercise: V2MaterializationExercise): string {
  const text = normalizedFields(exercise);
  if (hasAnyPattern(exercise, ["fly"]) || hasAnyText(text, ["fly"])) {
    return "fly";
  }
  if (
    hasAnyPattern(exercise, ["slight_incline_press", "incline_press"]) ||
    hasAnyText(text, ["slight incline", "incline"])
  ) {
    return "incline_press";
  }
  if (hasAnyText(text, ["cable press"])) {
    return "cable_press";
  }
  if (hasAnyText(text, ["machine press", "machine chest press", "selectorized"])) {
    return "machine_press";
  }
  if (hasAnyPattern(exercise, ["press", "horizontal_press"]) || hasAnyText(text, ["press"])) {
    return "press";
  }
  return normalizeV2MaterializationText(exercise.name);
}
