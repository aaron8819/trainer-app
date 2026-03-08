import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
