import ProfileForm from "../onboarding/ProfileForm";
import { prisma } from "@/lib/db/prisma";
import UserPreferencesForm from "@/components/UserPreferencesForm";
import BaselineSetupCard from "@/components/BaselineSetupCard";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const user = await resolveOwner();
  const [profile, goals, constraints, injury, preferences, exercises, activeProgram, baselines] = user
    ? await Promise.all([
        prisma.profile.findUnique({ where: { userId: user.id } }),
        prisma.goals.findUnique({ where: { userId: user.id } }),
        prisma.constraints.findUnique({ where: { userId: user.id } }),
        prisma.injury.findFirst({ where: { userId: user.id, isActive: true } }),
        prisma.userPreference.findUnique({ where: { userId: user.id } }),
        loadExerciseLibrary(user.id),
        prisma.program.findFirst({
          where: { userId: user.id, isActive: true },
          orderBy: { createdAt: "desc" },
          select: { weeklySchedule: true },
        }),
        prisma.baseline.findMany({ where: { userId: user.id } }),
      ])
    : [null, null, null, null, null, [], null, []];

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
        splitType: constraints?.splitType ?? "PPL",
        weeklySchedule: activeProgram?.weeklySchedule ?? [],
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
        optionalConditioning: preferences?.optionalConditioning ?? true,
      }
    : undefined;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Manage goals, schedule, equipment, and preferences.
        </p>

        <ProfileForm initialValues={initialValues} />
        <BaselineSetupCard
          title="Set Your Starting Weights"
          description="Update your baseline loads to improve first-pass load assignment when history is sparse."
          splitType={initialValues?.splitType}
          primaryGoal={initialValues?.primaryGoal}
          exercisePool={exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            isMainLiftEligible: exercise.isMainLiftEligible,
            equipment: exercise.equipment,
            primaryMuscles: exercise.primaryMuscles,
          }))}
          existingBaselines={baselines.map((baseline) => ({
            exerciseId: baseline.exerciseId,
            context: baseline.context,
            workingWeightMin: baseline.workingWeightMin,
            workingWeightMax: baseline.workingWeightMax,
            topSetWeight: baseline.topSetWeight,
            topSetReps: baseline.topSetReps,
          }))}
        />
        <UserPreferencesForm initialValues={preferenceValues} exercises={exercises} />
      </div>
    </main>
  );
}
