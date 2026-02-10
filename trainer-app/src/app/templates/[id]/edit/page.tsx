import { notFound } from "next/navigation";
import { loadTemplateDetail } from "@/lib/api/templates";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";
import { TemplateForm } from "@/components/templates/TemplateForm";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function EditTemplatePage({ params }: { params: Params }) {
  const { id } = await params;
  const owner = await resolveOwner();
  const template = await loadTemplateDetail(id, owner.id);

  if (!template) {
    notFound();
  }

  const exercises = await loadExerciseLibrary(owner.id);

  const initialExercises = template.exercises.map((te) => ({
    exerciseId: te.exerciseId,
    name: te.name,
    orderIndex: te.orderIndex,
    supersetGroup: te.supersetGroup ?? undefined,
  }));

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Edit Template</h1>
        <TemplateForm
          mode="edit"
          templateId={id}
          initialName={template.name}
          initialTargetMuscles={template.targetMuscles}
          initialIntent={template.intent}
          initialIsStrict={template.isStrict}
          initialExercises={initialExercises}
          exercises={exercises}
        />
      </div>
    </main>
  );
}
