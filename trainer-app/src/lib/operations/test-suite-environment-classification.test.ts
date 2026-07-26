import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildImportOnlyPlaceholderEnvironment,
  compareTestSuiteEnvironmentManifests,
  IMPORT_ONLY_PLACEHOLDER_URL,
  parseVitestSummary,
  sanitizeDatabaseTargetEnvironment,
  selectTestSuitesByEnvironment,
  validateImportOnlyPlaceholderEnvironment,
  validateTestSuiteEnvironmentManifest,
  type TestCommandRegistryEntry,
  type TestSuiteEnvironmentEntry,
  type TestSuiteEnvironmentManifest,
} from "./test-environment-preflight";

const temporaryDirectories: string[] = [];
const authorizedCommand: TestCommandRegistryEntry = {
  id: "npm-test-db-workout-mutations",
  packageScript: "test:db:workout-mutations",
  profile: "disposable-database-write",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function discoverTestFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.test\.tsx?$/.test(entry.name)) {
        files.push(relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  }
  visit(join(root, "src"));
  return files.sort();
}

function manifest(
  suites: TestSuiteEnvironmentEntry[]
): TestSuiteEnvironmentManifest {
  return {
    schema: "trainer-test-suite-environments",
    version: 1,
    suites,
  };
}

function importOnly(path: string): TestSuiteEnvironmentEntry {
  return {
    path,
    environment: "import-only-placeholder",
    owner: "test-environment-preflight",
    reason: "Fixture import-only reason.",
  };
}

function databaseRequired(path: string): TestSuiteEnvironmentEntry {
  return {
    path,
    environment: "db-required",
    owner: "workout-mutations",
    reason: "Fixture DB-required reason.",
    commandId: authorizedCommand.id,
    packageScript: authorizedCommand.packageScript,
  };
}

describe("test-suite environment manifest", () => {
  it("validates the real inventory and keeps every DB suite reachable", () => {
    const projectRoot = process.cwd();
    const currentManifest = JSON.parse(
      readFileSync(resolve("scripts/test-suite-environments.json"), "utf8")
    ) as TestSuiteEnvironmentManifest;
    const policy = JSON.parse(
      readFileSync(resolve("../scripts/codex/trainer-policy.v1.json"), "utf8")
    ) as { commandRegistry: TestCommandRegistryEntry[] };
    const discoveredTestFiles = discoverTestFiles(projectRoot);

    expect(
      validateTestSuiteEnvironmentManifest({
        manifest: currentManifest,
        discoveredTestFiles,
        commandRegistry: policy.commandRegistry,
      })
    ).toEqual([]);

    const selection = selectTestSuitesByEnvironment({
      manifest: currentManifest,
      discoveredTestFiles,
    });
    expect(discoveredTestFiles).toHaveLength(298);
    expect(selection.credentialFree).toHaveLength(262);
    expect(selection.importOnlyPlaceholder).toHaveLength(34);
    expect(selection.databaseRequired).toHaveLength(2);
    expect(
      selection.databaseRequired.every(
        (entry) =>
          entry.commandId === authorizedCommand.id &&
          entry.packageScript === authorizedCommand.packageScript
      )
    ).toBe(true);
  });

  it("keeps an unregistered import failure in credential-free selection", () => {
    const selection = selectTestSuitesByEnvironment({
      manifest: manifest([importOnly("src/known.test.ts")]),
      discoveredTestFiles: [
        "src/known.test.ts",
        "src/unexpected-import.test.ts",
      ],
    });
    expect(selection.credentialFree).toEqual(["src/unexpected-import.test.ts"]);
  });

  it("fails when a new DB-required suite is not classified", () => {
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([]),
      discoveredTestFiles: ["src/new-owner.db.test.ts"],
      commandRegistry: [authorizedCommand],
    });
    expect(errors.map((error) => error.code)).toContain(
      "unregistered-db-required-suite"
    );
  });

  it("fails when a DB-required suite has no authorized command", () => {
    const entry = databaseRequired("src/owner.db.test.ts");
    delete entry.commandId;
    delete entry.packageScript;
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([entry]),
      discoveredTestFiles: [entry.path],
      commandRegistry: [authorizedCommand],
    });
    expect(errors.map((error) => error.code)).toContain(
      "db-required-command-missing"
    );
  });

  it("fails conflicting duplicate environment classes", () => {
    const testPath = "src/owner.db.test.ts";
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([databaseRequired(testPath), importOnly(testPath)]),
      discoveredTestFiles: [testPath],
      commandRegistry: [authorizedCommand],
    });
    expect(errors.map((error) => error.code)).toContain("registry-conflict");
  });

  it("fails unsupported environment classes", () => {
    const entry = {
      ...importOnly("src/owner.test.ts"),
      environment: "unknown",
    } as unknown as TestSuiteEnvironmentEntry;
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([entry]),
      discoveredTestFiles: [entry.path],
      commandRegistry: [authorizedCommand],
    });
    expect(errors.map((error) => error.code)).toContain(
      "registry-environment-invalid"
    );
  });

  it("fails stale files and entries that point to non-test paths", () => {
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([
        importOnly("src/stale.test.ts"),
        importOnly("src/not-a-test.ts"),
      ]),
      discoveredTestFiles: [],
      commandRegistry: [authorizedCommand],
    });
    expect(errors.map((error) => error.code)).toContain("registry-path-missing");
    expect(errors.map((error) => error.code)).toContain("registry-path-not-test");
  });

  it("fails DB entries routed to a non-DB command profile", () => {
    const testPath = "src/owner.db.test.ts";
    const errors = validateTestSuiteEnvironmentManifest({
      manifest: manifest([databaseRequired(testPath)]),
      discoveredTestFiles: [testPath],
      commandRegistry: [
        {
          ...authorizedCommand,
          profile: "read-only",
        },
      ],
    });
    expect(errors.map((error) => error.code)).toContain(
      "db-required-command-unauthorized"
    );
  });

  it("surfaces branch changes to DB-required inventory", () => {
    const before = manifest([databaseRequired("src/old.db.test.ts")]);
    const after = manifest([
      databaseRequired("src/new.db.test.ts"),
      importOnly("src/changed.test.ts"),
    ]);
    before.suites.push(databaseRequired("src/removed.db.test.ts"));
    before.suites.push(databaseRequired("src/changed.test.ts"));
    const delta = compareTestSuiteEnvironmentManifests(before, after);
    expect(delta.added.map((entry) => entry.path)).toEqual([
      "src/new.db.test.ts",
    ]);
    expect(delta.removed.map((entry) => entry.path)).toEqual([
      "src/old.db.test.ts",
      "src/removed.db.test.ts",
    ]);
    expect(delta.changed.map((entry) => entry.after.path)).toEqual([
      "src/changed.test.ts",
    ]);
  });
});

describe("credential-free and placeholder failure boundaries", () => {
  const vitestCli = resolve("node_modules/vitest/vitest.mjs");

  it("keeps an accidental DB-owner import fatal without placeholder mode", () => {
    const result = spawnSync(
      process.execPath,
      [vitestCli, "run", "src/lib/api/analytics.test.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...sanitizeDatabaseTargetEnvironment(process.env),
          TRAINER_CREDENTIAL_FREE_TEST: "1",
        },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("Missing DATABASE_URL");
  }, 30_000);

  it("does not swallow an unrelated collection failure", () => {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-unexpected-collection-"));
    temporaryDirectories.push(fixture);
    const testFile = join(fixture, "src", "unrelated.test.ts");
    mkdirSync(resolve(testFile, ".."), { recursive: true });
    writeFileSync(join(fixture, "vitest.setup.ts"), "");
    writeFileSync(
      testFile,
      [
        'throw new Error("UNRELATED_COLLECTION_FAILURE");',
        'import { it } from "vitest";',
        'it("never runs", () => undefined);',
      ].join("\n")
    );
    const result = spawnSync(
      process.execPath,
      [
        vitestCli,
        "run",
        testFile,
        "--root",
        fixture,
        "--config",
        resolve("vitest.config.ts"),
      ],
      {
        cwd: fixture,
        env: {
          ...sanitizeDatabaseTargetEnvironment(process.env),
          TRAINER_CREDENTIAL_FREE_TEST: "1",
        },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "UNRELATED_COLLECTION_FAILURE"
    );
  }, 30_000);

  it("uses only the exact reserved placeholder and strips every other target", () => {
    const environment = buildImportOnlyPlaceholderEnvironment({
      database_url: "postgresql://production.example/trainer",
      DIRECT_URL: "postgresql://production.example/direct",
      TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
    });
    expect(environment.DATABASE_URL).toBe(
      IMPORT_ONLY_PLACEHOLDER_URL
    );
    expect(environment.database_url).toBeUndefined();
    expect(environment.DIRECT_URL).toBeUndefined();
    expect(environment.TRAINER_DISPOSABLE_DB_CONFIRMED).toBeUndefined();
    expect(validateImportOnlyPlaceholderEnvironment(environment)).toEqual([]);
  });

  it("rejects routable or production-looking placeholder values", () => {
    const environment: Record<string, string | undefined> = {
      ...buildImportOnlyPlaceholderEnvironment({}),
    };
    environment.DATABASE_URL =
      "postgresql://trainer:secret@db.production.example/trainer";
    expect(validateImportOnlyPlaceholderEnvironment(environment)).toContain(
      "Import-only placeholder mode requires the exact reserved TEST-NET database URL."
    );
  });

  it("parses deterministic Vitest file and test counts", () => {
    const output = [
      " Test Files  2 failed | 34 passed | 1 skipped (37)",
      "      Tests  101 passed | 3 skipped | 4 failed (108)",
    ].join("\n");
    expect(parseVitestSummary(output)).toEqual({
      files: { total: 37, passed: 34, failed: 2, skipped: 1 },
      tests: { total: 108, passed: 101, failed: 4, skipped: 3 },
    });
  });

  it("rejects incomplete or malformed Vitest results", () => {
    expect(parseVitestSummary("Test Files  1 passed (1)")).toBeNull();
    expect(
      parseVitestSummary(
        ["Test Files  passed", "Tests  1 passed (1)"].join("\n")
      )
    ).toBeNull();
  });
});

describe("pull-request CI contract", () => {
  it("delegates every environment class to the canonical inventory command", () => {
    const workflow = readFileSync(
      resolve("..", ".github/workflows/credential-free-inventory.yml"),
      "utf8"
    );

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- master");
    expect(workflow).toContain("name: credential-free-inventory");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain(
      "run: npm run test:inventory:credential-free -- --base-ref origin/master"
    );
    expect(workflow).not.toMatch(/\bDATABASE_URL\b|\bTEST_DATABASE_URL\b/);
    expect(workflow).not.toContain("test:db:");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toMatch(/\bvitest\b/);
  });
});
