import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from '../src/lib/operations/test-environment-preflight';
async function main() {
 if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid || !validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid) throw new Error('Expected --confirm-disposable with no inherited database target');
 const { runHomeProgramFixture } = await import('./trainer2/home-program-fixture');
 const { programSupportJourney } = await import('./trainer2/program-support-journey');
 await runHomeProgramFixture(false, false, programSupportJourney);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
