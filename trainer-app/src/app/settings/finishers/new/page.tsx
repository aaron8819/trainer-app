import Link from "next/link";
import { notFound } from "next/navigation";
import { FinisherRoutineEditor } from "@/components/finishers/FinisherRoutineEditor";
import { loadFinisherLibrary } from "@/lib/api/finisher-library-service";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { isFinisherRolloutEnabled } from "@/lib/operations/finisher-rollout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewFinisherPage() {
  if (!isFinisherRolloutEnabled()) notFound();
  const owner = await findOwnerReadOnly();
  if (!owner) notFound();
  const library = await loadFinisherLibrary(owner.id);
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="page-shell max-w-6xl">
        <Link href="/settings/finishers" className="text-sm font-medium text-sky-700">← Finishers</Link>
        <h1 className="page-title mt-3">Create Finisher</h1>
        <p className="mt-1.5 text-sm text-slate-600">Build an ordered timed routine and review the live preview before saving.</p>
        <div className="mt-6">
          <FinisherRoutineEditor mode="create" activeLimitations={library.activeLimitations} />
        </div>
      </div>
    </main>
  );
}
