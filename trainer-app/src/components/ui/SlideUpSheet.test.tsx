import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideUpSheet } from "./SlideUpSheet";

describe("SlideUpSheet", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function setupVisualViewport(initialHeight = 800) {
    let resizeHandler: (() => void) | undefined;
    let scrollHandler: (() => void) | undefined;
    const mockViewport = {
      height: initialHeight,
      offsetTop: 0,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "resize") {
          resizeHandler = handler;
        }
        if (event === "scroll") {
          scrollHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: mockViewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: initialHeight });

    return {
      mockViewport,
      setViewport(next: { height?: number; offsetTop?: number }) {
        if (next.height != null) {
          mockViewport.height = next.height;
        }
        if (next.offsetTop != null) {
          mockViewport.offsetTop = next.offsetTop;
        }
        resizeHandler?.();
        scrollHandler?.();
      },
    };
  }

  it("keeps the header outside the scroll body and applies mobile-safe spacing", () => {
    render(
      <SlideUpSheet isOpen={true} onClose={vi.fn()} title="Sheet title">
        <div>Content</div>
      </SlideUpSheet>
    );

    const panel = screen.getByTestId("slide-up-sheet-panel");
    const header = screen.getByTestId("slide-up-sheet-header");
    const body = screen.getByTestId("slide-up-sheet-body");

    expect(panel.className).toContain("flex-col");
    expect(panel.className).toContain("overflow-hidden");
    expect(panel.className).toContain("max-h-[min(90dvh,90vh)]");
    expect(panel.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(header.className).not.toContain("sticky");
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("pb-[calc(16px+env(safe-area-inset-bottom))]");
  });

  it("closes when the close button is pressed", () => {
    const onClose = vi.fn();

    render(
      <SlideUpSheet isOpen={true} onClose={onClose} title="Sheet title">
        <div>Content</div>
      </SlideUpSheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies visual viewport bottom offset only for chrome drift, not keyboard height", async () => {
    const viewport = setupVisualViewport();

    render(
      <SlideUpSheet isOpen={true} onClose={vi.fn()} title="Sheet title">
        <div>Content</div>
      </SlideUpSheet>
    );

    const panelContainer = screen.getByTestId("slide-up-sheet-panel").parentElement as HTMLElement;

    expect(panelContainer).toHaveStyle({ paddingBottom: "0px" });

    viewport.setViewport({ height: 760 });

    await waitFor(() => {
      expect(panelContainer).toHaveStyle({ paddingBottom: "40px" });
    });

    viewport.setViewport({ height: 480 });

    await waitFor(() => {
      expect(panelContainer).toHaveStyle({ paddingBottom: "0px" });
    });
  });

  it("does not subscribe to visualViewport while closed", () => {
    const viewport = setupVisualViewport();

    render(
      <SlideUpSheet isOpen={false} onClose={vi.fn()} title="Sheet title">
        <div>Content</div>
      </SlideUpSheet>
    );

    expect(viewport.mockViewport.addEventListener).not.toHaveBeenCalled();
  });
});
