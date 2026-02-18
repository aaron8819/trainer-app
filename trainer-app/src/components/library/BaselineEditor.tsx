"use client";

import { useState } from "react";
import { toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";

type BaselineData = {
  context: string;
  workingWeightMin?: number;
  workingWeightMax?: number;
  workingRepsMin?: number;
  workingRepsMax?: number;
  topSetWeight?: number;
  topSetReps?: number;
  notes?: string;
};

type BaselineEditorProps = {
  exerciseId: string;
  initial?: BaselineData;
  isDumbbell?: boolean;
  onSaved: () => void;
};

const CONTEXTS = [
  { value: "default", label: "Default" },
  { value: "heavy", label: "Heavy" },
  { value: "volume", label: "Volume" },
  { value: "strength", label: "Strength" },
];

export function BaselineEditor({ exerciseId, initial, isDumbbell = false, onSaved }: BaselineEditorProps) {
  // Weight state stores display values (per-dumbbell for DB exercises, total otherwise).
  // On save, we convert back to total via toStoredLoad.
  const [context, setContext] = useState(initial?.context ?? "default");
  const [workingWeightMin, setWorkingWeightMin] = useState(
    (toDisplayLoad(initial?.workingWeightMin, isDumbbell) ?? "").toString()
  );
  const [workingWeightMax, setWorkingWeightMax] = useState(
    (toDisplayLoad(initial?.workingWeightMax, isDumbbell) ?? "").toString()
  );
  const [workingRepsMin, setWorkingRepsMin] = useState(initial?.workingRepsMin?.toString() ?? "");
  const [workingRepsMax, setWorkingRepsMax] = useState(initial?.workingRepsMax?.toString() ?? "");
  const [topSetWeight, setTopSetWeight] = useState(
    (toDisplayLoad(initial?.topSetWeight, isDumbbell) ?? "").toString()
  );
  const [topSetReps, setTopSetReps] = useState(initial?.topSetReps?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const toNum = (v: string) => (v ? Number(v) : undefined);
    const toInt = (v: string) => (v ? Math.round(Number(v)) : undefined);

    const res = await fetch("/api/baselines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exerciseId,
        context,
        workingWeightMin: toStoredLoad(toNum(workingWeightMin), isDumbbell),
        workingWeightMax: toStoredLoad(toNum(workingWeightMax), isDumbbell),
        workingRepsMin: toInt(workingRepsMin),
        workingRepsMax: toInt(workingRepsMax),
        topSetWeight: toStoredLoad(toNum(topSetWeight), isDumbbell),
        topSetReps: toInt(topSetReps),
        notes: notes || undefined,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to save");
      return;
    }

    onSaved();
  };

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-slate-400";

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-600">Context</label>
        <select
          value={context}
          onChange={(e) => setContext(e.target.value)}
          className={inputClass + " mt-1"}
        >
          {CONTEXTS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600">
            {isDumbbell ? "Working Weight Min (per DB)" : "Working Weight Min"}
          </label>
          <input
            type="number"
            value={workingWeightMin}
            onChange={(e) => setWorkingWeightMin(e.target.value)}
            placeholder="lbs"
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">
            {isDumbbell ? "Working Weight Max (per DB)" : "Working Weight Max"}
          </label>
          <input
            type="number"
            value={workingWeightMax}
            onChange={(e) => setWorkingWeightMax(e.target.value)}
            placeholder="lbs"
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Working Reps Min</label>
          <input
            type="number"
            value={workingRepsMin}
            onChange={(e) => setWorkingRepsMin(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Working Reps Max</label>
          <input
            type="number"
            value={workingRepsMax}
            onChange={(e) => setWorkingRepsMax(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">
            {isDumbbell ? "Top Set Weight (per DB)" : "Top Set Weight"}
          </label>
          <input
            type="number"
            value={topSetWeight}
            onChange={(e) => setTopSetWeight(e.target.value)}
            placeholder="lbs"
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Top Set Reps</label>
          <input
            type="number"
            value={topSetReps}
            onChange={(e) => setTopSetReps(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-600">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass + " mt-1 resize-none"}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Baseline"}
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
