import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from '../src/lib/operations/test-environment-preflight';

async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid ||
    !validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid)
    throw new Error('Expected --confirm-disposable with no inherited database target');
  const { runHomeProgramFixture } = await import('./trainer2/home-program-fixture');
  const { equipmentFixturePlan, equipmentJourney } = await import('./trainer2/equipment-journey');
  await runHomeProgramFixture(false, false, equipmentJourney, equipmentFixturePlan());
}
void main().catch(e => { console.error(e instanceof Error ? e.message : 'Equipment recording verification failed'); process.exitCode = 1; });
