import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function WorkoutFooter({ children }: Props) {
  return <section className="sticky bottom-0 z-30">{children}</section>;
}
