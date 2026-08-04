import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinisherRoutineEditor } from "./FinisherRoutineEditor";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("FinisherRoutineEditor", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("updates the shared live preview and supports ordered timed steps", async () => {
    const user = userEvent.setup();
    render(<FinisherRoutineEditor mode="create" activeLimitations={[]} />);

    await user.type(screen.getByLabelText("Name"), "Core reset");
    await user.type(screen.getByLabelText("Description"), "A controlled reset.");
    await user.type(screen.getByLabelText("Movement"), "Dead bug");
    expect(screen.getByRole("heading", { name: "Core reset" })).toBeInTheDocument();
    expect(screen.getByText(/1\. Dead bug/)).toBeInTheDocument();
    expect(screen.getByText(/0:40/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move step 2 up" })).toBeEnabled();
  });

  it("submits only the supported definition and routes back to management", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(JSON.stringify({ item: { routineId: "created" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinisherRoutineEditor mode="create" activeLimitations={[]} />);

    await user.type(screen.getByLabelText("Name"), "Core reset");
    await user.type(screen.getByLabelText("Description"), "A controlled reset.");
    await user.type(screen.getByLabelText("Movement"), "Dead bug");
    await user.click(screen.getByRole("button", { name: "Create finisher" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.definition).toMatchObject({
      name: "Core reset",
      preparationSeconds: 10,
      includesFinalRecovery: false,
      steps: [{ movementName: "Dead bug", workSeconds: 40, recoverySeconds: 20 }],
    });
    expect(body.definition).not.toHaveProperty("equipmentRequirements");
    expect(body.definition).not.toHaveProperty("placement");
    expect(router.push).toHaveBeenCalledWith("/settings/finishers");
  });
});
