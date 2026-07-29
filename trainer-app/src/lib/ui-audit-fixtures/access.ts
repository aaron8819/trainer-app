import {
  UI_AUDIT_FIXTURE_SCENARIOS,
  type UiAuditFixtureScenario,
} from "./fixtures";

export const UI_AUDIT_FIXTURE_HEADER = "x-ui-audit-fixture";

export function isUiAuditFixtureScenario(
  value: string | null | undefined,
): value is UiAuditFixtureScenario {
  return UI_AUDIT_FIXTURE_SCENARIOS.includes(
    value as UiAuditFixtureScenario,
  );
}

export function isUiAuditFixtureModeEnabled(input: {
  mode: string | undefined;
  nodeEnv: string | undefined;
}): boolean {
  return input.mode === "1" && input.nodeEnv !== "production";
}

export function authorizeUiAuditFixtureRequest(input: {
  mode: string | undefined;
  nodeEnv: string | undefined;
  requestHeader: string | null | undefined;
}): UiAuditFixtureScenario | null {
  if (!isUiAuditFixtureModeEnabled(input)) {
    return null;
  }
  return isUiAuditFixtureScenario(input.requestHeader)
    ? input.requestHeader
    : null;
}
