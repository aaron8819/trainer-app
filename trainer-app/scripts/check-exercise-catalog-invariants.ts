import catalog from "../prisma/exercises_comprehensive.json";
import { exerciseAliases } from "../prisma/exercise-aliases";
import {
  validateCatalogInvariants,
  type CatalogExerciseDefinition,
} from "@/lib/exercise-library/catalog-invariants";

const exercises = catalog.exercises as CatalogExerciseDefinition[];
const errors = validateCatalogInvariants({ exercises, aliases: exerciseAliases });

if (errors.length > 0) {
  console.error("Exercise catalog invariant violations:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Exercise catalog invariants: PASS (canonical=${exercises.length}, aliases=${exerciseAliases.length})`,
  );
}
