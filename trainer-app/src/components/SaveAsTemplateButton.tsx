"use client";

import { useState } from "react";

type Exercise = {
  exerciseId: string;
  name: string;
  primaryMuscles: string[];
};

type SaveAsTemplateButtonProps = {
  exercises: Exercise[];
};

const MUSCLE_TO_GROUP: Record<string, string> = {
  Chest: "chest",
  "Front Delts": "shoulders",
  "Side Delts": "shoulders",
  "Rear Delts": "shoulders",
  Triceps: "arms",
  Biceps: "arms",
  Back: "back",
  "Upper Back": "back",
  Forearms: "arms",
  Quads: "legs",
  Hamstrings: "legs",
  Glutes: "legs",
  Calves: "legs",
  Core: "core",
  "Lower Back": "core",
  Adductors: "legs",
  "Hip Flexors": "legs",
};

export function SaveAsTemplateButton({ exercises }: SaveAsTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const targetMuscles = [
    ...new Set(
      exercises.flatMap((e) =>
        e.primaryMuscles.map((m) => MUSCLE_TO_GROUP[m]).filter(Boolean)
      )
    ),
  ];

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        targetMuscles,
        exercises: exercises.map((e, i) => ({
          exerciseId: e.exerciseId,
          orderIndex: i,
        })),
      }),
    });
    setSaving(false);
    if (response.ok) {
      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
        setName("");
      }, 1500);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium
          text-slate-700 hover:bg-slate-200"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save as Template
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">Save as Template</h3>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name..."
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        maxLength={100}
        autoFocus
      />
      <div className="flex flex-wrap gap-1">
        {targetMuscles.map((m) => (
          <span
            key={m}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
          >
            {m}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white
            disabled:opacity-60"
        >
          {saved ? "Saved!" : saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-medium
            text-slate-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
