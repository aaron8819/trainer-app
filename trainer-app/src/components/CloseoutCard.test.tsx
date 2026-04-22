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
          title: "Custom session",
          statusLabel: "Planned",
          detail: "Optional manual session.",
          actionHref: "/log/workout-closeout",
          actionLabel: "Open custom session",
          dismissActionHref: "/api/workouts/workout-closeout/dismiss-closeout",
          dismissActionLabel: "Hide optional session",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Hide optional session" }));

    expect(screen.queryByText("Optional manual session.")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workouts/workout-closeout/dismiss-closeout", {
        method: "POST",
      })
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
