import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UI audit request boundary", () => {
  it("is inert in production even when the fixture header is present", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(
      new NextRequest("http://localhost/plans", {
        headers: { "x-ui-audit-fixture": "active" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects fixture page requests before production page modules execute", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(
      new NextRequest("http://localhost/plans", {
        headers: { "x-ui-audit-fixture": "active" },
      }),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ui-audit-fixture");
    expect(location.searchParams.get("path")).toBe("/plans");
    expect(location.searchParams.has("scenario")).toBe(false);
  });

  it("leaves public Trainer brand assets available to fixture pages", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");

    for (const pathname of [
      "/brand/trainer-mark.png",
      "/icons/trainer-icon-192.png",
      "/icons/trainer-icon-512.png",
      "/apple-icon.png",
      "/manifest.webmanifest",
      "/favicon.ico",
    ]) {
      const response = proxy(
        new NextRequest(`http://localhost${pathname}`, {
          headers: { "x-ui-audit-fixture": "active" },
        }),
      );

      expect(response.headers.get("x-middleware-next"), pathname).toBe("1");
      expect(response.headers.get("location"), pathname).toBeNull();
    }
  });

  it("blocks every unhandled fixture API request before database code", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(
      new NextRequest("http://localhost/api/plans", {
        method: "POST",
        headers: { "x-ui-audit-fixture": "active" },
      }),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("explicit browser fixture handler"),
    });
  });

  it("does not expose fixtures for a missing or incorrect header", () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    for (const headers of [
      undefined,
      { "x-ui-audit-fixture": "incorrect" },
    ]) {
      const response = proxy(
        new NextRequest("http://localhost/plans?scenario=active", {
          headers,
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
