import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTestEnvironmentPreflight,
  classifyDatabaseTarget,
  classifyDependencyArrangement,
  classifyPrismaReadiness,
  DATABASE_TARGET_ENV_VARS,
  discoverDatabaseTargetVariableReferences,
  isDependencyLinkAllowed,
  normalizePrismaSchema,
  resolveDisposableDatabaseTestTarget,
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "./test-environment-preflight";

const READY_INPUT = {
  databaseTargets: {},
  dependencyInstallation: "available" as const,
  dependencyArrangement: "standalone" as const,
  dependencyLinkAllowed: true,
  prismaReadiness: "compatible" as const,
  docker: "available" as const,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("classifyDatabaseTarget", () => {
  it.each([
    ["postgres://user:secret@localhost/trainer", "local-loopback"],
    ["postgresql://user:secret@127.0.0.1:5432/trainer", "local-loopback"],
    ["postgresql://user:secret@[::1]:5432/trainer", "local-loopback"],
    ["", "missing"],
    ["   ", "missing"],
    ["https://localhost/trainer", "invalid"],
    ["localhost/trainer", "invalid"],
    ["postgresql://localhost:invalid/trainer", "invalid"],
    ["postgresql:///trainer", "invalid"],
    ["postgresql://localhost", "invalid"],
    ["postgresql://user:%ZZ@localhost/trainer", "invalid"],
    ["postgresql://user:secret@10.0.0.4/trainer", "prohibited"],
    ["postgresql://user:secret@host.docker.internal/trainer", "prohibited"],
    ["postgresql://user:secret@local.example.test/trainer", "prohibited"],
    ["postgresql://user:secret@aws-0-us.pooler.supabase.com/trainer", "prohibited"],
  ])("classifies a sanitized target case", (value, expected) => {
    expect(classifyDatabaseTarget(value)).toBe(expected);
  });

  it("never includes credentials in target classifications", () => {
    const secret = "encoded-secret-value";
    expect(JSON.stringify(classifyDatabaseTarget(
      `postgresql://user:${encodeURIComponent(secret)}@localhost/trainer`
    ))).not.toContain(secret);
  });
});

describe("database target policy", () => {
  it("strips every registered target and preserves unrelated environment values", () => {
    const sanitized = sanitizeDatabaseTargetEnvironment({
      DATABASE_URL: "remote-primary",
      TEST_DATABASE_URL: "remote-test",
      DIRECT_URL: "remote-direct",
      SHADOW_DATABASE_URL: "remote-shadow",
      SHADOW_URL: "remote-shadow-alias",
      NODE_ENV: "test",
    });

    for (const name of DATABASE_TARGET_ENV_VARS) expect(sanitized[name]).toBeUndefined();
    expect(sanitized.NODE_ENV).toBe("test");
  });

  it("requires confirmation and matching local primary/test targets", () => {
    const environment = {
      DATABASE_URL: "postgresql://trainer:secret@localhost:5432/trainer_test",
      TEST_DATABASE_URL: "postgresql://trainer:secret@127.0.0.1:5432/trainer_test",
    };

    expect(validateDisposableDatabaseTargets({ environment, confirmed: false }).valid).toBe(false);
    expect(validateDisposableDatabaseTargets({ environment, confirmed: true })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it("rejects a local primary plus remote secondary and a remote primary alone", () => {
    const mixed = validateDisposableDatabaseTargets({
      confirmed: true,
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
        TEST_DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
      },
    });
    const remoteOnly = validateDisposableDatabaseTargets({
      confirmed: true,
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
      },
    });

    expect(mixed.valid).toBe(false);
    expect(remoteOnly.valid).toBe(false);
    expect(JSON.stringify([mixed, remoteOnly])).not.toContain("secret");
  });

  it("rejects loopback URLs that select inconsistent database query targets", () => {
    const result = validateDisposableDatabaseTargets({
      confirmed: true,
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@localhost/trainer?schema=primary",
        TEST_DATABASE_URL: "postgresql://trainer:secret@localhost/trainer?schema=other",
      },
    });

    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("primary");
    expect(JSON.stringify(result)).not.toContain("other");
  });

  it("treats all absent targets as safe only for credential-free work", () => {
    expect(validateDisposableDatabaseTargets({ environment: {}, confirmed: true }).valid).toBe(false);
    const report = buildTestEnvironmentPreflight(READY_INPUT);
    expect(report.success).toBe(true);
    expect(report.groups.credentialFreeInventory.status).toBe("runnable");
    expect(Object.values(report.databaseTargets)).toEqual(
      expect.arrayContaining(["missing"])
    );
  });

  it("fails DB-test collection before mutation unless every target is valid and confirmed", () => {
    expect(() => resolveDisposableDatabaseTestTarget({
      DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
      TEST_DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
    })).toThrow("DATABASE_TEST_TARGET_BLOCKED");
    expect(() => resolveDisposableDatabaseTestTarget({
      DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
    })).toThrow("DATABASE_TEST_TARGET_BLOCKED");
    expect(resolveDisposableDatabaseTestTarget({})).toBeUndefined();
    expect(resolveDisposableDatabaseTestTarget({
      DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
      TEST_DATABASE_URL: "postgresql://trainer:secret@127.0.0.1/trainer",
      TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
    })).toBe("postgresql://trainer:secret@127.0.0.1/trainer");
  });
});

describe("dependency and Prisma readiness", () => {
  it("classifies standalone, Windows junction, Linux symlink, missing, and unresolved states", () => {
    expect(classifyDependencyArrangement({
      exists: true, resolved: true, isLink: false, platform: "win32",
    })).toBe("standalone");
    expect(classifyDependencyArrangement({
      exists: true, resolved: true, isLink: true, platform: "win32",
    })).toBe("junction");
    expect(classifyDependencyArrangement({
      exists: true, resolved: true, isLink: true, platform: "linux",
    })).toBe("symlink");
    expect(classifyDependencyArrangement({
      exists: false, resolved: false, isLink: false, platform: "linux",
    })).toBe("missing");
    expect(classifyDependencyArrangement({
      exists: true, resolved: false, isLink: true, platform: "linux",
    })).toBe("unresolved");
  });

  it("allows only registered exact-lock links", () => {
    const registered = new Set(["/worktree/trainer-app/node_modules"]);
    expect(isDependencyLinkAllowed({
      resolvedTarget: "/worktree/trainer-app/node_modules",
      registeredTargets: registered,
      currentLockHash: "exact",
      targetLockHash: "exact",
    })).toBe(true);
    expect(isDependencyLinkAllowed({
      resolvedTarget: "/worktree/trainer-app/node_modules",
      registeredTargets: registered,
      currentLockHash: "current",
      targetLockHash: "stale",
    })).toBe(false);
    expect(isDependencyLinkAllowed({
      resolvedTarget: "/external/node_modules",
      registeredTargets: registered,
      currentLockHash: "exact",
      targetLockHash: "exact",
    })).toBe(false);
  });

  it("distinguishes missing dependencies/packages/client, stale client, and compatibility", () => {
    const compatible = {
      dependenciesAvailable: true,
      prismaPackageAvailable: true,
      prismaClientPackageAvailable: true,
      generatedClientAvailable: true,
      checkedInSchema: "model User {\n id String @id // comment\n}",
      generatedSchema: "model User { id String @id }",
    };
    expect(classifyPrismaReadiness({
      ...compatible, dependenciesAvailable: false,
    })).toBe("dependencies-missing");
    expect(classifyPrismaReadiness({
      ...compatible, prismaPackageAvailable: false,
    })).toBe("packages-missing");
    expect(classifyPrismaReadiness({
      ...compatible, generatedClientAvailable: false,
    })).toBe("client-not-generated");
    expect(classifyPrismaReadiness({
      ...compatible, generatedSchema: "model Workout { id String @id }",
    })).toBe("generated-client-stale");
    expect(classifyPrismaReadiness(compatible)).toBe("compatible");
    expect(normalizePrismaSchema(compatible.checkedInSchema)).toBe(
      normalizePrismaSchema(compatible.generatedSchema)
    );
  });
});

describe("dependency-free launcher", () => {
  const launcher = resolve("scripts/test-environment-preflight.mjs");

  it("returns blocker exit 1 when node_modules is absent", () => {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-preflight-missing-"));
    temporaryDirectories.push(fixture);
    const result = spawnSync(process.execPath, [launcher, "--json"], {
      cwd: fixture,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"dependencyInstallation": "dependencies-missing"');
  });

  it("returns invalid-invocation exit 2 for unknown or conflicting flags", () => {
    const unknown = spawnSync(process.execPath, [launcher, "--unknown"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const conflicting = spawnSync(
      process.execPath,
      [launcher, "--json", "--run-verify-gate"],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(unknown.status).toBe(2);
    expect(conflicting.status).toBe(2);
  });
});

describe("database target inventory guard", () => {
  function filesBelow(root: string): string[] {
    if (!statSync(root).isDirectory()) return [root];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "node_modules") return [];
      const child = join(root, entry.name);
      return entry.isDirectory() ? filesBelow(child) : [child];
    });
  }

  it("registers every database-like target variable referenced by test workflow sources", () => {
    const roots = [
      resolve("src"),
      resolve("scripts"),
      resolve("prisma"),
      resolve("package.json"),
      resolve("vitest.config.ts"),
      resolve("vitest.setup.ts"),
      resolve("prisma.config.ts"),
    ];
    const extensions = /\.(?:ts|tsx|js|mjs|json|ps1)$/;
    const discovered = new Set<string>();
    for (const file of roots.flatMap(filesBelow).filter((file) => extensions.test(file))) {
      for (const name of discoverDatabaseTargetVariableReferences(
        readFileSync(file, "utf8")
      )) {
        discovered.add(name);
      }
    }

    expect([...discovered].filter(
      (name) => !DATABASE_TARGET_ENV_VARS.includes(
        name as (typeof DATABASE_TARGET_ENV_VARS)[number]
      )
    )).toEqual([]);
  });

  it("detects a newly referenced unregistered database target name", () => {
    const unregistered = ["ANALYTICS", "DB", "URL"].join("_");
    expect(discoverDatabaseTargetVariableReferences(
      `process.env.${unregistered}`
    )).toEqual([unregistered]);
  });
});

describe("buildTestEnvironmentPreflight", () => {
  it("accepts an approved exact-lock link and blocks an unapproved one", () => {
    const approved = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      dependencyArrangement: "junction",
    });
    const rejected = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      dependencyArrangement: "symlink",
      dependencyLinkAllowed: false,
    });

    expect(approved.success).toBe(true);
    expect(rejected.success).toBe(false);
    expect(rejected.blockers).toContain(
      "The dependency link is unresolved, policy-external, or lock-incompatible."
    );
  });

  it("reports configured targets without making credential-free commands inherit them", () => {
    const report = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      databaseTargets: {
        DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
        TEST_DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
      },
    });

    expect(report.databaseTargets).toMatchObject({
      DATABASE_URL: "local-loopback",
      TEST_DATABASE_URL: "prohibited",
    });
    expect(report.groups.credentialFreeInventory.status).toBe("runnable");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});

describe("command coverage honesty", () => {
  it("keeps package scripts and canonical docs aligned without comprehensive claims", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const docs = readFileSync(resolve("docs/06_TESTING.md"), "utf8");

    expect(packageJson.scripts).toMatchObject({
      "test:preflight": "node scripts/test-environment-preflight.mjs",
      "test:verify-gate": "node scripts/test-environment-preflight.mjs --run-verify-gate",
      "test:inventory:credential-free":
        "node scripts/test-environment-preflight.mjs --run-credential-free-inventory",
    });
    expect(packageJson.scripts).not.toHaveProperty("test:pure");
    expect(packageJson.scripts).not.toHaveProperty("test:full");
    for (const command of [
      "test:preflight",
      "test:verify-gate",
      "test:inventory:credential-free",
    ]) {
      expect(docs).toContain(`npm run ${command}`);
    }
    expect(docs).not.toContain("authoritative credential-free verification");
    expect(docs).toContain("not a comprehensive inventory");
  });
});
