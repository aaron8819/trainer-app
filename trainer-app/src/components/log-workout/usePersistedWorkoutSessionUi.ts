"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    window.localStorage.setItem(REST_TIMER_MUTE_STORAGE_KEY, restTimerMuted ? "true" : "false");
  }, [restTimerMuted]);

  useEffect(() => {
    if (activeSetIds.length === 0) {
      return;
    }
    const storedSetId = window.sessionStorage.getItem(activeSetStorageKey);
    if (!storedSetId || !activeSetIds.includes(storedSetId)) {
      return;
    }
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
