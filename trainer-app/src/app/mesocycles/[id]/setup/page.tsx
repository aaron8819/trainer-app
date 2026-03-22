import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadMesocycleSetupFromPrisma } from "@/lib/api/mesocycle-setup";
import { MesocycleSetupEditor } from "@/components/MesocycleSetupEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export default async function MesocycleSetupPage({ params }: { params: Params }) {
  const { id } = await params;
  const owner = await resolveOwner();
  const setup = await loadMesocycleSetupFromPrisma({ userId: owner.id, mesocycleId: id });

  if (!setup) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl pb-10">
        <header className="mb-8 md:mb-10">
          <Link
            href={`/mesocycles/${setup.mesocycleId}/review`}
            className="text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            Back to review
          </Link>
          <p className="mt-4 text-sm uppercase tracking-wide text-slate-500">Next-Cycle Setup</p>
          <h1 className="page-title mt-2">Meso {setup.mesoNumber} handoff setup</h1>
          <p className="mt-2 text-sm text-slate-600">
            This screen edits the pending setup draft that starts from the frozen system
            recommendation. The preview is the server projection of your current draft against that
            same handoff baseline.
          </p>
        </header>

        <MesocycleSetupEditor
          mesocycleId={setup.mesocycleId}
          recommendation={setup.recommendation}
          frozenRecommendationDraft={setup.frozenRecommendationDraft}
          initialDraft={setup.editableDraft}
          initialPreview={setup.preview}
        />
      </div>
    </main>
  );
}
