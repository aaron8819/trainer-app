import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import { TemplateForm } from "@/components/templates/TemplateForm";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const user = await resolveOwner();
  const exercises = await loadExerciseLibrary(user?.id);

  return (
    <main className="min-h-screen bg-white">
      <div className="page-shell max-w-2xl">
        <h1 className="page-title mb-2 text-slate-900">Create Template</h1>
        <p className="mb-5 text-sm text-slate-600 sm:mb-6">Build a reusable structure that stays clean on mobile.</p>
        <TemplateForm mode="create" exercises={exercises} />
      </div>
    </main>
  );
}
