import { notFound } from 'next/navigation';
import { developmentEnabled } from '@/lib/api/trainer2/development';
import { requestContext } from '@/lib/api/trainer2/access';
import { headers } from 'next/headers';
import { Workout } from '@/components/trainer2/Workout';
import { id } from '@/lib/trainer2-contracts/draft';
export const dynamic = 'force-dynamic';
export default async function ExecutionPage({ params }: { params: Promise<{ executionId: string }> }) {
  if (!developmentEnabled()) notFound();
  const parsed = id.safeParse((await params).executionId);
  if (!parsed.success) notFound();
  const { principal } = await requestContext(new Request('http://localhost/trainer2/dev/executions', { headers: await headers() }), 'read');
  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 bg-white p-4 pb-24 text-slate-900 sm:p-8"><p className="text-sm text-amber-900">Disposable demo · workouts are deleted when the demo stops.</p><Workout key={`${principal.accountId}:${parsed.data}`} accountId={principal.accountId} ownershipEpoch={0} executionId={parsed.data} /></main>;
}
