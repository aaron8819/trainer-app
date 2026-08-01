import "dotenv/config";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertOperationalProductionWriteAllowed } from "@/lib/operations/rollout-environment";

const argv = process.argv.slice(2);
assertOperationalProductionWriteAllowed({
  argv,
  writeRequested: true,
  operation: "operational_administration",
});

const prismaEntrypoint = join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const prismaArgs = argv.filter(
  (argument) =>
    argument !== "--confirm-remote-write" && argument !== "--confirm-disposable",
);
const result = spawnSync(process.execPath, [prismaEntrypoint, "studio", ...prismaArgs], {
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
