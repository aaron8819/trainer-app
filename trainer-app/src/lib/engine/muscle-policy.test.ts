import { describe, expect, it } from "vitest";
import { MUSCLE_SEED_ROWS } from "../../../prisma/muscle-seed-data";
import {
  CANONICAL_MUSCLE_IDS,
  getMusclePolicyByDisplayName,
  MUSCLE_POLICIES,
  MUSCLE_POLICY_BY_ID,
} from "./muscle-policy";
import { VOLUME_LANDMARKS } from "./volume-landmarks";

describe("canonical muscle policy", () => {
  it("defines every stable muscle identifier exactly once", () => {
    expect(MUSCLE_POLICIES).toHaveLength(CANONICAL_MUSCLE_IDS.length);
    expect(new Set(CANONICAL_MUSCLE_IDS).size).toBe(CANONICAL_MUSCLE_IDS.length);
    expect(new Set(MUSCLE_POLICIES.map((policy) => policy.id)).size).toBe(
      MUSCLE_POLICIES.length
    );
    expect(new Set(MUSCLE_POLICIES.map((policy) => policy.displayName)).size).toBe(
      MUSCLE_POLICIES.length
    );
    expect(Object.keys(MUSCLE_POLICY_BY_ID).sort()).toEqual(
      [...CANONICAL_MUSCLE_IDS].sort()
    );
  });

  it("derives runtime landmarks and actual Prisma seed inputs from the same policy", () => {
    const policyNames = MUSCLE_POLICIES.map((policy) => policy.displayName).sort();
    const seedNames = MUSCLE_SEED_ROWS.map((row) => row.name).sort();
    const runtimeNames = Object.keys(VOLUME_LANDMARKS).sort();

    expect(seedNames).toEqual(policyNames);
    expect(runtimeNames).toEqual(policyNames);

    for (const policy of MUSCLE_POLICIES) {
      expect(MUSCLE_SEED_ROWS.filter((row) => row.name === policy.displayName)).toEqual([
        {
          name: policy.displayName,
          ...policy.volume,
          sraHours: policy.defaultSraHours,
        },
      ]);
      expect(VOLUME_LANDMARKS[policy.displayName]).toEqual({
        ...policy.volume,
        sraHours: policy.defaultSraHours,
      });
    }
  });

  it("keeps landmarks ordered and SRA values within the supported range", () => {
    for (const policy of MUSCLE_POLICIES) {
      expect(policy.volume.mev).toBeLessThanOrEqual(policy.volume.mav);
      expect(policy.volume.mav).toBeLessThanOrEqual(policy.volume.mrv);
      expect(Number.isFinite(policy.defaultSraHours)).toBe(true);
      expect(policy.defaultSraHours).toBeGreaterThanOrEqual(12);
      expect(policy.defaultSraHours).toBeLessThanOrEqual(168);
    }
  });

  it("does not accept unsupported display-name aliases", () => {
    expect(getMusclePolicyByDisplayName("Triceps")?.id).toBe("triceps");
    expect(getMusclePolicyByDisplayName("tricep")).toBeUndefined();
    expect(getMusclePolicyByDisplayName("front deltoids")).toBeUndefined();
  });
});
