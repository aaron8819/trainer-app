'use client';

import { useId, useState, type ReactNode } from 'react';

export function ExerciseQueueDisclosure({ unresolved, children }: {
  unresolved: string;
  children: ReactNode;
}) {
  const id = useId();
  const [previousUnresolved, setPreviousUnresolved] = useState(unresolved);
  const [collapsed, setCollapsed] = useState(!unresolved);
  // Only a resolution transition changes the automatic disclosure state.
  // Manual reopening survives timer ticks and other exercises' updates.
  if (previousUnresolved !== unresolved) {
    setPreviousUnresolved(unresolved);
    setCollapsed(!unresolved);
  }
  return <>
    <button type="button" aria-expanded={!collapsed} aria-controls={id}
      className="min-h-11 px-2 text-sm underline"
      onClick={() => setCollapsed(value => !value)}>
      {collapsed ? 'Show sets' : 'Hide sets'}
    </button>
    <div id={id} hidden={collapsed}>{children}</div>
  </>;
}
