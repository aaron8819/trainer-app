import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  sticky?: boolean;
  bottomOffset?: number;
  viewportBottomOffset?: number;
};

export function WorkoutFooter({
  children,
  sticky = false,
  bottomOffset = 0,
  viewportBottomOffset = 0,
}: Props) {
  const viewportOffsetVar = "--workout-footer-viewport-offset" as const;
  const stickyStyle: CSSProperties | undefined = sticky
    ? ({
        [viewportOffsetVar]: `${viewportBottomOffset}px`,
        ...(bottomOffset > 0 ? { bottom: `${bottomOffset}px` } : {}),
        paddingBottom:
          bottomOffset > 0 ? "0.75rem" : "max(0.75rem, env(safe-area-inset-bottom, 0px))",
      } as CSSProperties)
    : undefined;

  return (
    <section
      className={
        sticky
          ? `fixed inset-x-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur ${
              bottomOffset > 0
                ? ""
                : "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+var(--workout-footer-viewport-offset,0px))] md:bottom-0"
            }`
          : "mt-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
      }
      data-testid={sticky ? "workout-finish-bar" : undefined}
      style={stickyStyle}
    >
      {children}
    </section>
  );
}
