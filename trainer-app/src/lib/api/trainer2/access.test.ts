import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftAccessError } from "./principal";

const fixture = vi.hoisted(() => ({ authenticate: vi.fn(), database: vi.fn(), lookup: vi.fn() }));
vi.mock("./authentication", () => ({ authenticateHostedRequest: fixture.authenticate }));
vi.mock("./database", () => ({ databaseFor: fixture.database }));
import { draftHttp } from "./http";
import { POST } from "../../../app/api/trainer2/drafts/create/route";

describe("hosted boundary orchestration (synthetic verifier output, not token verification)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("TRAINER2_LOCAL_DRAFTS", "enabled");
    vi.stubEnv("TRAINER_WRITE_PAUSE", "");
    vi.stubEnv("OWNER_EMAIL", "same@example.invalid");
    fixture.authenticate.mockReset(); fixture.database.mockReset(); fixture.lookup.mockReset();
    fixture.database.mockResolvedValue({ trainer2AccountPrincipal: { findUnique: fixture.lookup } });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["MISSING", "INVALID", "EXPIRED", "WRONG_ISSUER", "WRONG_AUDIENCE", "INVALID_SIGNATURE"])("propagates verifier rejection %s without a development rescue", async reason => {
    fixture.authenticate.mockRejectedValue(new DraftAccessError(reason));
    const response = await draftHttp(new Request("https://trainer.example.invalid/api/trainer2/drafts/a", {
      headers: { "x-account-id": "account-A", "x-subject": "developer", Authorization: "Bearer unverified", Cookie: "session=unverified" },
    }), "ReadDraft", "a");
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: reason });
    expect(fixture.database).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("denies unknown subjects and never provisions", async () => {
    fixture.authenticate.mockResolvedValue({ issuer: "verified-issuer", subject: "unknown", email: "same@example.invalid" });
    fixture.lookup.mockResolvedValue(null);
    const response = await draftHttp(new Request("https://trainer.example.invalid/"), "ReadDraft", "a");
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(fixture.lookup).toHaveBeenCalledExactlyOnceWith({ where: { issuer_subject: { issuer: "verified-issuer", subject: "unknown" } } });
  });
  it.each(["ReadDraft", "CreateDraft", "EditDraft"] as const)("mapped identity cannot admit %s or open a training pool", async command => {
    fixture.authenticate.mockResolvedValue({ issuer: "verified-issuer", subject: "subject-A" });
    fixture.lookup.mockResolvedValue({ issuer: "verified-issuer", subject: "subject-A", accountId: "account-A" });
    const response = await draftHttp(new Request("https://trainer.example.invalid/", { method: command === "ReadDraft" ? "GET" : "POST" }), command, "a");
    expect(await response.json()).toEqual({ error: "HOSTED_ADMISSION_DISABLED" });
    expect(fixture.database).toHaveBeenCalledExactlyOnceWith("identity", false);
  });
  it("operational pause still precedes authentication and persistence", async () => {
    vi.stubEnv("TRAINER_WRITE_PAUSE", "enabled");
    const response = await POST(new Request("https://trainer.example.invalid/", { method: "POST" }));
    expect(response.status).toBe(503); expect(fixture.authenticate).not.toHaveBeenCalled(); expect(fixture.database).not.toHaveBeenCalled();
  });
});
