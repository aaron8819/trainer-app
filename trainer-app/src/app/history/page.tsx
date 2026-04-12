import { resolveOwner } from "@/lib/api/workout-context";
import HistoryClient from "@/components/HistoryClient";
import { SurfaceGuideCard } from "@/components/SurfaceGuideCard";
import { loadHistoryPageData } from "@/lib/api/history-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function HistoryPage() {
  const owner = await resolveOwner();
  const data = await loadHistoryPageData(owner.id);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <h1 className="page-title">Workout History</h1>
          <p className="mt-2 text-slate-600">
            Browse and filter past sessions. Use Program for live block state and Analytics for broader trends.
          </p>
        </header>
        <div className="mb-6">
          <SurfaceGuideCard current="history" />
        </div>
        <HistoryClient
          initialWorkouts={data.initialWorkouts}
          initialNextCursor={data.initialNextCursor}
          initialTotalCount={data.initialTotalCount}
          mesocycles={data.mesocycles}
        />
      </div>
    </main>
  );
}
