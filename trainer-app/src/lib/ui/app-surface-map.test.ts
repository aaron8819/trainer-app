import { describe, expect, it } from "vitest";
import { APP_SURFACE_MAP, getRelatedAppSurfaces } from "./app-surface-map";

describe("app-surface-map", () => {
  it("defines primary surfaces for the post-contract dashboard flow", () => {
    expect(APP_SURFACE_MAP.home.href).toBe("/");
    expect(APP_SURFACE_MAP.program.href).toBe("/program");
    expect(APP_SURFACE_MAP.history.href).toBe("/history");
    expect(APP_SURFACE_MAP.analytics.href).toBe("/analytics");
  });

  it("returns contextual adjacent surfaces without linking a page to itself", () => {
    expect(getRelatedAppSurfaces("program").map((surface) => surface.key)).toEqual([
      "history",
      "analytics",
    ]);
    expect(getRelatedAppSurfaces("analytics").map((surface) => surface.key)).toEqual([
      "program",
      "history",
    ]);
  });
});
