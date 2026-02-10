import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import { TemplateForm } from "@/components/templates/TemplateForm";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const user = await resolveOwner();
  const exercises = await loadExerciseLibrary(user?.id);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Create Template</h1>
        <TemplateForm mode="create" exercises={exercises} />
      </div>
    </main>
  );
}
