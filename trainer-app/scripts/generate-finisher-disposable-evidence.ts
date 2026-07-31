import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertCanonicalDisposableEnvironment,
  buildCanonicalDisposableEvidence,
} from "@/lib/operations/finisher-disposable-evidence";

function value(argv: string[], name: string): string {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--")) {
    throw new Error(`Missing required ${name} <value>.`);
  }
  return argv[index + 1];
}

const argv = process.argv.slice(2);
const allowed = new Set(["--expected-commit", "--output"]);
for (let index = 0; index < argv.length; index += 1) {
  const key = argv[index].split("=", 1)[0];
  if (!allowed.has(key)) throw new Error(`Unsupported argument ${key}.`);
  if (!argv[index].includes("=")) index += 1;
}
const expectedCommit = value(argv, "--expected-commit").trim().toLowerCase();
const output = resolve(value(argv, "--output"));
const environment = {
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
  GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
  GITHUB_REF: process.env.GITHUB_REF,
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
  GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
  GITHUB_SHA: process.env.GITHUB_SHA,
};
assertCanonicalDisposableEnvironment(environment, expectedCommit);
const startedAt = new Date().toISOString();
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
for (const command of [
  ["run", "verify:production-write-gate"],
  ["run", "test:db:rollout-tooling", "--", "--confirm-disposable"],
]) {
  const result = spawnSync(npmExecutable, command, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Canonical disposable verification command failed with exit ${result.status ?? 1}: npm ${command.join(" ")}`,
    );
  }
}
const evidence = buildCanonicalDisposableEvidence({
  appRoot: process.cwd(),
  expectedCommit,
  startedAt,
  completedAt: new Date().toISOString(),
  environment,
});
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify(evidence));
