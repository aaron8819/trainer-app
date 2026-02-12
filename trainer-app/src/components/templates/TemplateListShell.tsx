"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TemplateCard } from "./TemplateCard";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";

type TemplateItem = {
  id: string;
  name: string;
  exerciseCount: number;
  targetMuscles: string[];
  intent: string;
  score?: number;
  scoreLabel?: string;
};

type TemplateListShellProps = {
  templates: TemplateItem[];
};

export function TemplateListShell({ templates: initialTemplates }: TemplateListShellProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteTargetName = deleteTarget
    ? templates.find((t) => t.id === deleteTarget)?.name ?? "this template"
    : "";

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    const response = await fetch(`/api/templates/${deleteTarget}`, { method: "DELETE" });
    if (response.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== deleteTarget));
      setDeleteTarget(null);
      router.refresh();
    }
    setDeleting(false);
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Templates</h1>
        <Link
          href="/templates/new"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
        >
          Create Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center sm:p-10">
          <p className="text-sm text-slate-500">No templates yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Create a template to save your favorite exercise combos
          </p>
          <Link
            href="/templates/new"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Create your first template
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              id={template.id}
              name={template.name}
              exerciseCount={template.exerciseCount}
              targetMuscles={template.targetMuscles}
              intent={template.intent}
              score={template.score}
              scoreLabel={template.scoreLabel}
              onDeleteClick={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <SlideUpSheet
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Template"
      >
        <p className="text-sm text-slate-600">
          Are you sure you want to delete <span className="font-semibold">{deleteTargetName}</span>?
          Existing workouts generated from this template will be preserved.
        </p>
        <div className="mt-4 grid gap-2 sm:flex sm:gap-3">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={() => setDeleteTarget(null)}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
        </div>
      </SlideUpSheet>
    </div>
  );
}
