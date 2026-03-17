import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadMesocycleSetupFromPrisma: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => mocks.notFound(...args),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-setup", () => ({
  loadMesocycleSetupFromPrisma: (...args: unknown[]) => mocks.loadMesocycleSetupFromPrisma(...args),
}));

vi.mock("@/components/MesocycleSetupEditor", () => ({
  MesocycleSetupEditor: ({ mesocycleId }: { mesocycleId: string }) => (
    <div>Setup editor for {mesocycleId}</div>
  ),
}));

describe("MesocycleSetupPage", () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadMesocycleSetupFromPrisma.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 3,
      recommendedDraft: { version: 1 },
      currentDraft: { version: 1 },
      carryForwardRows: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the setup route as the editable next-step after review", async () => {
    const { default: MesocycleSetupPage } = await import("./page");
    const ui = await MesocycleSetupPage({ params: Promise.resolve({ id: "meso-1" }) });

    render(ui);

    expect(screen.getByRole("heading", { name: "Meso 3 handoff setup" })).toBeInTheDocument();
    expect(
      screen.getByText(/The system recommendation stays frozen. This screen only edits the pending draft/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to review" })).toHaveAttribute(
      "href",
      "/mesocycles/meso-1/review"
    );
    expect(screen.getByText("Setup editor for meso-1")).toBeInTheDocument();
  });
});
