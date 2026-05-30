import { runExerciseLibrarySync } from "./sync-exercise-library";

async function main() {
  const apply = process.argv.includes("--apply");

  await runExerciseLibrarySync({ apply });
}

main().catch((error) => {
  console.error("Failed to repair exercise library", error);
  process.exit(1);
});
