import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeMutationOwners = [
  "src/app/api/logs/set/route.ts",
  "src/app/api/workouts/[id]/add-exercise/route.ts",
  "src/app/api/workouts/[id]/exercises/[exerciseId]/add-set/route.ts",
  "src/app/api/workouts/delete/route.ts",
  "src/lib/api/mesocycle-week-close.ts",
  "src/lib/api/runtime-exercise-remove-service.ts",
  "src/lib/api/runtime-exercise-swap-service.ts",
] as const;

const failures: string[] = [];
for (const relativePath of runtimeMutationOwners) {
  const source = readFileSync(join(process.cwd(), relativePath), "utf8");
  if (!source.includes("executeWorkoutMutation")) {
    failures.push(`${relativePath}: missing canonical workout mutation transaction`);
  }
  if (/revision\s*:\s*\{[\s\S]*?increment\s*:\s*1\s*\}/.test(source)) {
    failures.push(`${relativePath}: contains an unconditional local revision increment`);
  }
}

const canonicalClaim = readFileSync(
  join(process.cwd(), "src/lib/api/workout-mutation.ts"),
  "utf8",
);
if (!canonicalClaim.includes("updateMany") || !canonicalClaim.includes("expectedRevision")) {
  failures.push("src/lib/api/workout-mutation.ts: canonical CAS claim is missing");
}

if (failures.length > 0) {
  throw new Error(`WORKOUT_MUTATION_OWNERSHIP_FAILED\n${failures.join("\n")}`);
}

console.log(
  `Workout mutation ownership verified for ${runtimeMutationOwners.length} supported runtime owners.`,
);
