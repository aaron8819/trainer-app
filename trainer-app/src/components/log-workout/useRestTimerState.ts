"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RestTimerSnapshot = {
  startedAtMs: number;
  endAtMs: number;
};

export type { RestTimerSnapshot };

const STORAGE_KEY_PREFIX = "workout_rest_timer_";

function getStorageKey(workoutId: string): string {
  return `${STORAGE_KEY_PREFIX}${workoutId}`;
}

function parseSnapshot(value: string | null): RestTimerSnapshot | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<RestTimerSnapshot>;
    if (typeof parsed.startedAtMs !== "number" || typeof parsed.endAtMs !== "number") {
      return null;
    }
    return {
      startedAtMs: parsed.startedAtMs,
      endAtMs: parsed.endAtMs,
    };
  } catch {
    return null;
  }
}

export function useRestTimerState(workoutId: string) {
  const storageKey = useMemo(() => getStorageKey(workoutId), [workoutId]);
  const [timer, setTimer] = useState<RestTimerSnapshot | null>(null);
  const syncTimerFromStorage = useCallback(() => {
    const restored = parseSnapshot(window.sessionStorage.getItem(storageKey));
    if (!restored) {
      setTimer(null);
      return;
    }
    if (restored.endAtMs <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
      setTimer(null);
      return;
    }
    setTimer(restored);
  }, [storageKey]);

  useEffect(() => {
    syncTimerFromStorage();
  }, [syncTimerFromStorage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncTimerFromStorage();
      }
    };
    const handlePageShow = () => {
      syncTimerFromStorage();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handlePageShow);
    };
  }, [syncTimerFromStorage]);

  useEffect(() => {
    if (!timer) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(timer));
  }, [storageKey, timer]);

  const startTimer = useCallback((durationSeconds: number) => {
    const now = Date.now();
    setTimer({
      startedAtMs: now,
      endAtMs: now + Math.max(0, durationSeconds) * 1000,
    });
  }, []);

  const clearTimer = useCallback(() => {
    setTimer(null);
  }, []);

  const restoreTimer = useCallback((snapshot: RestTimerSnapshot | null) => {
    if (!snapshot || snapshot.endAtMs <= Date.now()) {
      setTimer(null);
      return;
    }
    setTimer(snapshot);
  }, []);

  const adjustTimer = useCallback((deltaSeconds: number) => {
    setTimer((prev) => {
      if (!prev) {
        return prev;
      }
      const nextEndAtMs = Math.max(Date.now(), prev.endAtMs + deltaSeconds * 1000);
      if (nextEndAtMs <= Date.now()) {
        return null;
      }
      return {
        ...prev,
        endAtMs: nextEndAtMs,
      };
    });
  }, []);

  return {
    restTimer: timer,
    startTimer,
    clearTimer,
    restoreTimer,
    adjustTimer,
  };
}
