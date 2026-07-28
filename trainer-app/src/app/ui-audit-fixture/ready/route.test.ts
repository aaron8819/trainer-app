import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UI audit readiness route", () => {
  it("reports database-independent readiness only in explicit non-production fixture mode", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      database: "unused",
    });
  });

  it("is unavailable in production", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(GET().status).toBe(404);
  });
});
