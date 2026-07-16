import { describe, expect, it } from "vitest";
import {
  assertProductionWriteAllowed,
  ProductionWritePausedError,
  productionWriteStatus,
} from "./production-write-gate";

describe("production write gate", () => {
  it.each([undefined, "", "disabled", "false", "1"])(
    "allows writes when TRAINER_WRITE_PAUSE is %s",
    (value) => {
      const environment = { TRAINER_WRITE_PAUSE: value };
      expect(productionWriteStatus(environment)).toBe("ENABLED");
      expect(() => assertProductionWriteAllowed("set_logging", environment)).not.toThrow();
    },
  );

  it("blocks only the exact enabled value and carries the operation", () => {
    const environment = { TRAINER_WRITE_PAUSE: "enabled" };
    expect(productionWriteStatus(environment)).toBe("PAUSED");

    try {
      assertProductionWriteAllowed("workout_save", environment);
      throw new Error("expected write pause");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionWritePausedError);
      expect(error).toMatchObject({
        code: "PRODUCTION_WRITE_PAUSED",
        operation: "workout_save",
        message: "PRODUCTION_WRITE_PAUSED",
      });
      expect(JSON.stringify(error)).not.toContain("enabled");
    }
  });
});
