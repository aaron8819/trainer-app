import Link from "next/link";
import { notFound } from "next/navigation";
import { FinisherLibraryClient } from "@/components/finishers/FinisherLibraryClient";
import { loadFinisherLibrary } from "@/lib/api/finisher-library-service";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { isFinisherRolloutEnabled } from "@/lib/operations/finisher-rollout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinisherSettingsPage() {
  if (!isFinisherRolloutEnabled()) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-3xl">
          <Link href="/settings" className="text-sm font-medium text-sky-700">← Settings</Link>
          <h1 className="page-title mt-3">Finishers</h1>
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Finisher management is not enabled in this environment.
          </p>
        </div>
      </main>
    );
  }
  const owner = await findOwnerReadOnly();
  if (!owner) notFound();
  const library = await loadFinisherLibrary(owner.id);
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl">
        <Link href="/settings" className="text-sm font-medium text-sky-700">← Settings</Link>
        <h1 className="page-title mt-3">Finishers</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Active routines appear automatically in every new post-workout offer, in this order.
        </p>
        <FinisherLibraryClient initial={library} />
      </div>
    </main>
  );
}
