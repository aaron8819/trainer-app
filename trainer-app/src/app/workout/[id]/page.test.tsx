import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  generateWorkoutExplanation: vi.fn(),
  workoutFindFirst: vi.fn(),
  injuryFindMany: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/explainability", () => ({
  generateWorkoutExplanation: (...args: unknown[]) => mocks.generateWorkoutExplanation(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
    },
    injury: {
      findMany: (...args: unknown[]) => mocks.injuryFindMany(...args),
    },
  },
}));

describe("WorkoutDetailPage", () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.generateWorkoutExplanation.mockResolvedValue({ error: "unavailable" });
    mocks.injuryFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(["PLANNED", "COMPLETED"])("renders the audit entry point for %s workouts", async (status) => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status,
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PUSH",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/workout/workout-1/audit");
  });
});
