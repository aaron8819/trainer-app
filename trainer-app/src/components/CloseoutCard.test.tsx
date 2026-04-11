import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseoutCard } from "./CloseoutCard";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

beforeEach(() => {
  mocks.refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("CloseoutCard", () => {
  it("optimistically hides the card when closeout dismissal succeeds", async () => {
    const user = userEvent.setup();
    render(
      <CloseoutCard
        closeout={{
          title: "Closeout",
          statusLabel: "Planned",
          detail: "Optional manual closeout work.",
          actionHref: "/log/workout-closeout",
          actionLabel: "Open closeout",
          dismissActionHref: "/api/workouts/workout-closeout/dismiss-closeout",
          dismissActionLabel: "Skip closeout",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Skip closeout" }));

    expect(screen.queryByText("Optional manual closeout work.")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workouts/workout-closeout/dismiss-closeout", {
        method: "POST",
      })
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
