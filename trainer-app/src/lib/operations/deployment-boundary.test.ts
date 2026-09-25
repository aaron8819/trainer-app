import { describe, expect, it } from "vitest";
import { deploymentDecision } from "./deployment-boundary";

describe("built deployment boundary", () => {
  const base = { built: "preview", runtime: "preview", vercelEnvironment: "preview", legacyCredentialsPresent: false };
  it("fails both mismatch directions, including missing and empty runtime mode", () => {
    expect(deploymentDecision(base)).toBe("preview");
    for (const runtime of [undefined, "", "v1"])
      expect(deploymentDecision({ ...base, runtime })).toBe("deny");
    expect(deploymentDecision({ ...base, built: "v1" })).toBe("deny");
  });
  it("rejects inherited V1 credentials and a Preview runtime for an ordinary build", () => {
    expect(deploymentDecision({ ...base, legacyCredentialsPresent: true })).toBe("deny");
    expect(deploymentDecision({ built: "v1", runtime: undefined, vercelEnvironment: "preview", legacyCredentialsPresent: true })).toBe("deny");
  });
  it("keeps ordinary V1 production without a new runtime variable", () => {
    expect(deploymentDecision({ built: "v1", runtime: undefined, vercelEnvironment: "production", legacyCredentialsPresent: true })).toBe("v1");
    expect(deploymentDecision({ built: "v1", runtime: "", vercelEnvironment: "production", legacyCredentialsPresent: true })).toBe("v1");
  });
});
