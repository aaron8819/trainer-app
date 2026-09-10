import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PrismaClient } from "@prisma/client";
import { identities } from "../../src/lib/engine/trainer2/planning";
import { canonicalJson, commandBinding, integrityHash } from "../../src/lib/api/trainer2/integrity";
import { createDraft, editDraft, readDraft, type ServerPrincipal } from "../../src/lib/api/trainer2/planning";
import type { CreateDraftCommand, DraftCommand, DraftDocument } from "../../src/lib/trainer2-contracts/draft";

export const draftTables = ["AccountPrincipal", "AccountTrainingState", "Plan", "PlanRevision", "Identity", "DurableAction", "ActionOutcome"];
export async function snapshot(pool: Pool) {
  return Promise.all(draftTables.map(async name => (await pool.query(`SELECT to_jsonb(t) AS row FROM "Trainer2${name}" t ORDER BY to_jsonb(t)::text`)).rows));
}
export const constraintError = (constraint: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, "23514");
  assert.equal((error as { constraint?: string }).constraint, constraint);
  return true;
};

export async function verifyAcceptance(pool: Pool, runtime: PrismaClient, principal: ServerPrincipal, sample: (account: string) => CreateDraftCommand,
  foreign: { result: unknown; identityId: string }) {
  type Options = {
    base?: string;
    document?: (doc: DraftDocument) => void;
    command?: (command: DraftCommand) => void;
    outcome?: (outcome: Record<string, unknown>) => void;
    counterDelta?: number;
    omitRevision?: boolean;
    omitOutcome?: boolean;
  };
  // Complete direct-write control, including acceptance, counters and all identities.
  // Outcome precedes graph construction deliberately: only commit may seal the set.
  async function complete(options: Options = {}) {
    const head = options.base ? await readDraft(runtime, principal, options.base) : null;
    const command: DraftCommand = head ? { ...sample(principal.accountId), commandType: "EditDraft", target: { planId: head.planId },
      expected: { planRevisionId: head.revisionId }, intent: { operations: [{ op: "renamePlan", name: "Direct successor" }] } } : sample(principal.accountId);
    const document = head ? structuredClone(head.intent) : (command as CreateDraftCommand).intent;
    if (head) document.name = "Direct successor";
    options.document?.(document);
    const planId = command.target.planId, revisionId = randomUUID(), revisionNumber = (head?.revisionNumber ?? 0) + 1;
    const canonicalContent = canonicalJson(document), contentHash = integrityHash(canonicalContent);
    options.command?.(command);
    const binding = commandBinding(command);
    const connection = await pool.connect();
    let reachedCommit = false;
    try {
      await connection.query("BEGIN");
      const updated = await connection.query('UPDATE "Trainer2AccountTrainingState" SET "acceptedSequence"="acceptedSequence"+$2 WHERE "accountId"=$1 RETURNING "acceptedSequence"', [principal.accountId, options.counterDelta ?? 1]);
      await connection.query('INSERT INTO "Trainer2DurableAction" ("accountId","actionId","hashVersion","envelopeHash","submittedEnvelope") VALUES ($1,$2,$3,$4,$5)', [principal.accountId, command.actionId, binding.hashVersion, binding.envelopeHash, binding.submittedEnvelope]);
      const outcome: Record<string, unknown> = { status: "Accepted", actionId: command.actionId, commandType: command.commandType,
        acceptedSequence: updated.rows[0].acceptedSequence, result: { planId, revisionId, revisionNumber, contentHash } };
      options.outcome?.(outcome);
      if (!options.omitOutcome) await connection.query('INSERT INTO "Trainer2ActionOutcome" ("accountId","actionId","status","outcome") VALUES ($1,$2,\'Accepted\',$3)', [principal.accountId, command.actionId, outcome]);
      if (!options.omitRevision) {
        if (!head) await connection.query('INSERT INTO "Trainer2Plan" ("id","accountId","currentRevisionId") VALUES ($1,$2,$3)', [planId, principal.accountId, revisionId]);
        await connection.query('INSERT INTO "Trainer2PlanRevision" ("id","accountId","planId","revisionNumber","parentRevisionId","actionId","document","canonicalContent","contentHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [revisionId, principal.accountId, planId, revisionNumber, head?.revisionId ?? null, command.actionId, document, canonicalContent, contentHash]);
        if (!head) for (const identity of identities(document)) await connection.query('INSERT INTO "Trainer2Identity" ("id","accountId","planId","kind","parentId","firstRevisionId") VALUES ($1,$2,$3,$4,$5,$6)', [identity.id, principal.accountId, planId, identity.kind, identity.parentId, revisionId]);
        if (head) await connection.query('UPDATE "Trainer2Plan" SET "currentRevisionId"=$1 WHERE "id"=$2', [revisionId, planId]);
      }
      reachedCommit = true;
      await connection.query("COMMIT");
      return { command, outcome, planId, revisionId };
    } catch (error) {
      await connection.query("ROLLBACK");
      assert(reachedCommit, `Expected deferred commit failure: ${String(error)}`);
      throw error;
    } finally { connection.release(); }
  }
  const control = await complete();
  const successor = await complete({ base: control.planId });
  const attacks: [string, Options, string][] = [
    ["outcome without revision", { omitRevision: true }, "trainer2_acceptance_revision"],
    ["outcome command type", { outcome: o => { o.commandType = "EditDraft"; } }, "trainer2_acceptance_revision"],
    ["unsupported command type", { command: c => { (c as { commandType: string }).commandType = "Unknown"; } }, "trainer2_acceptance_revision"],
    ["action target plan", { command: c => { c.target.planId = randomUUID(); } }, "trainer2_acceptance_revision"],
    ["edit expected parent", { base: control.planId, command: c => { c.expected = { planRevisionId: randomUUID() }; } }, "trainer2_acceptance_revision"],
    ...["planId", "revisionId", "revisionNumber", "contentHash"].map(key => [`result ${key}`, { outcome: (o: Record<string, unknown>) => { (o.result as Record<string, unknown>)[key] = key === "revisionNumber" ? 999 : randomUUID(); } }, "trainer2_acceptance_revision"] as [string, Options, string]),
    ["another action revision", { outcome: o => { o.result = successor.outcome.result; } }, "trainer2_acceptance_revision"],
    ["another account revision", { outcome: o => { o.result = foreign.result; } }, "trainer2_acceptance_revision"],
    ["fabricated acceptance sequence", { outcome: o => { o.acceptedSequence = "999"; } }, "trainer2_acceptance_sequence"],
    ["duplicate acceptance sequence", { outcome: o => { o.acceptedSequence = "1"; } }, "trainer2_acceptance_sequence"],
    ["missing acceptance sequence", { outcome: o => { delete o.acceptedSequence; } }, "trainer2_acceptance_sequence"],
    ["unincremented counter", { counterDelta: 0 }, "trainer2_acceptance_sequence"],
    ["skipped counter", { counterDelta: 2 }, "trainer2_acceptance_sequence"],
  ];
  const errors: string[] = [];
  for (const [name, options, constraint] of attacks) {
    const before = await snapshot(pool);
    await assert.rejects(complete(options), constraintError(constraint));
    assert.deepEqual(await snapshot(pool), before, `${name}: no partial graph/action/outcome/head/counter writes`);
    errors.push(`${name}: ${constraint} at COMMIT; full snapshot unchanged`);
  }
  // Same complete successor, with only each graph relationship changed. Acceptance
  // remains present and correct, so missing acceptance cannot mask these failures.
  for (const [name, mutate] of [
    ["missing stage", (d: DraftDocument) => { d.occurrences[0].stageId = randomUUID(); }],
    ["duplicate identity", (d: DraftDocument) => { d.occurrences[0].positions.push(d.occurrences[0].positions[0]); }],
    ["foreign identity", (d: DraftDocument) => { d.occurrences[0].positions[0].id = foreign.identityId; }],
  ] as const) {
    const before = await snapshot(pool);
    await assert.rejects(complete({ base: control.planId, document: mutate }), { message: "TRAINER2_DOCUMENT_REFERENCES", code: "P0001" });
    assert.deepEqual(await snapshot(pool), before);
    errors.push(`${name}: TRAINER2_DOCUMENT_REFERENCES at COMMIT; full snapshot unchanged`);
  }
  // Existing revision-to-acceptance seal still rejects a missing outcome. Avoid a
  // counter mismatch as an accidental alternate reason for this structural test.
  await assert.rejects(complete({ base: control.planId, omitOutcome: true, counterDelta: 0 }), { message: "TRAINER2_REVISION_WITHOUT_ACCEPTANCE", code: "P0001" });
  const beforeCounter = await snapshot(pool);
  await assert.rejects(pool.query('UPDATE "Trainer2AccountTrainingState" SET "acceptedSequence"="acceptedSequence"+1 WHERE "accountId"=$1', [principal.accountId]), constraintError("trainer2_acceptance_sequence"));
  assert.deepEqual(await snapshot(pool), beforeCounter);
  const replay = await createDraft(runtime, principal, control.command);
  assert(replay.replayed); assert.deepEqual(replay.outcome, control.outcome);
  assert.equal((await readDraft(runtime, principal, control.planId))?.revisionId, successor.revisionId);
  await pool.query('UPDATE "Trainer2Plan" SET "tombstonedAt"=now() WHERE "id"=$1', [control.planId]);
  assert.deepEqual((await createDraft(runtime, principal, control.command)).outcome, control.outcome);
  assert.deepEqual((await editDraft(runtime, principal, successor.command)).outcome, successor.outcome);
  assert.equal(await readDraft(runtime, principal, control.planId), null);
  return { controls: ["complete Create commits", "complete Edit commits", "historical replay preserves successor", "tombstone replay cannot resurrect", "revision requires acceptance", "counter-only increment rejected"], errors };
}
