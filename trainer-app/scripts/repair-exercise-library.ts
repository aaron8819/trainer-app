import { runExerciseLibrarySyncCli } from "./sync-exercise-library";

async function main() {
  await runExerciseLibrarySyncCli(process.argv.slice(2), {
    allowCatalogKeySelectors: false,
  });
}

main().catch((error) => {
  console.error("Failed to repair exercise library", error);
  process.exit(1);
});
