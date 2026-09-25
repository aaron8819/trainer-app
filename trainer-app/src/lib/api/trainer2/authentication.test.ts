import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSessionMutationOrigin, authConfiguration } from "./authentication";

afterEach(() => vi.unstubAllEnvs());

describe("single-user mutation origin", () => {
  it("requires an exact configured origin", () => {
    vi.stubEnv("TRAINER2_APP_ORIGIN", "https://trainer.invalid");
    expect(authConfiguration().origin).toBe("https://trainer.invalid");
    expect(() => assertSessionMutationOrigin(new Request("https://trainer.invalid", {
      method: "POST", headers: { origin: "https://trainer.invalid", "sec-fetch-site": "same-origin" },
    }))).not.toThrow();
    for (const origin of [null, "null", "https://attacker.invalid", "https://trainer.invalid.evil"])
      expect(() => assertSessionMutationOrigin(new Request("https://trainer.invalid", {
        method: "POST", headers: origin ? { origin } : {},
      }))).toThrow("INVALID_ORIGIN");
  });
  it("rejects cross-site Fetch Metadata despite a matching Origin", () => {
    vi.stubEnv("TRAINER2_APP_ORIGIN", "https://trainer.invalid");
    expect(() => assertSessionMutationOrigin(new Request("https://trainer.invalid", {
      method: "POST", headers: { origin: "https://trainer.invalid", "sec-fetch-site": "cross-site" },
    }))).toThrow("INVALID_ORIGIN");
  });
});
