import { describe, expect, it } from "vitest";
import {
  hashPreSessionReadinessIdentity,
  hashPreSessionReadinessTarget,
  hashPreSessionReadinessValue,
  normalizePreSessionReadinessHashInput,
  parsePreSessionReadinessIdentity,
  type PreSessionReadinessIdentity,
} from "./pre-session-readiness-identity";

function futureIdentity(
  overrides: Partial<PreSessionReadinessIdentity> = {}
): PreSessionReadinessIdentity {
  return {
    identityContractVersion: 1,
    ownerId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 2,
    sessionInWeek: 1,
    target: {
      kind: "future_slot",
      mesocycleId: "meso-1",
      weekInMeso: 2,
      sessionInWeek: 1,
      slotId: "lower_a",
      slotIntent: "lower",
      seedRevision: {
        status: "exact_revision",
        revisionId: "seed-rev-2",
        revision: 2,
        payloadHash: "seed-hash-2",
      },
      slotSequenceHash: "sequence-hash",
    },
    readinessEvidenceFingerprint: "readiness-hash",
    projectionFingerprint: "projection-hash",
    ...overrides,
  };
}

describe("pre-session readiness identity", () => {
  it("normalizes object keys deterministically", () => {
    expect(normalizePreSessionReadinessHashInput({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(normalizePreSessionReadinessHashInput({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it("hashes equivalent identities identically and material changes differently", () => {
    const identity = futureIdentity();
    expect(hashPreSessionReadinessIdentity(identity)).toBe(
      hashPreSessionReadinessIdentity(parsePreSessionReadinessIdentity({
        projectionFingerprint: identity.projectionFingerprint,
        target: identity.target,
        ownerId: identity.ownerId,
        weekInMeso: identity.weekInMeso,
        mesocycleState: identity.mesocycleState,
        identityContractVersion: 1,
        readinessEvidenceFingerprint: identity.readinessEvidenceFingerprint,
        sessionInWeek: identity.sessionInWeek,
        activeMesocycleId: identity.activeMesocycleId,
      })!)
    );
    expect(hashPreSessionReadinessIdentity(futureIdentity({
      readinessEvidenceFingerprint: "new-readiness",
    }))).not.toBe(hashPreSessionReadinessIdentity(identity));
  });

  it("keeps the logical target stable across evidence changes", () => {
    expect(hashPreSessionReadinessTarget(futureIdentity())).toBe(
      hashPreSessionReadinessTarget(futureIdentity({
        projectionFingerprint: "new-projection",
      }))
    );
  });

  it("parses exact future-slot and materialized-workout identities", () => {
    expect(parsePreSessionReadinessIdentity(futureIdentity())).toEqual(
      futureIdentity()
    );
    expect(parsePreSessionReadinessIdentity({
      ...futureIdentity(),
      target: {
        kind: "materialized_workout",
        workoutId: "workout-1",
        workoutRevision: 4,
        prescriptionFingerprint: "prescription-hash",
      },
    })?.target).toEqual({
      kind: "materialized_workout",
      workoutId: "workout-1",
      workoutRevision: 4,
      prescriptionFingerprint: "prescription-hash",
    });
  });

  it("rejects unsupported versions and incomplete seed evidence", () => {
    expect(parsePreSessionReadinessIdentity({
      ...futureIdentity(),
      identityContractVersion: 2,
    })).toBeNull();
    expect(parsePreSessionReadinessIdentity({
      ...futureIdentity(),
      target: {
        ...futureIdentity().target,
        seedRevision: { status: "exact_revision", revisionId: "rev-1" },
      },
    })).toBeNull();
  });

  it("hashes payloads with the same canonical normalizer", () => {
    expect(hashPreSessionReadinessValue({ z: [2, 1], a: true })).toMatch(
      /^[a-f0-9]{64}$/
    );
  });
});
