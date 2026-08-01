import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  verifyProductionWriteGate,
  verifyWriteGateContract,
} from "./production-write-gate-verifier";

function fixture(name: string): string {
  return resolve(
    process.cwd(),
    "scripts",
    "fixtures",
    "production-write-gate",
    name,
  );
}

describe("production write-gate static verification", () => {
  it("covers every classified application mutation before any mutation work", () => {
    const result = verifyProductionWriteGate(process.cwd());
    expect(result.failures).toEqual([]);
    expect(result.mutationRoutes).toHaveLength(35);
  });

  it("rejects a GET route with a direct upsert", () => {
    expect(
      verifyProductionWriteGate(fixture("get-upsert"), { fixtureMode: true })
        .failures,
    ).toContain(
      "Read surface reaches a database write: src/app/api/example/route.ts#GET",
    );
  });

  it("rejects a read route that reaches an imported mutation helper", () => {
    expect(
      verifyProductionWriteGate(fixture("indirect-read-write"), {
        fixtureMode: true,
      }).failures,
    ).toContain(
      "Read surface reaches a database write: src/app/api/example/route.ts#GET",
    );
  });

  it("rejects a registered production writer without target-aware enforcement", () => {
    expect(
      verifyProductionWriteGate(fixture("unguarded-command"), {
        fixtureMode: true,
      }).failures,
    ).toContain(
      "Registered production-capable command lacks target-aware pause enforcement: db:seed",
    );
  });

  it("rejects request parsing and owner provisioning before a mutation gate", () => {
    const failures = verifyProductionWriteGate(fixture("mutation-before-gate"), {
      fixtureMode: true,
    }).failures;
    expect(failures).toContain(
      "Mutation work occurs before the central gate for profile/setup/route.ts#POST",
    );
    expect(failures).toContain(
      "Owner provisioning occurs before the central gate for profile/setup/route.ts#POST",
    );
  });

  it("rejects a stale enforcement declaration", () => {
    expect(verifyWriteGateContract(fixture("stale-contract"))).toEqual(
      expect.arrayContaining([
        "Stale production write-status contract version",
        "Stale production write-enforcement contract version",
      ]),
    );
  });
});
