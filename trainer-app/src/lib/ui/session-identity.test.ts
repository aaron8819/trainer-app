import { describe, expect, it } from "vitest";
import {
  formatSessionIdentityDescription,
  formatSessionIdentityLabel,
  formatSessionIntentLabel,
} from "./session-identity";

describe("session identity helpers", () => {
  it("formats plain intent labels", () => {
    expect(formatSessionIntentLabel("FULL_BODY")).toBe("Full Body");
    expect(formatSessionIntentLabel("push")).toBe("Push");
    expect(formatSessionIntentLabel(null)).toBe("Workout");
  });

  it("formats slot-aware labels from canonical slot ids", () => {
    expect(formatSessionIdentityLabel({ intent: "UPPER", slotId: "upper_b" })).toBe("Upper 2");
    expect(formatSessionIdentityLabel({ intent: "FULL_BODY", slotId: "full_body_c" })).toBe("Full Body 3");
  });

  it("builds plain-English slot descriptions", () => {
    expect(
      formatSessionIdentityDescription({ intent: "LOWER", slotId: "lower_a" })
    ).toBe("First lower session in your current weekly order.");
    expect(
      formatSessionIdentityDescription({ intent: "UPPER", slotId: "upper_b" })
    ).toBe("Second upper session in your current weekly order.");
  });
});
