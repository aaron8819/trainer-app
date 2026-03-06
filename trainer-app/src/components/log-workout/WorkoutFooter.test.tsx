import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkoutFooter } from "./WorkoutFooter";

describe("WorkoutFooter", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the mobile nav offset class without forcing bottom 0 inline when keyboard is closed", () => {
    render(
      <WorkoutFooter sticky>
        <button type="button">Finish workout</button>
      </WorkoutFooter>
    );

    const footer = screen.getByTestId("workout-finish-bar");
    expect(footer).toHaveClass("fixed");
    expect(footer.className).toContain(
      "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]"
    );
    expect(footer.style.bottom).toBe("");
  });

  it("uses inline bottom offset only when an explicit keyboard offset is provided", () => {
    render(
      <WorkoutFooter sticky bottomOffset={320}>
        <button type="button">Finish workout</button>
      </WorkoutFooter>
    );

    const footer = screen.getByTestId("workout-finish-bar");
    expect(footer.style.bottom).toBe("320px");
  });
});
