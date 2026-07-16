import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const appRoot = resolve(process.cwd());
const apiRoot = join(appRoot, "src", "app", "api");

const gatedMethods = new Map<string, string>([
  ["profile/setup/route.ts#POST", "application_configuration"],
  ["preferences/route.ts#POST", "application_configuration"],
  ["periodization/macro/route.ts#POST", "mesocycle_acceptance"],
  ["program/route.ts#PATCH", "mesocycle_lifecycle"],
  ["templates/route.ts#POST", "application_configuration"],
  ["templates/[id]/route.ts#PUT", "application_configuration"],
  ["templates/[id]/route.ts#DELETE", "application_configuration"],
  ["templates/[id]/exercises/route.ts#POST", "application_configuration"],
  ["exercises/[id]/favorite/route.ts#POST", "application_configuration"],
  ["exercises/[id]/avoid/route.ts#POST", "application_configuration"],
  ["readiness/submit/route.ts#POST", "readiness_submission"],
  ["pre-session-readiness/prepare/route.ts#POST", "readiness_preparation"],
  ["mesocycles/[id]/accept-next-cycle/route.ts#POST", "mesocycle_acceptance"],
  ["mesocycles/[id]/refresh-next-seed-draft/route.ts#POST", "mesocycle_reseed"],
  ["mesocycles/[id]/draft/route.ts#PATCH", "mesocycle_reseed"],
  ["mesocycles/[id]/finish-deload/route.ts#POST", "mesocycle_lifecycle"],
  ["mesocycles/week-close/[id]/closeout/route.ts#POST", "mesocycle_lifecycle"],
  ["mesocycles/week-close/[id]/dismiss/route.ts#POST", "mesocycle_lifecycle"],
  ["workouts/generate-from-intent/route.ts#POST", "workout_materialization"],
  ["workouts/generate-from-template/route.ts#POST", "workout_materialization"],
  ["workouts/save/route.ts#POST", "workout_save"],
  ["workouts/delete/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/add-exercise/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/swap-exercise/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/exercises/[exerciseId]/route.ts#DELETE", "workout_structural_edit"],
  ["workouts/[id]/exercises/[exerciseId]/add-set/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/dismiss-closeout/route.ts#POST", "workout_structural_edit"],
  ["logs/set/route.ts#POST", "set_logging"],
  ["logs/set/route.ts#DELETE", "set_logging"],
]);

const readOnlyMutationMethodAllowlist = new Set([
  "mesocycles/[id]/setup-preview/route.ts#POST",
  "workouts/[id]/add-exercise-preview/route.ts#POST",
]);

const operationalWriteRoots = [join(appRoot, "scripts"), join(appRoot, "prisma")];
const operationalSupportAllowlist = new Set(["scripts/audit-cli-support.ts"]);
const implicitWriteScripts = ["scripts/backfill-immutable-seed-revisions.ts"];

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

const failures: string[] = [];
const discovered = new Set<string>();
const methodPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

for (const routePath of filesUnder(apiRoot).filter((path) => path.endsWith("route.ts"))) {
  const route = normalizedRelative(apiRoot, routePath);
  const source = readFileSync(routePath, "utf8");
  const methods = [...source.matchAll(methodPattern)];
  for (const [index, match] of methods.entries()) {
    const method = match[1]!;
    if (method === "GET") continue;
    const key = `${route}#${method}`;
    discovered.add(key);
    const operation = gatedMethods.get(key);
    if (!operation && !readOnlyMutationMethodAllowlist.has(key)) {
      failures.push(`Unclassified mutation method: ${key}`);
      continue;
    }
    const handlerSource = source.slice(match.index, methods[index + 1]?.index ?? source.length);
    if (operation && !new RegExp(`productionWritePauseResponse\\(\\s*\"${operation}\"`).test(handlerSource)) {
      failures.push(`Missing central gate for ${key} (${operation})`);
    }
  }
}

for (const key of gatedMethods.keys()) {
  if (!discovered.has(key)) failures.push(`Stale gated-route inventory entry: ${key}`);
}
for (const key of readOnlyMutationMethodAllowlist) {
  if (!discovered.has(key)) failures.push(`Stale read-only route allowlist entry: ${key}`);
}

const directCheckRoots = [join(appRoot, "src"), join(appRoot, "scripts")];
for (const path of directCheckRoots.flatMap(filesUnder).filter((path) => path.endsWith(".ts"))) {
  const relativePath = normalizedRelative(appRoot, path);
  if (
    relativePath.endsWith(".test.ts") ||
    relativePath === "src/lib/operations/production-write-gate.ts" ||
    relativePath === "scripts/check-production-write-gate.ts"
  ) {
    continue;
  }
  const source = readFileSync(path, "utf8");
  if (/TRAINER_WRITE_PAUSE|NEXT_PUBLIC_.*(?:WRITE|MAINTENANCE)|MAINTENANCE_MODE|WRITES_PAUSED/.test(source)) {
    failures.push(`Direct or competing write-pause environment check: ${relativePath}`);
  }
}

const operationalWriteScripts: string[] = [];
for (const path of operationalWriteRoots.flatMap(filesUnder).filter((path) => path.endsWith(".ts"))) {
  const relativePath = normalizedRelative(appRoot, path);
  if (
    relativePath === "scripts/check-production-write-gate.ts" ||
    operationalSupportAllowlist.has(relativePath) ||
    relativePath.includes("/test-") ||
    relativePath.endsWith(".test.ts")
  ) {
    continue;
  }
  const source = readFileSync(path, "utf8");
  if (!/--(?:write|apply|execute|accept-slot-plan-upgrade|apply-bounded-reseed)\b/.test(source)) {
    continue;
  }
  operationalWriteScripts.push(relativePath);
  if (
    !source.includes("runWithRolloutEnvironment") &&
    !source.includes("loadAuditEnv") &&
    !source.includes("assertOperationalProductionWriteAllowed")
  ) {
    failures.push(`Rollout write script bypasses target-aware gate: ${relativePath}`);
  }
}
for (const relativePath of implicitWriteScripts) {
  const source = readFileSync(join(appRoot, relativePath), "utf8");
  operationalWriteScripts.push(relativePath);
  if (!source.includes("runWithRolloutEnvironment")) {
    failures.push(`Rollout write script bypasses target-aware gate: ${relativePath}`);
  }
}
operationalWriteScripts.sort();

if (failures.length > 0) {
  console.error("Production write-gate ownership verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Production write-gate ownership verification passed.");
  console.log(`Gated mutation methods (${gatedMethods.size}):`);
  for (const [key, operation] of gatedMethods) console.log(`- ${key}: ${operation}`);
  console.log("Intentionally read-only non-GET methods:");
  for (const key of readOnlyMutationMethodAllowlist) console.log(`- ${key}`);
  console.log("Target-aware operational write scripts:");
  for (const path of operationalWriteScripts) console.log(`- ${path}`);
}
