import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CycleAnchorControls } from "./CycleAnchorControls";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
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

describe("CycleAnchorControls", () => {
  it("requires confirmation before ending the active mesocycle early", async () => {
    const user = userEvent.setup();
    render(
      <CycleAnchorControls availableActions={["end_early"]} showHeading={false} />
    );

    await user.click(screen.getByRole("button", { name: "End mesocycle early" }));

    expect(
      screen.getByText(/without counting unfinished sessions as performed/i)
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_early" }),
      })
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
