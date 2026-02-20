/**
 * Protects: Contracts verifier must pass.
 * Why it matters: Doc/runtime enum drift breaks API consumers and architecture documentation guarantees.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WORKOUT_EXERCISE_SECTION_VALUES,
  WORKOUT_SAVE_ACTION_VALUES,
  WORKOUT_SELECTION_MODE_VALUES,
  WORKOUT_SESSION_INTENT_DB_VALUES,
  WORKOUT_STATUS_VALUES,
} from "./validation";

type ContractsDoc = {
  workoutStatus: string[];
  workoutSaveAction: string[];
  workoutSelectionMode: string[];
  workoutSessionIntentDb: string[];
  workoutExerciseSection: string[];
};

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe("runtime contracts document", () => {
  const raw = readFileSync("docs/contracts/runtime-contracts.json", "utf8");
  const docs = JSON.parse(raw) as ContractsDoc;

  it("matches workout statuses", () => {
    expect(sorted(docs.workoutStatus)).toEqual(sorted(WORKOUT_STATUS_VALUES));
  });

  it("matches workout save actions", () => {
    expect(sorted(docs.workoutSaveAction)).toEqual(sorted(WORKOUT_SAVE_ACTION_VALUES));
  });

  it("matches workout selection modes", () => {
    expect(sorted(docs.workoutSelectionMode)).toEqual(sorted(WORKOUT_SELECTION_MODE_VALUES));
  });

  it("matches workout session intents", () => {
    expect(sorted(docs.workoutSessionIntentDb)).toEqual(sorted(WORKOUT_SESSION_INTENT_DB_VALUES));
  });

  it("matches workout exercise sections", () => {
    expect(sorted(docs.workoutExerciseSection)).toEqual(sorted(WORKOUT_EXERCISE_SECTION_VALUES));
  });
});
