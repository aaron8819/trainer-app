import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProgressBar } from "@/components/ui/ProgressBar";

const meta = {
  title: "UI/ProgressBar",
  component: ProgressBar,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
  args: {
    "aria-label": "Week completion",
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 45,
  },
};

export const WarningRange: Story = {
  args: {
    value: 82,
    tone: "warning",
    "aria-label": "Recoverable volume ceiling",
  },
};

export const CompleteHighState: Story = {
  args: {
    value: 100,
    tone: "success",
    "aria-label": "Planned sets resolved",
  },
};

export const CompactUsage: Story = {
  args: {
    value: 63,
    size: "compact",
    tone: "default",
    "aria-label": "Template score",
  },
};
