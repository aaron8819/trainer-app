import { PlanManagementClient } from "@/components/plans/PlanManagementClient";
import { loadConfiguredPlanManagementData } from "@/lib/api/plan-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlansPage() {
  const data = await loadConfiguredPlanManagementData();

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl pb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Plan management
        </p>
        <h1 className="page-title mt-2">Training plans</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Create and review hypertrophy plans, then explicitly choose which
          READY plan drives your training.
        </p>
        <PlanManagementClient initialData={data} />
      </div>
    </main>
  );
}
