import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusBadge } from "@/components/ui/StatusBadge";

const meta = {
  title: "UI/StatusBadge",
  component: StatusBadge,
  parameters: {
    layout: "centered",
  },
  args: {
    children: "On plan",
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: {
    tone: "neutral",
    children: "Pending review",
  },
};

export const Positive: Story = {
  args: {
    tone: "positive",
    children: "On target",
  },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    children: "Watch fatigue",
  },
};

export const Critical: Story = {
  args: {
    tone: "critical",
    children: "Above ceiling",
  },
};
