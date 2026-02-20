import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function ExerciseListPanel({ children }: Props) {
  return <section className="space-y-3">{children}</section>;
}
