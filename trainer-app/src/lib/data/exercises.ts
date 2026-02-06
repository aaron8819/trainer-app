import type { Exercise } from "../engine/types";

export const seedExercises: Exercise[] = [
  {
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    movementPattern: "squat",
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "rack"],
  },
  {
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "bench", "rack"],
  },
];
