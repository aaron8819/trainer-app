import { prisma } from "@/lib/db/prisma";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import OnboardingFlow from "./OnboardingFlow";

export default async function OnboardingPage() {
  const user = await resolveOwner();
  const [goals, constraints, baselines, exerciseLibrary] = await Promise.all([
    prisma.goals.findUnique({ where: { userId: user.id } }),
    prisma.constraints.findUnique({ where: { userId: user.id } }),
    prisma.baseline.findMany({ where: { userId: user.id } }),
    loadExerciseLibrary(user.id),
  ]);

  const initialValues = {
    primaryGoal: goals?.primaryGoal ?? "HYPERTROPHY",
    splitType: constraints?.splitType ?? "PPL",
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Profile Setup</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Capture goals, constraints, and equipment to power personalized workouts.
        </p>
        <OnboardingFlow
          initialValues={initialValues}
          exercisePool={exerciseLibrary.map((exercise) => ({
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
      </div>
    </main>
  );
}
