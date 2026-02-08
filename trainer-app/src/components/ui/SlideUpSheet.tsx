"use client";

import { useEffect, useRef, useCallback } from "react";

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
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className={
        "fixed inset-0 z-[60] m-0 h-full w-full max-h-full max-w-full bg-transparent p-0 " +
        "backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      }
    >
      {/* Mobile: Slide-up sheet from bottom */}
      <div className="flex h-full items-end md:items-center md:justify-center">
        <div
          className={
            "w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl " +
            "md:max-w-lg md:rounded-2xl md:max-h-[80vh] " +
            "animate-[slideUp_200ms_ease-out] md:animate-[fadeIn_150ms_ease-out]"
          }
        >
          {title && (
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 rounded-t-2xl">
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <button
                onClick={handleClose}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
          <div className="p-5">{children}</div>
        </div>
      </div>
    </dialog>
  );
}
