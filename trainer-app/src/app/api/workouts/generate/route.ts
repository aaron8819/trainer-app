import { NextResponse } from "next/server";
import { generateWorkout, getPeriodizationModifiers } from "@/lib/engine";
import { generateWorkoutSchema } from "@/lib/validation";
import {
  applyLoads,
  deriveWeekInBlock,
  loadWorkoutContext,
  mapConstraints,
  mapExercises,
  mapGoals,
  mapHistory,
  mapCheckIn,
  mapPreferences,
  mapProfile,
  resolveOwner,
} from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = generateWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, checkIns } =
    await loadWorkoutContext(user.id);

  if (!goals || !constraints || !profile) {
    return NextResponse.json({ error: "Profile, goals, or constraints missing" }, { status: 400 });
  }

  const mappedProfile = mapProfile(user.id, profile, injuries);
  const mappedGoals = mapGoals(goals.primaryGoal, goals.secondaryGoal);
  const mappedConstraints = mapConstraints(constraints);
  const exerciseLibrary = mapExercises(exercises);
  const history = mapHistory(workouts);
  const mappedPreferences = mapPreferences(preferences);
  const mappedCheckIn = mapCheckIn(checkIns);
  const activeProgramBlock = workouts.find((entry) => entry.programBlockId)?.programBlock ?? null;
  const weekInBlock = deriveWeekInBlock(new Date(), activeProgramBlock, workouts);
  const periodization = getPeriodizationModifiers(weekInBlock, mappedGoals.primary);

  let workout = generateWorkout(
    mappedProfile,
    mappedGoals,
    mappedConstraints,
    history,
    exerciseLibrary,
    undefined,
    {
      forcedSplit: parsed.data.forcedSplit?.toLowerCase() as
        | "push"
        | "pull"
        | "legs"
        | "upper"
        | "lower"
        | "full_body"
        | undefined,
      advancesSplit: parsed.data.advancesSplit,
      preferences: mappedPreferences,
      checkIn: mappedCheckIn,
      periodization,
    }
  );

  workout = applyLoads(
    workout,
    baselines,
    exercises,
    history,
    mappedProfile,
    mappedGoals.primary,
    mappedConstraints.sessionMinutes,
    periodization
  );

  return NextResponse.json({
    workout,
    selection: {
      selectionMode: parsed.data.selectionMode ?? "AUTO",
      forcedSplit: parsed.data.forcedSplit ?? null,
      advancesSplit: parsed.data.advancesSplit ?? true,
    },
  });
}
