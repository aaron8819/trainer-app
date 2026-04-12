import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MetricCard } from "@/components/ui/MetricCard";
import { SectionShell } from "@/components/ui/SectionShell";
import { StatusBadge } from "@/components/ui/StatusBadge";

const meta = {
  title: "UI/SectionShell",
  component: SectionShell,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[min(44rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SectionShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BasicSection: Story = {
  args: {
    eyebrow: "Active week",
    title: "Volume Snapshot",
    description: "Compact readout for the training week without pulling in live program data.",
  },
};

export const WithRightAlignedAction: Story = {
  args: {
    eyebrow: "Session plan",
    title: "Next Training Decision",
    description: "Keep the headline compact and let the action sit in the header rail.",
    action: (
      <button
        type="button"
        className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900"
      >
        Refine
      </button>
    ),
  },
};

export const WithNestedContent: Story = {
  args: {
    eyebrow: "Readiness",
    title: "Today At A Glance",
    description: "Dense dashboard blocks can sit inside the shell without needing backend data.",
    children: (
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Target RIR"
          value="2-3"
          supportingText="Moderate effort for accumulation work."
          badge="Steady"
          badgeTone="neutral"
        />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Fatigue</p>
            <StatusBadge tone="warning">Monitor</StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">
            Keep accessory work tight if soreness climbs before the next pull session.
          </p>
        </div>
      </div>
    ),
  },
};
