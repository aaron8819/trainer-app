import { resolveOwner } from "@/lib/api/workout-context";
import { loadTemplatesWithScores } from "@/lib/api/templates";
import { TemplateListShell } from "@/components/templates/TemplateListShell";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await resolveOwner();
  if (!user) {
    return (
      <main className="min-h-screen bg-white page-shell">
        <p className="text-slate-500">Set up your profile first.</p>
      </main>
    );
  }

  const templates = await loadTemplatesWithScores(user.id);

  return (
    <main className="min-h-screen bg-white">
      <div className="page-shell max-w-5xl">
        <TemplateListShell
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            exerciseCount: t.exerciseCount,
            targetMuscles: t.targetMuscles,
            intent: t.intent,
            score: t.score,
            scoreLabel: t.scoreLabel,
          }))}
        />
      </div>
    </main>
  );
}
