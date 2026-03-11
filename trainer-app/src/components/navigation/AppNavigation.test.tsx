import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function renderMobileNav(
  pathname: string,
  options?: { innerHeight?: number; viewportHeight?: number; viewportOffsetTop?: number }
) {
  mockedUsePathname.mockReturnValue(pathname);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: options?.innerHeight ?? 800,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      height: options?.viewportHeight ?? options?.innerHeight ?? 800,
      offsetTop: options?.viewportOffsetTop ?? 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
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

  it("Program tab is active on /program", () => {
    renderDesktopNav("/program");
    const programLink = screen.getByRole("link", { name: /Program/ });
    expect(isActiveLink(programLink)).toBe(true);
  });

  it("applies visual viewport bottom compensation on mobile when browser chrome shrinks the viewport", async () => {
    renderMobileNav("/", { innerHeight: 800, viewportHeight: 740 });

    await waitFor(() => {
      const nav = screen.getByRole("navigation");
      expect(nav).toHaveStyle({ bottom: "60px" });
    });
  });

  it("does not treat keyboard-height viewport shrink as mobile nav drift", async () => {
    renderMobileNav("/", { innerHeight: 800, viewportHeight: 480 });

    await waitFor(() => {
      const nav = screen.getByRole("navigation");
      expect(nav).toHaveStyle({ bottom: "0px" });
    });
  });
});
