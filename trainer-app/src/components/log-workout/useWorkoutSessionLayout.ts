"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExerciseSection } from "@/components/log-workout/types";

export function useWorkoutSessionLayout(stickyOffset = 0) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const activeSetPanelRef = useRef<HTMLElement | null>(null);
  const scrollCancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyOffsetRef = useRef(stickyOffset);
  const sectionRefs = useRef<Record<ExerciseSection, HTMLDivElement | null>>({
    warmup: null,
    main: null,
    accessory: null,
  });

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

  useEffect(() => {
    if (!window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const handleResize = () => {
      const heightDiff = window.innerHeight - viewport.height;
      const nextKeyboardOpen = heightDiff > 120;

      setKeyboardOpen(nextKeyboardOpen);
      setKeyboardHeight(nextKeyboardOpen ? heightDiff : 0);
    };

    viewport.addEventListener("resize", handleResize);
    return () => viewport.removeEventListener("resize", handleResize);
  }, []);

  return {
    keyboardOpen,
    keyboardHeight,
    activeSetPanelRef,
    jumpToActiveSet,
    sectionRefs,
  };
}
