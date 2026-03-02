import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function WorkoutFooter({ children }: Props) {
  return (
    <section className="sticky bottom-0 z-30 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-sm">
      {children}
    </section>
  );
}
