import type { WorkoutExplanation } from "@/lib/engine/explainability";

export type WorkoutExplanationResponse = {
  confidence: WorkoutExplanation["confidence"];
  sessionContext: WorkoutExplanation["sessionContext"];
  coachMessages: WorkoutExplanation["coachMessages"];
  exerciseRationales: Record<
    string,
    WorkoutExplanation["exerciseRationales"] extends Map<string, infer T> ? T : never
  >;
  prescriptionRationales: Record<
    string,
    WorkoutExplanation["prescriptionRationales"] extends Map<string, infer T> ? T : never
  >;
  progressionReceipts: Record<
    string,
    WorkoutExplanation["progressionReceipts"] extends Map<string, infer T> ? T : never
  >;
  nextExposureDecisions: Record<
    string,
    WorkoutExplanation["nextExposureDecisions"] extends Map<string, infer T> ? T : never
  >;
  filteredExercises?: WorkoutExplanation["filteredExercises"];
  volumeCompliance?: WorkoutExplanation["volumeCompliance"];
};

export function hydrateWorkoutExplanation(
  data: WorkoutExplanationResponse
): WorkoutExplanation {
  return {
    confidence: data.confidence,
    sessionContext: data.sessionContext,
    coachMessages: data.coachMessages,
    exerciseRationales: new Map(Object.entries(data.exerciseRationales ?? {})),
    prescriptionRationales: new Map(Object.entries(data.prescriptionRationales ?? {})),
    progressionReceipts: new Map(Object.entries(data.progressionReceipts ?? {})),
    nextExposureDecisions: new Map(Object.entries(data.nextExposureDecisions ?? {})),
    filteredExercises: data.filteredExercises,
    volumeCompliance: data.volumeCompliance ?? [],
  };
}
