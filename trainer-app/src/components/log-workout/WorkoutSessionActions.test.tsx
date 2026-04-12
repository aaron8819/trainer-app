import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutSessionActions } from "./WorkoutSessionActions";

function renderSessionActions(overrides: Partial<ComponentProps<typeof WorkoutSessionActions>> = {}) {
  const props: ComponentProps<typeof WorkoutSessionActions> = {
    workoutHref: "/workout/workout-1",
    loggedCount: 0,
    totalSets: 4,
    completed: false,
    skipped: false,
    showFinishBar: false,
    finishActionLabel: "Finish workout",
    showSkipOptions: false,
    skipReason: "",
    sessionActionPending: false,
    onFinish: vi.fn(),
    onLeaveForNow: vi.fn(),
    onToggleSkipOptions: vi.fn(),
    onSkipReasonChange: vi.fn(),
    onConfirmSkip: vi.fn(),
    ...overrides,
  };

  render(<WorkoutSessionActions {...props} />);

  return props;
}

describe("WorkoutSessionActions", () => {
  beforeEach(() => {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal() {
        this.setAttribute("open", "");
      };
    }

    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute("open");
      };
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps leave-for-now unavailable before any sets are logged", async () => {
    const user = userEvent.setup();

    renderSessionActions({ loggedCount: 0, showFinishBar: false });

    expect(screen.queryByRole("button", { name: "Leave for now" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "... Workout options" }));

    expect(screen.getByRole("heading", { name: "Workout options" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View workout" })).toHaveAttribute("href", "/workout/workout-1");
    expect(screen.queryByRole("button", { name: "Leave for now" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip workout" })).toBeInTheDocument();
  });

  it("shows leave-for-now as a direct action after progress exists", async () => {
    const user = userEvent.setup();
    const props = renderSessionActions({ loggedCount: 1, showFinishBar: false });

    await user.click(screen.getByRole("button", { name: "Leave for now" }));

    expect(props.onLeaveForNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "... Workout options" })).toBeInTheDocument();
  });

  it("keeps leave-for-now reachable when the finish bar is visible", () => {
    renderSessionActions({ loggedCount: 4, showFinishBar: true });

    expect(screen.getByRole("button", { name: "Leave for now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "... Workout options" })).not.toBeInTheDocument();
  });

  it("can render the workout options button without finish actions", async () => {
    const user = userEvent.setup();

    renderSessionActions({ loggedCount: 4, mode: "optionsOnly", showFinishBar: true });

    expect(screen.queryByRole("button", { name: "Leave for now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish workout" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "... Workout options" }));

    expect(screen.getByRole("link", { name: "View workout" })).toHaveAttribute("href", "/workout/workout-1");
    expect(screen.getByRole("button", { name: "Skip workout" })).toBeInTheDocument();
  });
});
