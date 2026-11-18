import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from '../src/lib/operations/test-environment-preflight';
async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid || !validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid) throw new Error('Expected --confirm-disposable with no inherited database target');
  const { runHomeProgramFixture } = await import('./trainer2/home-program-fixture');
  const { loggerJourney } = await import('./trainer2/logger-journey');
  const { verifyAmendmentUpgrade } = await import('./trainer2/plan-amendment-upgrade');
  const { verifyPlanAmendments } = await import('./trainer2/plan-amendment-tests');
  const { pendingExerciseAmendmentJourney } = await import('./trainer2/plan-amendment-journey');
  await runHomeProgramFixture(false, false, async context => {
    await loggerJourney(context);
    await verifyAmendmentUpgrade(context);
    const fixture = await verifyPlanAmendments(context);
    await pendingExerciseAmendmentJourney({ ...context, fixture });
  });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
