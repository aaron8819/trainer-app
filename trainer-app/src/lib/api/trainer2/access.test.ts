import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("./database", () => ({ databaseFor: fixture.database }));
import { draftHttp } from "./http";
import { executionHttp } from "./execution-http";

describe("direct Trainer2 endpoint access", () => {
  beforeEach(() => {
    for (const key of ["CI", "VERCEL", "VERCEL_ENV", "NETLIFY", "RENDER", "WEBSITE_SITE_NAME"])
      vi.stubEnv(key, "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TRAINER2_LOCAL_DRAFTS", "enabled");
    vi.stubEnv("TRAINER2_APP_ORIGIN", "http://localhost");
    vi.stubEnv("TRAINER_WRITE_PAUSE", "");
    fixture.database.mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = (method: string, origin = "http://localhost") => new Request("http://localhost/api/trainer2/drafts/x", {
    method, headers: { host: "localhost", ...(method === "POST" ? { origin } : {}) },
  });
  it("denies CI admission before opening any pool", async () => {
    vi.stubEnv("CI", "true");
    expect((await draftHttp(request("GET"), "ReadDraft", "x")).status).toBe(403);
    expect(fixture.database).not.toHaveBeenCalled();
  });
  it("denies direct reads without a cookie before opening a training pool", async () => {
    const response = await draftHttp(request("GET"), "ReadDraft", "x");
    expect(response.status).toBe(403);
    expect(fixture.database).toHaveBeenCalledExactlyOnceWith("identity", true);
  });
  it("denies direct writes and cross-site writes before any command", async () => {
    const absent = await draftHttp(request("POST"), "CreateDraft");
    expect(absent.status).toBe(403);
    const crossSite = await draftHttp(request("POST", "https://attacker.invalid"), "CreateDraft");
    expect(crossSite.status).toBe(403);
    expect(fixture.database.mock.calls.every(([purpose]) => purpose === "identity")).toBe(true);
  });
  it("denies execution reads through the same request context", async () => {
    const response = await executionHttp(request("GET"), "ReadExecution", "x");
    expect(response.status).toBe(403);
  });
});
