type WorkoutSessionFeedbackProps = {
  error: string | null;
  onDismissError: () => void;
};

const FEEDBACK_POSITION_STYLE = {
  position: "fixed" as const,
  bottom: "calc(var(--mobile-nav-height, 56px) + env(safe-area-inset-bottom, 0px) + 8px)",
  left: "16px",
  right: "16px",
  zIndex: 50,
};

export function WorkoutSessionFeedback({
  error,
  onDismissError,
}: WorkoutSessionFeedbackProps) {
  return (
    <>
      {error ? (
        <div
          data-testid="error-snackbar"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 shadow-sm"
          role="alert"
          aria-live="assertive"
          style={FEEDBACK_POSITION_STYLE}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-rose-700">{error}</p>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-rose-300 px-3 text-xs font-semibold text-rose-700"
              onClick={onDismissError}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
