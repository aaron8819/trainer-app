"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY_PREFIX = "workout_session_started_at_";

function getStorageKey(workoutId: string): string {
  return `${STORAGE_KEY_PREFIX}${workoutId}`;
}

function parseStartedAt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readOrCreateStartedAt(storageKey: string): number {
  if (typeof window === "undefined") {
    return Date.now();
  }

  const restored = parseStartedAt(window.sessionStorage.getItem(storageKey));
  if (restored) {
    return restored;
  }

  const startedAtMs = Date.now();
  window.sessionStorage.setItem(storageKey, String(startedAtMs));
  return startedAtMs;
}

function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function useWorkoutSessionElapsedTime(workoutId: string, active: boolean) {
  const storageKey = useMemo(() => getStorageKey(workoutId), [workoutId]);
  const [startedAtMs, setStartedAtMs] = useState(() => readOrCreateStartedAt(storageKey));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const nextStartedAtMs = readOrCreateStartedAt(storageKey);
    setStartedAtMs(nextStartedAtMs);
    setNowMs(Date.now());
  }, [storageKey]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const syncNow = () => setNowMs(Date.now());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncNow();
      }
    };

    const intervalId = window.setInterval(syncNow, 1000);
    window.addEventListener("focus", syncNow);
    window.addEventListener("pageshow", syncNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("pageshow", syncNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active]);

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));

  return {
    elapsedSeconds,
    elapsedLabel: formatElapsedSeconds(elapsedSeconds),
    startedAtMs,
  };
}

