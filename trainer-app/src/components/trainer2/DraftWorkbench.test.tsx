import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftWorkbench } from "./DraftWorkbench";

const state = (name = "My finite draft", revisionNumber = 1) => ({ planId: "plan-a", revisionId: `revision-${revisionNumber}`, revisionNumber,
  intent: { schemaVersion: 1, name, endpoint: "endOfOrderedOccurrences", stages: [], occurrences: [] }, activationBlockers: [] });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
const acceptance = (revisionNumber = 1, replayed = false) => json({ replayed,
  outcome: { status: "Accepted", result: { planId: "plan-a", revisionNumber } } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const mount = () => render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} />);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Draft workbench acceptance and read recovery", () => {
  it.each(["non-OK", "network"])("retains accepted create identity after %s refresh failure; retries only GET", async failure => {
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance());
    if (failure === "non-OK") fetcher.mockResolvedValueOnce(json({ error: "DRAFT_TRANSACTION_FAILED" }, false));
    else fetcher.mockRejectedValueOnce(new Error("offline"));
    fetcher.mockResolvedValueOnce(json(state()));
    vi.stubGlobal("fetch", fetcher); mount(); click("Create finite draft");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Accepted, refresh failed"));
    expect(screen.getByRole("status")).not.toHaveTextContent("Current head reloaded");
    expect(screen.getByLabelText("Saved plan ID")).toHaveValue("plan-a");
    expect(screen.getByText(/Last accepted result:/)).toHaveTextContent("Accepted revision 1 for plan plan-a");
    expect(screen.getByRole("button", { name: "Reload persisted draft" })).toBeEnabled();
    click("Reload persisted draft");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loaded revision 1"));
    expect(fetcher.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["POST", "GET", "GET"]);
    expect(screen.getByRole("button", { name: "Save name revision" })).toBeEnabled();
  });

  it.each([false, true])("keeps edit acceptance/replay historical after refresh failure (replayed=%s)", async replayed => {
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(state()))
      .mockResolvedValueOnce(acceptance(replayed ? 1 : 2, replayed)).mockResolvedValueOnce(json({ error: "unavailable" }, false))
      .mockResolvedValueOnce(json(state("Current server name", 3)));
    vi.stubGlobal("fetch", fetcher); mount(); click("Create finite draft");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save name revision" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Draft name"), { target: { value: "Edited" } });
    click(replayed ? "Retry same action" : "Save name revision");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Accepted, refresh failed"));
    expect(screen.getByRole("status")).not.toHaveTextContent("Current head reloaded");
    expect(screen.getByText(/Stale snapshot/)).toBeVisible();
    expect(screen.getByLabelText("Draft name")).toHaveValue("Edited");
    expect(screen.getByLabelText("Saved plan ID")).toHaveValue("plan-a");
    click("Reload persisted draft");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Revision 3: Current server name" })).toBeVisible());
    expect(screen.queryByText(/Stale snapshot/)).toBeNull();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(2);
    if (replayed) expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[0][1].body);
  });

  it("locks both inputs and overlapping requests through delayed POST, accepted GET, and manual GET", async () => {
    const user = userEvent.setup();
    let deliver!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    vi.stubGlobal("fetch", fetcher); mount(); click("Create finite draft");
    async function assertLocked(expectedCalls: number) {
      expect(screen.getByLabelText("Draft name")).toBeDisabled();
      expect(screen.getByLabelText("Saved plan ID")).toBeDisabled();
      await user.type(screen.getByLabelText("Draft name"), "Newer unsaved intention");
      expect(screen.getByLabelText("Draft name")).toHaveValue("My finite draft");
      for (const button of screen.getAllByRole("button")) { expect(button).toBeDisabled(); fireEvent.click(button); }
      expect(fetcher).toHaveBeenCalledTimes(expectedCalls);
    }
    await assertLocked(1);
    await act(async () => deliver(acceptance()));
    expect(screen.getByLabelText("Saved plan ID")).toHaveValue("plan-a");
    expect(screen.getByText(/Last accepted result:/)).toBeVisible();
    await assertLocked(2);
    await act(async () => deliver(json(state())));
    expect(screen.getByLabelText("Draft name")).toBeEnabled();
    click("Reload persisted draft"); await assertLocked(3);
    await act(async () => deliver(json(state())));
    await user.clear(screen.getByLabelText("Draft name"));
    await user.type(screen.getByLabelText("Draft name"), "New intention after reload");
    expect(screen.getByLabelText("Draft name")).toHaveValue("New intention after reload");
  });

  it("normal create/edit reload succeeds and uncertain delivery retries the exact envelope", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(acceptance(1, true)).mockResolvedValueOnce(json(state()))
      .mockResolvedValueOnce(acceptance(2)).mockResolvedValueOnce(json(state("Renamed", 2)));
    vi.stubGlobal("fetch", fetcher); mount(); click("Create finite draft");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Delivery uncertain"));
    click("Retry same action");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Current head reloaded separately"));
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
    fireEvent.change(screen.getByLabelText("Draft name"), { target: { value: "Renamed" } });
    click("Save name revision");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Revision 2: Renamed" })).toBeVisible());
    expect(screen.getByRole("status")).toHaveTextContent("Accepted revision 2");
    expect(screen.getByLabelText("Draft name")).toBeEnabled();
  });
});
