import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppNavigation } from "./AppNavigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { usePathname } from "next/navigation";
const mockedUsePathname = vi.mocked(usePathname);

function renderDesktopNav(pathname: string) {
  mockedUsePathname.mockReturnValue(pathname);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, // desktop — renders immediately without isMobile guard
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  return render(<AppNavigation />);
}

// Active desktop link has bg-slate-100 in its className
function isActiveLink(el: HTMLElement) {
  return el.className.includes("bg-slate-100");
}

describe("L-5 — AppNavigation active tab on /log paths", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("Home tab is active on /", () => {
    renderDesktopNav("/");
    const homeLink = screen.getByRole("link", { name: /Home/ });
    expect(isActiveLink(homeLink)).toBe(true);
  });

  it("Home tab is active on /log/workout-abc123", () => {
    renderDesktopNav("/log/workout-abc123");
    const homeLink = screen.getByRole("link", { name: /Home/ });
    expect(isActiveLink(homeLink)).toBe(true);
  });

  it("Home tab is active on /log", () => {
    renderDesktopNav("/log");
    const homeLink = screen.getByRole("link", { name: /Home/ });
    expect(isActiveLink(homeLink)).toBe(true);
  });

  it("Home tab is not active on /history", () => {
    renderDesktopNav("/history");
    const homeLink = screen.getByRole("link", { name: /Home/ });
    expect(isActiveLink(homeLink)).toBe(false);
  });

  it("History tab is active on /history", () => {
    renderDesktopNav("/history");
    const historyLink = screen.getByRole("link", { name: /History/ });
    expect(isActiveLink(historyLink)).toBe(true);
  });
});
