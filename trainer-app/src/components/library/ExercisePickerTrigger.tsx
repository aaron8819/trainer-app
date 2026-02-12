"use client";

type ExercisePickerTriggerProps = {
  selectedNames: string[];
  onRemove: (name: string) => void;
  onAdd: () => void;
  label: string;
};

export function ExercisePickerTrigger({
  selectedNames,
  onRemove,
  onAdd,
  label,
}: ExercisePickerTriggerProps) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {selectedNames.map((name) => (
          <span
            key={name}
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
          >
            {name}
            <button
              type="button"
              onClick={() => onRemove(name)}
              className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-slate-200"
              aria-label={`Remove ${name}`}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-700"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {label}
      </button>
    </div>
  );
}
