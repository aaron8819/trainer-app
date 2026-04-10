"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedDraftStatus, SetDraftBuffers } from "@/components/log-workout/types";

type DraftPayload = {
  reps: string;
  load: string;
  rpe: string;
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
  const pendingDraftsRef = useRef<Record<string, SetDraftBuffers>>({});
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

  const persistDraft = useCallback(
    (setId: string, values: SetDraftBuffers, options?: { updateState?: boolean }) => {
      const payload: DraftPayload = {
        reps: values.reps ?? "",
        load: values.load ?? "",
        rpe: values.rpe ?? "",
        savedAt: Date.now(),
      };
      window.localStorage.setItem(getDraftKey(workoutId, setId), JSON.stringify(payload));
      delete pendingDraftsRef.current[setId];
      delete saveTimersRef.current[setId];
      if (options?.updateState === false) {
        return;
      }
      setSavingDraftSetId((prev) => (prev === setId ? null : prev));
      setLastSavedDraft({ setId, savedAt: payload.savedAt });
    },
    [workoutId]
  );

  const flushDraft = useCallback(
    (setId: string, options?: { updateState?: boolean }) => {
      const timer = saveTimersRef.current[setId];
      if (timer) {
        clearTimeout(timer);
        delete saveTimersRef.current[setId];
      }
      const pendingDraft = pendingDraftsRef.current[setId];
      if (!pendingDraft) {
        if (options?.updateState === false) {
          return;
        }
        setSavingDraftSetId((prev) => (prev === setId ? null : prev));
        return;
      }
      persistDraft(setId, pendingDraft, options);
    },
    [persistDraft]
  );

  const flushAllDrafts = useCallback(
    (options?: { updateState?: boolean }) => {
      const pendingSetIds = new Set([
        ...Object.keys(saveTimersRef.current),
        ...Object.keys(pendingDraftsRef.current),
      ]);
      pendingSetIds.forEach((setId) => flushDraft(setId, options));
    },
    [flushDraft]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushAllDrafts();
      }
    };

    const handlePageHide = () => {
      flushAllDrafts();
    };

    const handleFocusOut = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }
      flushAllDrafts();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("pagehide", handlePageHide);
      flushAllDrafts({ updateState: false });
    };
  }, [flushAllDrafts]);

  const saveDraft = useCallback(
    (setId: string, values: SetDraftBuffers) => {
      if (saveTimersRef.current[setId]) {
        clearTimeout(saveTimersRef.current[setId]);
      }
      pendingDraftsRef.current[setId] = {
        reps: values.reps ?? "",
        load: values.load ?? "",
        rpe: values.rpe ?? "",
      };
      setSavingDraftSetId(setId);
      saveTimersRef.current[setId] = setTimeout(() => {
        flushDraft(setId);
      }, DRAFT_WRITE_DEBOUNCE_MS);
    },
    [flushDraft]
  );

  const clearDraft = useCallback(
    (setId: string) => {
      const timer = saveTimersRef.current[setId];
      if (timer) {
        clearTimeout(timer);
        delete saveTimersRef.current[setId];
      }
      delete pendingDraftsRef.current[setId];
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
      delete pendingDraftsRef.current[setId];
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
