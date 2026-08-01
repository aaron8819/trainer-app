import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIED_SCHEMA_EXPECTATIONS,
  BASELINE_UNIQUENESS_EXPECTATIONS,
  buildMigrationIntegrityReport,
  checksumMigrationSql,
  EXPECTED_GATE_A_PENDING,
  EXPECTED_MIGRATION_CHAIN,
  migrationChecksumMatches,
  MIGRATION_AUTHORIZATION_POLICY,
  PENDING_ARCHITECTURE_MANIFEST,
  prismaCompatibleMigrationSqlChecksums,
  type CatalogSnapshot,
  type CanonicalOperationalVerification,
  type CheckedInMigration,
  type LedgerRow,
  type LiveFinisherPrincipalVerification,
  type MigrationAuthorizationEvidence,
} from "./migration-integrity";
import {
  FINISHER_PRINCIPAL_CONTRACT,
  FINISHER_TARGET_MIGRATION,
  type FinisherPrincipalSnapshot,
} from "./finisher-principal-contract";
import {
  FINISHER_DISPOSABLE_WORKFLOW,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_PATH,
  FINISHER_PROVIDER_CONTRACT_VERSION,
  FINISHER_PROVIDER_EVIDENCE_SCHEMA,
  FINISHER_PROVIDER_EVIDENCE_VERSION,
  FINISHER_PROVIDER_TOOL_VERSION,
  migrationInventorySha256,
  type ProviderVerificationExpectation,
} from "./finisher-provider-verification";

const REPOSITORY_HEAD = "b".repeat(40);
const FUTURE_INTEGRATED_HEAD = "c".repeat(40);
const ARBITRARY_HEAD = "d".repeat(40);
const OLD_BASE_HEAD = "24e9e62f70a5cf66cef21997157f7b79a411a00f";
const EVALUATED_AT = "2026-07-26T18:00:00.000Z";
const VERIFIED_AT = "2026-07-26T17:50:00.000Z";
const TARGET_FINGERPRINT = "5952f3ffb454";
const PENDING_MANIFEST_INDEX = PENDING_ARCHITECTURE_MANIFEST.length - 1;

function checkedIn(): CheckedInMigration[] {
  return EXPECTED_MIGRATION_CHAIN.map((name) => ({
    name,
    checksum: checksumMigrationSql(Buffer.from(name)),
    sqlPath: `prisma/migrations/${name}/migration.sql`,
  }));
}

function successfulRow(migration: CheckedInMigration, index: number): LedgerRow {
  return {
    id: `ledger-${index}`,
    migrationName: migration.name,
    checksum: migration.checksum,
    finishedAt: "2026-07-01 00:00:00+00",
    rolledBackAt: null,
    logs: null,
    appliedStepsCount: 1,
  };
}

function appliedPrefix(count = EXPECTED_MIGRATION_CHAIN.length - 1): LedgerRow[] {
  return checkedIn().slice(0, count).map(successfulRow);
}

function addCompatibleManifestObject(
  catalog: CatalogSnapshot,
  migrationIndex: number,
  objectIndex: number,
): void {
  const object = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects[objectIndex];
  if (!object) return;
  if (object.kind === "table") catalog.tables.push(object.name);
  if (object.kind === "column") {
    catalog.columns.push({
      table: object.table!,
      name: object.name,
      ...object.column!,
    });
  }
  if (object.kind === "enum") {
    const finisherOwned =
      object.name.startsWith("Finisher") ||
      object.name.startsWith("WorkoutPhase");
    catalog.enums.push({
      name: object.name,
      values: [...(object.enum?.values ?? [])],
      ...(finisherOwned
        ? {
            owner: "trainer_finisher_owner",
            privileges: [
              {
                grantee: "trainer_app_runtime",
                grantor: "trainer_finisher_owner",
                privilege: "USAGE",
                grantable: false,
              },
            ],
          }
        : {}),
    });
  }
  if (object.kind === "index") {
    catalog.indexes.push({
      table: object.table!,
      name: object.name,
      ...object.index!,
      valid: true,
      ready: true,
      live: true,
    });
  }
  if (object.kind === "constraint") {
    catalog.constraints.push({
      table: object.table!,
      name: object.name,
      type: object.constraint?.type ?? "f",
      definition:
        object.constraint?.definition ??
        object.definitionIncludes?.join(" ") ??
        "",
    });
  }
  if (object.kind === "trigger") {
    catalog.triggers.push({
      table: object.table!,
      name: object.name,
      definition:
        object.trigger?.definition ??
        object.definitionIncludes?.join(" ") ??
        "",
      enabled: object.trigger?.enabled,
      functionName: object.trigger?.functionName,
      functionOwner: object.trigger?.functionOwner,
    });
  }
  if (object.kind === "function") {
    catalog.functions.push({
      name: object.name,
      definition: object.definitionIncludes?.join(" ") ?? "",
      ...object.function,
      body:
        object.function?.body ??
        object.function?.bodyIncludes?.join("\n") ??
        "",
      privileges:
        object.name === "cleanup_expired_finisher_execution_commands"
          ? [
              {
                grantee: "trainer_finisher_cleanup",
                grantor: "trainer_finisher_cleanup",
                privilege: "EXECUTE",
                grantable: false,
              },
              {
                grantee: "trainer_app_runtime",
                grantor: "trainer_finisher_cleanup",
                privilege: "EXECUTE",
                grantable: false,
              },
            ]
          : [
              {
                grantee: "trainer_finisher_owner",
                grantor: "trainer_finisher_owner",
                privilege: "EXECUTE",
                grantable: false,
              },
            ],
    });
  }
  if (object.kind === "catalogRow") {
    catalog.catalogRows.push({
      table: object.table!,
      key: object.name,
      values: structuredClone(object.row ?? {}),
    });
  }
}

function cleanCatalog(
  appliedCount = EXPECTED_MIGRATION_CHAIN.length - 1,
): CatalogSnapshot {
  const catalog: CatalogSnapshot = {
    tables: [], columns: [], enums: [], indexes: [], constraints: [], triggers: [], functions: [], catalogRows: [],
  };
  for (const expectation of APPLIED_SCHEMA_EXPECTATIONS) {
    if (expectation.kind === "table") catalog.tables.push(expectation.name);
    if (expectation.kind === "column") catalog.columns.push({ ...expectation });
    if (expectation.kind === "enum") catalog.enums.push({ name: expectation.name, values: [...expectation.values] });
    if (expectation.kind === "index") catalog.indexes.push({ ...expectation, columns: [...expectation.columns] });
    if (expectation.kind === "constraint") catalog.constraints.push({ ...expectation });
  }
  for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
    if (!catalog.tables.includes(expectation.table)) catalog.tables.push(expectation.table);
    catalog.indexes.push({
      table: expectation.table,
      name: expectation.name,
      unique: true,
      columns: [...expectation.columns],
      predicate: expectation.predicate,
      nullsNotDistinct: expectation.nullsNotDistinct,
      valid: true,
      ready: true,
      constraintName: null,
      constraintType: null,
    });
  }
  for (
    let migrationIndex = 0;
    migrationIndex < PENDING_ARCHITECTURE_MANIFEST.length;
    migrationIndex += 1
  ) {
    const migration = PENDING_ARCHITECTURE_MANIFEST[migrationIndex];
    const chainIndex = EXPECTED_MIGRATION_CHAIN.indexOf(
      migration.migration as (typeof EXPECTED_MIGRATION_CHAIN)[number],
    );
    if (chainIndex >= appliedCount) continue;
    for (
      let objectIndex = 0;
      objectIndex < migration.objects.length;
      objectIndex += 1
    ) {
      addCompatibleManifestObject(catalog, migrationIndex, objectIndex);
    }
  }
  if (catalog.tables.includes("FinisherExecutionCommand")) {
    const runtimeGrants: Record<string, string[]> = {
      FinisherRoutine: ["SELECT"],
      FinisherRoutineVersion: ["SELECT"],
      FinisherRoutineStep: ["SELECT"],
      FinisherRoutineStepAlternative: ["SELECT"],
      FinisherOffer: ["INSERT", "SELECT", "UPDATE"],
      FinisherOfferItem: ["INSERT", "SELECT"],
      FinisherDecision: ["INSERT", "SELECT"],
      FinisherExecution: ["INSERT", "SELECT", "UPDATE"],
      FinisherExecutionStep: ["INSERT", "SELECT", "UPDATE"],
      FinisherExecutionCommand: ["INSERT", "SELECT"],
    };
    catalog.tableSecurity = Object.entries(runtimeGrants).map(
      ([table, privileges]) => ({
        table,
        owner: "trainer_finisher_owner",
        rowSecurity: false,
        forceRowSecurity: false,
        privileges: [
          ...privileges.map((privilege) => ({
            grantee: "trainer_app_runtime",
            grantor: "trainer_finisher_owner",
            privilege,
            grantable: false,
          })),
          ...(table === "FinisherExecutionCommand"
            ? [
                {
                  grantee: "trainer_finisher_cleanup",
                  grantor: "trainer_finisher_owner",
                  privilege: "SELECT",
                  grantable: false,
                },
              ]
            : []),
        ],
      }),
    );
    catalog.columnPrivileges = ["cleanedAt", "response"].map((column) => ({
      table: "FinisherExecutionCommand",
      column,
      grantee: "trainer_finisher_cleanup",
      grantor: "trainer_finisher_owner",
      privilege: "UPDATE",
      grantable: false,
    }));
    catalog.roles = [
      {
        name: "trainer_app_runtime",
        canLogin: true,
        inherit: true,
        superuser: false,
        createRole: false,
        createDb: false,
        replication: false,
        bypassRls: false,
        publicSchemaCreate: false,
      },
      ...["trainer_finisher_owner", "trainer_finisher_cleanup"].map(
        (name) => ({
          name,
          canLogin: false,
          inherit: false,
          superuser: false,
          createRole: false,
          createDb: false,
          replication: false,
          bypassRls: false,
          publicSchemaCreate: false,
        }),
      ),
    ];
    catalog.roleMemberships = [];
    catalog.defaultPrivileges = [];
  }
  if (!catalog.roles) {
    catalog.roles = [
      {
        name: "trainer_app_runtime",
        canLogin: true,
        inherit: true,
        superuser: false,
        createRole: false,
        createDb: false,
        replication: false,
        bypassRls: false,
        publicSchemaCreate: false,
      },
      ...["trainer_finisher_owner", "trainer_finisher_cleanup"].map(
        (name) => ({
          name,
          canLogin: false,
          inherit: false,
          superuser: false,
          createRole: false,
          createDb: false,
          replication: false,
          bypassRls: false,
          publicSchemaCreate: true,
        }),
      ),
    ];
    catalog.roleMemberships = [
      "trainer_app_runtime",
      "trainer_finisher_owner",
      "trainer_finisher_cleanup",
    ].map((role) => ({
      role,
      member: "migration_admin",
      grantor: "postgres",
      grantorIsBootstrapSuperuser: true,
      adminOption: true,
      inheritOption: false,
      setOption: false,
    }));
    catalog.defaultPrivileges = [];
  }
  return catalog;
}

function fullEvidence(
  overrides: Partial<MigrationAuthorizationEvidence> = {},
): MigrationAuthorizationEvidence {
  return {
    repositoryHead: REPOSITORY_HEAD,
    requiredApplicationCommit: REPOSITORY_HEAD,
    evaluatedAt: EVALUATED_AT,
    ...overrides,
  };
}

function principalSnapshot(): FinisherPrincipalSnapshot {
  const administrator = "migration_admin";
  return {
    phase: "migration_capable",
    serverVersionNumber: 160010,
    administrator: {
      currentRole: administrator,
      sessionRole: administrator,
      canLogin: true,
      superuser: false,
      createRole: true,
      createroleSelfGrant: "",
    },
    roles: FINISHER_PRINCIPAL_CONTRACT.map((role) => ({
      name: role.name,
      canLogin: role.canLogin,
      inherit: role.inherit,
      superuser: false,
      createDb: false,
      createRole: false,
      replication: false,
      bypassRls: false,
      publicSchemaCreate: role.name !== "trainer_app_runtime",
      credential:
        role.name === "trainer_app_runtime"
          ? ("verified_matching" as const)
          : ("not_applicable" as const),
      defaultPrivilegeCount: 0,
    })),
    memberships: [
      ...FINISHER_PRINCIPAL_CONTRACT.map((role) => ({
        grantedRole: role.name,
        memberRole: administrator,
        grantorRole: "postgres",
        grantorIsBootstrapSuperuser: true,
        admin: true,
        inherit: false,
        set: false,
      })),
      ...["trainer_finisher_owner", "trainer_finisher_cleanup"].map(
        (grantedRole) => ({
          grantedRole,
          memberRole: administrator,
          grantorRole: administrator,
          grantorIsBootstrapSuperuser: false,
          admin: false,
          inherit: false,
          set: true,
        }),
      ),
    ],
    finisherObjectCount: 0,
    finisherObjectCapabilityCount: 0,
  };
}

function fullPrincipalVerification(
  overrides: Partial<LiveFinisherPrincipalVerification> = {},
  bindingHead = REPOSITORY_HEAD,
): LiveFinisherPrincipalVerification {
  return {
    source: "fresh_live_database_verification",
    verifiedAt: VERIFIED_AT,
    repositoryHead: bindingHead,
    requiredApplicationCommit: bindingHead,
    targetMigration: FINISHER_TARGET_MIGRATION,
    targetFingerprint: TARGET_FINGERPRINT,
    projectFingerprint: "project-fingerprint",
    database: "postgres",
    credentialProof: "bounded_runtime_authentication",
    readOnlyTransaction: true,
    databaseWrites: 0,
    snapshot: principalSnapshot(),
    ...overrides,
  };
}

function fullOperationalVerification(
  overrides: Record<string, unknown> = {},
  bindingHead = REPOSITORY_HEAD,
): CanonicalOperationalVerification {
  const inventory = [...EXPECTED_MIGRATION_CHAIN];
  const migrationSha256 = "1".repeat(64);
  return {
    schema: FINISHER_PROVIDER_EVIDENCE_SCHEMA,
    version: FINISHER_PROVIDER_EVIDENCE_VERSION,
    contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
    toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
    authority: "canonical_live_provider_verification",
    requiredApplicationCommit: bindingHead,
    migration: {
      path: FINISHER_MIGRATION_PATH,
      sha256: migrationSha256,
      gitBlob: FINISHER_MIGRATION_GIT_BLOB,
      inventorySha256: migrationInventorySha256(inventory),
      inventory,
    },
    target: {
      environment: "production",
      githubOwner: "aaron8819",
      githubRepository: "trainer-app",
      vercelTeamId: "team_trainer",
      vercelTeamSlug: "trainer-team",
      vercelProjectId: "prj_trainer",
      vercelProjectName: "trainer-app",
      productionAlias: "trainer.example.com",
      supabaseOrganizationId: "org_trainer",
      supabaseProjectRef: "a".repeat(20),
      database: "postgres",
    },
    applicationCompatibilityState: "compatible_with_write_boundary",
    deployment: {
      provider: "vercel",
      authenticated: true,
      account: "trainer-operator",
      accountId: "user_trainer_operator",
      teamId: "team_trainer",
      teamSlug: "trainer-team",
      projectId: "prj_trainer",
      projectName: "trainer-app",
      environment: "production",
      alias: "trainer.example.com",
      deploymentId: "dpl_trainer",
      creatorId: "user_trainer_operator",
      writePauseAuthorizationId: "env_write_pause",
      writePauseAuthorizedBy: "user_trainer_operator",
      writePauseAuthorizedAt: "2026-07-26T17:41:00.000Z",
      state: "READY",
      sourceProvider: "github",
      sourceRepository: "aaron8819/trainer-app",
      sourceBranch: "master",
      sourceCommit: bindingHead,
      createdAt: "2026-07-26T17:41:30.000Z",
      readyAt: "2026-07-26T17:42:00.000Z",
      aliasObservedAt: "2026-07-26T17:42:30.000Z",
      verifiedAt: "2026-07-26T17:42:30.000Z",
      provenance: "vercel_authenticated_read_only_rest",
    },
    disposable: {
      schema: "trainer-finisher-disposable-verification",
      version: 1,
      contractVersion: FINISHER_PROVIDER_CONTRACT_VERSION,
      toolVersion: FINISHER_PROVIDER_TOOL_VERSION,
      authority: "github_actions_exact_head_artifact",
      repository: "aaron8819/trainer-app",
      workflow: FINISHER_DISPOSABLE_WORKFLOW,
      workflowRunId: "123",
      workflowRunAttempt: 1,
      commitSha: bindingHead,
      ref: "refs/heads/master",
      event: "workflow_dispatch",
      environment: "disposable",
      postgresMajor: 16,
      sourceClean: true,
      migration: {
        path: FINISHER_MIGRATION_PATH,
        sha256: migrationSha256,
        gitBlob: FINISHER_MIGRATION_GIT_BLOB,
        inventorySha256: migrationInventorySha256(inventory),
        inventory,
      },
      preMigrationState: {
        checkedIn: inventory.length,
        applied: inventory.length - 1,
        pending: [FINISHER_TARGET_MIGRATION],
      },
      terminalState: {
        migrationApplied: true,
        exactSchemaVerified: true,
        exactCatalogVerified: true,
        restrictedAdministratorWorkflowVerified: true,
        principalTerminalStateVerified: true,
        productionWritePathCoverageVerified: true,
        databaseWritesOutsideDisposable: 0,
      },
      startedAt: "2026-07-26T17:32:00.000Z",
      completedAt: "2026-07-26T17:35:00.000Z",
      authenticated: true,
      artifactId: "456",
      artifactDigest: "2".repeat(64),
      verifiedAt: "2026-07-26T17:43:00.000Z",
      provenance: "github_authenticated_actions_artifact",
    },
    recovery: {
      provider: "supabase",
      authenticated: true,
      organizationId: "org_trainer",
      projectRef: "a".repeat(20),
      database: "postgres",
      pitrEnabled: true,
      walgEnabled: true,
      earliestRecoveryAt: "2026-07-26T16:00:00.000Z",
      latestRecoveryAt: "2026-07-26T17:46:00.000Z",
      requiredRecoveryAt: "2026-07-26T17:45:00.000Z",
      retentionMarginMinutes: 105,
      minimumRolloutCoverageMinutes: 30,
      coversRequiredRecoveryAt: true,
      coversRollout: true,
      latestDailyBackupAt: null,
      dailyBackupAgeSeconds: null,
      dailyBackupImplication: null,
      restoreOperation:
        "POST /v1/projects/{ref}/database/backups/restore-pitr",
      restoreTimestampParameter: "recovery_time_target_unix",
      restoreScope: "entire_project_database",
      restoreDowntime: "project_inaccessible_during_restore",
      postRestoreWriteLoss: "writes_after_selected_timestamp_are_lost",
      verifiedAt: "2026-07-26T17:46:00.000Z",
      verified: true,
      provenance: "supabase_authenticated_management_api",
    },
    writePause: {
      provider: "vercel_application",
      authenticatedProvider: true,
      teamId: "team_trainer",
      projectId: "prj_trainer",
      environment: "production",
      deploymentId: "dpl_trainer",
      commitSha: bindingHead,
      pauseOperationId: `trainer-write-pause:prj_trainer:production:${bindingHead}:dpl_trainer`,
      enforcement: "application_all_classified_write_paths",
      initiationCapability: "provider_operation",
      initiationAuthorizationId: "env_write_pause",
      initiationAuthorizedBy: "user_trainer_operator",
      initiationAuthorizedAt: "2026-07-26T17:41:00.000Z",
      initiationOperationId: "dpl_trainer",
      initiationObservedAt: "2026-07-26T17:44:00.000Z",
      establishedAt: "2026-07-26T17:45:00.000Z",
      runtimeStatus: "PAUSED",
      runtimeContractVersion: 2,
      enforcementContractVersion: 2,
      mutationCoverageVerified: true,
      bypassPaths: [],
      verifiedAt: "2026-07-26T17:45:00.000Z",
      verified: true,
      provenance: "vercel_authenticated_configuration_deployment_and_runtime",
    },
    verifiedAt: VERIFIED_AT,
    failureDetails: [],
    ...overrides,
  } as CanonicalOperationalVerification;
}

function providerExpectation(
  bindingHead = REPOSITORY_HEAD,
): ProviderVerificationExpectation {
  const operational = fullOperationalVerification({}, bindingHead);
  return {
    evaluatedAt: EVALUATED_AT,
    repositoryHead: bindingHead,
    requiredApplicationCommit: bindingHead,
    migrationPath: FINISHER_MIGRATION_PATH,
    migrationGitBlob: FINISHER_MIGRATION_GIT_BLOB,
    migrationSha256: operational.migration.sha256,
    migrationInventorySha256: operational.migration.inventorySha256,
    target: operational.target,
  };
}

function report(overrides: Partial<Parameters<typeof buildMigrationIntegrityReport>[0]> = {}) {
  return buildMigrationIntegrityReport({
    target: {
      classification: "remote",
      fingerprint: TARGET_FINGERPRINT,
      projectFingerprint: "project-fingerprint",
      database: "postgres",
    },
    checkedIn: checkedIn(),
    ledgerRows: appliedPrefix(),
    catalog: cleanCatalog(),
    writes: 0,
    authorizationEvidence: fullEvidence(),
    finisherPrincipalLiveVerification: fullPrincipalVerification(),
    operationalVerification: fullOperationalVerification(),
    providerVerificationExpectation: providerExpectation(),
    ...overrides,
  });
}

function addPendingObject(catalog: CatalogSnapshot, migrationIndex: number, objectIndex: number): void {
  const object = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects[objectIndex];
  if (!object) return;
  if (object.kind === "table") catalog.tables.push(object.name);
  if (object.kind === "column") catalog.columns.push({ table: object.table!, name: object.name, type: "text", nullable: true, default: null });
  if (object.kind === "enum") catalog.enums.push({ name: object.name, values: [] });
  if (object.kind === "index") catalog.indexes.push({ table: object.table!, name: object.name, unique: false, columns: [], predicate: null });
  if (object.kind === "constraint") catalog.constraints.push({ table: object.table!, name: object.name, type: "f", definition: "fixture" });
  if (object.kind === "trigger") catalog.triggers.push({ table: object.table!, name: object.name, definition: "fixture" });
  if (object.kind === "function") catalog.functions.push({ name: object.name, definition: "fixture" });
  if (object.kind === "catalogRow") catalog.catalogRows.push({ table: object.table!, key: object.name, values: {} });
}

function pendingObjectIndex(migrationIndex: number, kind: string): number {
  const index = PENDING_ARCHITECTURE_MANIFEST[migrationIndex].objects.findIndex((object) => object.kind === kind);
  if (index < 0) throw new Error(`Missing ${kind} fixture for pending migration ${migrationIndex}`);
  return index;
}

describe("migration integrity", () => {
  it("declares the checked-in migration directories in exact filesystem order", () => {
    const directories = readdirSync(resolve("prisma/migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual([...EXPECTED_MIGRATION_CHAIN]);
  });

  it("accepts the applied prefix and the exact expected pending migration", () => {
    const result = report();
    expect(result.chain).toMatchObject({
      checkedIn: EXPECTED_MIGRATION_CHAIN.length,
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: EXPECTED_GATE_A_PENDING.length,
      pendingNames: EXPECTED_GATE_A_PENDING,
    });
    expect(result.checksums).toMatchObject({
      matched: EXPECTED_MIGRATION_CHAIN.length - 1,
      mismatched: [],
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.migrationAuthorizationReady).toBe(true);
    expect(result.executionAuthorized).toBe(false);
  });

  it("treats clean zero-step baseline and hotfix resolutions as applied without breaking the prefix", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], appliedStepsCount: 0 };
    rows[9] = { ...rows[9], appliedStepsCount: 0 };
    const result = report({ ledgerRows: rows });

    expect(result.chain).toMatchObject({
      applied: EXPECTED_MIGRATION_CHAIN.length - 1,
      pending: EXPECTED_GATE_A_PENDING.length,
      pendingNames: EXPECTED_GATE_A_PENDING,
    });
    expect(result.ledger.successful).toHaveLength(
      EXPECTED_MIGRATION_CHAIN.length - 1,
    );
    expect(result.ledger.resolvedApplied).toEqual([
      EXPECTED_MIGRATION_CHAIN[0],
      EXPECTED_MIGRATION_CHAIN[9],
    ]);
    expect(result.ledger.successfulDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ migrationName: EXPECTED_MIGRATION_CHAIN[0], appliedMode: "resolved_applied", appliedStepsCount: 0 }),
      expect.objectContaining({ migrationName: EXPECTED_MIGRATION_CHAIN[1], appliedMode: "executed", appliedStepsCount: 1 }),
    ]));
    expect(result.ledger.incomplete).toEqual([]);
    expect(result.ledger.orderViolations).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it("hashes the exact migration bytes written to the Prisma ledger", () => {
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).not.toBe(
      checksumMigrationSql(Buffer.from("SELECT 1;\r\n")),
    );
    expect(checksumMigrationSql(Buffer.from("SELECT 1;\n"))).toHaveLength(64);
  });

  it("matches Prisma's exact, LF, and CRLF checksum variants", () => {
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    expect(prismaCompatibleMigrationSqlChecksums(lf)).toEqual(
      expect.arrayContaining([
        checksumMigrationSql(lf),
        checksumMigrationSql(crlf),
      ]),
    );
    expect(prismaCompatibleMigrationSqlChecksums(crlf)).toEqual(
      expect.arrayContaining([
        checksumMigrationSql(crlf),
        checksumMigrationSql(lf),
      ]),
    );
    const migration = {
      name: "test",
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
      sqlPath: "migration.sql",
    };
    expect(migrationChecksumMatches(migration, checksumMigrationSql(crlf))).toBe(true);
    expect(migrationChecksumMatches(migration, checksumMigrationSql(lf))).toBe(true);
  });

  it("does not normalize standalone carriage returns or genuine SQL drift", () => {
    const checksums = prismaCompatibleMigrationSqlChecksums(
      Buffer.from("SELECT 1;\r"),
    );
    expect(checksums).not.toContain(
      checksumMigrationSql(Buffer.from("SELECT 1;\n")),
    );
    expect(checksums).not.toContain(
      checksumMigrationSql(Buffer.from("SELECT 2;\r\n")),
    );
  });

  it("accepts a raw CRLF ledger checksum for a CRLF working-tree file", () => {
    const migrations = checkedIn();
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    migrations[0] = {
      ...migrations[0],
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
    };
    const rows = migrations.slice(0, -1).map(successfulRow);
    const result = report({ checkedIn: migrations, ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([]);
    expect(result.checksums.lineEndingCompatibilityUsed).toEqual([]);
    expect(result.migrationChecksumsValid).toBe(true);
    expect(migrations[0].checksum).toBe(checksumMigrationSql(crlf));
    expect(migrations[0].compatibleChecksums).toContain(
      checksumMigrationSql(lf),
    );
  });

  it("accepts an LF ledger checksum for a CRLF working-tree file", () => {
    const migrations = checkedIn();
    const lf = Buffer.from("SELECT 1;\n");
    const crlf = Buffer.from("SELECT 1;\r\n");
    migrations[0] = {
      ...migrations[0],
      checksum: checksumMigrationSql(crlf),
      compatibleChecksums: prismaCompatibleMigrationSqlChecksums(crlf),
    };
    const rows = migrations.slice(0, -1).map(successfulRow);
    rows[0] = {
      ...rows[0],
      checksum: checksumMigrationSql(lf),
      appliedStepsCount: 0,
    };
    const result = report({ checkedIn: migrations, ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([]);
    expect(result.checksums.lineEndingCompatibilityUsed).toEqual([
      migrations[0].name,
    ]);
    expect(result.migrationChecksumsValid).toBe(true);
    expect(result.ledger.successfulDetails).toContainEqual({
      migrationName: migrations[0].name,
      appliedMode: "resolved_applied",
      appliedStepsCount: 0,
    });
  });

  it("blocks a checksum mismatch and a missing ledger checksum", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], checksum: "changed" };
    rows[1] = { ...rows[1], checksum: null };
    const result = report({ ledgerRows: rows });
    expect(result.checksums.mismatched).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.checksums.missingLedgerChecksum).toEqual([EXPECTED_MIGRATION_CHAIN[1]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("reports an applied migration missing from the checked-in chain", () => {
    const migrations = checkedIn().slice(1);
    const result = report({ checkedIn: migrations, ledgerRows: appliedPrefix() });
    expect(result.checksums.missingCheckedIn).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.ledger.unknown).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it.each([
    ["failed", { finishedAt: null, logs: "database error" }, "failed"],
    ["rolled back", { finishedAt: null, rolledBackAt: "2026-07-01 01:00:00+00" }, "rolledBack"],
    ["unfinished", { finishedAt: null }, "incomplete"],
  ] as const)("blocks a %s ledger entry", (_label, change, field) => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], ...change };
    const result = report({ ledgerRows: rows });
    expect(result.ledger[field]).toContain(EXPECTED_MIGRATION_CHAIN[0]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks duplicate ledger rows", () => {
    const rows = appliedPrefix();
    rows.push({ ...rows[0], id: "duplicate" });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.duplicates).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("accepts exactly one clean replacement after rolled-back history", () => {
    const rows = appliedPrefix();
    rows.push({
      ...rows[0],
      id: "rolled-back-history",
      finishedAt: null,
      rolledBackAt: "2026-06-30 00:00:00+00",
      logs: "prior failure",
      appliedStepsCount: 0,
    });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.rolledBackHistory).toEqual([EXPECTED_MIGRATION_CHAIN[0]]);
    expect(result.ledger.rolledBack).toEqual([]);
    expect(result.ledger.duplicates).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it("blocks contradictory and ambiguous ledger groups", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], rolledBackAt: "2026-07-02 00:00:00+00" };
    rows.push({ ...rows[1], id: "second-success" });
    const result = report({ ledgerRows: rows });
    expect(result.ledger.incomplete).toEqual(expect.arrayContaining([
      EXPECTED_MIGRATION_CHAIN[0],
      EXPECTED_MIGRATION_CHAIN[1],
    ]));
    expect(result.ledger.duplicates).toContain(EXPECTED_MIGRATION_CHAIN[1]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks an applied migration after a pending predecessor", () => {
    const rows = appliedPrefix().filter((row) => row.migrationName !== EXPECTED_MIGRATION_CHAIN[4]);
    const result = report({ ledgerRows: rows });
    expect(result.ledger.orderViolations).toContain(EXPECTED_MIGRATION_CHAIN[5]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("keeps later clean migrations ordered behind zero-step successful predecessors", () => {
    const rows = appliedPrefix();
    rows[0] = { ...rows[0], appliedStepsCount: 0 };
    rows[4] = { ...rows[4], appliedStepsCount: 0 };
    const result = report({ ledgerRows: rows });
    expect(result.ledger.orderViolations).toEqual([]);
    expect(result.chain.applied).toBe(EXPECTED_MIGRATION_CHAIN.length - 1);
  });

  it("blocks an unknown ledger migration", () => {
    const rows = appliedPrefix();
    rows.push(successfulRow({ name: "unknown_migration", checksum: "abc", sqlPath: "missing" }, 99));
    const result = report({ ledgerRows: rows });
    expect(result.ledger.unknown).toEqual(["unknown_migration"]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("passes when every target-migration object is absent", () => {
    const result = report();
    expect(result.partialObjects.partiallyPresent).toEqual([]);
    expect(result.partialObjects.unexpectedPresent).toEqual([]);
    expect(result.partialObjects.commentsOnly).toEqual([]);
  });

  it.each([
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "column"),
      "target column",
    ],
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "index"),
      "target index",
    ],
    [
      PENDING_MANIFEST_INDEX,
      pendingObjectIndex(PENDING_MANIFEST_INDEX, "constraint"),
      "target constraint",
    ],
  ])("blocks one unexpectedly present %s/%s %s", (migrationIndex, objectIndex) => {
    const catalog = cleanCatalog();
    addPendingObject(catalog, migrationIndex, objectIndex);
    const result = report({ catalog });
    expect([
      ...result.partialObjects.partiallyPresent,
      ...result.partialObjects.unexpectedPresent,
      ...result.partialObjects.incompatible,
    ]).not.toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks a missing object from an already-applied architecture migration", () => {
    const catalog = cleanCatalog();
    catalog.columns = catalog.columns.filter(
      (column) =>
        !(
          column.table === "WorkoutExercise" &&
          column.name === "stimulusAccountingSnapshot"
        ),
    );
    const result = report({ catalog });
    expect(result.schemaPreflightValid).toBe(false);
    expect(result.definitions.appliedManifestMissing).toEqual([
      expect.stringContaining("stimulusAccountingSnapshot"),
    ]);
  });

  it("does not let forged operator evidence redefine the trusted pending sequence", () => {
    const observedPendingMigrations = EXPECTED_MIGRATION_CHAIN.slice(-2);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length - 2),
      catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length - 2),
      authorizationEvidence: {
        ...fullEvidence(),
        expectedPendingMigrations: [...observedPendingMigrations],
      } as MigrationAuthorizationEvidence & {
        expectedPendingMigrations: string[];
      },
    });
    expect(result.pendingMigrations).toEqual(observedPendingMigrations);
    expect(result.chain.expectedPendingMigrations).toEqual([
      "20260728120000_add_finishers_phase_1",
    ]);
    expect(result.technicalMigrationReady).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.blockingReasons).toContain(
      "pending_migration_sequence_mismatch",
    );
  });

  it("rejects an unexpected second pending migration", () => {
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length - 2),
      catalog: cleanCatalog(EXPECTED_MIGRATION_CHAIN.length - 2),
    });
    expect(result.pendingMigrations).toHaveLength(2);
    expect(result.unexpectedMigrations).toEqual([
      EXPECTED_MIGRATION_CHAIN.at(-2),
    ]);
    expect(result.technicalMigrationReady).toBe(false);
  });

  it("derives clean data preflight from the fresh zero-write catalog inspection", () => {
    const operational = fullOperationalVerification();
    const technicalOnly = report({
      operationalVerification: fullOperationalVerification({
        recovery: {
          ...operational.recovery,
          verified: false,
          pitrEnabled: false,
          earliestRecoveryAt: null,
          latestRecoveryAt: null,
          retentionMarginMinutes: null,
          coversRequiredRecoveryAt: false,
          coversRollout: false,
        },
      }),
    });
    expect(technicalOnly.dataPreflightValid).toBe(true);
    expect(technicalOnly.technicalMigrationReady).toBe(true);
    expect(technicalOnly.migrationAuthorizationReady).toBe(false);
  });

  it("requires canonical live PITR verification", () => {
    const operational = fullOperationalVerification();
    const result = report({
      operationalVerification: fullOperationalVerification({
        recovery: {
          ...operational.recovery,
          verified: false,
          pitrEnabled: false,
          earliestRecoveryAt: null,
          latestRecoveryAt: null,
          retentionMarginMinutes: null,
          coversRequiredRecoveryAt: false,
          coversRollout: false,
        },
      }),
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.pitrRecoveryVerified).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("keeps Gate A closed when PITR targets deployment readiness instead of pause verification", () => {
    const operational = fullOperationalVerification();
    const result = report({
      operationalVerification: fullOperationalVerification({
        recovery: {
          ...operational.recovery,
          requiredRecoveryAt: operational.deployment.readyAt,
        },
      }),
    });
    expect(result.pitrRecoveryVerified).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("requires canonical live write-pause verification", () => {
    const result = report({
      operationalVerification: undefined,
      providerVerificationExpectation: undefined,
    });
    expect(result.technicalMigrationReady).toBe(false);
    expect(result.writeBoundaryReady).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("keeps Gate A closed when pause enforcement is effective but initiation is unavailable", () => {
    const operational = fullOperationalVerification();
    const result = report({
      operationalVerification: fullOperationalVerification({
        writePause: {
          ...operational.writePause,
          initiationCapability:
            "unavailable_requires_authorized_environment_update_and_redeployment",
          initiationAuthorizedAt: null,
          initiationOperationId: null,
        },
      }),
    });
    expect(result.technicalMigrationReady).toBe(false);
    expect(result.writeBoundaryReady).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
  });

  it("authorizes any future integrated commit when all three trusted values match exactly", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        repositoryHead: FUTURE_INTEGRATED_HEAD,
        requiredApplicationCommit: FUTURE_INTEGRATED_HEAD,
      }),
      finisherPrincipalLiveVerification: fullPrincipalVerification(
        {},
        FUTURE_INTEGRATED_HEAD,
      ),
      operationalVerification: fullOperationalVerification(
        {},
        FUTURE_INTEGRATED_HEAD,
      ),
      providerVerificationExpectation: providerExpectation(
        FUTURE_INTEGRATED_HEAD,
      ),
    });
    expect(result.evidence).toMatchObject({
      repositoryHeadIdentified: true,
      productionDeploymentCommitIdentified: true,
      requiredApplicationCommitIdentified: true,
      requiredApplicationCommitMatchesRepositoryHead: true,
      requiredApplicationCommitMatchesProductionDeployment: true,
      repositoryHeadMatchesProductionDeployment: true,
      applicationCommitBindingVerified: true,
      productionDeploymentVerified: true,
    });
    expect(result.migrationAuthorizationReady).toBe(true);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("rejects requiredApplicationCommit when it differs from repositoryHead", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        requiredApplicationCommit: FUTURE_INTEGRATED_HEAD,
      }),
    });
    expect(result.evidence.requiredApplicationCommitMatchesRepositoryHead).toBe(
      false,
    );
    expect(result.blockingReasons).toContain(
      "required_application_commit_repository_head_mismatch",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("rejects requiredApplicationCommit when it differs from productionDeploymentCommit", () => {
    const operational = fullOperationalVerification();
    const result = report({
      operationalVerification: fullOperationalVerification({
        deployment: {
          ...operational.deployment,
          sourceCommit: FUTURE_INTEGRATED_HEAD,
        },
      }),
    });
    expect(
      result.evidence.requiredApplicationCommitMatchesProductionDeployment,
    ).toBe(false);
    expect(result.blockingReasons).toContain(
      "required_application_commit_production_deployment_mismatch",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("rejects repositoryHead when it differs from productionDeploymentCommit", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        repositoryHead: FUTURE_INTEGRATED_HEAD,
        requiredApplicationCommit: FUTURE_INTEGRATED_HEAD,
      }),
      finisherPrincipalLiveVerification: fullPrincipalVerification(
        {},
        FUTURE_INTEGRATED_HEAD,
      ),
    });
    expect(result.evidence.repositoryHeadMatchesProductionDeployment).toBe(
      false,
    );
    expect(result.blockingReasons).toContain(
      "repository_head_production_deployment_mismatch",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("rejects an arbitrary canonical SHA that is not the checked-out and deployed commit", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        requiredApplicationCommit: ARBITRARY_HEAD,
      }),
    });
    expect(result.evidence.requiredApplicationCommitIdentified).toBe(true);
    expect(result.evidence.applicationCommitBindingVerified).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("rejects the old base deployment after a different integrated commit is authorized", () => {
    const operational = fullOperationalVerification();
    const result = report({
      operationalVerification: fullOperationalVerification({
        deployment: {
          ...operational.deployment,
          deploymentId: "dpl_old",
          sourceCommit: OLD_BASE_HEAD,
        },
      }),
    });
    expect(result.evidence.productionDeploymentCommitIdentified).toBe(true);
    expect(result.evidence.productionDeploymentVerified).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "required_application_commit_production_deployment_mismatch",
        "repository_head_production_deployment_mismatch",
      ]),
    );
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it.each([
    ["short", "b".repeat(39)],
    ["malformed", "g".repeat(40)],
    ["uppercase", "B".repeat(40)],
    ["padded", ` ${REPOSITORY_HEAD} `],
    ["overlong", "b".repeat(41)],
  ])("rejects a %s commit value in live commit bindings", (_label, value) => {
    const evidence = fullEvidence({
      repositoryHead: value,
      requiredApplicationCommit: value,
    });
    const result = report({ authorizationEvidence: evidence });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.migrationAuthorizationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("models the captured production shape without granting execution", () => {
    const operational = fullOperationalVerification();
    const result = report({
      target: {
        classification: "remote",
        fingerprint: TARGET_FINGERPRINT,
        projectFingerprint: "project-fingerprint",
        database: "postgres",
      },
      operationalVerification: fullOperationalVerification({
        recovery: {
          ...operational.recovery,
          verified: false,
          pitrEnabled: false,
          earliestRecoveryAt: null,
          latestRecoveryAt: null,
          retentionMarginMinutes: null,
          coversRequiredRecoveryAt: false,
          coversRollout: false,
        },
      }),
    });
    expect(result).toMatchObject({
      appliedMigrations: expect.arrayContaining([
        EXPECTED_MIGRATION_CHAIN[0],
        EXPECTED_MIGRATION_CHAIN[14],
      ]),
      pendingMigrations: [MIGRATION_AUTHORIZATION_POLICY.targetMigration],
      schemaPreflightValid: true,
      dataPreflightValid: true,
      technicalMigrationReady: true,
      migrationAuthorizationReady: false,
      executionAuthorized: false,
    });
    expect(result.blockingReasons).toContain(
      "provider_pitr_disabled",
    );
  });

  it("can become authorization-ready with complete evidence but never execution-authorized in preparation mode", () => {
    const result = report();
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.migrationAuthorizationReady).toBe(true);
    expect(result.executionAuthorized).toBe(false);
  });

  it("requires fresh live Finisher principal verification before pre-migration Gate A", () => {
    const result = report({ finisherPrincipalLiveVerification: undefined });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.principalPrerequisites).toMatchObject({
      verified: false,
      reasons: ["missing_live_verification"],
    });
    expect(result.blockingReasons).toContain(
      "finisher_principal_live_missing_live_verification",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("rejects stale and write-reporting live Finisher principal results", () => {
    const stale = report({
      finisherPrincipalLiveVerification: fullPrincipalVerification({
        verifiedAt: "2026-07-26T16:00:00.000Z",
      }),
    });
    expect(stale.blockingReasons).toContain(
      "finisher_principal_live_stale_or_invalid_timestamp",
    );

    const writes = {
      ...fullPrincipalVerification(),
      databaseWrites: 1,
    } as unknown as LiveFinisherPrincipalVerification;
    const writeReporting = report({
      finisherPrincipalLiveVerification: writes,
    });
    expect(writeReporting.blockingReasons).toContain(
      "finisher_principal_live_writes_reported",
    );
  });

  it("never lets a caller-authored audit record replace live database results", () => {
    const result = report({
      finisherPrincipalLiveVerification: undefined,
      finisherPrincipalAuditRecord: {
        schema: "trainer-finisher-principal-audit-record",
        version: 2,
        verifier: "ops:finisher-principals",
        authority: "sanitized_audit_record_only",
        binding: {
          repositoryHead: REPOSITORY_HEAD,
          requiredApplicationCommit: REPOSITORY_HEAD,
          targetMigration: FINISHER_TARGET_MIGRATION,
          environment: "production",
          targetClassification: "remote",
          targetFingerprint: TARGET_FINGERPRINT,
          projectFingerprint: "project-fingerprint",
          database: "postgres",
        },
        operation: "verify",
        startedAt: VERIFIED_AT,
        completedAt: VERIFIED_AT,
        readOnlyTransaction: true,
        databaseWrites: 0,
        createdPrincipals: [],
        credentialConfigured: false,
        liveState: principalSnapshot(),
      },
    });
    expect(result.principalPrerequisites).toMatchObject({
      verified: false,
      auditRecordAuthority: "sanitized_audit_record_only",
      auditRecordUsedForAuthorization: false,
    });
  });

  it("requires the operator to identify the exact post-migration application commit", () => {
    const result = report({
      authorizationEvidence: fullEvidence({
        requiredApplicationCommit: undefined,
      }),
    });
    expect(result.technicalMigrationReady).toBe(true);
    expect(result.evidence.requiredApplicationCommitIdentified).toBe(false);
    expect(result.blockingReasons).toContain(
      "required_application_commit_not_identified",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("blocks an incompatible applied definition and an unverifiable catalog category", () => {
    const catalog = cleanCatalog();
    catalog.columns.find((item) => item.table === "SetLog" && item.name === "setIntent")!.type = "text";
    catalog.unableToVerify = ["functions"];
    const result = report({ catalog });
    expect(result.definitions.incompatible).toContain("column:SetLog.setIntent:incompatible");
    expect(result.partialObjects.unableToVerify).toEqual(["functions"]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("warns without blocking for semantically equivalent unique constraints", () => {
    const catalog = cleanCatalog();
    for (const expectation of BASELINE_UNIQUENESS_EXPECTATIONS) {
      const index = catalog.indexes.find((candidate) => candidate.name === expectation.name)!;
      index.constraintName = expectation.name;
      index.constraintType = "u";
    }
    const result = report({ catalog });
    expect(result.schemaIntegrity.semanticDriftBlocking).toBe(0);
    expect(result.schemaIntegrity.representationWarningCount).toBe(2);
    expect(result.schemaIntegrity.representationWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectName: "ExerciseAlias_alias_key",
        semanticEquivalent: true,
        actualRepresentation: "unique_constraint_backed_index",
        pendingMigrationDependsOnDistinction: false,
      }),
      expect.objectContaining({
        objectName: "WorkoutTemplateExercise_templateId_orderIndex_key",
        semanticEquivalent: true,
        actualRepresentation: "unique_constraint_backed_index",
        pendingMigrationDependsOnDistinction: false,
      }),
    ]));
    expect(result.migrationAuthorizationReady).toBe(true);
  });

  it.each([
    ["missing", (catalog: CatalogSnapshot) => { catalog.indexes = catalog.indexes.filter((index) => index.name !== "ExerciseAlias_alias_key"); }],
    ["wrong order", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "WorkoutTemplateExercise_templateId_orderIndex_key")!.columns.reverse(); }],
    ["non-unique", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.unique = false; }],
    ["different predicate", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.predicate = "(alias IS NOT NULL)"; }],
    ["different null semantics", (catalog: CatalogSnapshot) => { catalog.indexes.find((index) => index.name === "ExerciseAlias_alias_key")!.nullsNotDistinct = true; }],
    ["conflicting same-name constraint", (catalog: CatalogSnapshot) => { catalog.constraints.push({ table: "ExerciseAlias", name: "ExerciseAlias_alias_key", type: "u", definition: "UNIQUE (different_column)" }); }],
  ] as const)("blocks baseline uniqueness when it is %s", (_label, mutate) => {
    const catalog = cleanCatalog();
    mutate(catalog);
    const result = report({ catalog });
    expect(result.schemaIntegrity.semanticDriftBlocking).toBeGreaterThan(0);
    expect(result.schemaIntegrity.blockingDifferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "baseline_uniqueness" }),
    ]));
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("documents role-principal provisioning before Gate A and migration-owned grants after migration", () => {
    const operations = readFileSync(resolve("docs/07_OPERATIONS.md"), "utf8");
    const orderedMarkers = [
      "1. Merge and deploy the reviewed runtime-inert application",
      "2. Record the actual integrated `master` squash SHA, bind it as",
      "3. Obtain canonical commit-bound disposable PostgreSQL verification",
      "4. With separate authorization for the exact Vercel mutations",
      "5. Run authenticated Supabase PITR verification",
      "6. Run the immediate live read-only direct-database and migration-status",
      "7. Through the separately authorized database-administrator workflow",
      "8. Verify all three principals exist",
      "9. Run Gate A and the required pre-migration authorization checks.",
      "10. Only after Gate A reports `migrationAuthorizationReady: true`",
      "11. Run the authorized production migration once:",
      "12. Immediately verify the migration-owned object ownership",
      "13. Resume general writes only through the write-pause resume procedure",
      "14. Separately authorize Finishers enablement and bounded authenticated",
    ];
    let previousIndex = -1;
    for (const marker of orderedMarkers) {
      const markerIndex = operations.indexOf(marker);
      expect(markerIndex, marker).toBeGreaterThan(previousIndex);
      previousIndex = markerIndex;
    }
    expect(operations).toContain(
      "Do not re-provision migration-owned grants after migration",
    );
    expect(operations).toContain(
      "`migrationAuthorizationReady: false` and stop",
    );
    expect(operations).toContain("npm run ops:initiate-finisher-write-pause");
    expect(operations).toContain(
      "The trusted pause-establishment timestamp is exactly when",
    );
  });

  it.each([
    "canLogin",
    "inherit",
    "superuser",
    "createRole",
    "createDb",
    "replication",
    "bypassRls",
    "publicSchemaCreate",
  ] as const)(
    "fails pre-migration Gate A when a prerequisite principal has incorrect %s",
    (attribute) => {
      const catalog = cleanCatalog();
      const role = catalog.roles!.find(
        (candidate) => candidate.name === "trainer_app_runtime",
      )!;
      role[attribute] = !role[attribute];
      const result = report({ catalog });
      expect(result.chain.gateAApplicable).toBe(true);
      expect(catalog.tables).not.toContain("FinisherExecutionCommand");
      expect(result.schemaPreflightValid).toBe(false);
      expect(result.migrationAuthorizationReady).toBe(false);
    },
  );

  it.each([
    [
      "a missing principal",
      (catalog: CatalogSnapshot) => {
        catalog.roles = catalog.roles!.filter(
          (role) => role.name !== "trainer_finisher_owner",
        );
      },
    ],
  ] as const)("fails pre-migration Gate A for %s", (_label, mutate) => {
    const catalog = cleanCatalog();
    mutate(catalog);
    const result = report({ catalog });
    expect(catalog.tables).not.toContain("FinisherExecutionCommand");
    expect(result.schemaPreflightValid).toBe(false);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("fails pre-migration Gate A for wrong or unexpected live memberships", () => {
    const live = fullPrincipalVerification();
    live.snapshot.memberships.push({
      grantedRole: "trainer_finisher_owner",
      memberRole: "unexpected",
      grantorRole: "migration_admin",
      grantorIsBootstrapSuperuser: false,
      admin: false,
      inherit: false,
      set: true,
    });
    const result = report({ finisherPrincipalLiveVerification: live });
    expect(result.principalPrerequisites.verified).toBe(false);
    expect(result.blockingReasons).toContain(
      "finisher_principal_live_contract_membership_mismatch",
    );
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it.each([
    [
      "missing material column",
      (catalog: CatalogSnapshot) => {
        catalog.columns = catalog.columns.filter(
          (column) =>
            !(
              column.table === "FinisherExecution" &&
              column.name === "revision"
            ),
        );
      },
    ],
    [
      "altered material column",
      (catalog: CatalogSnapshot) => {
        catalog.columns.find(
          (column) =>
            column.table === "FinisherRoutineVersion" &&
            column.name === "sealedAt",
        )!.nullable = false;
      },
    ],
    [
      "missing enum value",
      (catalog: CatalogSnapshot) => {
        catalog.enums.find(
          (enumeration) => enumeration.name === "FinisherExecutionAction",
        )!.values.pop();
      },
    ],
    [
      "altered partial unique index",
      (catalog: CatalogSnapshot) => {
        catalog.indexes.find(
          (index) => index.name === "FinisherExecution_one_active_per_workout",
        )!.predicate = '"state" = \'SELECTED\'';
      },
    ],
    [
      "missing permanent performed-history uniqueness",
      (catalog: CatalogSnapshot) => {
        catalog.indexes = catalog.indexes.filter(
          (index) =>
            index.name !== "FinisherExecution_one_started_per_workout",
        );
      },
    ],
    [
      "permitting startedAt clearing",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "guard_finisher_execution_lifecycle",
        )!;
        fn.body = fn.body!.replace(
          'NEW."startedAt" IS DISTINCT FROM OLD."startedAt"',
          "false",
        );
      },
    ],
    [
      "allowing an empty finalized offer",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "require_finisher_offer_finalized",
        )!;
        fn.body = fn.body!.replace("actual_item_count = 0", "false");
      },
    ],
    [
      "allowing a recommendation outside the offer",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "require_finisher_offer_finalized",
        )!;
        fn.body = fn.body!.replace(
          'item."routineVersionId" = recommended_version_id',
          "true",
        );
      },
    ],
    [
      "weakening contiguous offer order",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "require_finisher_offer_finalized",
        )!;
        fn.body = fn.body!.replace(
          "maximum_position <> expected_item_count - 1",
          "false",
        );
      },
    ],
    [
      "removing finalized offer-item immutability",
      (catalog: CatalogSnapshot) => {
        catalog.triggers = catalog.triggers.filter(
          (trigger) => trigger.name !== "FinisherOfferItem_immutable",
        );
      },
    ],
    [
      "omitting expected offer revision from selection identity",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "require_finisher_execution_finalized",
        )!;
        fn.body = fn.body!.replace(
          'decision."expectedOfferRevision" = execution."offerRevisionAtSelection"',
          "true",
        );
      },
    ],
    [
      "omitting expected offer revision from decline identity",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "guard_finisher_offer_identity",
        )!;
        fn.body = fn.body!.replace(
          'decision."expectedOfferRevision" = OLD."revision"',
          "true",
        );
      },
    ],
    [
      "removing durable decision fingerprint",
      (catalog: CatalogSnapshot) => {
        catalog.columns = catalog.columns.filter(
          (column) =>
            !(
              column.table === "FinisherDecision" &&
              column.name === "requestFingerprint"
            ),
        );
      },
    ],
    [
      "missing check constraint",
      (catalog: CatalogSnapshot) => {
        catalog.constraints = catalog.constraints.filter(
          (constraint) =>
            constraint.name !== "FinisherExecution_feedback_range",
        );
      },
    ],
    [
      "altered foreign-key action",
      (catalog: CatalogSnapshot) => {
        catalog.constraints.find(
          (constraint) =>
            constraint.name === "FinisherOffer_workoutId_fkey",
        )!.definition =
          'FOREIGN KEY ("workoutId") REFERENCES "Workout"(id) ON UPDATE CASCADE ON DELETE CASCADE';
      },
    ],
    [
      "missing immutability trigger",
      (catalog: CatalogSnapshot) => {
        catalog.triggers = catalog.triggers.filter(
          (trigger) => trigger.name !== "FinisherRoutineStep_immutable",
        );
      },
    ],
    [
      "missing execution lifecycle trigger",
      (catalog: CatalogSnapshot) => {
        catalog.triggers = catalog.triggers.filter(
          (trigger) =>
            trigger.name !== "FinisherExecution_lifecycle_guard",
        );
      },
    ],
    [
      "disabled terminal step trigger",
      (catalog: CatalogSnapshot) => {
        catalog.triggers.find(
          (trigger) =>
            trigger.name === "FinisherExecutionStep_evidence_immutable",
        )!.enabled = "D";
      },
    ],
    [
      "replica-only command tombstone trigger",
      (catalog: CatalogSnapshot) => {
        catalog.triggers.find(
          (trigger) =>
            trigger.name === "FinisherExecutionCommand_tombstone",
        )!.enabled = "R";
      },
    ],
    [
      "command trigger attached to wrong table",
      (catalog: CatalogSnapshot) => {
        catalog.triggers.find(
          (trigger) =>
            trigger.name === "FinisherExecutionCommand_tombstone",
        )!.table = "FinisherExecution";
      },
    ],
    [
      "command trigger omits delete",
      (catalog: CatalogSnapshot) => {
        const trigger = catalog.triggers.find(
          (item) => item.name === "FinisherExecutionCommand_tombstone",
        )!;
        trigger.definition = trigger.definition.replace(
          "BEFORE UPDATE OR DELETE",
          "BEFORE UPDATE",
        );
      },
    ],
    [
      "altered immutability function",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (fn) => fn.name === "guard_finisher_routine_child_mutation",
        )!.body = "BEGIN RETURN NEW; END;";
      },
    ],
    [
      "weakened lifecycle terminal-state condition",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) =>
            item.name === "guard_finisher_execution_lifecycle",
        )!;
        fn.body = fn.body!.replace(", 'PARTIAL'", "");
      },
    ],
    [
      "omitted protected step field",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "guard_finisher_execution_step_evidence",
        )!;
        fn.body = fn.body!.replace(
          'OLD."startedAt" IS NOT NULL',
          "false",
        );
      },
    ],
    [
      "cleanup allowed before expiration",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) =>
            item.name === "cleanup_expired_finisher_execution_commands",
        )!;
        fn.body = fn.body!.replace(
          'AND command."expiresAt" <= cleanup_time',
          "",
        );
      },
    ],
    [
      "cleanup modifies permanent receipt identity",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) =>
            item.name === "cleanup_expired_finisher_execution_commands",
        )!;
        fn.body = fn.body!.replace(
          '"cleanedAt" = cleanup_time',
          '"cleanedAt" = cleanup_time, "resultRevision" = "resultRevision" + 1',
        );
      },
    ],
    [
      "cleanup is executable by public",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (item) =>
            item.name === "cleanup_expired_finisher_execution_commands",
        )!.publicExecute = true;
      },
    ],
    [
      "missing curated catalog row",
      (catalog: CatalogSnapshot) => {
        catalog.catalogRows = catalog.catalogRows.filter(
          (row) =>
            !(
              row.table === "FinisherRoutine" &&
              row.values.code === "core-stability-10"
            ),
        );
      },
    ],
    [
      "altered curated relationship",
      (catalog: CatalogSnapshot) => {
        const step = catalog.catalogRows.find(
          (row) => row.table === "FinisherRoutineStep",
        )!;
        step.values.routineVersionId = "drifted-version";
      },
    ],
  ] as const)("fails closed for applied Finisher drift: %s", (_label, mutate) => {
    const catalog = cleanCatalog(EXPECTED_MIGRATION_CHAIN.length);
    mutate(catalog);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length),
      catalog,
    });
    expect(result.schemaPreflightValid).toBe(false);
    expect([
      ...result.definitions.appliedManifestMissing,
      ...result.definitions.appliedManifestIncompatible,
    ]).not.toHaveLength(0);
  });

  it.each([
    [
      "row-level security is unexpectedly enabled",
      (catalog: CatalogSnapshot) => {
        catalog.tableSecurity!.find(
          (table) => table.table === "FinisherExecution",
        )!.rowSecurity = true;
      },
    ],
    [
      "enum ownership changes",
      (catalog: CatalogSnapshot) => {
        catalog.enums.find(
          (enumeration) => enumeration.name === "FinisherExecutionState",
        )!.owner = "trainer_app_runtime";
      },
    ],
    [
      "PUBLIC receives enum usage",
      (catalog: CatalogSnapshot) => {
        catalog.enums.find(
          (enumeration) => enumeration.name === "FinisherExecutionState",
        )!.privileges!.push({
          grantee: "PUBLIC",
          grantor: "trainer_finisher_owner",
          privilege: "USAGE",
          grantable: false,
        });
      },
    ],
    [
      "cleanup function owner changes",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (fn) => fn.name === "cleanup_expired_finisher_execution_commands",
        )!.owner = "trainer_app_runtime";
      },
    ],
    [
      "an unexpected role receives execute",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (fn) => fn.name === "cleanup_expired_finisher_execution_commands",
        )!.privileges!.push({
          grantee: "unexpected_cleanup",
          grantor: "trainer_finisher_cleanup",
          privilege: "EXECUTE",
          grantable: false,
        });
      },
    ],
    [
      "runtime receives direct command update",
      (catalog: CatalogSnapshot) => {
        catalog.tableSecurity!.find(
          (table) => table.table === "FinisherExecutionCommand",
        )!.privileges.push({
          grantee: "trainer_app_runtime",
          grantor: "trainer_finisher_owner",
          privilege: "UPDATE",
          grantable: false,
        });
      },
    ],
    [
      "role membership reaches cleanup authority",
      (catalog: CatalogSnapshot) => {
        catalog.roleMemberships!.push({
          role: "trainer_finisher_cleanup",
          member: "trainer_app_runtime",
          grantor: "trainer",
          grantorIsBootstrapSuperuser: false,
          adminOption: false,
          inheritOption: false,
          setOption: false,
        });
      },
    ],
    [
      "cleanup security mode weakens",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (fn) => fn.name === "cleanup_expired_finisher_execution_commands",
        )!.securityDefiner = false;
      },
    ],
    [
      "cleanup search path weakens",
      (catalog: CatalogSnapshot) => {
        catalog.functions.find(
          (fn) => fn.name === "cleanup_expired_finisher_execution_commands",
        )!.configuration = ["search_path=pg_catalog, public"];
      },
    ],
    [
      "a neutrally named static SQL helper touches tombstones",
      (catalog: CatalogSnapshot) => {
        catalog.functions.push({
          name: "command_cleanup_bypass",
          definition:
            'CREATE FUNCTION command_cleanup_bypass() RETURNS void LANGUAGE sql AS $$ UPDATE "FinisherExecutionCommand" SET "response" = NULL $$',
          language: "sql",
          arguments: "",
          resultType: "void",
          volatility: "v",
          securityDefiner: true,
          leakproof: false,
          strict: false,
          parallel: "u",
          body: 'UPDATE "FinisherExecutionCommand" SET "response" = NULL',
          owner: "trainer_finisher_owner",
          privileges: [],
          referencedRelations: ["public.FinisherExecutionCommand"],
          referencedFunctions: [],
          triggerTables: [],
          mutationCapability: true,
          publicExecute: false,
        });
      },
    ],
    [
      "an unexpected trigger creates another mutation path",
      (catalog: CatalogSnapshot) => {
        catalog.triggers.push({
          table: "FinisherExecutionCommand",
          name: "command_audit_side_effect",
          definition:
            'CREATE TRIGGER command_audit_side_effect BEFORE UPDATE ON "FinisherExecutionCommand" FOR EACH ROW EXECUTE FUNCTION command_cleanup_bypass()',
          enabled: "O",
          functionName: "command_cleanup_bypass",
          functionOwner: "trainer_finisher_owner",
        });
      },
    ],
    [
      "the protected runtime cleanup grant is removed",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) =>
            item.name === "cleanup_expired_finisher_execution_commands",
        )!;
        fn.privileges = fn.privileges!.filter(
          (privilege) => privilege.grantee !== "trainer_app_runtime",
        );
      },
    ],
    [
      "a caller-controlled setting bypass returns",
      (catalog: CatalogSnapshot) => {
        const fn = catalog.functions.find(
          (item) => item.name === "guard_finisher_execution_command_tombstone",
        )!;
        fn.body = `${fn.body}\nPERFORM current_setting('trainer.finisher_command_cleanup', true);`;
      },
    ],
  ] as const)("fails Gate A privilege/dependency drift: %s", (_label, mutate) => {
    const catalog = cleanCatalog(EXPECTED_MIGRATION_CHAIN.length);
    mutate(catalog);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length),
      catalog,
    });
    expect(result.schemaPreflightValid).toBe(false);
    expect(
      result.partialObjects.unexpectedOwnedObjects.length +
        result.definitions.appliedManifestIncompatible.length,
    ).toBeGreaterThan(0);
  });

  it("reports a fully migrated state as clean but not Gate A applicable", () => {
    const catalog = cleanCatalog(EXPECTED_MIGRATION_CHAIN.length);
    const result = report({
      ledgerRows: appliedPrefix(EXPECTED_MIGRATION_CHAIN.length),
      catalog,
    });
    expect(result.chain).toMatchObject({
      applied: EXPECTED_MIGRATION_CHAIN.length,
      pending: 0,
      gateAApplicable: false,
    });
    expect(result.partialObjects.partiallyPresent).toEqual([]);
    expect(result.partialObjects.unexpectedPresent).toEqual([]);
    expect(result.migrationAuthorizationReady).toBe(false);
  });

  it("is deterministic and does not serialize connection secrets", () => {
    const first = JSON.stringify(report());
    const second = JSON.stringify(report());
    expect(first).toBe(second);
    expect(first).not.toContain("postgresql://");
    expect(first).not.toContain("password");
  });
});
