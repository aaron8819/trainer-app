import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(window, "scrollBy", {
  configurable: true,
  value: vi.fn(),
});
