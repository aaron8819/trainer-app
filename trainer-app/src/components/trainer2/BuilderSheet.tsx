"use client";
import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import styles from './Builder.module.css';

export function containSheetFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]'))
    .filter(element => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length > 0);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}

export function BuilderSheet({ title, children, close, trigger }: { title: string; children: ReactNode; close: () => void; trigger?: HTMLElement }) {
  const ref = useRef<HTMLDialogElement>(null);
  const origin = useRef(trigger);
  useEffect(() => {
    const dialog = ref.current!;
    const destination = origin.current;
    dialog.showModal();
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.style.maxHeight = `${(viewport?.height ?? window.innerHeight) - 24}px`;
      dialog.style.bottom = `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`;
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => {
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      dialog.close();
      requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) destination?.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} aria-label={title} className={styles.sheet} onKeyDown={containSheetFocus} onCancel={e => { e.preventDefault(); close(); }}>
    <header className={styles.sheetHeader}><h2>{title}</h2><button type="button" onClick={close}>Cancel</button></header>
    {children}
  </dialog>;
}
