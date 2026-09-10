import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from "../src/lib/operations/test-environment-preflight";
async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid) throw new Error("Expected exactly --confirm-disposable");
  if (!validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid)
    throw new Error("TRAINER2_DB_TEST_TARGET_INVALID");
  const { verifySupabaseAuth } = await import("./trainer2/verify-supabase-auth");
  await verifySupabaseAuth();
}
void main().catch(() => { console.error("TRAINER2_AUTH_VERIFICATION_FAILED; see sanitized evidence"); process.exitCode = 1; });
