import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Alert } from "@/components/ui/Alert";

const meta = {
  title: "UI/Alert",
  component: Alert,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[min(34rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: {
    tone: "neutral",
    title: "No volume flags",
    children: "If you finish now, all tracked muscles stay inside the current week plan.",
  },
};

export const Info: Story = {
  args: {
    tone: "info",
    eyebrow: "Historical week",
    title: "Read-only volume review",
    children: "This snapshot uses the selected week and does not change today's training recommendation.",
  },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    eyebrow: "Closeout",
    title: "Finish the week boundary first",
    children: "Review or skip the optional closeout before accepting the next cycle.",
  },
};

export const Success: Story = {
  args: {
    tone: "success",
    title: "Workout plan saved",
    children: "The session is ready to log and remains tied to the current mesocycle week.",
  },
};
