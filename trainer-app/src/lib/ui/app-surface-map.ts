export type AppSurfaceKey = "home" | "program" | "history" | "analytics";

export type AppSurfaceDefinition = {
  key: AppSurfaceKey;
  href: string;
  label: string;
  title: string;
  purpose: string;
};

export const APP_SURFACE_MAP: Record<AppSurfaceKey, AppSurfaceDefinition> = {
  home: {
    key: "home",
    href: "/",
    label: "Home",
    title: "Today",
    purpose: "Run today’s training, resume logging, and check live program state.",
  },
  program: {
    key: "program",
    href: "/program",
    label: "Program",
    title: "Program",
    purpose: "Inspect the active mesocycle and current-week decision support.",
  },
  history: {
    key: "history",
    href: "/history",
    label: "History",
    title: "History",
    purpose: "Review past sessions with filters, pagination, and delete actions.",
  },
  analytics: {
    key: "analytics",
    href: "/analytics",
    label: "Analytics",
    title: "Analytics",
    purpose: "Review longer-term trends, volume, stimulus recency, and template follow-through.",
  },
};

const APP_SURFACE_RELATED: Record<AppSurfaceKey, AppSurfaceKey[]> = {
  home: ["program", "history", "analytics"],
  program: ["history", "analytics"],
  history: ["program", "analytics"],
  analytics: ["program", "history"],
};

export function getRelatedAppSurfaces(surface: AppSurfaceKey): AppSurfaceDefinition[] {
  return APP_SURFACE_RELATED[surface].map((key) => APP_SURFACE_MAP[key]);
}
