import { afterEach, describe, expect, it, vi } from "vitest";
import { productionWritePauseResponse } from "./production-write-gate-http";

const originalValue = process.env.TRAINER_WRITE_PAUSE;

afterEach(() => {
  if (originalValue === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = originalValue;
  vi.restoreAllMocks();
});

describe("production write pause HTTP mapping", () => {
  it("returns the stable 503 response and safe log event", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = productionWritePauseResponse("set_logging", "/api/logs/set");

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("60");
    await expect(response?.json()).resolves.toEqual({
      error: "Trainer writes are temporarily paused for maintenance.",
      code: "PRODUCTION_WRITE_PAUSED",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("trainer_production_write_blocked");
    expect(warn.mock.calls[0]?.[0]).not.toContain("enabled");
  });

  it("returns null when writes are enabled", () => {
    delete process.env.TRAINER_WRITE_PAUSE;
    expect(productionWritePauseResponse("set_logging", "/api/logs/set")).toBeNull();
  });
});
