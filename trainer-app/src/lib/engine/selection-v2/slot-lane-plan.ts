import type { Exercise } from "../types";
import type { SlotLanePlanLane } from "./types";

function normalizedName(exercise: Pick<Exercise, "name">): string {
  return exercise.name.trim().toLowerCase();
}

function hasPattern(
  exercise: Pick<Exercise, "movementPatterns">,
  pattern: string,
): boolean {
  return (exercise.movementPatterns ?? []).some(
    (entry) => entry.toLowerCase() === pattern,
  );
}

function hasPrimaryMuscle(
  exercise: Pick<Exercise, "primaryMuscles">,
  muscle: string,
): boolean {
  return (exercise.primaryMuscles ?? []).some(
    (entry) => entry.trim().toLowerCase() === muscle,
  );
}

export function exerciseMatchesSlotLane(
  exercise: Pick<
    Exercise,
    "id" | "name" | "movementPatterns" | "primaryMuscles" | "equipment"
  >,
  lane: SlotLanePlanLane,
): boolean {
  if (lane.avoidExerciseIds?.includes(exercise.id)) {
    return false;
  }

  const name = normalizedName(exercise);
  const matchesClass = (exerciseClass: SlotLanePlanLane["preferredClasses"][number]) => {
    switch (exerciseClass) {
      case "horizontal_press":
        return (
          hasPrimaryMuscle(exercise, "Chest") &&
          hasPattern(exercise, "horizontal_push") &&
          !name.includes("machine") &&
          !name.includes("cable") &&
          !name.includes("fly")
        );
      case "slight_incline_press":
        return (
          hasPrimaryMuscle(exercise, "Chest") &&
          name.includes("incline") &&
          (name.includes("bench") || name.includes("press")) &&
          !name.includes("machine")
        );
      case "machine_press":
        return hasPrimaryMuscle(exercise, "Chest") && name.includes("machine") && name.includes("press");
      case "cable_press":
        return hasPrimaryMuscle(exercise, "Chest") && name.includes("cable") && name.includes("press");
      case "chest_fly":
        return hasPrimaryMuscle(exercise, "Chest") && (name.includes("fly") || name.includes("pec deck") || name.includes("crossover"));
      case "chest_supported_row":
        return name.includes("chest supported") && name.includes("row");
      case "cable_row":
        return name.includes("cable row") || name.includes("seated cable row");
      case "t_bar_row":
        return name.includes("t-bar row") || name.includes("t bar row");
      case "pulldown":
        return name.includes("pulldown") || hasPattern(exercise, "vertical_pull");
      case "assisted_pullup":
        return name.includes("assisted") && (name.includes("pullup") || name.includes("pull-up"));
      case "rear_delt_fly":
        return name.includes("rear delt") || name.includes("face pull");
      case "reverse_pec_deck":
        return name.includes("reverse pec") || name.includes("reverse fly");
      case "triceps_isolation":
        return name.includes("triceps") || name.includes("pressdown") || name.includes("skullcrusher");
      case "overhead_press":
        return name.includes("overhead press") || name.includes("ohp");
      case "machine_shoulder_press":
        return name.includes("machine") && name.includes("shoulder press");
      case "lateral_raise":
        return name.includes("lateral raise");
      case "biceps_curl":
        return name.includes("curl") && hasPrimaryMuscle(exercise, "Biceps");
      case "back_squat":
        return name.includes("back squat");
      case "hack_squat":
        return name.includes("hack squat");
      case "leg_press":
        return name.includes("leg press") && !name.includes("calf");
      case "goblet_squat":
        return name.includes("goblet squat");
      case "split_squat":
        return name.includes("split squat") || name.includes("lunge");
      case "leg_extension":
        return name.includes("leg extension");
      case "seated_leg_curl":
        return name.includes("seated") && name.includes("leg curl");
      case "lying_leg_curl":
        return name.includes("lying") && name.includes("leg curl");
      case "nordic_curl":
        return name.includes("nordic");
      case "rdl":
        return name.includes("romanian deadlift") || name.includes("rdl");
      case "sldl":
        return name.includes("stiff-legged") || name.includes("stiff leg") || name === "sldl";
      case "light_hinge":
        return hasPattern(exercise, "hinge") && !name.includes("back extension");
      case "calf_raise":
        return name.includes("calf raise");
    }
  };

  return lane.preferredClasses.some(matchesClass);
}

export function getSlotLaneSetTargetForExercise(
  exercise: Pick<
    Exercise,
    "id" | "name" | "movementPatterns" | "primaryMuscles" | "equipment"
  >,
  lanes: readonly SlotLanePlanLane[] | undefined,
): number | undefined {
  const matchingTargets = (lanes ?? [])
    .filter((lane) => exerciseMatchesSlotLane(exercise, lane))
    .map((lane) => lane.preferredSets);
  if (matchingTargets.length === 0) {
    return undefined;
  }
  return Math.max(...matchingTargets);
}
