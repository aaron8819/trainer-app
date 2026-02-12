import { describe, expect, it } from "vitest";
import {
  pickTemplateForSessionIntent,
  selectTemplatesForWeeklyProgram,
} from "./weekly-program-selection";

type TemplateFixture = {
  id: string;
  intent: string;
};

describe("selectTemplatesForWeeklyProgram", () => {
  const templates: TemplateFixture[] = [
    { id: "tpl-ppl", intent: "PUSH_PULL_LEGS" },
    { id: "tpl-ul", intent: "UPPER_LOWER" },
    { id: "tpl-full", intent: "FULL_BODY" },
    { id: "tpl-body", intent: "BODY_PART" },
  ];

  it("selects templates in weekly schedule order by intent priority", () => {
    const selected = selectTemplatesForWeeklyProgram(
      templates,
      4,
      undefined,
      ["UPPER", "LOWER", "PUSH", "FULL_BODY"]
    );

    expect(selected.map((template) => template.id)).toEqual([
      "tpl-ul",
      "tpl-full",
      "tpl-ppl",
      "tpl-body",
    ]);
  });

  it("uses explicit template IDs over weekly schedule selection", () => {
    const selected = selectTemplatesForWeeklyProgram(
      templates,
      4,
      ["tpl-full", "tpl-ppl"],
      ["UPPER", "LOWER", "PUSH", "FULL_BODY"]
    );

    expect(selected.map((template) => template.id)).toEqual(["tpl-full", "tpl-ppl"]);
  });

  it("returns undefined for strict intent pick with no matching template", () => {
    const picked = pickTemplateForSessionIntent(
      [{ id: "tpl-legacy", intent: "LEGACY" }],
      "PUSH",
      new Set<string>()
    );

    expect(picked).toBeUndefined();
  });

  it("allows intent-priority reuse when enabled", () => {
    const used = new Set<string>(["tpl-ppl"]);
    const picked = pickTemplateForSessionIntent(templates, "PUSH", used, {
      allowReuse: true,
    });

    expect(picked?.id).toBe("tpl-ppl");
  });
});
