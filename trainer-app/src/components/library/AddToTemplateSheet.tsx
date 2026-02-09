"use client";

import { useEffect, useState } from "react";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";

type Template = {
  id: string;
  name: string;
  exerciseCount: number;
};

type AddToTemplateSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  exerciseId: string;
  exerciseName: string;
};

export function AddToTemplateSheet({
  isOpen,
  onClose,
  exerciseId,
  exerciseName,
}: AddToTemplateSheetProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [prevIsOpen, setPrevIsOpen] = useState(false);

  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setLoading(true);
    setSuccess(null);
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? data ?? []))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleAdd = async (templateId: string) => {
    setAddingTo(templateId);
    const response = await fetch(`/api/templates/${templateId}/exercises`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseId }),
    });
    setAddingTo(null);
    if (response.ok) {
      setSuccess(templateId);
      setTimeout(() => onClose(), 1200);
    }
  };

  return (
    <SlideUpSheet
      isOpen={isOpen}
      onClose={onClose}
      title={`Add "${exerciseName}" to template`}
    >
      <div className="space-y-2 p-4">
        {loading && <p className="text-sm text-slate-400">Loading templates...</p>}
        {!loading && templates.length === 0 && (
          <p className="text-sm text-slate-400">No templates found. Create one first.</p>
        )}
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => handleAdd(t.id)}
            disabled={addingTo !== null}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200
              px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <div>
              <span className="text-sm font-medium text-slate-800">{t.name}</span>
              <span className="ml-2 text-xs text-slate-400">
                {t.exerciseCount} exercises
              </span>
            </div>
            {success === t.id ? (
              <span className="text-xs font-medium text-emerald-600">Added!</span>
            ) : addingTo === t.id ? (
              <span className="text-xs text-slate-400">Adding...</span>
            ) : (
              <svg
                className="h-4 w-4 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </SlideUpSheet>
  );
}
