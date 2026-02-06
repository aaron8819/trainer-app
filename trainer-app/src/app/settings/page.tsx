import ProfileForm from "../onboarding/ProfileForm";
import { prisma } from "@/lib/db/prisma";
import UserPreferencesForm from "@/components/UserPreferencesForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await prisma.user.findFirst({
    orderBy: { createdAt: "desc" },
    where: {
      profile: {
        isNot: null,
      },
    },
  });
  const [profile, goals, constraints, injury, preferences] = user
    ? await Promise.all([
        prisma.profile.findUnique({ where: { userId: user.id } }),
        prisma.goals.findUnique({ where: { userId: user.id } }),
        prisma.constraints.findUnique({ where: { userId: user.id } }),
        prisma.injury.findFirst({ where: { userId: user.id, isActive: true } }),
        prisma.userPreference.findUnique({ where: { userId: user.id } }),
      ])
    : [null, null, null, null, null];

  const initialValues = user
    ? {
        userId: user.id,
        email: user.email,
        age: profile?.age ?? undefined,
        sex: profile?.sex ?? undefined,
        heightIn: profile?.heightCm ? Math.round(profile.heightCm / 2.54) : undefined,
        weightLb: profile?.weightKg ? Number((profile.weightKg / 0.45359237).toFixed(1)) : undefined,
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
        injuryActive: injury?.isActive ?? true,
      }
    : undefined;

  const preferenceValues = user
    ? {
        userId: user.id,
        favoriteExercisesText: (preferences?.favoriteExercises ?? []).join(", "),
        avoidExercisesText: (preferences?.avoidExercises ?? []).join(", "),
        rpe5to8:
          preferences?.rpeTargets && Array.isArray(preferences.rpeTargets)
            ? Number(preferences.rpeTargets.find((entry: { min: number; max: number }) => entry.min === 5)?.targetRpe ?? 8.5)
            : 8.5,
        rpe8to12:
          preferences?.rpeTargets && Array.isArray(preferences.rpeTargets)
            ? Number(preferences.rpeTargets.find((entry: { min: number; max: number }) => entry.min === 8)?.targetRpe ?? 7.75)
            : 7.75,
        rpe12to20:
          preferences?.rpeTargets && Array.isArray(preferences.rpeTargets)
            ? Number(preferences.rpeTargets.find((entry: { min: number; max: number }) => entry.min === 12)?.targetRpe ?? 7.5)
            : 7.5,
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
        <UserPreferencesForm initialValues={preferenceValues} />
      </div>
    </main>
  );
}
