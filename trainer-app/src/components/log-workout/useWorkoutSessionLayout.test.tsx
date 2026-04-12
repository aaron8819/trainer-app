/* eslint-disable react-hooks/refs */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
      <div data-testid="viewport-bottom-offset">{layout.visualViewportBottomOffset}</div>
    </div>
  );
}

describe("useWorkoutSessionLayout", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "scrollTo", {
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
      expect(window.scrollTo).toHaveBeenCalled();
    });
  });

  it("tracks keyboard viewport height without forcing active panel scroll", async () => {
    let resizeHandler: (() => void) | undefined;
    const mockViewport = {
      height: 800,
      offsetTop: 0,
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
      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });

  it("keeps hydration stable before reading visualViewport metrics", async () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    const markup = renderToString(<LayoutHarness />);
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);

    let root: ReturnType<typeof hydrateRoot> | null = null;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: {
          height: 480,
          offsetTop: 0,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });

      await act(async () => {
        root = hydrateRoot(container, <LayoutHarness />);
        await Promise.resolve();
      });

      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          String(call[0]).includes("hydrated but some attributes")
        )
      ).toBe(false);

      await waitFor(() => {
        expect(screen.getByTestId("root")).toHaveStyle({ paddingBottom: "336px" });
      });
    } finally {
      await act(async () => {
        root?.unmount();
      });
      document.body.removeChild(container);
      consoleErrorSpy.mockRestore();
    }
  });

  it("tracks non-keyboard visual viewport bottom offset separately from keyboard height", async () => {
    let resizeHandler: (() => void) | undefined;
    const mockViewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        resizeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: mockViewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    render(<LayoutHarness />);
    mockViewport.height = 760;
    resizeHandler?.();

    await waitFor(() => {
      expect(screen.getByTestId("keyboard-open")).toHaveTextContent("false");
      expect(screen.getByTestId("viewport-bottom-offset")).toHaveTextContent("40");
      expect(screen.getByTestId("root")).toHaveStyle({ paddingBottom: "env(safe-area-inset-bottom, 16px)" });
    });
  });
});
