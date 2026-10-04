import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from '../src/lib/operations/test-environment-preflight';
async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid || !validateDisposableDatabaseTargets({environment:process.env,confirmed:true,requiredTargets:[]}).valid) throw new Error('Expected --confirm-disposable with no inherited database target');
  const { runHomeProgramFixture } = await import('./trainer2/home-program-fixture');
  await runHomeProgramFixture(false, true);
}
void main().catch(e => { console.error(e instanceof Error ? e.message : 'Home/Program surface verification failed'); process.exitCode=1; });
