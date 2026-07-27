import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IntentWorkoutCard } from "./IntentWorkoutCard";

const meta = {
  title: "Home/IntentWorkoutCard",
  component: IntentWorkoutCard,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-white p-4 text-slate-950 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    initialIntent: "upper",
    initialSlotId: "upper_a",
    primaryAction: {
      label: "Start workout",
      state: "planned",
      mode: "generate",
    },
    nextSessionLabel: "Upper 1",
    nextSessionDescription: "Week 2 · Session 1 of 4",
    eligibleAlternativeSessions: [
      {
        slotId: "lower_a",
        intent: "lower",
        label: "Lower 1",
        sequenceIndex: 1,
      },
      {
        slotId: "upper_b",
        intent: "upper",
        label: "Upper 2",
        sequenceIndex: 2,
      },
      {
        slotId: "lower_b",
        intent: "lower",
        label: "Lower 2",
        sequenceIndex: 3,
      },
    ],
  },
} satisfies Meta<typeof IntentWorkoutCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ChooseDifferentSession: Story = {};
