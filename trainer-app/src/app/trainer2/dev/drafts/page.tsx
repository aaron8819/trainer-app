import { notFound } from "next/navigation";
import { developmentContext, developmentEnabled } from "@/lib/api/trainer2/development";
import { DraftWorkbench } from "@/components/trainer2/DraftWorkbench";

export const dynamic = "force-dynamic";
export default async function DraftPage() {
  if (!developmentEnabled()) notFound();
  const { db, principal } = await developmentContext();
  const state = await db.trainer2AccountTrainingState.findUnique({ where: { accountId: principal.accountId } });
  return <DraftWorkbench accountId={principal.accountId} ownershipEpoch={state?.ownershipEpoch ?? 0} />;
}
