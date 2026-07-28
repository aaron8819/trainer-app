import { notFound } from "next/navigation";
import { PlanReviewView } from "@/components/plans/PlanReviewView";
import { loadConfiguredPlanReview } from "@/lib/api/plan-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = Promise<{ id: string }>;

export default async function PlanReviewPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const plan = await loadConfiguredPlanReview(id);
  if (!plan) notFound();

  return <PlanReviewView plan={plan} />;
}
