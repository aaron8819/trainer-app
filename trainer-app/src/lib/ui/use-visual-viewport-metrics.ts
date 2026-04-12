"use client";

import { useEffect, useState } from "react";

// Treat only large visualViewport height drops as keyboard state so Safari chrome
// collapse still reports as bottom drift for fixed-bottom surfaces.
const KEYBOARD_OPEN_THRESHOLD_PX = 120;

type VisualViewportMetrics = {
  keyboardOpen: boolean;
  keyboardHeight: number;
  bottomOffset: number;
};

const INITIAL_VISUAL_VIEWPORT_METRICS: VisualViewportMetrics = {
  keyboardOpen: false,
  keyboardHeight: 0,
  bottomOffset: 0,
};

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function roundViewportPixels(value: number): number {
  return Math.max(0, Math.round(value));
}

function isEditableElementFocused(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable || element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type.toLowerCase());
  }

  return false;
}

function readVisualViewportMetrics(): VisualViewportMetrics {
  if (typeof window === "undefined" || !window.visualViewport) {
    return INITIAL_VISUAL_VIEWPORT_METRICS;
  }

  const viewport = window.visualViewport;
  const heightDiff = Math.max(0, window.innerHeight - viewport.height);
  const keyboardOpen =
    heightDiff > KEYBOARD_OPEN_THRESHOLD_PX && isEditableElementFocused();
  const bottomOffset = Math.max(
    0,
    window.innerHeight - (viewport.height + viewport.offsetTop)
  );

  return {
    keyboardOpen,
    keyboardHeight: keyboardOpen ? roundViewportPixels(heightDiff) : 0,
    bottomOffset:
      keyboardOpen || heightDiff > KEYBOARD_OPEN_THRESHOLD_PX
        ? 0
        : roundViewportPixels(bottomOffset),
  };
}

export function useVisualViewportMetrics(): VisualViewportMetrics {
  const [metrics, setMetrics] = useState<VisualViewportMetrics>(
    INITIAL_VISUAL_VIEWPORT_METRICS
  );

  useEffect(() => {
    if (!window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const updateMetrics = () => {
      setMetrics(readVisualViewportMetrics());
    };

    updateMetrics();
    viewport.addEventListener("resize", updateMetrics);
    viewport.addEventListener("scroll", updateMetrics);
    window.addEventListener("resize", updateMetrics);
    document.addEventListener("focusin", updateMetrics);
    document.addEventListener("focusout", updateMetrics);

    return () => {
      viewport.removeEventListener("resize", updateMetrics);
      viewport.removeEventListener("scroll", updateMetrics);
      window.removeEventListener("resize", updateMetrics);
      document.removeEventListener("focusin", updateMetrics);
      document.removeEventListener("focusout", updateMetrics);
    };
  }, []);

  return metrics;
}
