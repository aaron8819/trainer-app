"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExerciseSection } from "@/components/log-workout/types";

export function useWorkoutSessionLayout() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const activeSetPanelRef = useRef<HTMLElement | null>(null);
  const scrollCancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<ExerciseSection, HTMLDivElement | null>>({
    warmup: null,
    main: null,
    accessory: null,
  });

  const jumpToActiveSet = useCallback(() => {
    if (scrollCancelRef.current !== null) {
      clearTimeout(scrollCancelRef.current);
    }

    scrollCancelRef.current = setTimeout(() => {
      scrollCancelRef.current = null;
      const element = activeSetPanelRef.current;
      if (!element || typeof element.scrollIntoView !== "function") {
        return;
      }

      element.scrollIntoView({ behavior: "smooth", block: "start" });
      window.scrollBy?.(0, -72);
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollCancelRef.current !== null) {
        clearTimeout(scrollCancelRef.current);
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
