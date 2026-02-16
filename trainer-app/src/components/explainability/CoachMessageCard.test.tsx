/**
 * CoachMessageCard - Component smoke tests
 *
 * Phase 4.6: Basic rendering tests for coach messages
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CoachMessageCard } from "./CoachMessageCard";
import type { CoachMessage } from "@/lib/engine/explainability";

describe("CoachMessageCard", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders warning message with high priority badge", () => {
    const message: CoachMessage = {
      type: "warning",
      priority: "high",
      message: "Excessive fatigue detected in shoulders",
    };

    render(<CoachMessageCard message={message} />);

    expect(screen.getByText("Excessive fatigue detected in shoulders")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("High Priority")).toBeInTheDocument();
  });

  it("renders encouragement message without priority badge", () => {
    const message: CoachMessage = {
      type: "encouragement",
      priority: "medium",
      message: "Great progress on squat strength!",
    };

    render(<CoachMessageCard message={message} />);

    expect(screen.getByText("Great progress on squat strength!")).toBeInTheDocument();
    expect(screen.getByText("Encouragement")).toBeInTheDocument();
    expect(screen.queryByText("High Priority")).not.toBeInTheDocument();
  });

  it("renders milestone message", () => {
    const message: CoachMessage = {
      type: "milestone",
      priority: "medium",
      message: "Completed 3 weeks of accumulation",
    };

    render(<CoachMessageCard message={message} />);

    expect(screen.getByText("Completed 3 weeks of accumulation")).toBeInTheDocument();
    expect(screen.getByText("Milestone")).toBeInTheDocument();
  });

  it("renders tip message", () => {
    const message: CoachMessage = {
      type: "tip",
      priority: "low",
      message: "Focus on full range of motion for optimal hypertrophy",
    };

    render(<CoachMessageCard message={message} />);

    expect(screen.getByText("Focus on full range of motion for optimal hypertrophy")).toBeInTheDocument();
    expect(screen.getByText("Tip")).toBeInTheDocument();
  });

  it("renders all message types with correct icons", () => {
    const messages: CoachMessage[] = [
      { type: "warning", priority: "high", message: "Warning text" },
      { type: "encouragement", priority: "medium", message: "Encouragement text" },
      { type: "milestone", priority: "medium", message: "Milestone text" },
      { type: "tip", priority: "low", message: "Tip text" },
    ];

    messages.forEach((message) => {
      const { container, unmount } = render(<CoachMessageCard message={message} />);
      // Check that an emoji icon is rendered
      const icon = container.querySelector('[role="img"]');
      expect(icon).toBeInTheDocument();
      unmount();
    });
  });
});
