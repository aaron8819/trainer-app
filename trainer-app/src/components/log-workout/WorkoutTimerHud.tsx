"use client";

import { memo, useEffect, useState } from "react";
import { RestTimer } from "@/components/RestTimer";
import type { RestTimerSnapshot } from "@/components/log-workout/useRestTimerState";

type WorkoutTimerHudProps = {
  timer: RestTimerSnapshot | null;
  keyboardOpen: boolean;
  muted: boolean;
  onDismiss: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onMuteToggle: () => void;
};

export const WorkoutTimerHud = memo(function WorkoutTimerHud({
  timer,
  keyboardOpen,
  muted,
  onDismiss,
  onAdjust,
  onMuteToggle,
}: WorkoutTimerHudProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!timer || keyboardOpen) {
      setExpanded(false);
    }
  }, [keyboardOpen, timer]);

  if (!timer) {
    return null;
  }

  return (
    <div className="sticky top-0 z-40 -mx-1 px-1 pt-1 sm:px-0">
      <div className="mx-auto w-full max-w-4xl">
        <RestTimer
          startedAtMs={timer.startedAtMs}
          endAtMs={timer.endAtMs}
          onDismiss={onDismiss}
          onAdjust={onAdjust}
          muted={muted}
          onMuteToggle={onMuteToggle}
          expanded={expanded}
          onExpand={() => setExpanded(true)}
          onCloseExpanded={() => setExpanded(false)}
        />
      </div>
    </div>
  );
});
