import { spawnSync } from "node:child_process";
import { verifyExerciseLibrary } from "./verify-exercise-library";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");

  const before = await verifyExerciseLibrary();
  if (before.isClean) {
    console.log("Exercise library already matches JSON source of truth.");
    return;
  }

  console.log("Exercise library drift detected.");
  console.log(`Missing: ${before.missingInDb.length}, Extra: ${before.extraInDb.length}, Field mismatches: ${before.mismatches.length}`);

  if (!apply) {
    console.log("Dry run mode. Re-run with --apply to repair using prisma seed.");
    process.exitCode = 1;
    return;
  }

  console.log("Applying repair via prisma seed...");
  run("npx", ["tsx", "prisma/seed.ts"]);

  const after = await verifyExerciseLibrary();
  if (!after.isClean) {
    console.error("Repair completed but drift remains.");
    process.exit(1);
  }

  console.log("Repair complete. Exercise library is now in sync.");
}

main().catch((error) => {
  console.error("Failed to repair exercise library", error);
  process.exit(1);
});
