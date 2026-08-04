import Link from "next/link";
import { notFound } from "next/navigation";
import { FinisherRoutineEditor } from "@/components/finishers/FinisherRoutineEditor";
import { loadFinisherLibraryItem } from "@/lib/api/finisher-library-service";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { isFinisherRolloutEnabled } from "@/lib/operations/finisher-rollout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EditFinisherPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFinisherRolloutEnabled()) notFound();
  const owner = await findOwnerReadOnly();
  if (!owner) notFound();
  const { id } = await params;
  const result = await loadFinisherLibraryItem(owner.id, id);
  if (!result || !result.item.canEdit) notFound();
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="page-shell max-w-6xl">
        <Link href="/settings/finishers" className="text-sm font-medium text-sky-700">← Finishers</Link>
        <h1 className="page-title mt-3">Edit {result.item.routine.name}</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Saving creates immutable version {result.item.routine.version + 1}. Existing offers and history keep their current version.
        </p>
        <div className="mt-6">
          <FinisherRoutineEditor mode="edit" item={result.item} activeLimitations={result.activeLimitations} />
        </div>
      </div>
    </main>
  );
}
