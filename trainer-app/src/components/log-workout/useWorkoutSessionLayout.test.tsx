/* eslint-disable react-hooks/refs */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkoutSessionLayout } from "@/components/log-workout/useWorkoutSessionLayout";

function LayoutHarness() {
  const layout = useWorkoutSessionLayout();
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
      <button onClick={layout.jumpToActiveSet} type="button">
        jump
      </button>
      <div data-testid="keyboard-open">{String(keyboardOpen)}</div>
    </div>
  );
}

describe("useWorkoutSessionLayout", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes explicit jumpToActiveSet action", async () => {
    render(<LayoutHarness />);
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("tracks keyboard viewport height without forcing active panel scroll", async () => {
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
    (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    mockViewport.height = 480;
    resizeHandler?.();

    await waitFor(() => {
      expect(screen.getByTestId("keyboard-open")).toHaveTextContent("true");
      expect(screen.getByTestId("root")).toHaveStyle({ paddingBottom: "336px" });
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
