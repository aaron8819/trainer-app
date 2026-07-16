import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProductionWriteStatus } from "./production-write-status-command";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production write status command", () => {
  it("requires an explicit environment file", () => {
    expect(() => loadProductionWriteStatus([])).toThrow("Missing required --env-file");
  });

  it.each([
    { value: "enabled", expected: "PAUSED" },
    { value: "disabled", expected: "ENABLED" },
    { value: "", expected: "ENABLED" },
  ])("reports $expected for an exact '$value' value", ({ value, expected }) => {
    const cwd = join(tmpdir(), `trainer-write-status-${crypto.randomUUID()}`);
    mkdirSync(cwd, { recursive: true });
    roots.push(cwd);
    const envFile = join(cwd, "status.env");
    writeFileSync(envFile, `TRAINER_WRITE_PAUSE=${value}\nDATABASE_URL=secret-not-read\n`);

    expect(loadProductionWriteStatus(["--env-file", envFile], cwd)).toBe(expected);
  });
});
