import { generateWorkoutFromTemplate, type TemplateExerciseInput } from "@/lib/engine";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { SraWarning } from "@/lib/engine/sra";
import { loadTemplateDetail } from "./templates";
import {
  applyLoads,
  loadWorkoutContext,
  mapCheckIn,
  mapExercises,
  mapGoals,
  mapHistory,
  mapPreferences,
  mapProfile,
} from "./workout-context";

type GenerateSessionResult =
  | { workout: WorkoutPlan; templateId: string; sraWarnings: SraWarning[] }
  | { error: string };

export async function generateSessionFromTemplate(
  userId: string,
  templateId: string
): Promise<GenerateSessionResult> {
  const [template, context] = await Promise.all([
    loadTemplateDetail(templateId, userId),
    loadWorkoutContext(userId),
  ]);

  if (!template) {
    return { error: "Template not found" };
  }

  if (template.exercises.length === 0) {
    return { error: "Template has no exercises" };
  }

  const { profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, checkIns } =
    context;

  if (!goals || !constraints || !profile) {
    return { error: "Profile, goals, or constraints missing" };
  }

  const mappedProfile = mapProfile(userId, profile, injuries);
  const mappedGoals = mapGoals(goals.primaryGoal, goals.secondaryGoal);
  const exerciseLibrary = mapExercises(exercises);
  const history = mapHistory(workouts);
  const mappedPreferences = mapPreferences(preferences);
  const mappedCheckIn = mapCheckIn(checkIns);

  // Build exercise lookup from mapped library
  const exerciseById = new Map(exerciseLibrary.map((e) => [e.id, e]));

  // Map template exercises to engine inputs
  const templateExercises: TemplateExerciseInput[] = [];
  for (const te of template.exercises) {
    const exercise = exerciseById.get(te.exerciseId);
    if (!exercise) continue;
    templateExercises.push({
      exercise,
      orderIndex: te.orderIndex,
    });
  }

  const { workout, sraWarnings } = generateWorkoutFromTemplate(templateExercises, {
    profile: mappedProfile,
    goals: mappedGoals,
    history,
    exerciseLibrary,
    preferences: mappedPreferences,
    checkIn: mappedCheckIn,
  });

  // Apply loads (no sessionMinutes — don't trim template workouts)
  const withLoads = applyLoads(
    workout,
    baselines,
    exercises,
    history,
    mappedProfile,
    mappedGoals.primary,
    undefined,
    undefined
  );

  return { workout: withLoads, templateId, sraWarnings };
}
