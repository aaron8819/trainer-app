import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const COMMIT_SHA = "80b4e4bac0faf57dc15188556583908916aba8c4";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("returns a stable successful JSON contract when the commit SHA is configured", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    await expect(response.json()).resolves.toEqual({ commitSha: COMMIT_SHA });
  });

  it("returns only the safe local fallback when deployment metadata is unavailable", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("TRAINER_BUILD_GIT_SHA", "");
    vi.stubEnv("NODE_ENV", "development");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ commitSha: "unknown" });
    expect(Object.keys(body)).toEqual(["commitSha"]);
  });

  it("exposes GET only and imports no persistence, user, or secret-bearing seams", () => {
    const source = readFileSync("src/app/api/version/route.ts", "utf8");

    expect(source).toContain("export async function GET");
    expect(source).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)/);
    expect(source).not.toContain("@/lib/db");
    expect(source).not.toContain("@/lib/api/workout-context");
    expect(source).not.toContain("process.env");
  });
});
