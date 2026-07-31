import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("GET /api/operations/write-status", () => {
  it("reports the runtime-enforced paused state with exact deployment commit", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      schema: "trainer-production-write-status",
      version: 1,
      environment: "production",
      commitSha: "a".repeat(40),
      status: "PAUSED",
      enforcement: "application_all_classified_write_paths",
    });
  });

  it("refuses to manufacture production evidence outside production", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    const { GET } = await import("./route");
    await expect(GET()).rejects.toThrow(
      "Production write status evidence is unavailable outside Vercel production.",
    );
  });
});
