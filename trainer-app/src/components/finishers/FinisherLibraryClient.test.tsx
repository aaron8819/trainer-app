import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FinisherLibraryData,
  FinisherLibraryItemDto,
} from "@/lib/api/finisher-library-service";
import { FinisherLibraryClient } from "./FinisherLibraryClient";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function item(input: {
  id: string;
  name: string;
  ownership?: "SYSTEM" | "USER";
  state?: "ACTIVE" | "ARCHIVED";
  revision?: number;
}): FinisherLibraryItemDto {
  const ownership = input.ownership ?? "SYSTEM";
  const state = input.state ?? "ACTIVE";
  return {
    routineId: input.id,
    state,
    activePosition: state === "ACTIVE" ? 0 : null,
    revision: input.revision ?? 1,
    ownership,
    canEdit: ownership === "USER",
    canDelete: ownership === "USER",
    createdAt: null,
    updatedAt: null,
    archivedAt: state === "ARCHIVED" ? "2026-08-03T12:00:00.000Z" : null,
    restoredAt: null,
    routine: {
      id: `${input.id}-version`,
      routineId: input.id,
      code: input.id,
      version: 1,
      name: input.name,
      description: `${input.name} description`,
      category: "CORE",
      placement: "POST_WORKOUT",
      kind: "FINISHER",
      protocol: "TIMED_INTERVALS",
      difficulty: "EASY",
      fatigueCost: "LOW",
      impactLevel: "LOW",
      preparationSeconds: 0,
      includesFinalRecovery: false,
      durationSeconds: 40,
      equipmentRequirements: [],
      bodyRegions: ["core"],
      limitationTags: [],
      warnings: [],
      steps: [{
        id: `${input.id}-step`,
        orderIndex: 0,
        movementName: "Dead bug",
        workSeconds: 40,
        recoverySeconds: 0,
        techniqueCues: [],
        alternatives: [],
      }],
    },
  };
}

const system = item({
  id: "00000000-0000-4000-8000-000000000001",
  name: "System Core",
  revision: 0,
});
const custom = item({
  id: "00000000-0000-4000-8000-000000000002",
  name: "My Core",
  ownership: "USER",
  revision: 3,
});
const archived = item({
  id: "00000000-0000-4000-8000-000000000003",
  name: "Archived Core",
  ownership: "USER",
  state: "ARCHIVED",
  revision: 4,
});
const library: FinisherLibraryData = {
  active: [system, custom],
  archived: [archived],
  activeLimitations: [],
};

describe("FinisherLibraryClient", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("separates Active and Archived views and protects system routines", async () => {
    const user = userEvent.setup();
    render(<FinisherLibraryClient initial={library} />);

    expect(screen.getByText("System Core").closest("article")).toHaveTextContent("System");
    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
    expect(screen.getByText("System Core").closest("article")).not.toHaveTextContent("Delete");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/settings/finishers/${custom.routineId}/edit`,
    );

    await user.click(screen.getByRole("tab", { name: "Archived (1)" }));
    expect(screen.getByText("Archived Core")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("submits the complete ordered ID/revision set when reordering", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ...library, active: [custom, system] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinisherLibraryClient initial={library} />);

    await user.click(screen.getByRole("button", { name: "Move My Core up" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/finishers/reorder",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items: [
            { routineId: custom.routineId, expectedRevision: 3 },
            { routineId: system.routineId, expectedRevision: 0 },
          ],
        }),
      }),
    );
    expect(screen.getByText("Finisher order updated.")).toBeInTheDocument();
  });

  it("binds customization to the displayed immutable routine version", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ item: custom }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinisherLibraryClient initial={library} />);

    await user.click(screen.getByRole("button", { name: "Customize" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/finishers/${system.routineId}/duplicate`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedRoutineVersionId: system.routine.id,
        }),
      }),
    );
  });
});
