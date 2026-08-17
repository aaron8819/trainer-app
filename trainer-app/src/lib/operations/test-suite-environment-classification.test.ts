import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
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
const yaml = createRequire(import.meta.url)("js-yaml") as {
  load(source: string): unknown;
};

type WorkflowStep = {
  name?: unknown;
  id?: unknown;
  run?: unknown;
  uses?: unknown;
  if?: unknown;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
};

type CredentialFreeWorkflow = {
  on?: {
    pull_request?: {
      branches?: unknown;
    };
  };
  permissions?: Record<string, unknown>;
  jobs?: Record<
    string,
    {
      name?: unknown;
      env?: Record<string, unknown>;
      steps?: WorkflowStep[];
    }
  >;
};

function parseWorkflow(source: string): CredentialFreeWorkflow {
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credential-free workflow must parse as an object.");
  }
  return parsed as CredentialFreeWorkflow;
}

function workflowStep(
  workflow: CredentialFreeWorkflow,
  name: string
): WorkflowStep | undefined {
  return workflow.jobs?.["credential-free-inventory"]?.steps?.find(
    (step) => step.name === name
  );
}

function validateCredentialFreeWorkflow(workflow: CredentialFreeWorkflow): string[] {
  const errors: string[] = [];
  const job = workflow.jobs?.["credential-free-inventory"];
  const branches = workflow.on?.pull_request?.branches;
  if (!Array.isArray(branches) || !branches.includes("master")) errors.push("pull-request-branch");
  if (workflow.permissions?.contents !== "read") errors.push("permissions");
  if (job?.name !== "credential-free-inventory") errors.push("job-name");
  if (job?.env?.CI !== true || job.env.TZ !== "America/Chicago") errors.push("job-env");

  const checkout = workflowStep(workflow, "Check out repository");
  if (checkout?.uses !== "actions/checkout@v7" || checkout.with?.["fetch-depth"] !== 0) {
    errors.push("checkout-step");
  }
  const setupNode = workflowStep(workflow, "Set up Node.js");
  if (setupNode?.uses !== "actions/setup-node@v7" || setupNode.with?.["node-version"] !== 22) {
    errors.push("node-step");
  }
  if (workflowStep(workflow, "Install exact dependencies")?.run !== "npm ci") {
    errors.push("install-step");
  }

  const inventory = workflowStep(workflow, "Run credential-free inventory");
  if (inventory?.id !== "credential_free_inventory") errors.push("inventory-id");
  if (
    inventory?.run !==
    "npm run test:inventory:credential-free -- --base-ref origin/master"
  ) {
    errors.push("inventory-run");
  }

  const upload = workflowStep(workflow, "Upload credential-free failure bundle");
  if (
    upload?.if !==
    "${{ always() && steps.credential_free_inventory.outcome == 'failure' }}"
  ) {
    errors.push("upload-if");
  }
  if (upload?.uses !== "actions/upload-artifact@v4") errors.push("upload-action");
  if (
    upload?.with?.name !==
    "credential-free-inventory-${{ github.run_id }}-${{ github.run_attempt }}"
  ) {
    errors.push("upload-name");
  }
  if (upload?.with?.path !== "trainer-app/artifacts/credential-free-inventory/") {
    errors.push("upload-path");
  }
  if (upload?.with?.["if-no-files-found"] !== "error") errors.push("upload-missing-files");
  if (upload?.with?.["retention-days"] !== 7) errors.push("upload-retention");
  if (job?.steps?.some((step) => step["continue-on-error"] !== undefined)) {
    errors.push("continue-on-error");
  }
  return errors;
}
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
    expect(discoveredTestFiles).toHaveLength(362);
    expect(selection.credentialFree).toHaveLength(323);
    expect(selection.credentialFree).toContain(
      "src/lib/operations/credential-free-inventory-runner.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/engine/hypertrophy-plan-recommendations.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/engine/hypertrophy-prescription-patterns.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/exercise-library/catalog-invariants.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/engine/movement-pattern-coverage.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/api/template-session-proof-boundary.test.ts"
    );
    expect(selection.credentialFree).toContain(
      "src/lib/api/template-session-v4-revised.test.ts"
    );
    expect(selection.importOnlyPlaceholder).toHaveLength(34);
    expect(selection.databaseRequired).toHaveLength(5);
    for (const entry of selection.databaseRequired) {
      expect(policy.commandRegistry).toContainEqual(
        expect.objectContaining({
          id: entry.commandId,
          packageScript: entry.packageScript,
          profile: "disposable-database-write",
        })
      );
    }
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

  it("parses deterministic Vitest JSON reporter counts", () => {
    const output = JSON.stringify({
      numTotalTests: 4,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 1,
      numTodoTests: 0,
      testResults: [
        { status: "passed" },
        { status: "failed" },
        { status: "pending" },
      ],
    });
    expect(parseVitestSummary(output)).toEqual({
      files: { total: 3, passed: 1, failed: 1, skipped: 1 },
      tests: { total: 4, passed: 2, failed: 1, skipped: 1 },
    });
  });

  it("parses colorized Vitest summary counts", () => {
    const escape = "\u001B[";
    const output = [
      `${escape}2m Test Files ${escape}22m ${escape}32m295 passed${escape}39m (295)`,
      `${escape}2m      Tests ${escape}22m ${escape}32m2909 passed${escape}39m | 1 skipped (2910)`,
    ].join("\n");
    expect(parseVitestSummary(output)).toEqual({
      files: { total: 295, passed: 295, failed: 0, skipped: 0 },
      tests: { total: 2910, passed: 2909, failed: 0, skipped: 1 },
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
  const workflowSource = readFileSync(
    resolve("..", ".github/workflows/credential-free-inventory.yml"),
    "utf8"
  );

  it("parses the workflow and validates the identified inventory and upload steps", () => {
    const workflow = parseWorkflow(workflowSource);

    expect(validateCredentialFreeWorkflow(workflow)).toEqual([]);
    expect(workflowSource).not.toMatch(/\bDATABASE_URL\b|\bTEST_DATABASE_URL\b/);
    expect(workflowSource).not.toContain("test:db:");
    expect(workflowSource).not.toMatch(/^\s+run:\s+.*\bvitest\b/m);
  });

  it("rejects missing or misplaced workflow contract fields", () => {
    const cases: Array<{
      label: string;
      expectedError: string;
      mutate(workflow: CredentialFreeWorkflow): void;
    }> = [
      {
        label: "missing inventory step ID",
        expectedError: "inventory-id",
        mutate: (workflow) => {
          delete workflowStep(workflow, "Run credential-free inventory")?.id;
        },
      },
      {
        label: "upload condition unrelated to inventory outcome",
        expectedError: "upload-if",
        mutate: (workflow) => {
          const upload = workflowStep(workflow, "Upload credential-free failure bundle");
          if (upload) upload.if = "${{ always() && steps.checkout.outcome == 'failure' }}";
        },
      },
      {
        label: "broad artifact path",
        expectedError: "upload-path",
        mutate: (workflow) => {
          const upload = workflowStep(workflow, "Upload credential-free failure bundle");
          if (upload?.with) upload.with.path = "trainer-app/";
        },
      },
      {
        label: "missing retention",
        expectedError: "upload-retention",
        mutate: (workflow) => {
          const upload = workflowStep(workflow, "Upload credential-free failure bundle");
          if (upload?.with) delete upload.with["retention-days"];
        },
      },
      {
        label: "upload action and fields attached to the inventory step",
        expectedError: "upload-action",
        mutate: (workflow) => {
          const inventory = workflowStep(workflow, "Run credential-free inventory");
          const upload = workflowStep(workflow, "Upload credential-free failure bundle");
          if (inventory && upload) {
            inventory.uses = upload.uses;
            inventory.with = upload.with;
            delete upload.uses;
            delete upload.with;
          }
        },
      },
    ];

    for (const testCase of cases) {
      const fixture = structuredClone(parseWorkflow(workflowSource));
      testCase.mutate(fixture);
      expect(
        validateCredentialFreeWorkflow(fixture),
        testCase.label
      ).toContain(testCase.expectedError);
    }
  });

  it("keeps one-worker progress and reporter separation in the canonical runner", () => {
    const runner = readFileSync(
      resolve("scripts/test-environment-preflight.ts"),
      "utf8"
    );
    expect(runner).toContain('const vitestArgs = ["--maxWorkers", "1"]');
    expect(runner).toContain("formatVitestPhaseFailure");
    expect(runner).toContain("Credential-free inventory total elapsed");
    const phaseRunner = readFileSync(
      resolve("src/lib/operations/credential-free-inventory-runner.ts"),
      "utf8"
    );
    expect(phaseRunner).toContain('"--reporter=dot"');
    expect(phaseRunner).toContain('"--reporter=json"');
    expect(phaseRunner).not.toContain("--outputFile.json=");
    expect(phaseRunner).toContain("extractVitestJsonReporter");
    expect(phaseRunner).toContain("reporterOutput:");
    expect(phaseRunner).toContain('stdio: ["ignore", "pipe", "pipe"]');
  });

  it("configures only the proven filesystem inventory guard with a 60 second timeout", () => {
    const source = readFileSync(
      resolve("src/lib/operations/test-environment-preflight.test.ts"),
      "utf8"
    );
    expect(source).toContain(
      'describe("database target inventory guard", { timeout: 60_000 }'
    );
    expect(readFileSync(resolve("vitest.config.ts"), "utf8")).not.toContain(
      "testTimeout"
    );
  });
});
