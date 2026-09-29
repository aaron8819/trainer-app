import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UI audit request boundary", () => {
  it("is inert in production even when the fixture header is present", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    const response = await proxy(
      new NextRequest("http://localhost/plans", {
        headers: { "x-ui-audit-fixture": "active" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects fixture page requests before production page modules execute", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = await proxy(
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

  it("leaves public Trainer brand assets available to fixture pages", async () => {
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
      const response = await proxy(
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
    const response = await proxy(
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

  it("does not expose fixtures for a missing or incorrect header", async () => {
    vi.stubEnv("UI_AUDIT_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    for (const headers of [
      undefined,
      { "x-ui-audit-fixture": "incorrect" },
    ]) {
      const response = await proxy(
        new NextRequest("http://localhost/plans?scenario=active", {
          headers,
        }),
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("Preview route boundary", () => {
  const request = (path: string) => proxy(new NextRequest(`https://preview.invalid${path}`));
  it("blocks V1 routes and permits only Trainer2 routes when Preview is correctly bound", () => {
    vi.stubEnv("TRAINER_BUILT_MODE", "preview"); vi.stubEnv("TRAINER_DEPLOYMENT_MODE", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const key of ["DATABASE_URL", "DIRECT_URL", "OWNER_EMAIL", "DATABASE_SSL_NO_VERIFY"]) vi.stubEnv(key, "");
    expect(request("/api/program").status).toBe(404);
    expect(request("/plans").status).toBe(404);
    expect(request("/api/trainer2/drafts").headers.get("x-middleware-next")).toBe("1");
  });
  it("fails closed for missing or empty runtime mode, inherited credentials, and opposite mismatch", () => {
    vi.stubEnv("TRAINER_BUILT_MODE", "preview"); vi.stubEnv("VERCEL_ENV", "preview");
    for (const key of ["DATABASE_URL", "DIRECT_URL", "OWNER_EMAIL", "DATABASE_SSL_NO_VERIFY"]) vi.stubEnv(key, "");
    for (const runtime of ["", "v1"]) {
      vi.stubEnv("TRAINER_DEPLOYMENT_MODE", runtime);
      expect(request("/api/program").status).toBe(503);
    }
    vi.stubEnv("TRAINER_DEPLOYMENT_MODE", "preview"); vi.stubEnv("DATABASE_URL", "postgresql://inherited.invalid/db");
    expect(request("/trainer2/auth").status).toBe(503);
    vi.stubEnv("TRAINER_BUILT_MODE", "v1"); vi.stubEnv("DATABASE_URL", "");
    expect(request("/api/program").status).toBe(503);
  });
});

describe("protected hosted-test route boundary", () => {
  it("permits Trainer2 only on its exact origin and denies V1 paths", () => {
    vi.stubEnv("TRAINER_BUILT_MODE", "hosted-test");
    vi.stubEnv("TRAINER_DEPLOYMENT_MODE", "hosted-test");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TRAINER2_APP_ORIGIN", "https://synthetic.example.test");
    vi.stubEnv("TRAINER2_OWNER_USER_ID", "00000000-0000-0000-0000-000000000001");
    vi.stubEnv("TRAINER2_DB_CA_CERT_PEM", "test-ca");
    vi.stubEnv("TRAINER2_IDENTITY_CONNECTION_STRING", "restricted-identity");
    vi.stubEnv("TRAINER2_READ_CONNECTION_STRING", "restricted-read");
    vi.stubEnv("TRAINER2_WRITE_CONNECTION_STRING", "restricted-write");
    for (const key of ["DATABASE_URL", "DIRECT_URL", "OWNER_EMAIL", "DATABASE_SSL_NO_VERIFY"]) vi.stubEnv(key, "");
    const request = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
    expect(request("synthetic.example.test", "/api/trainer2/drafts").headers.get("x-middleware-next")).toBe("1");
    expect(request("synthetic.example.test", "/api/workouts").status).toBe(404);
    expect(request("synthetic.example.test", "/plans").status).toBe(404);
    expect(request("other.example.test", "/api/trainer2/drafts").status).toBe(404);
    vi.stubEnv("DATABASE_URL", "postgresql://admin.invalid/db");
    expect(request("synthetic.example.test", "/api/trainer2/drafts").status).toBe(503);
  });
});
