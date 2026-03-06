import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutCompletionDialog } from "./WorkoutCompletionDialog";

describe("WorkoutCompletionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders above mobile nav with explicit bottom safe-area clearance", () => {
    render(
      <WorkoutCompletionDialog
        action="mark_completed"
        loggedCount={18}
        totalSets={18}
        submitting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Workout completion confirmation" });
    expect(dialog.className).toContain("z-[70]");
    expect(dialog.className).toContain(
      "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+12px)]"
    );
  });
});
