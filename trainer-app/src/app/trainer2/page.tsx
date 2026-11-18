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
    {(['current', 'completed'] as const).map(group => {
      const plans = home.plans.filter(plan => (plan.lifecycle === 'Completed') === (group === 'completed'));
      return <section key={group} className={styles.card} aria-label={group === 'completed' ? 'Completed programs' : 'Current programs'}>
        <h2>{group === 'completed' ? 'Completed programs' : home.plans.length ? 'Current programs' : program ? 'No program yet' : 'Ready when you are'}</h2>
        {group === 'completed' && <p>Review previous programs, saved prescriptions and workout results. Opening history does not change your current program.</p>}
        {plans.length ? <ul className={styles.planList}>{plans.map(plan => <li key={plan.id}>
          <h3>{plan.name ?? 'Saved program'}</h3>
          <p>{plan.lifecycle}{plan.savedAt ? ` · Saved ${plan.savedAt.slice(0, 10)}` : ''}</p>
          <Link className={styles.planLink} href={`/trainer2/dev/drafts?planId=${encodeURIComponent(plan.id)}${plan.lifecycle !== 'Draft' ? '&view=program' : ''}`}>Open {plan.lifecycle.toLowerCase()} plan</Link>
        </li>)}</ul> : <p>{group === 'completed' ? 'No completed programs yet.' : home.plans.length ? 'No current program.' : 'You have no plan yet. Create a plan to build your training program.'}</p>}
        {group === 'current' && <Link className={styles.primary} href="/trainer2/dev/drafts?view=builder">Create plan</Link>}
      </section>;
    })}
  </main>;
}
