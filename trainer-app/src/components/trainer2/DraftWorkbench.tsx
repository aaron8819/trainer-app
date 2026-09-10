"use client";
import { useState } from "react";
import type { DraftDocument, DraftCommand, EditDraftCommand } from "@/lib/trainer2-contracts/draft";

type Loaded = { planId: string; revisionId: string; revisionNumber: number; intent: DraftDocument; activationBlockers: string[] };
export function DraftWorkbench({ accountId, ownershipEpoch }: { accountId: string; ownershipEpoch: number }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [planId, setPlanId] = useState("");
  const [name, setName] = useState("My finite draft");
  const [message, setMessage] = useState("Create a draft or enter its saved plan ID to reload it.");
  const [lastCommand, setLastCommand] = useState<DraftCommand | null>(null);
  const [busy, setBusy] = useState(false);
  async function reload(id = planId) {
    const response = await fetch(`/api/trainer2/drafts/${id}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error); return; }
    setLoaded(result); setName(result.intent.name); setPlanId(id);
    setMessage(`Loaded revision ${result.revisionNumber}`);
  }
  async function submit(command: DraftCommand) {
    setBusy(true); setLastCommand(command);
    try {
      const response = await fetch(`/api/trainer2/drafts/${command.commandType === "CreateDraft" ? "create" : "edit"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
      });
      const result = await response.json();
      if (result.outcome?.status === "Accepted") {
        await reload(result.outcome.result.planId);
        setMessage(`${result.replayed ? "Replayed original" : "Accepted"} revision ${result.outcome.result.revisionNumber}. Current head reloaded separately.`);
      } else setMessage(result.outcome?.code === "STALE_REVISION" ? "Stale edit: another revision was accepted. Your submitted edit is retained. Reload before making a new edit." : result.outcome?.code ?? result.error);
    } catch { setMessage("Delivery uncertain. Retry the same action."); }
    finally { setBusy(false); }
  }
  function envelope() {
    return { schemaVersion: 1 as const, actionId: crypto.randomUUID(), originatingAccountId: accountId,
      deviceId: sessionStorage.getItem("trainer2-device") ?? (() => { const id = crypto.randomUUID(); sessionStorage.setItem("trainer2-device", id); return id; })(), ownershipEpoch, dependsOn: [] };
  }
  function create() {
    const stageId = crypto.randomUUID();
    void submit({ ...envelope(), commandType: "CreateDraft", target: { planId: crypto.randomUUID() }, expected: {},
      intent: { schemaVersion: 1, name, endpoint: "endOfOrderedOccurrences", stages: [{ id: stageId, name: "Stage 1" }],
        occurrences: [{ id: crypto.randomUUID(), stageId, name: "Session A", positions: ["Squat", "Squat"].map(name => ({
          id: crypto.randomUUID(), exercise: { kind: "authoredDescription" as const, name, variation: "" }, targets: [{
            id: crypto.randomUUID(), classification: "working" as const, required: true,
            reps: { min: 8, max: 12, basis: "total" as const }, measurement: { kind: "externalLoad" as const, value: "20.00", unit: "kg" as const, convention: "barbellTotal" as const, zeroMeaning: "notAllowed" as const }, rir: "2", restSeconds: "120",
          }],
        })) }] } });
  }
  function edit(operations: EditDraftCommand["intent"]["operations"]) {
    if (loaded) void submit({ ...envelope(), commandType: "EditDraft", target: { planId: loaded.planId }, expected: { planRevisionId: loaded.revisionId }, intent: { operations } });
  }
  const button = "rounded border border-slate-400 px-3 py-2 disabled:opacity-40";
  return <main className="mx-auto max-w-4xl space-y-5 p-6 pb-24">
    <h1 className="text-2xl font-semibold">Trainer2 developer draft workbench</h1>
    <p>Local disposable database · draft authoring only</p>
    <label className="block">Draft name <input className="rounded border p-2" value={name} onChange={e => setName(e.target.value)} /></label>
    <div className="flex gap-3"><button className={button} disabled={busy} onClick={create}>Create finite draft</button>
      <button className={button} disabled={busy || !loaded} onClick={() => edit([{ op: "renamePlan", name }])}>Save name revision</button></div>
    <label className="block">Saved plan ID <input className="w-full rounded border p-2 font-mono" value={planId} onChange={e => setPlanId(e.target.value)} /></label>
    <div className="flex gap-3"><button className={button} disabled={busy || !planId} onClick={() => void reload().catch(() => setMessage("Reload failed"))}>Reload persisted draft</button>
      <button className={button} disabled={busy || !lastCommand} onClick={() => lastCommand && void submit(lastCommand)}>Retry same action</button></div>
    <p role="status" className="rounded bg-slate-100 p-3 text-slate-900">{message}</p>
    {loaded && <section className="space-y-4"><h2 className="text-xl">Revision {loaded.revisionNumber}: {loaded.intent.name}</h2>
      <p className="break-all font-mono text-sm">{loaded.revisionId}</p>
      {loaded.intent.occurrences.map(o => <div key={o.id} className="space-y-2 rounded border p-4"><h3>{o.name}</h3>
        <button className={button} disabled={busy} onClick={() => edit([{ op: "reorderPositions", occurrenceId: o.id, positionIds: o.positions.map(p => p.id).reverse() }])}>Reverse positions</button>
        <button className={button} disabled={busy} onClick={() => edit([{ op: "addPosition", occurrenceId: o.id, position: { id: crypto.randomUUID(), exercise: { kind: "authoredDescription", name: "Squat", variation: "" }, targets: [] } }])}>Add new Squat position</button>
        <ol>{o.positions.map(p => <li key={p.id} className="my-3"><span>{p.exercise.name} · </span><code>{p.id}</code>{" "}
          <button className={button} disabled={busy} onClick={() => edit([{ op: "removePosition", positionId: p.id }])}>Remove position</button></li>)}</ol>
      </div>)}
      <details><summary>Developer diagnostics: intent and activation blockers</summary><pre className="overflow-auto text-xs">{JSON.stringify(loaded, null, 2)}</pre></details>
    </section>}
  </main>;
}
