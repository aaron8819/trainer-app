import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import {
  FINISHER_PRINCIPAL_AUDIT_SCHEMA,
  FINISHER_PRINCIPAL_AUDIT_VERSION,
  FINISHER_PRINCIPAL_VERIFIER,
  FINISHER_RUNTIME_PASSWORD_VARIABLE,
  FINISHER_TARGET_MIGRATION,
  isFullCommitSha,
  projectFingerprint,
  targetFingerprint,
  type FinisherPrincipalAuditRecord,
  type FinisherPrincipalBinding,
} from "@/lib/operations/finisher-principal-contract";
import {
  provisionFinisherPrincipals,
  verifyRuntimeCredentialReadOnly,
  verifyFinisherPrincipalsReadOnly,
} from "@/lib/operations/finisher-principal-postgres";

type Mode = "provision" | "verify";
type EnvironmentName = "production" | "disposable";

const HELP = `Trainer Finisher prerequisite principal workflow

Fresh live verification (zero database writes):
  npm run ops:finisher-principals -- --mode verify --environment production \\
    --env-file <reviewed-env> --expected-project-reference <20-char-ref> \\
    --expected-database postgres --required-application-commit <full-sha> \\
    --evidence-file <new-audit-record.json>

Provisioning (protected database-administrator write):
  npm run ops:finisher-principals -- --mode provision --environment production \\
    --env-file <reviewed-env> --expected-project-reference <20-char-ref> \\
    --expected-database postgres --required-application-commit <full-sha> \\
    --write --confirm-remote-write \\
    --confirm-principal-provisioning trainer-principals:<20-char-ref> \\
    --evidence-file <new-audit-record.json>

The environment file supplies only the reviewed database target. The runtime
password is process-scoped in TRAINER_APP_RUNTIME_PASSWORD and is proven by a
bounded read-only login to the independently resolved target. Generated JSON is
a sanitized audit record, never an authorization token or attestation.

Production provisioning currently fails closed until canonical provider-backed
PITR coverage and write-pause verification is available to this command. The
command never accepts operator-authored JSON as a replacement for those facts.`;

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function requiredArgument(argv: string[], name: string): string {
  const value = readArgument(argv, name);
  if (!value) throw new Error(`Missing required ${name} <value>.`);
  return value;
}

function loadExplicitEnvironment(argv: string[]): Record<string, string> {
  const envFile = resolve(requiredArgument(argv, "--env-file"));
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(readFileSync(envFile));
  } catch {
    throw new Error("Unable to load the explicitly named environment file.");
  }
  if (parsed[FINISHER_RUNTIME_PASSWORD_VARIABLE]) {
    throw new Error(
      `${FINISHER_RUNTIME_PASSWORD_VARIABLE} must be process-scoped, not stored in the environment file.`,
    );
  }
  return parsed;
}

function repositoryHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function validateTarget(options: {
  argv: string[];
  directUrl: string;
  environment: EnvironmentName;
  expectedProjectReference: string;
  expectedDatabase: string;
}): {
  hostname: string;
  classification: "remote" | "disposable";
} {
  let url: URL;
  try {
    url = new URL(options.directUrl);
  } catch {
    throw new Error("DIRECT_URL in the explicit environment file is invalid.");
  }
  const hostname = url.hostname.toLowerCase();
  const database = url.pathname.replace(/^\//, "");
  if (database !== options.expectedDatabase) {
    throw new Error("DIRECT_URL resolves to the wrong database identity.");
  }

  if (options.environment === "production") {
    if (!/^[a-z0-9]{20}$/.test(options.expectedProjectReference)) {
      throw new Error(
        "Production requires an exact 20-character Supabase project reference.",
      );
    }
    if (hostname !== `db.${options.expectedProjectReference}.supabase.co`) {
      throw new Error(
        "DIRECT_URL does not resolve to the expected production project.",
      );
    }
    if ((url.port || "5432") !== "5432") {
      throw new Error(
        "Production principal workflow requires the direct PostgreSQL port.",
      );
    }
    if (
      !["require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    ) {
      throw new Error(
        "Production principal workflow requires an approved TLS mode.",
      );
    }
    if (options.argv.includes("--confirm-disposable")) {
      throw new Error(
        "--confirm-disposable cannot be used with --environment production.",
      );
    }
    return { hostname, classification: "remote" };
  }

  if (!options.argv.includes("--confirm-disposable")) {
    throw new Error(
      "Disposable execution requires --confirm-disposable before connection.",
    );
  }
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) &&
    !hostname.endsWith(".localhost")
  ) {
    throw new Error("Disposable execution requires a loopback database target.");
  }
  if (options.expectedProjectReference !== "disposable") {
    throw new Error(
      "Disposable execution requires --expected-project-reference disposable.",
    );
  }
  return { hostname, classification: "disposable" };
}

function buildBinding(options: {
  repositoryHead: string;
  requiredApplicationCommit: string;
  environment: EnvironmentName;
  classification: "remote" | "disposable";
  hostname: string;
  expectedProjectReference: string;
  database: string;
}): FinisherPrincipalBinding {
  return {
    repositoryHead: options.repositoryHead,
    requiredApplicationCommit: options.requiredApplicationCommit,
    targetMigration: FINISHER_TARGET_MIGRATION,
    environment: options.environment,
    targetClassification: options.classification,
    targetFingerprint: targetFingerprint(options.hostname),
    projectFingerprint: projectFingerprint(options.expectedProjectReference),
    database: options.database,
  };
}

function writeEvidence(path: string, evidence: unknown): void {
  writeFileSync(resolve(path), `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function verifyConnectedIdentity(
  client: Client,
  expectedDatabase: string,
): Promise<void> {
  const result = await client.query<{
    database_name: string;
    current_role: string;
    session_role: string;
  }>(
    "SELECT current_database() AS database_name, current_user AS current_role, session_user AS session_role",
  );
  const observed = result.rows[0];
  if (!observed || observed.database_name !== expectedDatabase) {
    throw new Error("Connected database identity does not match the expected target.");
  }
  if (
    observed.current_role !== observed.session_role ||
    [
      "trainer_app_runtime",
      "trainer_finisher_owner",
      "trainer_finisher_cleanup",
    ].includes(observed.current_role)
  ) {
    throw new Error(
      "Principal administration requires a distinct direct administrator session.",
    );
  }
}

function validateProvisionAuthorization(options: {
  argv: string[];
  environmentName: EnvironmentName;
  expectedProjectReference: string;
}): void {
  if (!options.argv.includes("--write")) {
    throw new Error("Provisioning requires explicit --write authorization.");
  }
  const expectedConfirmation = `trainer-principals:${options.expectedProjectReference}`;
  if (
    readArgument(options.argv, "--confirm-principal-provisioning") !==
    expectedConfirmation
  ) {
    throw new Error(
      "Provisioning requires the exact project-bound --confirm-principal-provisioning value.",
    );
  }
  if (readArgument(options.argv, "--authorization-evidence-file")) {
    throw new Error(
      "Operator-authored authorization evidence cannot replace live provider verification.",
    );
  }
  if (options.environmentName === "production") {
    if (!options.argv.includes("--confirm-remote-write")) {
      throw new Error(
        "Production provisioning requires --confirm-remote-write.",
      );
    }
    throw new Error(
      "PRODUCTION_PRINCIPAL_PROVISIONING_BLOCKED: canonical provider verification for PITR coverage and the active write pause is unavailable; fail closed without connecting.",
    );
  }
  if (options.argv.includes("--confirm-remote-write")) {
    throw new Error(
      "--confirm-remote-write is invalid for a disposable target.",
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const mode = requiredArgument(argv, "--mode") as Mode;
  const environmentName = requiredArgument(
    argv,
    "--environment",
  ) as EnvironmentName;
  if (!["provision", "verify"].includes(mode)) {
    throw new Error("--mode must be provision or verify.");
  }
  if (!["production", "disposable"].includes(environmentName)) {
    throw new Error("--environment must be production or disposable.");
  }

  const expectedProjectReference = requiredArgument(
    argv,
    "--expected-project-reference",
  );
  const expectedDatabase = requiredArgument(argv, "--expected-database");
  const requiredApplicationCommit = requiredArgument(
    argv,
    "--required-application-commit",
  );
  const evidenceFile = requiredArgument(argv, "--evidence-file");
  const head = repositoryHead();
  if (
    !isFullCommitSha(requiredApplicationCommit) ||
    requiredApplicationCommit !== head
  ) {
    throw new Error(
      "The required application commit must exactly match the checked-out repository HEAD.",
    );
  }

  const parsedEnvironment = loadExplicitEnvironment(argv);
  const directUrl = parsedEnvironment.DIRECT_URL;
  if (!directUrl) {
    throw new Error(
      "The explicitly named environment file must define DIRECT_URL.",
    );
  }
  const runtimePassword = process.env[FINISHER_RUNTIME_PASSWORD_VARIABLE];
  if (!runtimePassword) {
    throw new Error(
      `${FINISHER_RUNTIME_PASSWORD_VARIABLE} is required in the process environment for exact runtime credential verification.`,
    );
  }

  const target = validateTarget({
    argv,
    directUrl,
    environment: environmentName,
    expectedProjectReference,
    expectedDatabase,
  });
  const binding = buildBinding({
    repositoryHead: head,
    requiredApplicationCommit,
    environment: environmentName,
    classification: target.classification,
    hostname: target.hostname,
    expectedProjectReference,
    database: expectedDatabase,
  });

  if (mode === "provision") {
    validateProvisionAuthorization({
      argv,
      environmentName,
      expectedProjectReference,
    });
  } else if (
    argv.includes("--write") ||
    argv.includes("--confirm-remote-write") ||
    readArgument(argv, "--confirm-principal-provisioning") ||
    readArgument(argv, "--authorization-evidence-file")
  ) {
    throw new Error("Verification mode rejects every provisioning/write flag.");
  }

  const startedAt = new Date().toISOString();
  const administrator = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  try {
    await administrator.connect();
    await verifyConnectedIdentity(administrator, expectedDatabase);
    const credentialBefore = await verifyRuntimeCredentialReadOnly({
      directUrl,
      expectedDatabase,
      password: runtimePassword,
    });

    if (mode === "provision") {
      const result = await provisionFinisherPrincipals(administrator, {
        runtimePassword,
        existingRuntimeCredentialVerified: credentialBefore,
      });
      const credentialAfter = await verifyRuntimeCredentialReadOnly({
        directUrl,
        expectedDatabase,
        password: runtimePassword,
      });
      if (!credentialAfter) {
        throw new Error("FINISHER_PRINCIPAL_RUNTIME_CREDENTIAL_MISMATCH");
      }
      const liveState = await verifyFinisherPrincipalsReadOnly(administrator, {
        phase: "migration_capable",
        runtimeCredentialVerified: true,
      });
      const evidence: FinisherPrincipalAuditRecord = {
        schema: FINISHER_PRINCIPAL_AUDIT_SCHEMA,
        version: FINISHER_PRINCIPAL_AUDIT_VERSION,
        verifier: FINISHER_PRINCIPAL_VERIFIER,
        authority: "sanitized_audit_record_only",
        binding,
        operation: "provision",
        startedAt,
        completedAt: new Date().toISOString(),
        readOnlyTransaction: false,
        databaseWrites: result.databaseWrites,
        createdPrincipals: result.createdPrincipals,
        credentialConfigured: result.credentialConfigured,
        liveState,
      };
      writeEvidence(evidenceFile, evidence);
      console.log(
        `Finisher principal provisioning verified: target=${binding.targetFingerprint} ` +
          `phase=${liveState.phase} created=${result.createdPrincipals.length} ` +
          `credentialConfigured=${result.credentialConfigured} databaseWrites=${result.databaseWrites}.`,
      );
      return;
    }

    if (!credentialBefore) {
      throw new Error("FINISHER_PRINCIPAL_RUNTIME_CREDENTIAL_MISMATCH");
    }
    const liveState = await verifyFinisherPrincipalsReadOnly(administrator, {
      phase: "migration_capable",
      runtimeCredentialVerified: true,
    });
    const evidence: FinisherPrincipalAuditRecord = {
      schema: FINISHER_PRINCIPAL_AUDIT_SCHEMA,
      version: FINISHER_PRINCIPAL_AUDIT_VERSION,
      verifier: FINISHER_PRINCIPAL_VERIFIER,
      authority: "sanitized_audit_record_only",
      binding,
      operation: "verify",
      startedAt,
      completedAt: new Date().toISOString(),
      readOnlyTransaction: true,
      databaseWrites: 0,
      createdPrincipals: [],
      credentialConfigured: false,
      liveState,
    };
    writeEvidence(evidenceFile, evidence);
    console.log(
      `Finisher principal verification passed: target=${binding.targetFingerprint} ` +
        `phase=${liveState.phase} roles=${liveState.roles.length} databaseWrites=0.`,
    );
  } finally {
    await administrator.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const safe =
    message.startsWith("Missing required") ||
    message.startsWith("--") ||
    message.startsWith("Production") ||
    message.startsWith("Disposable") ||
    message.startsWith("DIRECT_URL") ||
    message.startsWith("The explicitly named environment file") ||
    message.startsWith("The required application commit") ||
    message.startsWith("Connected database identity") ||
    message.startsWith("Principal administration") ||
    message.startsWith("Provisioning") ||
    message.startsWith("Verification mode") ||
    message.startsWith("Operator-authored") ||
    message.startsWith("TRAINER_") ||
    message.startsWith("FINISHER_PRINCIPAL_") ||
    message.startsWith("PRODUCTION_PRINCIPAL_")
      ? message
      : "Finisher principal workflow failed without emitting connection or credential details.";
  console.error(safe);
  process.exitCode = 1;
});
