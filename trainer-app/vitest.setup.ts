import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: vi.fn(),
  });
}
