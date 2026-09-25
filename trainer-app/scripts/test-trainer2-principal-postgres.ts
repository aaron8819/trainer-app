import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from "../src/lib/operations/test-environment-preflight";

async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid) throw new Error("Expected exactly --confirm-disposable");
  if (!validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid)
    throw new Error("TRAINER2_DB_TEST_TARGET_INVALID");
  const { verifySingleUser } = await import("./trainer2/verify-single-user");
  await verifySingleUser();
}
void main().catch(error => { console.error("TRAINER2_SINGLE_USER_VERIFICATION_FAILED", error instanceof Error &&
  /^(DESKTOP|PHONE)_PLAN_RENDER_TIMEOUT$/.test(error.message) ? error.message : "see sanitized evidence"); process.exitCode = 1; });
