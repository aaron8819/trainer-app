import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/Button";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: {
    layout: "centered",
  },
  args: {
    children: "Start next session",
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Start next session",
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Review plan",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "View audit trail",
  },
};

export const Danger: Story = {
  args: {
    variant: "danger",
    children: "Skip workout",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Saving plan...",
  },
};

export const TouchFriendlySize: Story = {
  args: {
    size: "touch",
    children: "Generate pull session",
  },
};
