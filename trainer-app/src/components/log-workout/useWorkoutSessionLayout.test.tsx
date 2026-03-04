/* eslint-disable react-hooks/refs */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkoutSessionLayout } from "@/components/log-workout/useWorkoutSessionLayout";
import type { ExerciseSection } from "@/components/log-workout/types";

function LayoutHarness({
  sessionTerminated = false,
}: {
  sessionTerminated?: boolean;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<ExerciseSection, boolean>>({
    warmup: true,
    main: true,
    accessory: true,
  });
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const layout = useWorkoutSessionLayout({
    activeSection: "main",
    activeExerciseId: "ex-main",
    sessionTerminated,
    setExpandedSections,
    setExpandedExerciseId,
  });
  const keyboardHeight = layout.keyboardHeight;
  const keyboardOpen = layout.keyboardOpen;

  return (
    <div
      data-testid="root"
      style={{
        paddingBottom:
          keyboardHeight > 0 ? `${keyboardHeight + 16}px` : "env(safe-area-inset-bottom, 16px)",
      }}
    >
      <input aria-label="Reps" />
      <section ref={layout.activeSetPanelRef} data-testid="active-set-panel" />
      <div data-testid="keyboard-open">{String(keyboardOpen)}</div>
      <div data-testid="expanded-sections">{JSON.stringify(expandedSections)}</div>
      <div data-testid="expanded-exercise">{expandedExerciseId ?? ""}</div>
    </div>
  );
}

describe("useWorkoutSessionLayout", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollBy", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("owns active section expansion while the session is in progress", async () => {
    render(<LayoutHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("expanded-sections")).toHaveTextContent(
        '{"warmup":false,"main":true,"accessory":false}'
      );
      expect(screen.getByTestId("expanded-exercise")).toHaveTextContent("ex-main");
    });
  });

  it("restores all sections when the session is terminal", async () => {
    render(<LayoutHarness sessionTerminated />);

    await waitFor(() => {
      expect(screen.getByTestId("expanded-sections")).toHaveTextContent(
        '{"warmup":true,"main":true,"accessory":true}'
      );
    });
  });

  it("tracks keyboard viewport height and scrolls the active panel on input focus", async () => {
    let resizeHandler: (() => void) | undefined;
    const mockViewport = {
      height: 800,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        resizeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: mockViewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    render(<LayoutHarness />);
    fireEvent.focus(screen.getByLabelText("Reps"));
    mockViewport.height = 480;
    resizeHandler?.();

    await waitFor(() => {
      expect(screen.getByTestId("keyboard-open")).toHaveTextContent("true");
      expect(screen.getByTestId("root")).toHaveStyle({ paddingBottom: "336px" });
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });
});
