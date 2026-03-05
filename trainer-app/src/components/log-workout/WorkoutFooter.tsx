import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function WorkoutFooter({ children }: Props) {
  return (
    <section className="pb-[env(safe-area-inset-bottom,0px)]">
      {children}
    </section>
  );
}
