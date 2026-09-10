// Collected only by the disposable harness's explicit Vitest configuration.
// No application environment variable can select this authentication replacement.
import { afterAll, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ authenticate: vi.fn(), purposes: [] as string[] }));
vi.mock("../../src/lib/api/trainer2/authentication", () => ({ authenticateHostedRequest: fixture.authenticate }));
vi.mock("../../src/lib/api/trainer2/database", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/lib/api/trainer2/database")>();
  return { ...actual, databaseFor: async (purpose: "identity" | "read" | "write", local: boolean) => {
    expect(local).toBe(false); fixture.purposes.push(purpose);
    // Only the test transport changes: actual connection validation/privilege checks
    // operate against loopback PostgreSQL. Hosted TLS remains unqualified.
    return actual.databaseFor(purpose, true);
  } };
});
import { draftHttp } from "../../src/lib/api/trainer2/http";
import { closeTrainer2Connections } from "../../src/lib/api/trainer2/database";
import { DraftAccessError } from "../../src/lib/api/trainer2/principal";
afterAll(closeTrainer2Connections);
it("hosted request path uses exact real mapping, denies admission and cannot fall back to development", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("TRAINER2_LOCAL_DRAFTS", "enabled");
  const request = () => new Request("https://qualification.invalid/api/trainer2/drafts/create", { method: "POST", headers: { "x-account-id": "account-A", "x-subject": "developer" } });
  for (const command of ["ReadDraft", "CreateDraft", "EditDraft"] as const) {
    fixture.authenticate.mockResolvedValue({ issuer: "https://synthetic.invalid/issuer-A", subject: "subject-A" });
    const result = await draftHttp(request(), command, "untrusted-plan-id");
    expect(await result.json()).toEqual({ error: "HOSTED_ADMISSION_DISABLED" });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  }
  fixture.authenticate.mockResolvedValue({ issuer: "https://synthetic.invalid/issuer-A", subject: "unknown", email: "a@synthetic.invalid" });
  expect(await (await draftHttp(request(), "CreateDraft")).json()).toEqual({ error: "UNAUTHORIZED" });
  const lookups = fixture.purposes.length;
  fixture.authenticate.mockRejectedValue(new DraftAccessError("INVALID_AUTHENTICATION"));
  expect(await (await draftHttp(request(), "CreateDraft")).json()).toEqual({ error: "INVALID_AUTHENTICATION" });
  expect(fixture.purposes).toHaveLength(lookups);
  expect(fixture.purposes.every(p => p === "identity")).toBe(true);
  vi.unstubAllEnvs();
});
