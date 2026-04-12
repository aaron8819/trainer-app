import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MetricCard } from "@/components/ui/MetricCard";

const meta = {
  title: "UI/MetricCard",
  component: MetricCard,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[min(22rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetricCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "This week",
    value: "3 / 4",
    badge: "Active",
    badgeTone: "neutral",
  },
};

export const WithSupportingText: Story = {
  args: {
    label: "Pull volume",
    value: "14.5",
    supportingText: "Weighted sets logged against a 16-set target.",
    badge: "Near target",
    badgeTone: "positive",
  },
};

export const WarningState: Story = {
  args: {
    label: "Quad exposure",
    value: "21",
    supportingText: "Volume is near the recoverable ceiling for the current week.",
    badge: "Near MRV",
    badgeTone: "warning",
    tone: "warning",
  },
};
