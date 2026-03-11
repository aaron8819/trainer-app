"use client";

import { useEffect, useRef, useCallback } from "react";
import { useVisualViewportMetrics } from "@/lib/ui/use-visual-viewport-metrics";

type SlideUpSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function SlideUpSheet({ isOpen, onClose, title, children }: SlideUpSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onDialogClose = () => handleClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [handleClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <OpenSlideUpSheet
      dialogRef={dialogRef}
      handleBackdropClick={handleBackdropClick}
      handleClose={handleClose}
      title={title}
    >
      {children}
    </OpenSlideUpSheet>
  );
}

function OpenSlideUpSheet({
  dialogRef,
  handleBackdropClick,
  handleClose,
  title,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  handleBackdropClick: (event: React.MouseEvent<HTMLDialogElement>) => void;
  handleClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const { bottomOffset } = useVisualViewportMetrics();

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={
        "fixed inset-0 z-[60] m-0 h-full w-full max-h-full max-w-full bg-transparent p-0 " +
        "backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      }
    >
      {/* Mobile: Slide-up sheet from bottom */}
      <div
        className="flex h-full items-end md:items-center md:justify-center"
        style={{ paddingBottom: `${bottomOffset}px` }}
      >
        <div
          data-testid="slide-up-sheet-panel"
          className={
            "flex w-full max-h-[min(90dvh,90vh)] flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[85dvh] sm:pb-0 " +
            "md:max-h-[80dvh] md:max-w-lg md:rounded-2xl " +
            "animate-[slideUp_200ms_ease-out] md:animate-[fadeIn_150ms_ease-out]"
          }
        >
          {title && (
            <div
              data-testid="slide-up-sheet-header"
              className="z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-white px-4 py-3 sm:px-5 sm:py-4"
            >
              <h2 className="min-w-0 text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
              <button
                onClick={handleClose}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
          <div
            data-testid="slide-up-sheet-body"
            className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:p-5"
          >
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}
