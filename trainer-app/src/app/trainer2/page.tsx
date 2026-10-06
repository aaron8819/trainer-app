import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requestContext, hostedTestEnabled } from "@/lib/api/trainer2/access";
import { developmentEnabled } from "@/lib/api/trainer2/development";
import { DraftAccessError } from "@/lib/api/trainer2/principal";
import { readTrainingHome } from "@/lib/api/trainer2/training-home";

export const dynamic = "force-dynamic";
export default async function TrainingPage() {
  if (!developmentEnabled() && !hostedTestEnabled()) notFound();
  const request = new Request("http://localhost/trainer2", { headers: await headers() });
  let home;
  try {
    const { db, principal } = await requestContext(request, "read", false);
    home = await readTrainingHome(db, principal);
  } catch (error) {
    if (error instanceof DraftAccessError) redirect("/trainer2/auth");
    throw error;
  }
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-3xl font-semibold">Training</h1>
    {home.plans.length === 0 ? <p>You have no plan yet.</p> :
      <ul className="space-y-3">{home.plans.map(plan => <li key={plan.id}>
        <a className="inline-flex min-h-11 items-center underline" href={`/trainer2/dev/drafts?planId=${encodeURIComponent(plan.id)}`}>Open {plan.lifecycle.toLowerCase()} plan</a>
      </li>)}</ul>}
    <a className="inline-flex min-h-11 items-center rounded-lg bg-teal-800 px-5 py-3 text-white" href="/trainer2/dev/drafts?view=builder">Create plan</a>
    <a className="block underline" href="/trainer2/auth">Device access</a>
  </main>;
}
