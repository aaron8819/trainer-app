import ProfileForm from "../onboarding/ProfileForm";
import { prisma } from "@/lib/db/prisma";
import UserPreferencesForm from "@/components/UserPreferencesForm";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await resolveOwner();
  const [profile, goals, constraints, injury, preferences, exercises] = user
    ? await Promise.all([
        prisma.profile.findUnique({ where: { userId: user.id } }),
        prisma.goals.findUnique({ where: { userId: user.id } }),
        prisma.constraints.findUnique({ where: { userId: user.id } }),
        prisma.injury.findFirst({ where: { userId: user.id, isActive: true } }),
        prisma.userPreference.findUnique({ where: { userId: user.id } }),
        loadExerciseLibrary(user.id),
      ])
    : [null, null, null, null, null, []];

  type RpeTarget = { min: number; max: number; targetRpe?: number };
  const rpeTargets = Array.isArray(preferences?.rpeTargets) ? preferences.rpeTargets : [];
  const getRpeTarget = (min: number, fallback: number) => {
    const match = rpeTargets.find((entry): entry is RpeTarget => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const candidate = entry as { min?: unknown; max?: unknown };
      return typeof candidate.min === "number" && typeof candidate.max === "number" && candidate.min === min;
    });
    const value = match?.targetRpe;
    return typeof value === "number" ? value : fallback;
  };

  const initialValues = user
    ? {
        userId: user.id,
        email: user.email,
        age: profile?.age ?? undefined,
        sex: profile?.sex ?? undefined,
        heightIn: profile?.heightIn ?? undefined,
        weightLb: profile?.weightLb ?? undefined,
        trainingAge: profile?.trainingAge ?? "INTERMEDIATE",
        primaryGoal: goals?.primaryGoal ?? "HYPERTROPHY",
        secondaryGoal: goals?.secondaryGoal ?? "CONDITIONING",
        daysPerWeek: constraints?.daysPerWeek ?? 4,
        sessionMinutes: constraints?.sessionMinutes ?? 55,
        splitType: constraints?.splitType ?? "UPPER_LOWER",
        equipmentNotes: constraints?.equipmentNotes ?? undefined,
        proteinTarget: goals?.proteinTarget ?? undefined,
        injuryBodyPart: injury?.bodyPart ?? undefined,
        injurySeverity: injury?.severity ?? undefined,
        injuryDescription: injury?.description ?? undefined,
        injuryActive: injury ? injury.isActive : false,
      }
    : undefined;

  const preferenceValues = user
    ? {
        userId: user.id,
        favoriteExercises: preferences?.favoriteExercises ?? [],
        avoidExercises: preferences?.avoidExercises ?? [],
        rpe5to8:
          getRpeTarget(5, 8.5),
        rpe8to12:
          getRpeTarget(8, 7.75),
        rpe12to20:
          getRpeTarget(12, 7.5),
        progressionStyle: preferences?.progressionStyle ?? "double_progression",
        optionalConditioning: preferences?.optionalConditioning ?? true,
        benchFrequency: preferences?.benchFrequency ?? 2,
        squatFrequency: preferences?.squatFrequency ?? 1,
        deadliftFrequency: preferences?.deadliftFrequency ?? 1,
      }
    : undefined;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-2 text-slate-600">Manage goals, split, equipment, and preferences.</p>

        <ProfileForm initialValues={initialValues} />
        <UserPreferencesForm initialValues={preferenceValues} exercises={exercises} />
      </div>
    </main>
  );
}
