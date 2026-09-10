// Real Supabase verifier + real restricted PostgreSQL. Only loopback DB transport is adapted.
import { afterAll, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => [] as string[]);
vi.mock("../../src/lib/api/trainer2/database", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/lib/api/trainer2/database")>();
  return { ...actual, databaseFor: async (purpose: "identity" | "read" | "write", local: boolean) => {
    expect(local).toBe(false); calls.push(purpose); return actual.databaseFor(purpose, true);
  } };
});
import { draftHttp } from "../../src/lib/api/trainer2/http";
import { authenticateHostedRequest } from "../../src/lib/api/trainer2/authentication";
import { closeTrainer2Connections } from "../../src/lib/api/trainer2/database";
import { resolveAccount } from "../../src/lib/api/trainer2/principal";
import { createDraft } from "../../src/lib/api/trainer2/planning";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
afterAll(closeTrainer2Connections);
it("real identity stays denied by hosted gate; binding removal/reassignment also denies historical replay", async () => {
  const request = () => new Request("http://127.0.0.1/trainer2", { headers: { cookie: process.env.TRAINER2_TEST_SESSION! } });
  const verified = await authenticateHostedRequest(request());
  const owner = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  // Import original for the intentionally authorized local Draft setup only.
  const original = await vi.importActual<typeof import("../../src/lib/api/trainer2/database")>("../../src/lib/api/trainer2/database");
  try {
    expect(await (await draftHttp(request(), "ReadDraft", randomUUID())).json()).toEqual({ error: "UNAUTHORIZED" });
    await owner.query('INSERT INTO "Trainer2AccountPrincipal" (id,issuer,subject,"accountId") VALUES ($1,$2,$3,$4)', [randomUUID(), verified.issuer, verified.subject, "auth-account-A"]);
    for (const command of ["ReadDraft", "CreateDraft", "EditDraft"] as const)
      expect(await (await draftHttp(request(), command, randomUUID())).json()).toEqual({ error: "HOSTED_ADMISSION_DISABLED" });
    expect(calls.every(p => p === "identity")).toBe(true);
    const lookup = await original.databaseFor("identity", true);
    const principal = await resolveAccount(lookup, verified);
    const writer = await original.databaseFor("write", true);
    const envelope = { schemaVersion: 1, commandType: "CreateDraft" as const, actionId: randomUUID(),
      originatingAccountId: principal.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [],
      target: { planId: randomUUID() }, expected: {}, intent: { schemaVersion: 1, name: "Auth qualification",
      endpoint: "endOfOrderedOccurrences", stages: [], occurrences: [] } };
    expect((await createDraft(writer, principal, envelope)).outcome.status).toBe("Accepted");
    await owner.query('DELETE FROM "Trainer2AccountPrincipal" WHERE issuer=$1 AND subject=$2', [verified.issuer, verified.subject]);
    expect(await (await draftHttp(request(), "ReadDraft", envelope.target.planId)).json()).toEqual({ error: "UNAUTHORIZED" });
    await expect(createDraft(writer, principal, envelope)).rejects.toThrow("UNAUTHORIZED");
    await owner.query('INSERT INTO "Trainer2AccountPrincipal" (id,issuer,subject,"accountId") VALUES ($1,$2,$3,$4)', [randomUUID(), verified.issuer, verified.subject, "auth-account-B"]);
    expect((await resolveAccount(lookup, await authenticateHostedRequest(request()))).accountId).toBe("auth-account-B");
    await expect(createDraft(writer, principal, envelope)).rejects.toThrow("UNAUTHORIZED");
    expect(await (await draftHttp(request(), "ReadDraft", envelope.target.planId)).json()).toEqual({ error: "HOSTED_ADMISSION_DISABLED" });
    expect(calls.every(p => p === "identity")).toBe(true);
    expect((await owner.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n).toBe(2);
    expect((await owner.query('SELECT count(*)::int AS n FROM "Trainer2DurableAction"')).rows[0].n).toBe(1);
  } finally { await owner.end(); }
}, 30000);
