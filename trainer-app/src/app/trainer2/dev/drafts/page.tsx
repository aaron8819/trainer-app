import { notFound, redirect } from "next/navigation";
import { developmentEnabled } from "@/lib/api/trainer2/development";
import { hostedTestEnabled, hostedEnabled } from "@/lib/api/trainer2/access";
import { requestContext } from "@/lib/api/trainer2/access";
import { headers } from "next/headers";
import { DraftWorkbench } from "@/components/trainer2/DraftWorkbench";

export const dynamic = "force-dynamic";
export default async function DraftPage({ searchParams }: { searchParams: Promise<{ planId?: string; view?: string }> }) {
  if (!developmentEnabled() && !hostedEnabled()) notFound();
  const { db, principal } = await requestContext(new Request("http://localhost/trainer2/dev/drafts", { headers: await headers() }), "read");
  const state = await db.trainer2AccountTrainingState.findUnique({ where: { accountId: principal.accountId } });
  const { planId, view } = await searchParams;
  if (!planId && view !== "builder") redirect("/trainer2");
  return <DraftWorkbench hostedTrial={hostedTestEnabled()} production={hostedEnabled() && !hostedTestEnabled()} view={view === "program" ? "program" : undefined} key={planId ?? "scratch"} initialPlanId={typeof planId === "string" ? planId : ""} accountId={principal.accountId} ownershipEpoch={state?.ownershipEpoch ?? 0} />;
}
