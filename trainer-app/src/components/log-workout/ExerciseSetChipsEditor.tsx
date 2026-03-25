export type ExerciseSetChip = {
  setId: string;
  label: string;
  isLogged: boolean;
  isActive: boolean;
  isSaving: boolean;
};

type ExerciseSetChipsEditorProps = {
  chips: ExerciseSetChip[];
  hasLoggedSets: boolean;
  onSelectSet: (setId: string) => void;
  trailingAction?: {
    label: string;
    disabled?: boolean;
    onClick: () => void;
  };
};

export function ExerciseSetChipsEditor({
  chips,
  hasLoggedSets,
  onSelectSet,
  trailingAction,
}: ExerciseSetChipsEditorProps) {
  return (
    <div className="border-t border-slate-100 p-3">
      {hasLoggedSets ? (
        <p className="mb-2 text-[11px] text-slate-500">
          Dark chip is the selected set. Logged chips reopen the active card in edit mode.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2" data-testid="exercise-set-chip-list">
        {chips.map((chip) => (
          <button
            key={chip.setId}
            className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
              chip.isActive
                ? "border-slate-900 bg-slate-900 text-white shadow-sm ring-2 ring-slate-200"
                : chip.isLogged
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-300 text-slate-700"
            } ${chip.isSaving ? "opacity-60" : ""}`}
            onClick={() => onSelectSet(chip.setId)}
            type="button"
          >
            {chip.label}
          </button>
        ))}
        {trailingAction ? (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
            disabled={trailingAction.disabled}
            onClick={trailingAction.onClick}
            type="button"
          >
            {trailingAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
