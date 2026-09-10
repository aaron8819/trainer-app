import { validateDisposableDatabaseTargets } from "../src/lib/operations/test-environment-preflight";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== "--confirm-disposable" || args[1] !== "--account" || !args[2] || args[3] !== "--source-system" || !args[4])
    throw new Error("Expected --confirm-disposable --account <legacy-id> --source-system <source-id>");
  if (!validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid) throw new Error("LEGACY_SOURCE_INHERITED_TARGET_INVALID");
  if (process.env.VERCEL || process.env.CI || process.env.NODE_ENV === "production") throw new Error("LEGACY_SOURCE_LOCAL_ONLY");
  const target = process.env.TRAINER2_LEGACY_DATABASE_URL;
  if (!target) throw new Error("TRAINER2_LEGACY_DATABASE_URL_REQUIRED");
  // No dotenv, database imports, provisioning or writes before target admission.
  const { captureLegacyDatabase } = await import("../src/lib/api/trainer2/legacy-source");
  const { discrepancyReport } = await import("../src/lib/legacy-history/source");
  const capture = await captureLegacyDatabase(target, args[4], args[2]);
  process.stdout.write(JSON.stringify({ capture, report: discrepancyReport(capture) }, null, 2) + "\n");
}
void main().catch(() => { console.error("LEGACY_SOURCE_CAPTURE_FAILED: check explicit disposable reader target, arguments, scope and resource bounds; no source writes performed."); process.exitCode = 1; });
