import type { MuscleGroup } from "./types";
import type { MovementPatternV2, StimulusBias } from "@/lib/engine/types";

export const MUSCLE_GROUP_HIERARCHY: Record<MuscleGroup, string[]> = {
  chest: ["Chest"],
  back: ["Lats", "Upper Back", "Lower Back"],
  shoulders: ["Front Delts", "Side Delts", "Rear Delts"],
  arms: ["Biceps", "Triceps", "Forearms"],
  legs: ["Quads", "Hamstrings", "Glutes", "Adductors", "Abductors", "Calves"],
  core: ["Core", "Abs"],
};

export const MUSCLE_TO_GROUP: Record<string, MuscleGroup> = Object.fromEntries(
  Object.entries(MUSCLE_GROUP_HIERARCHY).flatMap(([group, muscles]) =>
    muscles.map((muscle) => [muscle, group as MuscleGroup])
  )
) as Record<string, MuscleGroup>;

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  legs: "Legs",
  core: "Core",
};

export const MOVEMENT_PATTERN_LABELS: Record<MovementPatternV2, string> = {
  horizontal_push: "Horizontal Push",
  vertical_push: "Vertical Push",
  horizontal_pull: "Horizontal Pull",
  vertical_pull: "Vertical Pull",
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  carry: "Carry",
  rotation: "Rotation",
  anti_rotation: "Anti-Rotation",
  flexion: "Flexion",
  extension: "Extension",
  abduction: "Abduction",
  adduction: "Adduction",
  isolation: "Isolation",
};

export const STIMULUS_BIAS_LABELS: Record<StimulusBias, string> = {
  mechanical: "Mechanical Tension",
  metabolic: "Metabolic Stress",
  stretch: "Stretch-Mediated",
  stability: "Stability",
};

export const SINGLE_MUSCLE_GROUPS: MuscleGroup[] = ["chest", "core"];
