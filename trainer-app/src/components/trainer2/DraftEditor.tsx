import type { DraftDocument } from "@/lib/trainer2-contracts/draft";

type Target = DraftDocument["occurrences"][number]["positions"][number]["targets"][number];
type Measurement = NonNullable<Target["measurement"]>;
const labels: Record<string, string> = {
  missing: "Unspecified", externalLoad: "External load", addedLoad: "Added load", assistance: "Assistance", bodyweight: "Bodyweight only",
  preparation: "Preparation", rampUp: "Ramp-up", working: "Working", optionalFinisher: "Optional finisher",
  total: "Total", perSide: "Per side", alternating: "Alternating", barbellTotal: "Barbell total", perImplement: "Per implement",
  machineDisplayed: "Machine displayed", notAllowed: "Zero not allowed", validZero: "Zero is valid",
};
export const control = "rounded border border-slate-400 bg-white px-3 py-2 text-slate-900 disabled:opacity-40";
export function TextField({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) {
  return <label className="flex flex-col gap-1">{label}<input className={control} value={value} inputMode={numeric ? "decimal" : undefined} onChange={e => onChange(e.target.value)} /></label>;
}
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (value: T) => void }) {
  return <label className="flex flex-col gap-1">{label}<select aria-label={label} className={control} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(v => <option key={v} value={v}>{labels[v] ?? v}</option>)}</select></label>;
}
function Order({ index, length, move }: { index: number; length: number; move: (offset: number) => void }) {
  return <span className="flex gap-2"><button type="button" className={control} disabled={index === 0} onClick={() => move(-1)}>Move up</button><button type="button" className={control} disabled={index === length - 1} onClick={() => move(1)}>Move down</button></span>;
}
function move<T>(items: T[], index: number, offset: number) {
  if (index + offset < 0 || index + offset >= items.length) return;
  [items[index], items[index + offset]] = [items[index + offset], items[index]];
}
function initialMeasurement(kind: Measurement["kind"] | "missing"): Target["measurement"] {
  switch (kind) {
    case "missing": return null;
    case "bodyweight": return { kind, convention: "bodyweightOnly" };
    case "addedLoad": return { kind, value: "0", unit: "kg", convention: "addedExternal", zeroMeaning: "noAddedLoad" };
    case "assistance": return { kind, value: "0", unit: "kg", convention: "displayedAssistance", zeroMeaning: "noAssistance" };
    case "externalLoad": return { kind, value: "", unit: "kg", convention: "barbellTotal", zeroMeaning: "notAllowed" };
  }
}
export function TargetFields({ target: t, change, exercise }: { exercise?: DraftDocument["occurrences"][number]["positions"][number]["exercise"]; target: Target; change: (fn: (target: Target) => void, field: "classification" | "required" | "reps" | "measurement" | "rir" | "restSeconds") => void }) {
  const m = t.measurement;
  const fixed = exercise?.kind === "catalogSnapshot" ? exercise : undefined;
  return <div className="grid gap-3 sm:grid-cols-3">
    <Choice label="Classification" value={t.classification} options={["preparation", "rampUp", "working", "optionalFinisher"]} onChange={v => change(t => { t.classification = v; }, 'classification')} />
    <label><input type="checkbox" checked={t.required} onChange={e => change(t => { t.required = e.target.checked; }, 'required')} /> Required target</label>
    <TextField label="Minimum reps" numeric value={String(t.reps.min || "")} onChange={v => change(t => { t.reps.min = Number(v); }, 'reps')} />
    <TextField label="Maximum reps" numeric value={String(t.reps.max || "")} onChange={v => change(t => { t.reps.max = Number(v); }, 'reps')} />
    <Choice label="Rep basis" value={t.reps.basis} options={fixed ? [fixed.repBasis] : ["total", "perSide", "alternating"]} onChange={v => change(t => { t.reps.basis = v; }, 'reps')} />
    <Choice label="Measurement kind" value={m?.kind ?? "missing"} options={fixed ? ["missing", fixed.loadKind] : ["missing", "externalLoad", "addedLoad", "assistance", "bodyweight"]} onChange={v => change(t => { t.measurement = initialMeasurement(v); if (fixed && t.measurement?.kind === "externalLoad") t.measurement.convention = fixed.convention as "barbellTotal" | "perImplement" | "machineDisplayed"; }, 'measurement')} />
    {m && m.kind !== "bodyweight" && <>
      <TextField label="Load or assistance" numeric value={m.value} onChange={v => change(t => { if (t.measurement && t.measurement.kind !== "bodyweight") t.measurement.value = v; }, 'measurement')} />
      <Choice label="Unit" value={m.unit} options={["kg", "lb"]} onChange={v => change(t => { if (t.measurement && t.measurement.kind !== "bodyweight") t.measurement.unit = v; }, 'measurement')} />
    </>}
    {m?.kind === "externalLoad" ? <>
      <Choice label="Convention" value={m.convention} options={fixed ? [m.convention] : ["barbellTotal", "perImplement", "machineDisplayed"]} onChange={v => change(t => { if (t.measurement?.kind === "externalLoad") t.measurement.convention = v; }, 'measurement')} />
      <Choice label="Zero meaning" value={m.zeroMeaning} options={fixed?.catalogFacts?.externalZeroMeaning ? [fixed.catalogFacts.externalZeroMeaning] : ["notAllowed", "validZero"]} onChange={v => change(t => { if (t.measurement?.kind === "externalLoad") t.measurement.zeroMeaning = v; }, 'measurement')} />
    </> : <p>{!m ? "Weight is optional. You can choose it later." : m.kind === "bodyweight" ? "Bodyweight only; no numeric load." : m.kind === "addedLoad" ? "Added external load; zero means no added load." : "Displayed assistance; zero means no assistance."}</p>}
    <TextField label="RIR (blank = unspecified)" numeric value={t.rir ?? ""} onChange={v => change(t => { t.rir = v === "" ? null : v; }, 'rir')} />
    <TextField label="Rest seconds (blank = unspecified)" numeric value={t.restSeconds ?? ""} onChange={v => change(t => { t.restSeconds = v === "" ? null : v; }, 'restSeconds')} />
  </div>;
}

export function DraftEditor({ document: doc, disabled, onChange }: { document: DraftDocument; disabled: boolean; onChange: (doc: DraftDocument) => void }) {
  function update(fn: (doc: DraftDocument) => void) { if (disabled) return; const next = structuredClone(doc); fn(next); onChange(next); }
  return <fieldset disabled={disabled} className="space-y-5">
    <legend className="text-xl font-semibold">Edit draft intent</legend>
    <p>These inputs are unsaved until you submit a revision. Blank measurement, RIR and rest mean unspecified. Changing measurement kind resets its fields; review them before saving.</p>
    <h3 className="font-semibold">Ordered stages</h3>
    {doc.stages.map((s, i) => <fieldset key={s.id} className="space-y-2 rounded border p-3"><legend>Stage {i + 1}</legend>
      <TextField label="Stage name" value={s.name} onChange={v => update(d => { d.stages[i].name = v; })} />
      <Order index={i} length={doc.stages.length} move={v => update(d => move(d.stages, i, v))} />
      <button type="button" className={control} disabled={doc.occurrences.some(o => o.stageId === s.id)} onClick={() => update(d => { d.stages.splice(i, 1); })}>Remove stage</button>
      {doc.occurrences.some(o => o.stageId === s.id) && <p>Reassign or remove its sessions below before removing this stage; save the related edits together.</p>}
    </fieldset>)}
    <button type="button" className={control} onClick={() => update(d => { d.stages.push({ id: crypto.randomUUID(), name: "" }); })}>Add stage</button>
    <h3 className="font-semibold">Ordered sessions</h3>
    <p>Session order defines the finite endpoint independently of stage order.</p>
    {doc.occurrences.map((o, i) => <fieldset id={`edit-${o.id}`} tabIndex={-1} key={o.id} className="space-y-4 rounded border p-4"><legend>Session {i + 1}</legend>
      <TextField label="Session name" value={o.name} onChange={v => update(d => { d.occurrences[i].name = v; })} />
      <label className="block">Assigned stage <select aria-label="Assigned stage" className={control} value={o.stageId} onChange={e => update(d => { d.occurrences[i].stageId = e.target.value; })}>{doc.stages.map((s, j) => <option key={s.id} value={s.id}>{j + 1}. {s.name || "Unnamed stage"}</option>)}</select></label>
      <Order index={i} length={doc.occurrences.length} move={v => update(d => move(d.occurrences, i, v))} />
      <button type="button" className={control} onClick={() => update(d => { d.occurrences.splice(i, 1); })}>Remove session</button>
      {o.positions.map((p, j) => <fieldset key={p.id} className="space-y-3 rounded border p-3"><legend>Position {j + 1}</legend>
        <TextField label="Exercise name" value={p.exercise.name} onChange={v => update(d => { d.occurrences[i].positions[j].exercise.name = v; })} />
        <TextField label="Variation" value={p.exercise.variation} onChange={v => update(d => { d.occurrences[i].positions[j].exercise.variation = v; })} />
        <Order index={j} length={o.positions.length} move={v => update(d => move(d.occurrences[i].positions, j, v))} />
        <button type="button" className={control} onClick={() => update(d => { d.occurrences[i].positions.splice(j, 1); })}>Remove position</button>
        {p.targets.map((t, k) => <fieldset key={t.id} className="space-y-3 rounded border p-3"><legend>Target {k + 1}</legend>
          <TargetFields target={t} change={fn => update(d => fn(d.occurrences[i].positions[j].targets[k]))} />
          <Order index={k} length={p.targets.length} move={v => update(d => move(d.occurrences[i].positions[j].targets, k, v))} />
          <button type="button" className={control} onClick={() => update(d => { d.occurrences[i].positions[j].targets.splice(k, 1); })}>Remove target</button>
        </fieldset>)}
        <button type="button" className={control} onClick={() => update(d => { d.occurrences[i].positions[j].targets.push({ id: crypto.randomUUID(), classification: "working", required: true, reps: { min: 1, max: 1, basis: "total" }, measurement: null, rir: null, restSeconds: null }); })}>Add target</button>
      </fieldset>)}
      <button type="button" className={control} onClick={() => update(d => { d.occurrences[i].positions.push({ id: crypto.randomUUID(), exercise: { kind: "authoredDescription", name: "", variation: "" }, targets: [] }); })}>Add exercise position</button>
    </fieldset>)}
    <button type="button" className={control} disabled={!doc.stages.length} onClick={() => update(d => { d.occurrences.push({ id: crypto.randomUUID(), stageId: d.stages[0].id, name: "", positions: [] }); })}>Add session</button>
  </fieldset>;
}
