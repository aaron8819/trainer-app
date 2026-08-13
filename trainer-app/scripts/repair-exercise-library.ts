import {
  parseCatalogKeySelectors,
  runExerciseLibrarySync,
} from "./sync-exercise-library";
import { assertOperationalProductionWriteAllowed } from "@/lib/operations/rollout-environment";

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const catalogKeys = parseCatalogKeySelectors(argv);
  assertOperationalProductionWriteAllowed({
    argv,
    writeRequested: apply,
  });

  await runExerciseLibrarySync({ apply, catalogKeys });
}

main().catch((error) => {
  console.error("Failed to repair exercise library", error);
  process.exit(1);
});
