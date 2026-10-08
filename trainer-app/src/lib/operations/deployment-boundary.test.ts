import { describe, expect, it } from "vitest";
import { deploymentDecision } from "./deployment-boundary";

describe("built deployment boundary", () => {
  it("requires an explicit production build/runtime, production environment and safe origin", () => {
    const production = { built: "v2-production", runtime: "v2-production",
      vercelEnvironment: "production", legacyCredentialsPresent: false,
      restrictedCredentialsPresent: true, hostedConfigurationPresent: true,
      productionOriginValid: true };
    expect(deploymentDecision(production)).toBe("v2-production");
    for (const change of [{ built: "unknown" }, { runtime: undefined }, { runtime: "hosted-test" },
      { vercelEnvironment: undefined }, { vercelEnvironment: "unknown" },
      { vercelEnvironment: "preview" }, { legacyCredentialsPresent: true },
      { restrictedCredentialsPresent: false }, { hostedConfigurationPresent: false },
      { productionOriginValid: false }])
      expect(deploymentDecision({ ...production, ...change })).toBe("deny");
  });
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
  it("requires an explicit hosted-test build, runtime, Preview environment, and restricted configuration", () => {
    const hosted = { built: "hosted-test", runtime: "hosted-test", vercelEnvironment: "preview",
      legacyCredentialsPresent: false, restrictedCredentialsPresent: true, hostedConfigurationPresent: true };
    expect(deploymentDecision(hosted)).toBe("hosted-test");
    for (const change of [
      { built: "preview" }, { runtime: undefined }, { runtime: "" }, { vercelEnvironment: "production" },
      { legacyCredentialsPresent: true }, { restrictedCredentialsPresent: false }, { hostedConfigurationPresent: false },
    ]) expect(deploymentDecision({ ...hosted, ...change })).toBe("deny");
    expect(deploymentDecision({ ...base, restrictedCredentialsAny: true })).toBe("deny");
  });
});
