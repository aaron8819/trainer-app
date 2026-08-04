import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwner: vi.fn(),
  loadData: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: mocks.findOwner,
}));
vi.mock("@/lib/api/settings-page", () => ({
  loadSettingsPageData: mocks.loadData,
}));
vi.mock("../onboarding/ProfileForm", () => ({
  default: () => <div>Profile form</div>,
}));
vi.mock("@/components/UserPreferencesForm", () => ({
  default: () => <div>Preference form</div>,
}));

import SettingsPage from "./page";

describe("SettingsPage", () => {
  beforeEach(() => {
    mocks.findOwner.mockResolvedValue({ id: "owner", email: "owner@test.local" });
    mocks.loadData.mockResolvedValue({
      profileInitialValues: {},
      preferenceInitialValues: {},
      exercises: [],
    });
  });

  it("includes the dedicated Finisher management entry", async () => {
    render(await SettingsPage());
    expect(screen.getByRole("link", { name: /Finishers/ })).toHaveAttribute(
      "href",
      "/settings/finishers",
    );
    expect(screen.getByText(/Create, order, archive, and customize/)).toBeInTheDocument();
  });
});
