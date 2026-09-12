import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from "../src/lib/operations/test-environment-preflight";

async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid) throw new Error("Expected exactly --confirm-disposable");
  if (!validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid)
    throw new Error("TRAINER2_DB_TEST_TARGET_INVALID");
  const { verifyDrafts } = await import("./trainer2/verify-drafts");
  await verifyDrafts({ manualDemo: true });
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "TRAINER2_LOCAL_FAILED"); process.exitCode = 1; });
