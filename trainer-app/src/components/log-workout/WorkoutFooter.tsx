import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function WorkoutFooter({ children }: Props) {
  return (
    <section className="mt-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
      {children}
    </section>
  );
}
