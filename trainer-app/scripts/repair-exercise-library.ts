import { runExerciseLibrarySync } from "./sync-exercise-library";
import { assertOperationalProductionWriteAllowed } from "@/lib/operations/rollout-environment";

async function main() {
  const apply = process.argv.includes("--apply");
  assertOperationalProductionWriteAllowed({
    argv: process.argv.slice(2),
    writeRequested: apply,
  });

  await runExerciseLibrarySync({ apply });
}

main().catch((error) => {
  console.error("Failed to repair exercise library", error);
  process.exit(1);
});
