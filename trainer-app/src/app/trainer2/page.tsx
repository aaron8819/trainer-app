import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requestContext, hostedEnabled } from "@/lib/api/trainer2/access";
import { developmentEnabled } from "@/lib/api/trainer2/development";
import { DraftAccessError } from "@/lib/api/trainer2/principal";
import { readTrainingHome } from "@/lib/api/trainer2/training-home";
import Link from 'next/link';
import styles from '@/components/trainer2/Trainer2Shell.module.css';

export const dynamic = "force-dynamic";
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!developmentEnabled() && !hostedEnabled()) notFound();
  const request = new Request("http://localhost/trainer2", { headers: await headers() });
  let home;
  try {
    const { db, principal } = await requestContext(request, "read", false);
    home = await readTrainingHome(db, principal);
  } catch (error) {
    if (error instanceof DraftAccessError) redirect("/trainer2/auth");
    throw error;
  }
  const program = (await searchParams).view === 'program';
  if (!program) {
    const active = home.plans.find(plan => plan.lifecycle === 'Active');
    if (active) redirect(`/trainer2/dev/drafts?planId=${encodeURIComponent(active.id)}`);
  }
  return <main className={styles.home}>
    <header className={styles.title}><h1>{program ? 'Program' : 'Training'}</h1>
      <p className={styles.subtitle}>{program ? 'Your saved plans and prescriptions.' : 'Your training, one workout at a time.'}</p></header>
    <section className={styles.card} aria-label={program ? 'Saved programs' : 'Training plans'}>
    {home.plans.length === 0 ? <><h2>{program ? 'No program yet' : 'Ready when you are'}</h2><p>You have no plan yet. Create a plan to build your training program.</p></> :
      <ul>{home.plans.map(plan => <li key={plan.id}>
        <Link className={styles.planLink} href={`/trainer2/dev/drafts?planId=${encodeURIComponent(plan.id)}${program && plan.lifecycle !== 'Draft' ? '&view=program' : ''}`}>Open {plan.lifecycle.toLowerCase()} plan</Link>
      </li>)}</ul>}
    <Link className={styles.primary} href="/trainer2/dev/drafts?view=builder">Create plan</Link>
    </section>
  </main>;
}
