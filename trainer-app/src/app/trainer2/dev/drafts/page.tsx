import { notFound } from "next/navigation";
import { developmentContext, developmentEnabled } from "@/lib/api/trainer2/development";
import { DraftWorkbench } from "@/components/trainer2/DraftWorkbench";

export const dynamic = "force-dynamic";
export default async function DraftPage({ searchParams }: { searchParams: Promise<{ planId?: string }> }) {
  if (!developmentEnabled()) notFound();
  const { db, principal } = await developmentContext();
  const state = await db.trainer2AccountTrainingState.findUnique({ where: { accountId: principal.accountId } });
  const { planId } = await searchParams;
  return <DraftWorkbench key={planId ?? "scratch"} initialPlanId={typeof planId === "string" ? planId : ""} accountId={principal.accountId} ownershipEpoch={state?.ownershipEpoch ?? 0} />;
}
