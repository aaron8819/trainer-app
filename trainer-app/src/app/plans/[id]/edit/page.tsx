import { notFound } from "next/navigation";
import { HypertrophyPlanEditor } from "@/components/plans/HypertrophyPlanEditor";
import { loadHypertrophyPlanEditorData } from "@/lib/api/hypertrophy-plan-drafts";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { isCustomHypertrophyPlanRolloutEnabled } from "@/lib/operations/custom-hypertrophy-plan-rollout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EditHypertrophyPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isCustomHypertrophyPlanRolloutEnabled()) notFound();
  const [{ id }, owner] = await Promise.all([params, findOwnerReadOnly()]);
  if (!owner) notFound();
  const data = await loadHypertrophyPlanEditorData(owner.id, id);
  if (!data) notFound();
  return <HypertrophyPlanEditor initialData={data} />;
}
