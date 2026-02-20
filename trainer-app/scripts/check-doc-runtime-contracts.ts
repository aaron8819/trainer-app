import fs from "node:fs";
import path from "node:path";
import {
  WORKOUT_EXERCISE_SECTION_VALUES,
  WORKOUT_SAVE_ACTION_VALUES,
  WORKOUT_SELECTION_MODE_VALUES,
  WORKOUT_SESSION_INTENT_DB_VALUES,
  WORKOUT_STATUS_VALUES,
} from "../src/lib/validation";

type ContractsDoc = {
  workoutStatus: string[];
  workoutSaveAction: string[];
  workoutSelectionMode: string[];
  workoutSessionIntentDb: string[];
  workoutExerciseSection: string[];
};

function asSorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function compareContract(name: string, runtimeValues: readonly string[], docValues: readonly string[]): string[] {
  const runtime = new Set(runtimeValues);
  const docs = new Set(docValues);
  const missingInDocs = asSorted(runtimeValues.filter((value) => !docs.has(value)));
  const missingInRuntime = asSorted(docValues.filter((value) => !runtime.has(value)));
  if (missingInDocs.length === 0 && missingInRuntime.length === 0) {
    return [];
  }
  return [
    `${name} mismatch`,
    `  missing_in_docs: ${missingInDocs.length > 0 ? missingInDocs.join(", ") : "(none)"}`,
    `  missing_in_runtime: ${missingInRuntime.length > 0 ? missingInRuntime.join(", ") : "(none)"}`,
  ];
}

function main() {
  const contractPath = path.join(process.cwd(), "docs", "contracts", "runtime-contracts.json");
  const raw = fs.readFileSync(contractPath, "utf8");
  const docs = JSON.parse(raw) as ContractsDoc;

  const errors = [
    ...compareContract("workoutStatus", WORKOUT_STATUS_VALUES, docs.workoutStatus),
    ...compareContract("workoutSaveAction", WORKOUT_SAVE_ACTION_VALUES, docs.workoutSaveAction),
    ...compareContract("workoutSelectionMode", WORKOUT_SELECTION_MODE_VALUES, docs.workoutSelectionMode),
    ...compareContract("workoutSessionIntentDb", WORKOUT_SESSION_INTENT_DB_VALUES, docs.workoutSessionIntentDb),
    ...compareContract("workoutExerciseSection", WORKOUT_EXERCISE_SECTION_VALUES, docs.workoutExerciseSection),
  ];

  if (errors.length > 0) {
    console.error("Doc/runtime contract drift detected:");
    for (const line of errors) {
      console.error(line);
    }
    process.exit(1);
  }

  console.log("Doc/runtime contracts are aligned.");
}

main();
