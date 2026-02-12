import { describe, expect, it } from "vitest";
import { EquipmentType } from "@prisma/client";
import { ALL_EQUIPMENT_TYPES } from "./default-equipment";

describe("ALL_EQUIPMENT_TYPES", () => {
  it("includes every EquipmentType enum value", () => {
    const expected = Object.values(EquipmentType).sort();
    const actual = [...ALL_EQUIPMENT_TYPES].sort();
    expect(actual).toEqual(expected);
  });
});
