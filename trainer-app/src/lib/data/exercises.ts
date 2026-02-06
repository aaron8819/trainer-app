import type { Exercise } from "../engine/types";

export const seedExercises: Exercise[] = [
  {
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    movementPattern: "squat",
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "rack"],
  },
  {
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    movementPattern: "push",
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "bench", "rack"],
  },
];
