"use client";

import { useEffect, useRef, useState } from "react";

const ACTIVE_SET_STORAGE_KEY_PREFIX = "workout_active_set_";
const REST_TIMER_MUTE_STORAGE_KEY = "workout_rest_timer_muted";

function getActiveSetStorageKey(workoutId: string): string {
  return `${ACTIVE_SET_STORAGE_KEY_PREFIX}${workoutId}`;
}

export function usePersistedWorkoutSessionUi({
  workoutId,
  activeSetIds,
  resolvedActiveSetId,
  setActiveSetId,
}: {
  workoutId: string;
  activeSetIds: string[];
  resolvedActiveSetId: string | null;
  setActiveSetId: (setId: string | null) => void;
}) {
  const [restTimerMuted, setRestTimerMuted] = useState(
    () => (typeof window !== "undefined" ? window.localStorage.getItem(REST_TIMER_MUTE_STORAGE_KEY) === "true" : false)
  );
  const activeSetStorageKey = getActiveSetStorageKey(workoutId);
  const restoredActiveSetRef = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(REST_TIMER_MUTE_STORAGE_KEY, restTimerMuted ? "true" : "false");
  }, [restTimerMuted]);

  useEffect(() => {
    restoredActiveSetRef.current = false;
  }, [workoutId]);

  useEffect(() => {
    if (restoredActiveSetRef.current) {
      return;
    }
    if (activeSetIds.length === 0) {
      return;
    }
    const storedSetId = window.sessionStorage.getItem(activeSetStorageKey);
    if (!storedSetId || !activeSetIds.includes(storedSetId)) {
      restoredActiveSetRef.current = true;
      return;
    }
    restoredActiveSetRef.current = true;
    setActiveSetId(storedSetId);
  }, [activeSetIds, activeSetStorageKey, setActiveSetId]);

  useEffect(() => {
    if (!resolvedActiveSetId) {
      window.sessionStorage.removeItem(activeSetStorageKey);
      return;
    }
    window.sessionStorage.setItem(activeSetStorageKey, resolvedActiveSetId);
  }, [activeSetStorageKey, resolvedActiveSetId]);

  return {
    restTimerMuted,
    setRestTimerMuted,
  };
}
