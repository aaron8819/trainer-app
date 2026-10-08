'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function LocalDateTime({ value }: { value: string }) {
  // UTC is deterministic for server rendering and the first hydration render.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return <time dateTime={value}>
    {mounted ? new Date(value).toLocaleString() : new Date(value).toUTCString()}
  </time>;
}
