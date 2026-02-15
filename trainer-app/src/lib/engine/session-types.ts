/**
 * Shared session types used across template and intent-based generation
 */

import type { VolumePlanByMuscle } from "./volume";

export type SessionIntent =
  | "push"
  | "pull"
  | "legs"
  | "upper"
  | "lower"
  | "full_body"
  | "body_part";

export type ColdStartStage = 0 | 1 | 2;

export type SelectionStep = "pin" | "anchor" | "main_pick" | "accessory_pick";

/**
 * Session output format for template and intent-based generation
 *
 * Selection-v2 uses SelectionResult internally, which is mapped to this format
 * for consistency across the session API layer.
 */
export type SelectionOutput = {
  selectedExerciseIds: string[];
  mainLiftIds: string[];
  accessoryIds: string[];
  perExerciseSetTargets: Record<string, number>;
  volumePlanByMuscle: VolumePlanByMuscle;
  rationale: Record<
    string,
    {
      score: number;
      components: Record<string, number>;
      hardFilterPass: boolean;
      selectedStep: SelectionStep;
    }
  >;
};
