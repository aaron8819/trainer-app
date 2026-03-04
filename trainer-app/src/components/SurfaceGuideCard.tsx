import Link from "next/link";
import {
  APP_SURFACE_MAP,
  getRelatedAppSurfaces,
  type AppSurfaceKey,
} from "@/lib/ui/app-surface-map";

type Props = {
  current: AppSurfaceKey;
  heading?: string;
};

export function SurfaceGuideCard({ current, heading = "Next Views" }: Props) {
  const currentSurface = APP_SURFACE_MAP[current];
  const relatedSurfaces = getRelatedAppSurfaces(current);

  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</p>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{currentSurface.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{currentSurface.purpose}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {relatedSurfaces.map((surface) => (
          <Link
            key={surface.key}
            href={surface.href}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition-colors hover:border-slate-300 hover:bg-white"
          >
            <p className="text-sm font-semibold text-slate-900">{surface.label}</p>
            <p className="mt-1 text-xs text-slate-500">{surface.purpose}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default SurfaceGuideCard;
