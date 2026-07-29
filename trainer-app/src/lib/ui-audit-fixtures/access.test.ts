import { describe, expect, it } from "vitest";
import {
  isUiAuditFixtureModeEnabled,
  authorizeUiAuditFixtureRequest,
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

  it("authorizes only an exact recognized request header in fixture mode", () => {
    expect(
      authorizeUiAuditFixtureRequest({
        mode: "1",
        nodeEnv: "development",
        requestHeader: "active",
      }),
    ).toBe("active");
    for (const requestHeader of [undefined, null, "", " ", "unknown", "ACTIVE"]) {
      expect(
        authorizeUiAuditFixtureRequest({
          mode: "1",
          nodeEnv: "development",
          requestHeader,
        }),
      ).toBeNull();
    }
  });

  it("fails closed when either the approved environment or header is absent", () => {
    expect(
      authorizeUiAuditFixtureRequest({
        mode: undefined,
        nodeEnv: "development",
        requestHeader: "active",
      }),
    ).toBeNull();
    expect(
      authorizeUiAuditFixtureRequest({
        mode: "1",
        nodeEnv: "production",
        requestHeader: "active",
      }),
    ).toBeNull();
    expect(
      authorizeUiAuditFixtureRequest({
        mode: "1",
        nodeEnv: "development",
        requestHeader: null,
      }),
    ).toBeNull();
  });
});
