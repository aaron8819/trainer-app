import { describe, expect, it } from "vitest";
import {
  formatSessionIdentityDescription,
  formatSessionIdentityLabel,
  formatSessionSlotTechnicalDescription,
  formatSessionSlotTechnicalLabel,
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

  it("prefers a persisted authored label and keeps the legacy fallback", () => {
    expect(
      formatSessionIdentityLabel({
        authoredLabel: " Upper B ",
        intent: "UPPER",
        slotId: "upper-b",
      })
    ).toBe("Upper B");
    expect(
      formatSessionIdentityLabel({
        authoredLabel: "   ",
        intent: "UPPER",
        slotId: "upper_b",
      })
    ).toBe("Upper 2");
  });

  it("builds plain-English slot descriptions", () => {
    expect(
      formatSessionIdentityDescription({ intent: "LOWER", slotId: "lower_a" })
    ).toBe("First lower session in your current weekly order.");
    expect(
      formatSessionIdentityDescription({ intent: "UPPER", slotId: "upper_b" })
    ).toBe("Second upper session in your current weekly order.");
    expect(
      formatSessionIdentityDescription({
        authoredLabel: "Upper B",
        intent: "UPPER",
        slotId: "upper-b",
      })
    ).toBe("Upper B session in your current weekly order.");
  });

  it("formats technical slot labels from canonical slot ids", () => {
    expect(formatSessionSlotTechnicalLabel("upper_b")).toBeNull();
    expect(
      formatSessionSlotTechnicalDescription({
        slotId: "upper_b",
        source: "mesocycle_slot_sequence",
      })
    ).toBe("This session comes from your ordered weekly slot sequence.");
    expect(
      formatSessionSlotTechnicalDescription({
        slotId: "upper_b",
        source: "legacy_weekly_schedule",
      })
    ).toBe("This session comes from your saved weekly schedule.");
  });
});
