import { afterEach, describe, expect, it, vi } from "vitest";
import { getUiAuditFixtureFromHeaders } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UI audit fixture server authorization", () => {
  it("resolves a fixture only from an exact request header in fixture mode", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");

    expect(
      getUiAuditFixtureFromHeaders(
        new Headers({ "x-ui-audit-fixture": "active" }),
      )?.scenario,
    ).toBe("active");
    expect(getUiAuditFixtureFromHeaders(new Headers())).toBeNull();
    expect(
      getUiAuditFixtureFromHeaders(
        new Headers({ "x-ui-audit-fixture": "incorrect" }),
      ),
    ).toBeNull();
  });

  it("does not use a scenario environment variable as authorization", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("UI_AUDIT_FIXTURE_SCENARIO", "active");
    vi.stubEnv("NODE_ENV", "development");

    expect(getUiAuditFixtureFromHeaders(new Headers())).toBeNull();
  });

  it("stays inert outside fixture mode and in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      getUiAuditFixtureFromHeaders(
        new Headers({ "x-ui-audit-fixture": "active" }),
      ),
    ).toBeNull();

    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(
      getUiAuditFixtureFromHeaders(
        new Headers({ "x-ui-audit-fixture": "active" }),
      ),
    ).toBeNull();
  });
});
