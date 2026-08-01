import { resolve } from "node:path";
import { verifyProductionWriteGate } from "@/lib/operations/production-write-gate-verifier";

const fixtureRootIndex = process.argv.indexOf("--fixture-root");
const fixtureRoot =
  fixtureRootIndex >= 0 ? process.argv[fixtureRootIndex + 1] : undefined;
const result = verifyProductionWriteGate(
  fixtureRoot ? resolve(process.cwd(), fixtureRoot) : process.cwd(),
  { fixtureMode: Boolean(fixtureRoot) },
);

if (result.failures.length > 0) {
  console.error("Production write-gate ownership verification failed:");
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Production write-gate ownership verification passed.");
  console.log(`Gated mutation methods (${result.mutationRoutes.length}):`);
  for (const [key, operation] of result.mutationRoutes) {
    console.log(`- ${key}: ${operation}`);
  }
  console.log("Target-aware operational commands:");
  for (const [name, path] of result.operationalCommands) {
    console.log(`- ${name}: ${path}`);
  }
}
