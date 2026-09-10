import type { SourceFamily } from "../trainer2-contracts/legacy-source";
// Surviving source relationships, never destination identity or acceptance.
export const legacyLinks: Partial<Record<SourceFamily, Record<string, SourceFamily>>> = {
  HypertrophyPlanDraft: { macroCycleId: "MacroCycle" }, Mesocycle: { macroCycleId: "MacroCycle", currentSeedRevisionId: "MesocycleSeedRevision" },
  MesocycleSeedRevision: { mesocycleId: "Mesocycle", sourceRevisionId: "MesocycleSeedRevision" }, TrainingBlock: { mesocycleId: "Mesocycle" },
  MesocycleWeekClose: { mesocycleId: "Mesocycle", optionalWorkoutId: "Workout" },
  WorkoutTemplateExercise: { templateId: "WorkoutTemplate", exerciseId: "Exercise" },
  Workout: { templateId: "WorkoutTemplate", mesocycleId: "Mesocycle", seedRevisionId: "MesocycleSeedRevision", trainingBlockId: "TrainingBlock" },
  WorkoutExercise: { workoutId: "Workout", exerciseId: "Exercise" }, WorkoutSet: { workoutExerciseId: "WorkoutExercise" }, SetLog: { workoutSetId: "WorkoutSet" },
  ExerciseVariation: { exerciseId: "Exercise" }, ExerciseAlias: { exerciseId: "Exercise" }, ExerciseEquipment: { exerciseId: "Exercise", equipmentId: "Equipment" },
  PreSessionReadinessSnapshot: { activeMesocycleId: "Mesocycle", plannedWorkoutId: "Workout", seedRevisionId: "MesocycleSeedRevision" },
  PostSessionReviewSnapshot: { workoutId: "Workout" }, SessionCheckIn: { workoutId: "Workout" },
  FinisherOffer: { workoutId: "Workout" }, FinisherOfferItem: { offerId: "FinisherOffer" },
  FinisherExecution: { workoutId: "Workout", offerId: "FinisherOffer" }, FinisherExecutionStep: { executionId: "FinisherExecution" },
  FinisherExecutionCommand: { executionId: "FinisherExecution", workoutId: "Workout" }, DeviceDraft: { workoutId: "Workout", workoutSetId: "WorkoutSet" },
};
