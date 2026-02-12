import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import { ExerciseLibraryShell } from "@/components/library/ExerciseLibraryShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LibraryPage() {
  const user = await resolveOwner();
  const exercises = await loadExerciseLibrary(user?.id);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-3xl">
        <h1 className="page-title">Exercise Library</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Browse {exercises.length} exercises. Tap to see details.
        </p>
        <div className="mt-4 sm:mt-5">
          <ExerciseLibraryShell exercises={exercises} />
        </div>
      </div>
    </main>
  );
}
