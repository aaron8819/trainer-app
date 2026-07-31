import { describe, expect, it } from "vitest";
import {
  FINISHER_PRINCIPAL_EVIDENCE_SCHEMA,
  FINISHER_PRINCIPAL_EVIDENCE_VERSION,
  FINISHER_PRINCIPAL_VERIFIER,
  authorizationContext,
  evidenceSignature,
  expectedEvidenceRoles,
  verifyPrincipalEvidenceForGate,
  type FinisherPrincipalVerificationEvidence,
} from "./finisher-principal-contract";

const KEY = "test-finisher-principal-evidence-key-32";
const HEAD = "a".repeat(40);
const VERIFIED_AT = "2026-07-30T12:00:00.000Z";
const EVALUATED_AT = "2026-07-30T12:10:00.000Z";

function evidence(
  mutate?: (value: FinisherPrincipalVerificationEvidence) => void,
): FinisherPrincipalVerificationEvidence {
  const unsignedBinding = {
    repositoryHead: HEAD,
    requiredApplicationCommit: HEAD,
    targetMigration: "20260728120000_add_finishers_phase_1" as const,
    environment: "production" as const,
    targetClassification: "remote" as const,
    targetFingerprint: "target123456",
    projectFingerprint: "project123456789",
    database: "postgres",
  };
  const unsigned: FinisherPrincipalVerificationEvidence = {
    schema: FINISHER_PRINCIPAL_EVIDENCE_SCHEMA,
    version: FINISHER_PRINCIPAL_EVIDENCE_VERSION,
    verifier: FINISHER_PRINCIPAL_VERIFIER,
    binding: {
      ...unsignedBinding,
      authorizationContext: authorizationContext(unsignedBinding),
    },
    provisioningEvidenceHash: "b".repeat(64),
    provisioningCompletedAt: "2026-07-30T11:58:00.000Z",
    verificationStartedAt: "2026-07-30T11:59:00.000Z",
    verifiedAt: VERIFIED_AT,
    readOnlyTransaction: true as const,
    databaseWrites: 0 as const,
    roles: expectedEvidenceRoles(),
    signature: "",
  };
  const result = structuredClone(unsigned);
  mutate?.(result);
  result.signature = evidenceSignature(result, KEY);
  return result;
}

function verify(value: FinisherPrincipalVerificationEvidence | undefined) {
  return verifyPrincipalEvidenceForGate({
    evidence: value,
    signingKey: KEY,
    repositoryHead: HEAD,
    requiredApplicationCommit: HEAD,
    target: {
      classification: "remote",
      fingerprint: "target123456",
      projectFingerprint: "project123456789",
      database: "postgres",
    },
    evaluatedAt: EVALUATED_AT,
    maxAgeMinutes: 30,
  });
}

describe("Finisher prerequisite principal evidence", () => {
  it("accepts only the canonical signed, fresh, zero-write contract", () => {
    expect(verify(evidence())).toEqual({ valid: true, reasons: [] });
  });

  it.each([
    ["missing", undefined, "missing"],
    [
      "stale",
      evidence((value) => {
        value.verifiedAt = "2026-07-30T10:00:00.000Z";
      }),
      "stale_or_invalid_timestamp",
    ],
    [
      "cross-commit",
      evidence((value) => {
        value.binding.repositoryHead = "c".repeat(40);
      }),
      "authorization_context_mismatch",
    ],
    [
      "wrong target",
      evidence((value) => {
        value.binding.targetFingerprint = "wrong-target";
      }),
      "target_mismatch",
    ],
    [
      "write-reporting",
      evidence((value) => {
        (value as { databaseWrites: number }).databaseWrites = 1;
      }),
      "writes_reported",
    ],
    [
      "verification-before-provisioning",
      evidence((value) => {
        value.provisioningCompletedAt = "2026-07-30T12:01:00.000Z";
      }),
      "verification_order_invalid",
    ],
  ] as const)("fails closed for %s evidence", (_label, value, reason) => {
    expect(verify(value).reasons).toContain(reason);
  });

  it("rejects a caller-authored claim without the canonical signature", () => {
    const value = evidence();
    value.roles[0].superuser = true;
    expect(verify(value).reasons).toContain("signature_invalid");
  });

  it.each([
    "canLogin",
    "inherit",
    "superuser",
    "createDb",
    "createRole",
    "replication",
    "bypassRls",
    "publicSchemaCreate",
  ] as const)("rejects an incorrect %s attribute", (attribute) => {
    const value = evidence((candidate) => {
      candidate.roles[0][attribute] = !candidate.roles[0][attribute];
    });
    expect(verify(value).reasons).toContain("principal_contract_mismatch");
  });

  it.each([
    [
      "missing principal",
      (value: FinisherPrincipalVerificationEvidence): void => {
        value.roles.pop();
      },
    ],
    [
      "extra granted membership",
      (value: FinisherPrincipalVerificationEvidence): void => {
        value.roles[0].membershipsGranted.push("unexpected");
      },
    ],
    [
      "extra received membership",
      (value: FinisherPrincipalVerificationEvidence): void => {
        value.roles[1].membershipsReceived.push("unexpected");
      },
    ],
    [
      "default privilege",
      (value: FinisherPrincipalVerificationEvidence): void => {
        value.roles[2].defaultPrivilegeCount = 1;
      },
    ],
    [
      "missing runtime credential",
      (value: FinisherPrincipalVerificationEvidence): void => {
        value.roles[0].credential = "not_configured";
      },
    ],
  ] as const)("rejects %s", (_label, mutate) => {
    const value = evidence(mutate);
    expect(verify(value).reasons).toContain("principal_contract_mismatch");
  });

  it("contains no credential, connection string, or password hash", () => {
    const serialized = JSON.stringify(evidence());
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("SCRAM-SHA-256$");
    expect(serialized.toLowerCase()).not.toContain("password");
  });
});
