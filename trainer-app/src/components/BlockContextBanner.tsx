"use client";

import type { BlockContext } from "@/lib/engine";

export type BlockContextBannerProps = {
  blockContext: BlockContext | null;
};

/**
 * Block Context Banner - Displays current training block phase.
 * Shows mesocycle focus, block type, and week progress.
 */
export function BlockContextBanner({ blockContext }: BlockContextBannerProps) {
  if (!blockContext) {
    return null;
  }

  // Format block type for display
  const blockTypeDisplay = blockContext.block.blockType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <div className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-4 text-white shadow-md">
      <div className="text-sm font-medium opacity-90">
        {blockContext.mesocycle.focus}
      </div>
      <div className="mt-1 text-lg font-bold">
        {blockTypeDisplay} Block • Week {blockContext.weekInBlock}/
        {blockContext.block.durationWeeks}
      </div>
      <div className="mt-2 flex gap-4 text-xs opacity-80">
        <div>
          <span className="font-semibold">Volume:</span>{" "}
          {blockContext.block.volumeTarget.toUpperCase()}
        </div>
        <div>
          <span className="font-semibold">Intensity:</span>{" "}
          {blockContext.block.intensityBias.toUpperCase()}
        </div>
        <div>
          <span className="font-semibold">Adaptation:</span>{" "}
          {blockContext.block.adaptationType
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (l) => l.toUpperCase())}
        </div>
      </div>
    </div>
  );
}
