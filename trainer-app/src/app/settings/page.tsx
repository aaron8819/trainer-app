import ProfileForm from "../onboarding/ProfileForm";
import { prisma } from "@/lib/db/prisma";
import UserPreferencesForm from "@/components/UserPreferencesForm";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import { PRIMARY_GOAL_OPTIONS, SECONDARY_GOAL_OPTIONS } from "@/lib/profile-goal-options";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await resolveOwner();
  const [profile, goals, constraints, injury, preferences, exercises] = user
    ? await Promise.all([
        prisma.profile.findUnique({ where: { userId: user.id } }),
        prisma.goals.findUnique({ where: { userId: user.id } }),
        prisma.constraints.findUnique({ where: { userId: user.id } }),
        prisma.injury.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
        prisma.userPreference.findUnique({ where: { userId: user.id } }),
        loadExerciseLibrary(user.id),
      ])
    : [null, null, null, null, null, []];

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
        splitType: constraints?.splitType ?? "PPL",
        weeklySchedule: constraints?.weeklySchedule ?? [],
        injuryBodyPart: injury?.bodyPart ?? undefined,
        injurySeverity: injury?.severity ?? undefined,
        injuryDescription: injury?.description ?? undefined,
        injuryActive: injury ? injury.isActive : false,
      }
    : undefined;

  const preferenceValues = user
    ? {
        userId: user.id,
        favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
        avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
      }
    : undefined;

  const primaryGoalOptions = PRIMARY_GOAL_OPTIONS;
  const secondaryGoalOptions = SECONDARY_GOAL_OPTIONS;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Manage goals, schedule, equipment, and preferences.
        </p>

        <ProfileForm
          initialValues={initialValues}
          primaryGoalOptions={primaryGoalOptions}
          secondaryGoalOptions={secondaryGoalOptions}
        />
        <UserPreferencesForm initialValues={preferenceValues} exercises={exercises} />
      </div>
    </main>
  );
}
