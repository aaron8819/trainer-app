import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseoutCard } from "./CloseoutCard";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
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
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.push.mockReset();
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
          dismissActionLabel: "Dismiss optional session",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Dismiss optional session" }));

    expect(screen.queryByText("Optional manual session.")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workouts/workout-closeout/dismiss-closeout", {
        method: "POST",
      })
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("creates optional sessions with POST before navigating to logging", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ workout: { id: "created-closeout" } }),
      })) as unknown as typeof fetch
    );

    render(
      <CloseoutCard
        closeout={{
          title: "Week 3 optional session",
          statusLabel: "Available",
          detail: "Optional manual session.",
          actionHref: "/api/mesocycles/week-close/wc-1/closeout",
          actionLabel: "Create optional session",
          actionMethod: "post",
          dismissActionHref: null,
          dismissActionLabel: null,
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Create optional session" }));

    expect(fetch).toHaveBeenCalledWith("/api/mesocycles/week-close/wc-1/closeout", {
      method: "POST",
    });
    expect(mocks.push).toHaveBeenCalledWith("/log/created-closeout");
  });
});
