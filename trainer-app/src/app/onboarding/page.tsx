import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import OnboardingFlow from "./OnboardingFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await resolveOwner();
  const [goals, constraints] = await Promise.all([
    prisma.goals.findUnique({ where: { userId: user.id } }),
    prisma.constraints.findUnique({ where: { userId: user.id } }),
  ]);

  const initialValues = {
    primaryGoal: goals?.primaryGoal ?? "HYPERTROPHY",
    daysPerWeek: constraints?.daysPerWeek ?? 4,
    splitType: constraints?.splitType ?? "PPL",
    weeklySchedule: constraints?.weeklySchedule ?? [],
  };

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Profile Setup</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Capture goals and constraints to power personalized workouts.
        </p>
        <OnboardingFlow
          initialValues={initialValues}
        />
      </div>
    </main>
  );
}
