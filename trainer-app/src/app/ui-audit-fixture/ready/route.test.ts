import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UI audit readiness route", () => {
  it("reports database-independent readiness only in explicit non-production fixture mode", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = GET(
      new Request("http://localhost/ui-audit-fixture/ready", {
        headers: { "x-ui-audit-fixture": "active" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      database: "unused",
    });
  });

  it("rejects missing and incorrect headers even in fixture mode", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(
      GET(new Request("http://localhost/ui-audit-fixture/ready")).status,
    ).toBe(404);
    expect(
      GET(
        new Request("http://localhost/ui-audit-fixture/ready", {
          headers: { "x-ui-audit-fixture": "incorrect" },
        }),
      ).status,
    ).toBe(404);
  });

  it("is unavailable in production even with a correct header", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(
      GET(
        new Request("http://localhost/ui-audit-fixture/ready", {
          headers: { "x-ui-audit-fixture": "active" },
        }),
      ).status,
    ).toBe(404);
  });
});
