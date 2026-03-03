"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedDraftStatus, SetDraftBuffers } from "@/components/log-workout/types";

type DraftPayload = {
  reps: SetDraftBuffers["reps"];
  load: SetDraftBuffers["load"];
  rpe: SetDraftBuffers["rpe"];
  savedAt: number;
};

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_WRITE_DEBOUNCE_MS = 500;

function getDraftKey(workoutId: string, workoutSetId: string): string {
  return `draft_set_${workoutId}_${workoutSetId}`;
}

function parseDraft(value: string | null): DraftPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DraftPayload>;
    if (
      typeof parsed.reps !== "string" ||
      typeof parsed.load !== "string" ||
      typeof parsed.rpe !== "string" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    return {
      reps: parsed.reps,
      load: parsed.load,
      rpe: parsed.rpe,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function useSetDraft({
  workoutId,
  setIds,
  onRestore,
}: {
  workoutId: string;
  setIds: string[];
  onRestore: (setId: string, draft: SetDraftBuffers) => void;
}) {
  const [restoredSetIds, setRestoredSetIds] = useState<Set<string>>(new Set());
  const [savingDraftSetId, setSavingDraftSetId] = useState<string | null>(null);
  const [lastSavedDraft, setLastSavedDraft] = useState<SavedDraftStatus>(null);
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const restoredOnceRef = useRef<Set<string>>(new Set());
  const stableSetIds = useMemo(() => Array.from(new Set(setIds)), [setIds]);
  const stableSetIdsKey = useMemo(() => stableSetIds.join("|"), [stableSetIds]);

  useEffect(() => {
    restoredOnceRef.current = new Set();
  }, [workoutId]);

  useEffect(() => {
    const now = Date.now();
    const restored = new Set<string>();
    const setIdsToRestore = stableSetIdsKey ? stableSetIdsKey.split("|") : [];
    setIdsToRestore.forEach((setId) => {
      const key = getDraftKey(workoutId, setId);
      const draft = parseDraft(window.localStorage.getItem(key));
      if (!draft) {
        return;
      }
      if (now - draft.savedAt > DRAFT_TTL_MS) {
        window.localStorage.removeItem(key);
        return;
      }
      const restoreToken = `${workoutId}:${setId}`;
      if (restoredOnceRef.current.has(restoreToken)) {
        restored.add(setId);
        return;
      }
      restoredOnceRef.current.add(restoreToken);
      restored.add(setId);
      onRestore(setId, { reps: draft.reps, load: draft.load, rpe: draft.rpe });
    });
    const syncTimeout = setTimeout(() => {
      setRestoredSetIds((prev) => {
        if (prev.size === restored.size && Array.from(restored).every((setId) => prev.has(setId))) {
          return prev;
        }
        return restored;
      });
    }, 0);
    return () => clearTimeout(syncTimeout);
  }, [onRestore, stableSetIdsKey, workoutId]);

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer));
      saveTimersRef.current = {};
    };
  }, []);

  const saveDraft = useCallback(
    (setId: string, values: SetDraftBuffers) => {
      const key = getDraftKey(workoutId, setId);
      if (saveTimersRef.current[setId]) {
        clearTimeout(saveTimersRef.current[setId]);
      }
      setSavingDraftSetId(setId);
      saveTimersRef.current[setId] = setTimeout(() => {
        const payload: DraftPayload = {
          reps: values.reps,
          load: values.load,
          rpe: values.rpe,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
        delete saveTimersRef.current[setId];
        setSavingDraftSetId((prev) => (prev === setId ? null : prev));
        setLastSavedDraft({ setId, savedAt: payload.savedAt });
      }, DRAFT_WRITE_DEBOUNCE_MS);
    },
    [workoutId]
  );

  const clearDraft = useCallback(
    (setId: string) => {
      const timer = saveTimersRef.current[setId];
      if (timer) {
        clearTimeout(timer);
        delete saveTimersRef.current[setId];
      }
      window.localStorage.removeItem(getDraftKey(workoutId, setId));
      restoredOnceRef.current.delete(`${workoutId}:${setId}`);
      setSavingDraftSetId((prev) => (prev === setId ? null : prev));
      setLastSavedDraft((prev) => (prev?.setId === setId ? null : prev));
      setRestoredSetIds((prev) => {
        const next = new Set(prev);
        next.delete(setId);
        return next;
      });
    },
    [workoutId]
  );

  const clearAllDrafts = useCallback(() => {
    stableSetIds.forEach((setId) => {
      const timer = saveTimersRef.current[setId];
      if (timer) {
        clearTimeout(timer);
        delete saveTimersRef.current[setId];
      }
      window.localStorage.removeItem(getDraftKey(workoutId, setId));
      restoredOnceRef.current.delete(`${workoutId}:${setId}`);
    });
    setSavingDraftSetId(null);
    setLastSavedDraft(null);
    setRestoredSetIds(new Set());
  }, [stableSetIds, workoutId]);

  const markRestoredSeen = useCallback((setId: string) => {
    setRestoredSetIds((prev) => {
      if (!prev.has(setId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(setId);
      return next;
    });
  }, []);

  return {
    saveDraft,
    clearDraft,
    clearAllDrafts,
    restoredSetIds,
    savingDraftSetId,
    lastSavedDraft,
    markRestoredSeen,
  };
}
