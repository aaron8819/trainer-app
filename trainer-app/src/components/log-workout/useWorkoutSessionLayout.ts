"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExerciseSection } from "@/components/log-workout/types";

type UseWorkoutSessionLayoutParams = {
  activeSection: ExerciseSection | null;
  activeExerciseId: string | null;
  sessionTerminated: boolean;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<ExerciseSection, boolean>>>;
  setExpandedExerciseId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useWorkoutSessionLayout({
  activeSection,
  activeExerciseId,
  sessionTerminated,
  setExpandedSections,
  setExpandedExerciseId,
}: UseWorkoutSessionLayoutParams) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const activeSetPanelRef = useRef<HTMLElement | null>(null);
  const scrollCancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<ExerciseSection, HTMLDivElement | null>>({
    warmup: null,
    main: null,
    accessory: null,
  });

  const scrollToActiveSet = useCallback(() => {
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
      const activeElement = document.activeElement;
      const isInput =
        activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      const heightDiff = window.innerHeight - viewport.height;
      const nextKeyboardOpen = heightDiff > 120;

      setKeyboardOpen(nextKeyboardOpen);
      setKeyboardHeight(nextKeyboardOpen ? heightDiff : 0);

      if (isInput && nextKeyboardOpen) {
        scrollToActiveSet();
      }
    };

    viewport.addEventListener("resize", handleResize);
    return () => viewport.removeEventListener("resize", handleResize);
  }, [scrollToActiveSet]);

  useEffect(() => {
    if (sessionTerminated || activeSection === null || activeExerciseId === null) {
      setExpandedSections({ warmup: true, main: true, accessory: true });
      return;
    }

    setExpandedSections({ warmup: false, main: false, accessory: false, [activeSection]: true });
    setExpandedExerciseId(activeExerciseId);
    scrollToActiveSet();
  }, [
    activeExerciseId,
    activeSection,
    scrollToActiveSet,
    sessionTerminated,
    setExpandedExerciseId,
    setExpandedSections,
  ]);

  return {
    keyboardOpen,
    keyboardHeight,
    activeSetPanelRef,
    sectionRefs,
  };
}
