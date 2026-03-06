import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  sticky?: boolean;
  bottomOffset?: number;
};

export function WorkoutFooter({ children, sticky = false, bottomOffset = 0 }: Props) {
  return (
    <section
      className={
        sticky
          ? "fixed inset-x-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"
          : "mt-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
      }
      data-testid={sticky ? "workout-finish-bar" : undefined}
      style={
        sticky
          ? {
              bottom: `${bottomOffset}px`,
              paddingBottom:
                bottomOffset > 0 ? "0.75rem" : "max(0.75rem, env(safe-area-inset-bottom, 0px))",
            }
          : undefined
      }
    >
      {children}
    </section>
  );
}
