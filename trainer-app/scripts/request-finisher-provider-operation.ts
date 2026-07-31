import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
} from "@/lib/operations/finisher-provider-verification";

type Operation = "recovery-point" | "write-pause";

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function required(argv: string[], name: string): string {
  const value = readArgument(argv, name)?.trim();
  if (!value) throw new Error(`Missing required ${name} <value>.`);
  return value;
}

const argv = process.argv.slice(2);
const valueArguments = new Set([
  "--operation",
  "--required-application-commit",
  "--expected-provider-account-id",
  "--expected-project-reference",
  "--expected-database",
  "--confirm-provider-operation",
]);
const flagArguments = new Set(["--authorize-provider-mutation"]);
const seen = new Set<string>();
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index];
  const key = argument.split("=", 1)[0];
  if ((!valueArguments.has(key) && !flagArguments.has(key)) || seen.has(key)) {
    throw new Error(`Unsupported or duplicate argument ${key}.`);
  }
  seen.add(key);
  if (valueArguments.has(key) && !argument.includes("=")) index += 1;
}
const operation = required(argv, "--operation") as Operation;
if (operation !== "recovery-point" && operation !== "write-pause") {
  throw new Error("--operation must be recovery-point or write-pause.");
}
const commit = required(argv, "--required-application-commit").toLowerCase();
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("--required-application-commit must be one full lowercase Git SHA.");
}
const actualHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (actualHead !== commit) {
  throw new Error("The checked-out repository HEAD must equal the authorized application commit.");
}
const migrationBlob = execFileSync(
  "git",
  ["rev-parse", `${actualHead}:${FINISHER_MIGRATION_PATH}`],
  { encoding: "utf8" },
).trim();
if (migrationBlob !== FINISHER_MIGRATION_GIT_BLOB) {
  throw new Error("The checked-out Finisher migration is not the reviewed Git blob.");
}
const migrationSha256 = createHash("sha256")
  .update(execFileSync("git", ["cat-file", "blob", migrationBlob], { encoding: null }))
  .digest("hex");
const account = required(argv, "--expected-provider-account-id");
const project = required(argv, "--expected-project-reference");
const database = required(argv, "--expected-database");
if (database !== "postgres") {
  throw new Error("The expected database must be the explicit production database postgres.");
}
if (operation === "recovery-point" && !/^[a-z0-9]{20}$/.test(project)) {
  throw new Error("Recovery-point scope requires one exact Supabase project reference.");
}
if (operation === "write-pause") {
  const contract = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "..", "scripts", "codex", "trainer-remote.v1.json"),
      "utf8",
    ),
  ) as { vercel?: { teamId?: string; projectId?: string } };
  if (
    contract.vercel?.teamId !== account ||
    contract.vercel.projectId !== project
  ) {
    throw new Error("Write-pause scope does not match the committed Vercel team and project.");
  }
}
const confirmation = required(argv, "--confirm-provider-operation");
const expectedConfirmation = `trainer-${operation}:${project}:${commit}`;
if (!argv.includes("--authorize-provider-mutation") || confirmation !== expectedConfirmation) {
  throw new Error("The separately authorized provider-mutation confirmation is missing or mismatched.");
}

const limitation =
  operation === "recovery-point"
    ? "Supabase exposes authenticated backup inventory and restore operations but no authoritative on-demand recovery-point creation operation."
    : "Trainer has no provider-native write-only pause operation; application pause activation requires an authorized Vercel environment update and an exact-commit production redeployment.";
console.error(JSON.stringify({
  schema: "trainer-finisher-provider-operation-capability",
  version: 1,
  operation,
  status: "unavailable",
  mutationAttempted: false,
  limitation,
  manualBridgeRequired: true,
  scope: {
    providerAccountId: account,
    providerProjectReference: project,
    database,
    applicationCommit: commit,
    migrationPath: FINISHER_MIGRATION_PATH,
    migrationGitBlob: migrationBlob,
    migrationSha256,
  },
}));
process.exitCode = 1;
