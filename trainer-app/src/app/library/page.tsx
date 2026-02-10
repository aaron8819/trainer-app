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
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <h1 className="text-2xl font-semibold md:text-3xl">Exercise Library</h1>
        <p className="mt-1 text-sm text-slate-500">
          Browse {exercises.length} exercises. Tap to see details.
        </p>
        <div className="mt-5">
          <ExerciseLibraryShell exercises={exercises} />
        </div>
      </div>
    </main>
  );
}
