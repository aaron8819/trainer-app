import { describe, expect, it } from "vitest";
import { DATABASE_TARGET_ENV_VARS } from "./test-environment-preflight";
import {
  CREDENTIAL_FREE_SHARD_COUNT,
  CREDENTIAL_SAFE_PROFILE,
  INVENTORY_COMPONENT_SCHEMA,
  INVENTORY_COMPONENT_SCHEMA_VERSION,
  buildCredentialFreeShardVitestArgs,
  buildImportSafetyVitestArgs,
  normalizeExecutedReporterFile,
  normalizeExecutedReporterFiles,
  validateCredentialFreeAggregate,
  type AggregateValidationExpectation,
  type CredentialFreeShardSummary,
  type ImportSafetySummary,
  type InventoryComponentIdentity,
  type InventoryComponentSummary,
} from "./credential-free-inventory-sharding";

const credentialFiles = [
  "src/a.test.ts",
  "src/b.test.ts",
  "src/c.test.tsx",
  "src/d.test.ts",
];
const importFiles = ["src/import-only.test.ts"];
const databaseFiles = ["src/persistence.db.test.ts"];

const identity: InventoryComponentIdentity = {
  treeSha: "a".repeat(40),
  checkedOutCommitSha: "b".repeat(40),
  verificationDefinitionHash: "c".repeat(64),
  classificationHash: "d".repeat(64),
  lockfileHash: "e".repeat(64),
  workflow: "Trainer pull request checks",
  workflowRunId: "32923027847",
  runAttempt: "1",
  job: "credential-free-shard",
  execution: {
    nodeVersion: "v22.20.0",
    vitestVersion: "4.0.18",
    pool: "forks",
    isolation: true,
    workerCount: 1,
    timezone: "America/Chicago",
  },
  security: {
    profile: CREDENTIAL_SAFE_PROFILE,
    credentialStripping: true,
    databaseTargetsRemoved: [...DATABASE_TARGET_ENV_VARS].sort(),
    dotenvSuppressed: true,
  },
};

function counts(files: readonly string[]) {
  return {
    selectedFiles: files.length,
    executedFiles: files.length,
    passedFiles: files.length,
    failedFiles: 0,
    skippedFiles: 0,
    totalTests: files.length,
    passedTests: files.length,
    failedTests: 0,
    skippedTests: 0,
  };
}

function shard(index: number, files: string[]): CredentialFreeShardSummary {
  return {
    schema: INVENTORY_COMPONENT_SCHEMA,
    schemaVersion: INVENTORY_COMPONENT_SCHEMA_VERSION,
    componentType: "credential-free-shard",
    ...identity,
    shardIndex: index,
    shardCount: CREDENTIAL_FREE_SHARD_COUNT,
    files,
    fileDurations: files.map((file) => ({ file, durationMs: 10 })),
    counts: counts(files),
    durationMs: 100,
    status: "pass",
    reporterState: "available",
    failureClassification: "none",
  };
}

function importSummary(files = importFiles): ImportSafetySummary {
  return {
    schema: INVENTORY_COMPONENT_SCHEMA,
    schemaVersion: INVENTORY_COMPONENT_SCHEMA_VERSION,
    componentType: "import-safety",
    ...identity,
    job: "import-safety",
    files: [...files],
    fileDurations: files.map((file) => ({ file, durationMs: 10 })),
    counts: counts(files),
    durationMs: 50,
    status: "pass",
    reporterState: "available",
    failureClassification: "none",
    placeholderValidationPassed: true,
    socketGuardCompleted: true,
    connectionAttempted: false,
  };
}

function components(): InventoryComponentSummary[] {
  return [
    shard(1, [credentialFiles[0]]),
    shard(2, [credentialFiles[1]]),
    shard(3, [credentialFiles[2]]),
    shard(4, [credentialFiles[3]]),
    importSummary(),
  ];
}

function expectation(): AggregateValidationExpectation {
  return {
    ...identity,
    job: "credential-free-inventory",
    credentialFreeFiles: credentialFiles,
    importOnlyFiles: importFiles,
    databaseRequiredFiles: databaseFiles,
    dependencyResults: {
      credentialShards: "success",
      importSafety: "success",
    },
  };
}

function invalidErrors(
  values: readonly unknown[],
  expected = expectation()
): string[] {
  const result = validateCredentialFreeAggregate({
    untrustedComponents: values,
    expected,
  });
  expect(result.valid).toBe(false);
  return result.valid ? [] : result.errors;
}

describe("credential-free inventory aggregate validation", () => {
  it("accepts one complete, exact, non-overlapping four-way topology", () => {
    const result = validateCredentialFreeAggregate({
      untrustedComponents: components(),
      expected: expectation(),
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.aggregate.coverage).toMatchObject({
      credentialFreeExpected: credentialFiles,
      credentialFreeUnion: credentialFiles,
      importOnlyExpected: importFiles,
      databaseRequiredExcluded: databaseFiles,
      unionExact: true,
      noOverlap: true,
      importExact: true,
      databaseExcluded: true,
    });
    expect(result.aggregate.counts).toMatchObject({
      filesDiscovered: 6,
      selectedFiles: 5,
      executedFiles: 5,
      databaseRequiredExcluded: 1,
    });
  });

  it.each([
    {
      label: "missing credential file",
      mutate(values: InventoryComponentSummary[]) {
        values[3] = shard(4, []);
      },
      error: "credential shard union does not equal canonical selection",
    },
    {
      label: "overlap",
      mutate(values: InventoryComponentSummary[]) {
        values[1] = shard(2, [credentialFiles[0], credentialFiles[1]]);
      },
      error: "credential shard file sets overlap",
    },
    {
      label: "missing shard",
      mutate(values: InventoryComponentSummary[]) {
        values.splice(2, 1);
      },
      error: "credential shard 3/4 is missing",
    },
    {
      label: "duplicate shard",
      mutate(values: InventoryComponentSummary[]) {
        values[2] = shard(2, [credentialFiles[2]]);
      },
      error: "credential shard index is duplicated",
    },
    {
      label: "unknown credential file",
      mutate(values: InventoryComponentSummary[]) {
        values[0] = shard(1, ["src/unknown.test.ts"]);
      },
      error: "credential shard union does not equal canonical selection",
    },
    {
      label: "import file in credential shard",
      mutate(values: InventoryComponentSummary[]) {
        values[0] = shard(1, [importFiles[0]]);
      },
      error: "credential shard contains an import-only or database-required file",
    },
    {
      label: "DB file in credential shard",
      mutate(values: InventoryComponentSummary[]) {
        values[0] = shard(1, [databaseFiles[0]]);
      },
      error: "credential shard contains an import-only or database-required file",
    },
    {
      label: "credential file in import summary",
      mutate(values: InventoryComponentSummary[]) {
        values[4] = importSummary([credentialFiles[0]]);
      },
      error: "import safety files do not equal canonical import-only selection",
    },
  ])("rejects $label", ({ mutate, error }) => {
    const values = components();
    mutate(values);
    expect(invalidErrors(values)).toContain(error);
  });

  it.each([
    "treeSha",
    "checkedOutCommitSha",
    "verificationDefinitionHash",
    "classificationHash",
    "lockfileHash",
    "workflow",
    "workflowRunId",
    "runAttempt",
  ] as const)("rejects a component %s mismatch", (key) => {
    const values = components();
    Object.assign(values[1], {
      [key]: key.endsWith("Hash") ? "f".repeat(64) : "f".repeat(40),
    });
    if (key === "workflow") {
      Object.assign(values[1], { [key]: "Different workflow" });
    } else if (key === "workflowRunId" || key === "runAttempt") {
      Object.assign(values[1], { [key]: "2" });
    }
    expect(invalidErrors(values).join("\n")).toContain(key);
  });

  it.each([
    ["nodeVersion", "v20.1.0"],
    ["vitestVersion", "4.0.17"],
    ["pool", "threads"],
    ["isolation", false],
    ["workerCount", 2],
  ] as const)("rejects an execution mismatch in %s", (key, value) => {
    const values = components();
    values[0] = {
      ...values[0],
      execution: { ...values[0].execution, [key]: value },
    } as CredentialFreeShardSummary;
    expect(invalidErrors(values).join("\n")).toMatch(/execution/);
  });

  it("rejects a shard-count mismatch", () => {
    const values = components();
    (values[0] as CredentialFreeShardSummary).shardCount = 5;
    expect(invalidErrors(values)).toContain(
      "credential shard 1 has the wrong shard count"
    );
  });

  it("rejects untrusted claims that weaken the sanitizer profile", () => {
    for (const security of [
      { ...identity.security, credentialStripping: false },
      { ...identity.security, dotenvSuppressed: false },
      { ...identity.security, databaseTargetsRemoved: ["DATABASE_URL"] },
      { ...identity.security, profile: "unregistered-profile" },
    ]) {
      const values = components();
      values[0] = { ...values[0], security } as CredentialFreeShardSummary;
      expect(invalidErrors(values).join("\n")).toContain("security");
    }
  });

  it("rejects failed, missing, cancelled, and skipped dependencies", () => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const expected = expectation();
      expected.dependencyResults.credentialShards = result;
      expect(invalidErrors(components(), expected)).toContain(
        "credential shard dependency did not succeed"
      );
    }
  });

  it("rejects unavailable or contradictory reporter results", () => {
    const unavailable = components();
    unavailable[0] = {
      ...unavailable[0],
      reporterState: "missing",
    } as CredentialFreeShardSummary;
    expect(invalidErrors(unavailable).join("\n")).toContain("reporter state");

    const failedTests = components();
    failedTests[0] = {
      ...failedTests[0],
      counts: {
        ...failedTests[0].counts,
        passedTests: 0,
        failedTests: 1,
      },
    } as CredentialFreeShardSummary;
    expect(invalidErrors(failedTests).join("\n")).toContain(
      "pass status contradicts counts"
    );
  });

  it("rejects malformed counts, durations, paths, and duplicate paths", () => {
    const countMismatch = components();
    countMismatch[0] = {
      ...countMismatch[0],
      counts: { ...countMismatch[0].counts, executedFiles: 2 },
    } as CredentialFreeShardSummary;
    expect(invalidErrors(countMismatch).join("\n")).toContain(
      "executed file count differs"
    );

    const invalidDuration = components();
    invalidDuration[0] = {
      ...invalidDuration[0],
      durationMs: Number.NaN,
    } as CredentialFreeShardSummary;
    expect(invalidErrors(invalidDuration).join("\n")).toContain(
      "duration is invalid"
    );

    for (const file of ["", "../outside.test.ts", "/src/a.test.ts", "src\\a.test.ts"]) {
      const unsafe = components() as unknown as Array<Record<string, unknown>>;
      unsafe[0] = { ...unsafe[0], files: [file] };
      expect(invalidErrors(unsafe).join("\n")).toContain(
        "file identities are malformed"
      );
    }

    const duplicate = components() as unknown as Array<Record<string, unknown>>;
    duplicate[0] = {
      ...duplicate[0],
      files: [credentialFiles[0], credentialFiles[0]],
      counts: counts([credentialFiles[0], credentialFiles[0]]),
    };
    expect(invalidErrors(duplicate).join("\n")).toContain(
      "file identities are duplicated"
    );
  });

  it("rejects an import socket attempt even under a claimed pass", () => {
    const values = components();
    values[4] = { ...importSummary(), connectionAttempted: true };
    expect(invalidErrors(values).join("\n")).toContain(
      "import pass contradicts safety fields"
    );
  });

  it("requires completed placeholder validation and socket guard", () => {
    for (const change of [
      { placeholderValidationPassed: false },
      { socketGuardCompleted: false },
    ]) {
      const values = components();
      values[4] = { ...importSummary(), ...change };
      expect(invalidErrors(values).join("\n")).toContain(
        "import pass contradicts safety fields"
      );
    }
  });
});

describe("reporter path normalization", () => {
  it("normalizes absolute and platform-relative reporter paths to trainer-app identity", () => {
    const root = process.platform === "win32" ? "C:\\repo\\trainer-app" : "/repo/trainer-app";
    const absolute =
      process.platform === "win32"
        ? "C:\\repo\\trainer-app\\src\\a.test.ts"
        : "/repo/trainer-app/src/a.test.ts";
    expect(normalizeExecutedReporterFile(root, absolute)).toBe("src/a.test.ts");
    expect(normalizeExecutedReporterFile(root, "src/b.test.ts")).toBe(
      "src/b.test.ts"
    );
  });

  it("rejects paths outside the project and duplicates after normalization", () => {
    const root = process.platform === "win32" ? "C:\\repo\\trainer-app" : "/repo/trainer-app";
    expect(() => normalizeExecutedReporterFile(root, "../outside.test.ts")).toThrow(
      /outside trainer-app/
    );
    expect(() =>
      normalizeExecutedReporterFiles(root, ["src/a.test.ts", "src/./a.test.ts"])
    ).toThrow(/duplicates/);
  });
});

describe("native Vitest shard arguments", () => {
  it("excludes classified files before applying native 1/4 sharding", () => {
    expect(
      buildCredentialFreeShardVitestArgs({
        excludedFiles: [importFiles[0], databaseFiles[0]],
        shardIndex: 1,
        shardCount: 4,
      })
    ).toEqual([
      "--exclude",
      importFiles[0],
      "--exclude",
      databaseFiles[0],
      "--maxWorkers",
      "1",
      "--pool=forks",
      "--isolate",
      "--shard=1/4",
    ]);
  });

  it("keeps import safety explicit, unsharded, and single-worker", () => {
    expect(buildImportSafetyVitestArgs(importFiles)).toEqual([
      importFiles[0],
      "--maxWorkers",
      "1",
      "--pool=forks",
      "--isolate",
    ]);
  });

  it("rejects any topology other than the fixed four shards", () => {
    expect(() =>
      buildCredentialFreeShardVitestArgs({
        excludedFiles: [],
        shardIndex: 1,
        shardCount: 5,
      })
    ).toThrow(/identity is invalid/);
  });
});
