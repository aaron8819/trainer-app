import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UserPreferencesForm from "./UserPreferencesForm";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./library/ExercisePicker", () => ({
  ExercisePicker: () => null,
}));

vi.mock("./library/ExercisePickerTrigger", () => ({
  ExercisePickerTrigger: () => <button type="button">Add exercises</button>,
}));

describe("UserPreferencesForm", () => {
  it("links from training preferences to the exercise library", () => {
    render(<UserPreferencesForm exercises={[]} />);

    expect(screen.getByRole("link", { name: "Exercise Library" })).toHaveAttribute(
      "href",
      "/library"
    );
  });
});
