import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import {
  FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE,
  FINISHER_PRINCIPAL_EVIDENCE_SCHEMA,
  FINISHER_PRINCIPAL_EVIDENCE_VERSION,
  FINISHER_PRINCIPAL_PROVISION_SCHEMA,
  FINISHER_PRINCIPAL_VERIFIER,
  FINISHER_RUNTIME_PASSWORD_VARIABLE,
  authorizationContext,
  canonicalEvidenceJson,
  evidenceSignature,
  evidenceSignatureMatches,
  isFullCommitSha,
  parsePrincipalProvisionEvidence,
  projectFingerprint,
  sha256Hex,
  targetFingerprint,
  type FinisherPrincipalBinding,
  type FinisherPrincipalProvisionEvidence,
  type FinisherPrincipalVerificationEvidence,
} from "@/lib/operations/finisher-principal-contract";
import {
  provisionFinisherPrincipals,
  verifyFinisherPrincipalsReadOnly,
} from "@/lib/operations/finisher-principal-postgres";

type Mode = "provision" | "verify";
type EnvironmentName = "production" | "disposable";

const HELP = `Trainer Finisher prerequisite principal workflow

Verification (zero database writes):
  npm run ops:finisher-principals -- --mode verify --environment production \\
    --env-file <reviewed-env> --expected-project-reference <20-char-ref> \\
    --expected-database postgres --required-application-commit <full-sha> \\
    --provisioning-evidence-file <provision.json> --evidence-file <new-verify.json>

Provisioning (protected database-administrator write):
  npm run ops:finisher-principals -- --mode provision --environment production \\
    --env-file <reviewed-env> --expected-project-reference <20-char-ref> \\
    --expected-database postgres --required-application-commit <full-sha> \\
    --authorization-evidence-file <reviewed-authorization.json> \\
    --write --confirm-remote-write \\
    --confirm-principal-provisioning trainer-principals:<20-char-ref> \\
    --evidence-file <new-provision.json>

The environment file supplies DIRECT_URL, the evidence key, and write-pause
state. Provisioning reads TRAINER_APP_RUNTIME_PASSWORD only from the
operator-controlled process environment.
The command never prints connection strings, credentials, or password hashes.`;

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
  try {
    return dotenv.parse(readFileSync(envFile));
  } catch {
    throw new Error(
      "Unable to load the explicitly named environment file.",
    );
  }
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
  const unsigned = {
    repositoryHead: options.repositoryHead,
    requiredApplicationCommit: options.requiredApplicationCommit,
    targetMigration: "20260728120000_add_finishers_phase_1" as const,
    environment: options.environment,
    targetClassification: options.classification,
    targetFingerprint: targetFingerprint(options.hostname),
    projectFingerprint: projectFingerprint(options.expectedProjectReference),
    database: options.database,
  };
  return {
    ...unsigned,
    authorizationContext: authorizationContext(unsigned),
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
  }>(
    "SELECT current_database() AS database_name, current_user AS current_role",
  );
  const observed = result.rows[0];
  if (!observed || observed.database_name !== expectedDatabase) {
    throw new Error("Connected database identity does not match the expected target.");
  }
  if (
    [
      "trainer_app_runtime",
      "trainer_finisher_owner",
      "trainer_finisher_cleanup",
    ].includes(observed.current_role)
  ) {
    throw new Error(
      "Principal administration requires a distinct administrator connection.",
    );
  }
}

function validateProvisionAuthorization(options: {
  argv: string[];
  environmentName: EnvironmentName;
  expectedProjectReference: string;
  parsedEnvironment: Record<string, string>;
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
  if (options.environmentName === "production") {
    if (!options.argv.includes("--confirm-remote-write")) {
      throw new Error(
        "Production provisioning requires --confirm-remote-write.",
      );
    }
    if (options.parsedEnvironment.TRAINER_WRITE_PAUSE !== "enabled") {
      throw new Error(
        "Production principal provisioning requires a verified TRAINER_WRITE_PAUSE=enabled environment.",
      );
    }
    const authorizationEvidencePath = requiredArgument(
      options.argv,
      "--authorization-evidence-file",
    );
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(
        readFileSync(resolve(authorizationEvidencePath), "utf8"),
      ) as Record<string, unknown>;
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        throw new Error("invalid evidence shape");
      }
    } catch {
      throw new Error(
        "Production provisioning requires a readable authorization evidence JSON object.",
      );
    }
    const now = Date.now();
    const fresh = (value: unknown): boolean => {
      if (typeof value !== "string") return false;
      const timestamp = Date.parse(value);
      return (
        Number.isFinite(timestamp) &&
        timestamp <= now &&
        now - timestamp <= 30 * 60_000
      );
    };
    const recovery =
      evidence.recoveryPoint &&
      typeof evidence.recoveryPoint === "object" &&
      !Array.isArray(evidence.recoveryPoint)
        ? (evidence.recoveryPoint as Record<string, unknown>)
        : {};
    const writeBoundary =
      evidence.writeBoundary &&
      typeof evidence.writeBoundary === "object" &&
      !Array.isArray(evidence.writeBoundary)
        ? (evidence.writeBoundary as Record<string, unknown>)
        : {};
    const head = repositoryHead();
    if (
      evidence.productionDeploymentCommit !== head ||
      evidence.requiredApplicationCommit !== head ||
      !fresh(evidence.deploymentVerifiedAt) ||
      recovery.verified !== true ||
      typeof recovery.providerProjectIdentity !== "string" ||
      recovery.providerProjectIdentity.trim().length === 0 ||
      typeof recovery.databaseIdentity !== "string" ||
      recovery.databaseIdentity.trim().length === 0 ||
      recovery.retentionConfirmed !== true ||
      recovery.recoverabilityConfirmed !== true ||
      recovery.freshForExecution !== true ||
      !fresh(recovery.operatorVerifiedAt) ||
      writeBoundary.ready !== true ||
      writeBoundary.mechanism !== "production-write-gate" ||
      !fresh(writeBoundary.verifiedAt)
    ) {
      throw new Error(
        "Production provisioning requires fresh commit-bound deployment, recovery-point, and write-pause evidence.",
      );
    }
  } else if (options.argv.includes("--confirm-remote-write")) {
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
  const signingKey =
    parsedEnvironment[FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE];
  if (!directUrl) {
    throw new Error(
      "The explicitly named environment file must define DIRECT_URL.",
    );
  }
  if (!signingKey || signingKey.length < 32) {
    throw new Error(
      `The explicitly named environment file must define ${FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE} with at least 32 characters.`,
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
      parsedEnvironment,
    });
    const runtimePassword = process.env[FINISHER_RUNTIME_PASSWORD_VARIABLE];
    if (!runtimePassword) {
      throw new Error(
        `Provisioning requires ${FINISHER_RUNTIME_PASSWORD_VARIABLE} in the explicit environment file.`,
      );
    }
    const startedAt = new Date().toISOString();
    const client = new Client({
      connectionString: directUrl,
      connectionTimeoutMillis: 5_000,
    });
    try {
      await client.connect();
      await verifyConnectedIdentity(client, expectedDatabase);
      const result = await provisionFinisherPrincipals(client, runtimePassword);
      const unsigned: Omit<FinisherPrincipalProvisionEvidence, "signature"> = {
        schema: FINISHER_PRINCIPAL_PROVISION_SCHEMA,
        version: FINISHER_PRINCIPAL_EVIDENCE_VERSION,
        verifier: FINISHER_PRINCIPAL_VERIFIER,
        binding,
        startedAt,
        completedAt: new Date().toISOString(),
        databaseWrites: result.databaseWrites,
        createdPrincipals: result.createdPrincipals,
        credentialConfigured: result.credentialConfigured,
      };
      const evidence: FinisherPrincipalProvisionEvidence = {
        ...unsigned,
        signature: evidenceSignature(unsigned, signingKey),
      };
      writeEvidence(evidenceFile, evidence);
      console.log(
        `Finisher principal provisioning verified: target=${binding.targetFingerprint} ` +
          `created=${result.createdPrincipals.length} credentialConfigured=${result.credentialConfigured} ` +
          `databaseWrites=${result.databaseWrites}.`,
      );
    } finally {
      await client.end().catch(() => undefined);
    }
    return;
  }

  if (
    argv.includes("--write") ||
    argv.includes("--confirm-remote-write") ||
    readArgument(argv, "--confirm-principal-provisioning")
  ) {
    throw new Error("Verification mode rejects every provisioning/write flag.");
  }
  const provisionEvidencePath = requiredArgument(
    argv,
    "--provisioning-evidence-file",
  );
  const provisionEvidenceRaw = JSON.parse(
    readFileSync(resolve(provisionEvidencePath), "utf8"),
  ) as unknown;
  const provisionEvidence =
    parsePrincipalProvisionEvidence(provisionEvidenceRaw);
  if (
    provisionEvidence.schema !== FINISHER_PRINCIPAL_PROVISION_SCHEMA ||
    provisionEvidence.version !== FINISHER_PRINCIPAL_EVIDENCE_VERSION ||
    provisionEvidence.verifier !== FINISHER_PRINCIPAL_VERIFIER ||
    !evidenceSignatureMatches(
      provisionEvidence as unknown as Record<string, unknown>,
      signingKey,
    ) ||
    canonicalEvidenceJson(provisionEvidence.binding) !==
      canonicalEvidenceJson(binding)
  ) {
    throw new Error(
      "Provisioning evidence is invalid or belongs to another authorization context.",
    );
  }

  const verificationStartedAt = new Date().toISOString();
  if (
    Date.parse(provisionEvidence.completedAt) >
    Date.parse(verificationStartedAt)
  ) {
    throw new Error("Provisioning evidence completion is after verification start.");
  }
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    await verifyConnectedIdentity(client, expectedDatabase);
    const roles = await verifyFinisherPrincipalsReadOnly(client);
    const unsigned: Omit<
      FinisherPrincipalVerificationEvidence,
      "signature"
    > = {
      schema: FINISHER_PRINCIPAL_EVIDENCE_SCHEMA,
      version: FINISHER_PRINCIPAL_EVIDENCE_VERSION,
      verifier: FINISHER_PRINCIPAL_VERIFIER,
      binding,
      provisioningEvidenceHash: sha256Hex(
        canonicalEvidenceJson(provisionEvidence),
      ),
      provisioningCompletedAt: provisionEvidence.completedAt,
      verificationStartedAt,
      verifiedAt: new Date().toISOString(),
      readOnlyTransaction: true as const,
      databaseWrites: 0 as const,
      roles,
    };
    const evidence: FinisherPrincipalVerificationEvidence = {
      ...unsigned,
      signature: evidenceSignature(unsigned, signingKey),
    };
    writeEvidence(evidenceFile, evidence);
    console.log(
      `Finisher principal verification passed: target=${binding.targetFingerprint} ` +
        `roles=${roles.length} databaseWrites=0.`,
    );
  } finally {
    await client.end().catch(() => undefined);
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
    message.startsWith("FINISHER_PRINCIPAL_")
      ? message
      : "Finisher principal workflow failed without emitting connection or credential details.";
  console.error(safe);
  process.exitCode = 1;
});
