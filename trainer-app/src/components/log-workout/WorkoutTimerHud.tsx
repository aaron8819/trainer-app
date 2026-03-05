"use client";

import { memo } from "react";
import { RestTimer } from "@/components/RestTimer";
import type { RestTimerSnapshot } from "@/components/log-workout/useRestTimerState";

type WorkoutTimerHudProps = {
  timer: RestTimerSnapshot | null;
  compact: boolean;
  muted: boolean;
  onDismiss: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onMuteToggle: () => void;
};

export const WorkoutTimerHud = memo(function WorkoutTimerHud({
  timer,
  compact,
  muted,
  onDismiss,
  onAdjust,
  onMuteToggle,
}: WorkoutTimerHudProps) {
  if (!timer) {
    return null;
  }

  if (compact) {
    return (
      <RestTimer
        startedAtMs={timer.startedAtMs}
        endAtMs={timer.endAtMs}
        onDismiss={onDismiss}
        onAdjust={onAdjust}
        compact={true}
        muted={muted}
        onMuteToggle={onMuteToggle}
      />
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-2 sm:px-4">
      <div className="mx-auto w-full max-w-4xl">
        <RestTimer
          startedAtMs={timer.startedAtMs}
          endAtMs={timer.endAtMs}
          onDismiss={onDismiss}
          onAdjust={onAdjust}
          compact={false}
          muted={muted}
          onMuteToggle={onMuteToggle}
        />
      </div>
    </div>
  );
});
