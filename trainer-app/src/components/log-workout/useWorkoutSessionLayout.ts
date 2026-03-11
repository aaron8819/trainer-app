"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ExerciseSection } from "@/components/log-workout/types";
import { useVisualViewportMetrics } from "@/lib/ui/use-visual-viewport-metrics";

export function useWorkoutSessionLayout(stickyOffset = 0) {
  const activeSetPanelRef = useRef<HTMLElement | null>(null);
  const scrollCancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyOffsetRef = useRef(stickyOffset);
  const sectionRefs = useRef<Record<ExerciseSection, HTMLDivElement | null>>({
    warmup: null,
    main: null,
    accessory: null,
  });
  const { keyboardOpen, keyboardHeight, bottomOffset: visualViewportBottomOffset } =
    useVisualViewportMetrics();

  useEffect(() => {
    stickyOffsetRef.current = stickyOffset;
  }, [stickyOffset]);

  const scrollActiveSetIntoView = useCallback(() => {
    const element = activeSetPanelRef.current;
    if (!element) {
      return;
    }
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (typeof window.scrollTo === "function") {
      const y = window.scrollY + element.getBoundingClientRect().top - stickyOffsetRef.current - 12;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }
  }, []);

  const jumpToActiveSet = useCallback(() => {
    if (scrollCancelRef.current !== null) {
      clearTimeout(scrollCancelRef.current);
    }
    if (followUpScrollRef.current !== null) {
      clearTimeout(followUpScrollRef.current);
    }

    scrollCancelRef.current = setTimeout(() => {
      scrollCancelRef.current = null;
      scrollActiveSetIntoView();
      // Apply a second correction after sticky timer layout settles.
      followUpScrollRef.current = setTimeout(() => {
        followUpScrollRef.current = null;
        scrollActiveSetIntoView();
      }, 180);
    }, 150);
  }, [scrollActiveSetIntoView]);

  useEffect(() => {
    return () => {
      if (scrollCancelRef.current !== null) {
        clearTimeout(scrollCancelRef.current);
      }
      if (followUpScrollRef.current !== null) {
        clearTimeout(followUpScrollRef.current);
      }
    };
  }, []);

  return {
    keyboardOpen,
    keyboardHeight,
    visualViewportBottomOffset,
    activeSetPanelRef,
    jumpToActiveSet,
    sectionRefs,
  };
}
