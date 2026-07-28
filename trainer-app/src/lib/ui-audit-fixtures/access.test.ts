import { describe, expect, it } from "vitest";
import {
  isUiAuditFixtureModeEnabled,
  resolveUiAuditFixtureScenario,
} from "./access";

describe("UI audit fixture access", () => {
  it("requires both the explicit mode and a non-production environment", () => {
    expect(
      isUiAuditFixtureModeEnabled({
        mode: "1",
        nodeEnv: "development",
      }),
    ).toBe(true);
    expect(
      isUiAuditFixtureModeEnabled({
        mode: undefined,
        nodeEnv: "development",
      }),
    ).toBe(false);
    expect(
      isUiAuditFixtureModeEnabled({
        mode: "1",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("does not allow a scenario value alone to expose fixtures", () => {
    expect(
      resolveUiAuditFixtureScenario({
        mode: undefined,
        nodeEnv: "development",
        requestedScenario: "active",
      }),
    ).toBeNull();
    expect(
      resolveUiAuditFixtureScenario({
        mode: "1",
        nodeEnv: "production",
        requestedScenario: "active",
      }),
    ).toBeNull();
    expect(
      resolveUiAuditFixtureScenario({
        mode: "1",
        nodeEnv: "development",
        requestedScenario: "unknown",
      }),
    ).toBeNull();
  });
});
