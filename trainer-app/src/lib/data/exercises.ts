import type { Exercise } from "../engine/types";

export const seedExercises: Exercise[] = [
  {
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "high",
    equipment: ["barbell", "rack"],
  },
  {
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    equipment: ["barbell", "bench", "rack"],
  },
];
