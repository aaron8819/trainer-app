import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from "../src/lib/operations/test-environment-preflight";

async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid) throw new Error("Expected exactly --confirm-disposable");
  if (!validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid) throw new Error("LEGACY_SOURCE_INHERITED_TARGET_INVALID");
  const { verifyLegacySource } = await import("./trainer2/verify-legacy-source");
  await verifyLegacySource();
}
void main().catch(error => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[target]") : "LEGACY_SOURCE_VERIFICATION_FAILED"); process.exitCode = 1; });
