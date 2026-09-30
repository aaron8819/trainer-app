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
    expect(result.mutationRoutes).toHaveLength(57);
    expect(result.mutationRoutes).toContainEqual(["trainer2/drafts/activate/route.ts#POST", "mesocycle_acceptance"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/executions/start/route.ts#POST", "workout_materialization"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/executions/corrections/route.ts#POST", "set_logging"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/drafts/create/route.ts#POST", "trainer2_draft"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/drafts/edit/route.ts#POST", "trainer2_draft"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/executions/skip-set/route.ts#POST", "set_logging"]);
    expect(result.mutationRoutes).toContainEqual(["trainer2/executions/swap-exercise/route.ts#POST", "set_logging"]);
    expect(result.operationalCommands).toHaveLength(21);
  });

  it("fails closed on an unsupported route declaration", () => {
    expect(
      verifyProductionWriteGate(fixture("unsupported-route-export"), { fixtureMode: true })
        .failures,
    ).toContain(
      "Unsupported route method declaration: example/route.ts#POST",
    );
  });

  it("rejects a Trainer2 result writer without its central gate", () => {
    expect(verifyProductionWriteGate(fixture("missing-trainer2-gate"), { fixtureMode: true }).failures)
      .toContain("Missing central gate for trainer2/executions/results/route.ts#POST (set_logging)");
  });

  it("rejects a Trainer2 result writer classified under another operation", () => {
    expect(verifyProductionWriteGate(fixture("wrong-trainer2-operation"), { fixtureMode: true }).failures)
      .toContain("Wrong central gate operation for trainer2/executions/results/route.ts#POST; expected set_logging");
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
