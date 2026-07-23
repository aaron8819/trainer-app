import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
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
  inspectDependencyFilesystem,
  inspectPrismaClientFilesystem,
  isDependencyLinkAllowed,
  normalizePrismaSchema,
  parseExactDisposableConfirmationArgs,
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

  it.each([
    "?host=remote.example.com",
    "?hostaddr=8.8.8.8",
    "?port=6543",
    "?database=other_db",
    "?dbname=other_db",
    "?service=remote",
    "?servicefile=remote.conf",
    "?sslhost=remote.example.com",
    "?HoSt=remote.example.com",
    "?%68ost=remote.example.com",
    "?host=localhost&host=remote.example.com",
    "?unknown=value",
  ])("rejects routing, duplicate, encoded, or unknown query parameters: %s", (query) => {
    expect(
      classifyDatabaseTarget(`postgresql://trainer:secret@localhost/trainer${query}`)
    ).toBe("invalid");
  });

  it.each([
    "?schema=fixture",
    "?application_name=trainer_test",
    "?connect_timeout=5&pool_timeout=10",
  ])("allows a documented non-routing query parameter set: %s", (query) => {
    expect(
      classifyDatabaseTarget(`postgresql://trainer:secret@localhost/trainer${query}`)
    ).toBe("local-loopback");
  });

  it("rejects multiple raw authority separators", () => {
    expect(
      classifyDatabaseTarget(
        "postgresql://trainer:secret@attacker@localhost/trainer"
      )
    ).toBe("invalid");
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
      TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
      NODE_ENV: "test" as const,
    });

    for (const name of DATABASE_TARGET_ENV_VARS) expect(sanitized[name]).toBeUndefined();
    expect(sanitized.NODE_ENV).toBe("test");
    expect(sanitized.TRAINER_DISPOSABLE_DB_CONFIRMED).toBeUndefined();
  });

  it("strips every casing variant and duplicate from a real child process", () => {
    const sanitized = sanitizeDatabaseTargetEnvironment({
      database_url: "lower",
      Database_Url: "mixed",
      test_database_url: "test-lower",
      Direct_Url: "direct-mixed",
      shadow_database_url: "shadow-lower",
      Shadow_Url: "shadow-mixed",
      trainer_disposable_db_confirmed: "1",
      TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
      TRAINER_UNRELATED_VALUE: "preserved",
      NODE_ENV: "test" as const,
    });
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "const forbidden=new Set([",
          '"DATABASE_URL","TEST_DATABASE_URL","DIRECT_URL","SHADOW_DATABASE_URL","SHADOW_URL","TRAINER_DISPOSABLE_DB_CONFIRMED"',
          "]);",
          "const leaked=Object.keys(process.env).filter((key)=>forbidden.has(key.toUpperCase()));",
          "console.log(JSON.stringify({leaked,preserved:process.env.TRAINER_UNRELATED_VALUE}));",
        ].join(""),
      ],
      { env: sanitized, encoding: "utf8" }
    );

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      leaked: [],
      preserved: "preserved",
    });
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

  it("rejects matching URLs that contain the same unsafe routing override", () => {
    const unsafe =
      "postgresql://trainer:secret@localhost/trainer?host=remote.example.com";
    expect(
      validateDisposableDatabaseTargets({
        confirmed: true,
        environment: { DATABASE_URL: unsafe, TEST_DATABASE_URL: unsafe },
      }).valid
    ).toBe(false);
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

  it("accepts only the exact documented mutation confirmation argument", () => {
    expect(parseExactDisposableConfirmationArgs(["--confirm-disposable"])).toEqual({
      valid: true,
    });
    expect(
      parseExactDisposableConfirmationArgs(
        [],
        "npm run test:db:rollout-tooling -- --confirm-disposable"
      )
    ).toEqual({
      valid: false,
      message:
        "Invalid invocation. Expected exactly one argument: --confirm-disposable. Run: npm run test:db:rollout-tooling -- --confirm-disposable",
    });
    for (const args of [
      [],
      ["--confirm-disposable", "--extra"],
      ["--confirm-disposable", "--confirm-disposable"],
      ["--confirm_disposable"],
      ["confirm-disposable"],
      ["prefix--confirm-disposable"],
    ]) {
      expect(parseExactDisposableConfirmationArgs(args).valid).toBe(false);
    }
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

  function createDependencyProject(
    fixtureRoot: string,
    name: string,
    lock = "exact"
  ): { worktreeRoot: string; projectRoot: string; nodeModules: string } {
    const worktreeRoot = join(fixtureRoot, name);
    const projectRoot = join(worktreeRoot, "trainer-app");
    const nodeModules = join(projectRoot, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(projectRoot, "package-lock.json"), lock);
    writeFileSync(join(projectRoot, "package.json"), '{"scripts":{}}');
    return { worktreeRoot, projectRoot, nodeModules };
  }

  function linkDirectory(target: string, linkPath: string): void {
    symlinkSync(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir"
    );
  }

  it("inspects standalone and approved exact-lock linked installations at the resolved root", () => {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-dependency-links-"));
    temporaryDirectories.push(fixture);
    const standalone = createDependencyProject(fixture, "standalone");
    const validatedRoots: string[] = [];
    const standaloneResult = inspectDependencyFilesystem({
      currentProjectRoot: standalone.projectRoot,
      registeredWorktreeRoots: [standalone.worktreeRoot],
      platform: process.platform,
      validateInstallation: (root) => {
        validatedRoots.push(root);
        return true;
      },
    });
    expect(standaloneResult).toMatchObject({
      installation: "available",
      arrangement: "standalone",
      linkAllowed: true,
    });
    expect(validatedRoots).toEqual([standalone.projectRoot]);

    const registered = createDependencyProject(fixture, "registered");
    const linked = createDependencyProject(fixture, "linked");
    rmSync(linked.nodeModules, { recursive: true });
    linkDirectory(registered.nodeModules, linked.nodeModules);
    validatedRoots.length = 0;
    const linkedResult = inspectDependencyFilesystem({
      currentProjectRoot: linked.projectRoot,
      registeredWorktreeRoots: [registered.worktreeRoot, linked.worktreeRoot],
      platform: process.platform,
      validateInstallation: (root) => {
        validatedRoots.push(root);
        return true;
      },
    });
    expect(linkedResult).toMatchObject({
      installation: "available",
      arrangement: process.platform === "win32" ? "junction" : "symlink",
      linkAllowed: true,
      dependencyProjectRoot: registered.projectRoot,
    });
    expect(validatedRoots).toEqual([registered.projectRoot]);
    expect(
      inspectDependencyFilesystem({
        currentProjectRoot: linked.projectRoot,
        registeredWorktreeRoots: [registered.worktreeRoot, linked.worktreeRoot],
        platform: "linux",
        validateInstallation: () => true,
      })
    ).toMatchObject({
      installation: "available",
      arrangement: "symlink",
      linkAllowed: true,
    });
  });

  it("rejects lock-mismatched and chained-outside-policy links", () => {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-dependency-reject-"));
    temporaryDirectories.push(fixture);
    const registered = createDependencyProject(fixture, "registered");
    const mismatched = createDependencyProject(fixture, "mismatched", "different");
    rmSync(mismatched.nodeModules, { recursive: true });
    linkDirectory(registered.nodeModules, mismatched.nodeModules);
    expect(
      inspectDependencyFilesystem({
        currentProjectRoot: mismatched.projectRoot,
        registeredWorktreeRoots: [registered.worktreeRoot],
        platform: process.platform,
        validateInstallation: () => true,
      })
    ).toMatchObject({ installation: "invalid", linkAllowed: false });

    const external = createDependencyProject(fixture, "external");
    const chainedTarget = createDependencyProject(fixture, "chained-target");
    rmSync(chainedTarget.nodeModules, { recursive: true });
    linkDirectory(external.nodeModules, chainedTarget.nodeModules);
    const chainedCurrent = createDependencyProject(fixture, "chained-current");
    rmSync(chainedCurrent.nodeModules, { recursive: true });
    linkDirectory(chainedTarget.nodeModules, chainedCurrent.nodeModules);
    expect(
      inspectDependencyFilesystem({
        currentProjectRoot: chainedCurrent.projectRoot,
        registeredWorktreeRoots: [chainedTarget.worktreeRoot],
        platform: process.platform,
        validateInstallation: () => true,
      })
    ).toMatchObject({ installation: "invalid", linkAllowed: false });
  });

  it("distinguishes missing dependencies/packages/client, stale client, and compatibility", () => {
    const compatible = {
      dependenciesAvailable: true,
      prismaPackageAvailable: true,
      prismaClientPackageAvailable: true,
      prismaPackageMetadataValid: true,
      prismaClientPackageMetadataValid: true,
      generatedClientDirectoryAvailable: true,
      generatedPackageMetadataValid: true,
      requiredGeneratedArtifactsAvailable: true,
      clientForwardersAvailable: true,
      importProbeSucceeded: true,
      expectedModelMetadataAvailable: true,
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
      ...compatible, generatedClientDirectoryAvailable: false,
    })).toBe("generated-client-missing");
    expect(classifyPrismaReadiness({
      ...compatible, requiredGeneratedArtifactsAvailable: false,
    })).toBe("generated-client-partial-or-corrupt");
    expect(classifyPrismaReadiness({
      ...compatible, importProbeSucceeded: false,
    })).toBe("generated-client-partial-or-corrupt");
    expect(classifyPrismaReadiness({
      ...compatible, generatedSchema: "model Workout { id String @id }",
    })).toBe("generated-client-stale");
    expect(classifyPrismaReadiness(compatible)).toBe("compatible");
    expect(normalizePrismaSchema(compatible.checkedInSchema)).toBe(
      normalizePrismaSchema(compatible.generatedSchema)
    );
  });

  function createPrismaFilesystemFixture(): {
    root: string;
    dependencyRoot: string;
    generatedRoot: string;
  } {
    const root = mkdtempSync(join(tmpdir(), "trainer-prisma-readiness-"));
    temporaryDirectories.push(root);
    const dependencyRoot = join(root, "node_modules");
    const generatedRoot = join(dependencyRoot, ".prisma", "client");
    const files: Record<string, string> = {
      [join(root, "prisma", "schema.prisma")]: "model User { id String @id }",
      [join(dependencyRoot, "prisma", "package.json")]:
        '{"name":"prisma","version":"7.3.0"}',
      [join(dependencyRoot, "@prisma", "client", "package.json")]:
        '{"name":"@prisma/client","version":"7.3.0"}',
      [join(dependencyRoot, "@prisma", "client", "default.js")]: "module.exports={};",
      [join(dependencyRoot, "@prisma", "client", "default.d.ts")]: "export {};",
      [join(dependencyRoot, "@prisma", "client", "runtime", "client.js")]:
        "module.exports={};",
      [join(dependencyRoot, "@prisma", "client", "runtime", "client.mjs")]:
        "export {};",
      [join(dependencyRoot, "@prisma", "client", "runtime", "client.d.ts")]:
        "export {};",
      [join(generatedRoot, "default.js")]: "module.exports={};",
      [join(generatedRoot, "default.d.ts")]: "export {};",
      [join(generatedRoot, "index.js")]: "module.exports={};",
      [join(generatedRoot, "index.d.ts")]: "export {};",
      [join(generatedRoot, "package.json")]:
        '{"main":"index.js","types":"index.d.ts"}',
      [join(generatedRoot, "query_compiler_fast_bg.js")]: "module.exports={};",
      [join(generatedRoot, "query_compiler_fast_bg.wasm")]: "fixture",
      [join(generatedRoot, "query_compiler_fast_bg.wasm-base64.js")]:
        "module.exports={};",
      [join(generatedRoot, "schema.prisma")]: "model User { id String @id }",
    };
    for (const [filePath, source] of Object.entries(files)) {
      mkdirSync(resolve(filePath, ".."), { recursive: true });
      writeFileSync(filePath, source);
    }
    return { root, dependencyRoot, generatedRoot };
  }

  it("classifies complete, missing, partial, corrupt, and stale filesystem fixtures", () => {
    const fixture = createPrismaFilesystemFixture();
    const inspect = (overrides: {
      importProbeSucceeded?: boolean;
      expectedModelMetadataAvailable?: boolean;
    } = {}) =>
      inspectPrismaClientFilesystem({
        checkedInSchemaPath: join(fixture.root, "prisma", "schema.prisma"),
        dependencyRoot: fixture.dependencyRoot,
        dependenciesAvailable: true,
        importProbeSucceeded: overrides.importProbeSucceeded ?? true,
        expectedModelMetadataAvailable:
          overrides.expectedModelMetadataAvailable ?? true,
      });

    expect(inspect()).toBe("compatible");
    unlinkSync(join(fixture.generatedRoot, "index.js"));
    expect(inspect()).toBe("generated-client-partial-or-corrupt");
    writeFileSync(join(fixture.generatedRoot, "index.js"), "module.exports={};");
    unlinkSync(join(fixture.generatedRoot, "index.d.ts"));
    expect(inspect()).toBe("generated-client-partial-or-corrupt");
    writeFileSync(join(fixture.generatedRoot, "index.d.ts"), "export {};");
    writeFileSync(join(fixture.generatedRoot, "package.json"), "{malformed");
    expect(inspect()).toBe("generated-client-partial-or-corrupt");
    writeFileSync(
      join(fixture.generatedRoot, "package.json"),
      '{"main":"index.js","types":"index.d.ts"}'
    );
    unlinkSync(join(fixture.generatedRoot, "query_compiler_fast_bg.wasm"));
    expect(inspect()).toBe("generated-client-partial-or-corrupt");
    writeFileSync(join(fixture.generatedRoot, "query_compiler_fast_bg.wasm"), "fixture");
    unlinkSync(join(fixture.generatedRoot, "default.js"));
    expect(inspect()).toBe("generated-client-partial-or-corrupt");
    writeFileSync(join(fixture.generatedRoot, "default.js"), "module.exports={};");
    writeFileSync(
      join(fixture.generatedRoot, "schema.prisma"),
      "model Workout { id String @id }"
    );
    expect(inspect()).toBe("generated-client-stale");
    writeFileSync(
      join(fixture.generatedRoot, "schema.prisma"),
      "model User { id String @id }"
    );
    expect(inspect({ importProbeSucceeded: false })).toBe(
      "generated-client-partial-or-corrupt"
    );
    expect(inspect({ expectedModelMetadataAvailable: false })).toBe(
      "generated-client-partial-or-corrupt"
    );
  });

  it("non-connectingly imports the installed generated client and reads model metadata", () => {
    const generatedIndex = resolve("node_modules/.prisma/client/index.js");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "const client=require(process.argv[1]);",
          "const models=client.Prisma?.dmmf?.datamodel?.models;",
          'if(typeof client.PrismaClient!=="function"||!Array.isArray(models)||models.length===0)process.exit(1);',
        ].join(""),
        generatedIndex,
      ],
      {
        env: sanitizeDatabaseTargetEnvironment(process.env),
        encoding: "utf8",
      }
    );
    expect(child.status).toBe(0);
  });
});

describe("dependency-free launcher", () => {
  const launcher = resolve("scripts/test-environment-preflight.mjs");

  function createLauncherFixture(input: {
    packageSource?: string | null;
    lockfile?: boolean;
    nodeModules?: boolean;
    typedRunner?: boolean;
    tsxLauncherSource?: string | null;
  }): string {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-preflight-launcher-"));
    temporaryDirectories.push(fixture);
    if (input.packageSource !== null) {
      writeFileSync(
        join(fixture, "package.json"),
        input.packageSource ?? '{"scripts":{}}'
      );
    }
    if (input.lockfile !== false) {
      writeFileSync(join(fixture, "package-lock.json"), "{}");
    }
    if (input.typedRunner !== false) {
      mkdirSync(join(fixture, "scripts"), { recursive: true });
      writeFileSync(
        join(fixture, "scripts", "test-environment-preflight.ts"),
        "export {};"
      );
    }
    if (input.nodeModules) {
      mkdirSync(join(fixture, "node_modules"), { recursive: true });
    }
    if (input.tsxLauncherSource !== null) {
      const tsxLauncher = join(
        fixture,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs"
      );
      mkdirSync(resolve(tsxLauncher, ".."), { recursive: true });
      writeFileSync(
        tsxLauncher,
        input.tsxLauncherSource ??
          'console.log("Trainer test environment preflight");'
      );
    }
    return fixture;
  }

  it("returns blocker exit 1 when node_modules is absent", () => {
    const fixture = createLauncherFixture({ tsxLauncherSource: null });
    const result = spawnSync(process.execPath, [launcher, "--json"], {
      cwd: fixture,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"code": "dependencies-missing"');
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

  it.each([
    [{ packageSource: null }, 1, "package-metadata-missing"],
    [{ packageSource: "{malformed" }, 2, "package-metadata-malformed"],
    [{ lockfile: false }, 1, "lockfile-missing"],
    [{ typedRunner: false }, 1, "typed-runner-missing"],
    [{ tsxLauncherSource: null }, 1, "dependencies-missing"],
    [
      { nodeModules: true, tsxLauncherSource: null },
      1,
      "tsx-launcher-missing",
    ],
  ] as const)(
    "classifies missing or malformed launcher fixture state",
    (fixtureInput, expectedExit, expectedCode) => {
      const fixture = createLauncherFixture(fixtureInput);
      const result = spawnSync(process.execPath, [launcher, "--json"], {
        cwd: fixture,
        encoding: "utf8",
      });
      expect(result.status).toBe(expectedExit);
      expect(result.stdout).toContain(`"code": "${expectedCode}"`);
      expect(result.stderr).not.toContain("Error:");
    }
  );

  it("suppresses raw loader failures and reports a stable blocker", () => {
    const fixture = createLauncherFixture({
      tsxLauncherSource:
        'console.error("Error: loader stack with secret-value"); process.exit(1);',
    });
    const result = spawnSync(process.execPath, [launcher], {
      cwd: fixture,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("typed-runner-loader-failed");
    expect(result.stderr).not.toContain("secret-value");
  });

  it.skipIf(process.platform === "win32")(
    "classifies signal termination without exposing a stack",
    () => {
    const fixture = createLauncherFixture({
      tsxLauncherSource: 'process.kill(process.pid, "SIGTERM");',
    });
    const result = spawnSync(process.execPath, [launcher], {
      cwd: fixture,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("typed-runner-terminated");
    }
  );
});

describe("credential-free and mutation subprocess boundaries", () => {
  const vitestCli = resolve("node_modules/vitest/vitest.mjs");
  const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
  const npmCli = process.env.npm_execpath;

  function runMutationPackageCommand(
    packageScript: string,
    args: string[],
    additions: Record<string, string | undefined> = {}
  ) {
    if (!npmCli) throw new Error("NPM_EXECUTABLE_PATH_UNAVAILABLE");
    const fixture = mkdtempSync(join(tmpdir(), "trainer-mutation-guard-"));
    temporaryDirectories.push(fixture);
    const pgMarker = join(fixture, "pg-loaded");
    const dockerMarker = join(fixture, "docker-called");
    const hook = join(fixture, "guard-hook.cjs");
    writeFileSync(
      hook,
      [
        'const { writeFileSync } = require("node:fs");',
        'const Module = require("node:module");',
        'const childProcess = require("node:child_process");',
        "const originalLoad = Module._load;",
        "Module._load = function(request, parent, isMain) {",
        '  if (request === "pg") {',
        '    writeFileSync(process.env.MUTATION_PG_LOAD_MARKER, "loaded");',
        '    throw new Error("PG_IMPORT_BLOCKED_BY_TEST");',
        "  }",
        "  return originalLoad.call(this, request, parent, isMain);",
        "};",
        "const originalSpawnSync = childProcess.spawnSync;",
        "childProcess.spawnSync = function(executable, childArgs, options) {",
        '  if (String(executable).toLowerCase() === "docker" || String(executable).toLowerCase().endsWith("docker.exe")) {',
        '    writeFileSync(process.env.MUTATION_DOCKER_CALL_MARKER, "called");',
        '    throw new Error("DOCKER_CALL_BLOCKED_BY_TEST");',
        "  }",
        "  return originalSpawnSync.call(this, executable, childArgs, options);",
        "};",
      ].join("\n")
    );
    const result = spawnSync(
      process.execPath,
      [
        npmCli,
        "run",
        packageScript,
        ...(args.length > 0 ? ["--", ...args] : []),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...sanitizeDatabaseTargetEnvironment(process.env),
          ...additions,
          NODE_OPTIONS: `--require=${hook.replaceAll("\\", "/")}`,
          MUTATION_PG_LOAD_MARKER: pgMarker,
          MUTATION_DOCKER_CALL_MARKER: dockerMarker,
        },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    return {
      result,
      output: `${result.stdout}\n${result.stderr}`,
      pgLoaded: existsSync(pgMarker),
      dockerCalled: existsSync(dockerMarker),
    };
  }

  function runReadinessPackageCommand(
    args: string[],
    additions: Record<string, string | undefined> = {}
  ) {
    return runMutationPackageCommand(
      "test:db:readiness-snapshots",
      args,
      additions
    );
  }

  function runVitestCollection(
    testFile: string,
    additions: Record<string, string | undefined> = {}
  ) {
    return spawnSync(process.execPath, [vitestCli, "run", testFile], {
      cwd: process.cwd(),
      env: {
        ...sanitizeDatabaseTargetEnvironment(process.env),
        ...additions,
        NODE_ENV: "test",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
  }

  it("does not repopulate DB targets from a temporary dotenv file", () => {
    const fixture = mkdtempSync(join(tmpdir(), "trainer-dotenv-boundary-"));
    temporaryDirectories.push(fixture);
    const testFile = join(fixture, "src", "credential-free.test.ts");
    mkdirSync(resolve(testFile, ".."), { recursive: true });
    writeFileSync(
      join(fixture, ".env"),
      [
        "DATABASE_URL=postgresql://trainer:secret@remote.example.com/trainer",
        "TEST_DATABASE_URL=postgresql://trainer:secret@remote.example.com/trainer",
        "TRAINER_DISPOSABLE_DB_CONFIRMED=1",
      ].join("\n")
    );
    writeFileSync(join(fixture, "vitest.setup.ts"), "");
    writeFileSync(
      testFile,
      [
        'import { expect, it } from "vitest";',
        'it("stays credential free", () => {',
        'expect(process.env.DATABASE_URL).toBeUndefined();',
        'expect(process.env.TEST_DATABASE_URL).toBeUndefined();',
        'expect(process.env.TRAINER_DISPOSABLE_DB_CONFIRMED).toBeUndefined();',
        "});",
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
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 30_000);

  it("classifies workout mutation collection with no target before importing Prisma", () => {
    const result = runVitestCollection(
      "src/lib/api/workout-mutation.db.test.ts"
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "DATABASE_TEST_TARGET_NOT_CONFIGURED"
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      "Missing DATABASE_URL"
    );
  }, 30_000);

  it("safely skips persistence collection with no target before importing Prisma", () => {
    const result = runVitestCollection(
      "src/lib/api/save-workout/persistence.db.test.ts"
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("Missing DATABASE_URL");
  }, 30_000);

  it.each([
    {
      label: "remote target",
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@remote.example.com/trainer",
        TEST_DATABASE_URL: "postgresql://trainer:secret@remote.example.com/trainer",
        TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
      },
    },
    {
      label: "local target without confirmation",
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
        TEST_DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
      },
    },
    {
      label: "inherited confirmation removed",
      environment: {
        DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
        TEST_DATABASE_URL: "postgresql://trainer:secret@localhost/trainer",
        trainer_disposable_db_confirmed: "1",
      },
      sanitizeAgain: true,
    },
  ])("blocks direct mutation collection for $label before Prisma import", (fixture) => {
    const environment = fixture.sanitizeAgain
      ? {
          ...sanitizeDatabaseTargetEnvironment({
            ...process.env,
            trainer_disposable_db_confirmed: "1",
          }),
          DATABASE_URL: fixture.environment.DATABASE_URL,
          TEST_DATABASE_URL: fixture.environment.TEST_DATABASE_URL,
        }
      : { ...fixture.environment };
    const result = runVitestCollection(
      "src/lib/api/workout-mutation.db.test.ts",
      environment
    );
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("DATABASE_TEST_TARGET_BLOCKED");
    expect(output).not.toContain("Missing DATABASE_URL");
    expect(output).not.toContain("secret");
  }, 30_000);

  it.each([
    "scripts/test-workout-mutations-postgres.ts",
    "scripts/test-readiness-snapshot-postgres.ts",
    "scripts/verify-seed-revision-concurrency.ts",
  ])("rejects missing and extra mutation arguments before side effects: %s", (script) => {
    for (const args of [
      [],
      ["--confirm-disposable", "--extra"],
      ["--confirm-disposable", "--confirm-disposable"],
      ["--confirm_disposable"],
      ["positional"],
      ["--extra", "--confirm-disposable"],
      ["--confirm-disposable=1"],
      ["prefix--confirm-disposable"],
    ]) {
      const result = spawnSync(process.execPath, [tsxCli, script, ...args], {
        cwd: process.cwd(),
        env: sanitizeDatabaseTargetEnvironment(process.env),
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(
        result.status,
        `${script} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`
      ).toBe(2);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "Expected exactly one argument"
      );
    }
  }, 30_000);

  it("rejects the readiness package command without confirmation before pg or Docker", () => {
    const result = runReadinessPackageCommand([]);

    expect(result.result.status, result.output).toBe(2);
    expect(result.output).toContain(
      "npm run test:db:readiness-snapshots -- --confirm-disposable"
    );
    expect(result.pgLoaded).toBe(false);
    expect(result.dockerCalled).toBe(false);
  }, 30_000);

  it("loads pg only after valid readiness confirmation and before Docker", () => {
    const result = runReadinessPackageCommand(["--confirm-disposable"]);

    expect(result.result.status, result.output).toBe(1);
    expect(result.output).toContain("READINESS_SNAPSHOT_POSTGRES_FAILED");
    expect(result.pgLoaded).toBe(true);
    expect(result.dockerCalled).toBe(false);
  }, 30_000);

  it.each([
    ["duplicate confirmation", ["--confirm-disposable", "--confirm-disposable"]],
    ["extra flag", ["--confirm-disposable", "--extra"]],
    ["reordered extra flag", ["--extra", "--confirm-disposable"]],
    ["positional argument", ["positional"]],
    ["misspelling", ["--confirm_disposable"]],
    ["embedded substring", ["prefix--confirm-disposable"]],
    ["malformed value", ["--confirm-disposable=1"]],
  ])("rejects readiness package %s before pg or Docker", (_label, args) => {
    const result = runReadinessPackageCommand(args);

    expect(result.result.status, result.output).toBe(2);
    expect(result.output).toContain("Expected exactly one argument");
    expect(result.pgLoaded).toBe(false);
    expect(result.dockerCalled).toBe(false);
  }, 30_000);

  it("reaches Docker only after exact rollout confirmation", () => {
    const result = runMutationPackageCommand(
      "test:db:rollout-tooling",
      ["--confirm-disposable"]
    );

    expect(result.result.status, result.output).toBe(1);
    expect(result.pgLoaded).toBe(false);
    expect(result.dockerCalled).toBe(true);
  }, 30_000);

  it.each([
    ["no confirmation", []],
    ["duplicate confirmation", ["--confirm-disposable", "--confirm-disposable"]],
    ["extra flag", ["--confirm-disposable", "--extra"]],
    ["flag before confirmation", ["--extra", "--confirm-disposable"]],
    ["positional argument", ["positional"]],
    ["misspelling", ["--confirm_disposable"]],
    ["embedded substring", ["prefix--confirm-disposable"]],
    ["malformed argument", ["--confirm-disposable=1"]],
  ])("rejects rollout package %s before pg or Docker", (_label, args) => {
    const result = runMutationPackageCommand(
      "test:db:rollout-tooling",
      args
    );

    expect(result.result.status, result.output).toBe(2);
    expect(result.output).toContain(
      "npm run test:db:rollout-tooling -- --confirm-disposable"
    );
    expect(result.pgLoaded).toBe(false);
    expect(result.dockerCalled).toBe(false);
  }, 30_000);

  it("rejects an unsafe inherited readiness target before pg or Docker", () => {
    const result = runReadinessPackageCommand(
      ["--confirm-disposable"],
      {
        DATABASE_URL:
          "postgresql://trainer:secret@remote.example.test/trainer",
      }
    );

    expect(result.result.status, result.output).toBe(1);
    expect(result.output).toContain("READINESS_DB_TEST_TARGET_INVALID");
    expect(result.output).not.toContain("secret");
    expect(result.pgLoaded).toBe(false);
    expect(result.dockerCalled).toBe(false);
  }, 30_000);
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
  it("keeps operator confirmation out of package and registry command strings", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const policy = JSON.parse(
      readFileSync(
        resolve("..", "scripts", "codex", "trainer-policy.v1.json"),
        "utf8"
      )
    ) as {
      commandRegistry: Array<{
        packageScript?: string;
        command: string;
        entrypoint?: string | null;
        profile: string;
      }>;
    };
    const registryByPackageScript = new Map(
      policy.commandRegistry
        .filter((entry) => entry.packageScript)
        .map((entry) => [entry.packageScript!, entry])
    );
    const mutatingProfiles = new Set([
      "disposable-database-write",
      "production-write",
    ]);

    for (const [name, command] of Object.entries(packageJson.scripts)) {
      expect(command, `package script ${name} must not self-confirm`).not.toContain(
        "--confirm-disposable"
      );
      for (const match of command.matchAll(/\bnpm run ([\w:-]+)/g)) {
        const child = registryByPackageScript.get(match[1]);
        const parent = registryByPackageScript.get(name);
        if (child && mutatingProfiles.has(child.profile)) {
          expect(
            mutatingProfiles.has(parent?.profile ?? ""),
            `${name} must not disguise mutating child ${match[1]}`
          ).toBe(true);
        }
      }
    }
    for (const entry of policy.commandRegistry) {
      expect(
        entry.command,
        `registry command ${entry.packageScript ?? entry.command} must not self-confirm`
      ).not.toContain("--confirm-disposable");
    }

    const exactConfirmationEntrypoints = new Set([
      "trainer-app/scripts/test-workout-mutations-postgres.ts",
      "trainer-app/scripts/test-rollout-tooling-postgres.ts",
      "trainer-app/scripts/test-readiness-snapshot-postgres.ts",
      "trainer-app/scripts/verify-seed-revision-concurrency.ts",
    ]);
    const approvedGuardFirstPackageScripts = new Set([
      "test",
      "test:readiness-integrity",
      "test:migration-integrity",
      "test:watch",
    ]);
    const approvedAliases = new Map([
      ["test:db:historical-snapshots", "npm run test:db:workout-mutations"],
    ]);
    const disposableEntries = policy.commandRegistry.filter(
      (entry) => entry.profile === "disposable-database-write"
    );

    for (const entry of disposableEntries) {
      const packageScript = entry.packageScript ?? "";
      if (entry.entrypoint && exactConfirmationEntrypoints.has(entry.entrypoint)) {
        const source = readFileSync(
          resolve(entry.entrypoint.replace(/^trainer-app\//, "")),
          "utf8"
        );
        expect(
          source,
          `${packageScript} must use the canonical exact-confirmation parser`
        ).toMatch(
          /parseExactDisposableConfirmationArgs\s*\(\s*process\.argv\.slice\(2\)/
        );
        expect(
          source,
          `${packageScript} must not use a permissive confirmation check`
        ).not.toMatch(
          /(?:includes|indexOf|find|some)\s*\(\s*["'`]--confirm-disposable/
        );
        continue;
      }

      const approvedAlias = approvedAliases.get(packageScript);
      if (approvedAlias) {
        expect(packageJson.scripts[packageScript]).toBe(approvedAlias);
        continue;
      }

      expect(
        approvedGuardFirstPackageScripts.has(packageScript),
        `${packageScript || entry.command} must use an approved mutation guard route`
      ).toBe(true);
    }
  });

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
