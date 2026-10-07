'use client';

import Link from 'next/link';
import { createContext, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useVisualViewportMetrics } from '@/lib/ui/use-visual-viewport-metrics';
import styles from './Trainer2Shell.module.css';

type Destination = { planId?: string; builder: boolean };
type NavigationState = Destination & { builderId?: string };
const DestinationContext = createContext<((value: Destination) => void) | null>(null);
// Presentation context only. The existing controllers still own drafts and commands.
export function useTrainer2Destination(planId: string | undefined, builder = false) {
  const report = useContext(DestinationContext);
  useEffect(() => { report?.({ planId, builder }); }, [report, planId, builder]);
}

export function Trainer2Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { keyboardOpen, bottomOffset } = useVisualViewportMetrics();
  const [destination, setDestination] = useState<NavigationState>({ builder: false });
  const report = useCallback((value: Destination) => setDestination(previous => ({ ...value,
    builderId: value.builder ? value.planId : previous.builderId === value.planId ? undefined : previous.builderId })), []);
  const auth = pathname === '/trainer2/auth' || pathname?.startsWith('/trainer2/auth/');
  return <div className={styles.shell} data-trainer2-shell data-auth={auth || undefined} data-keyboard={keyboardOpen || undefined}>
    <DestinationContext.Provider value={report}>
      {!auth && <Suspense><Trainer2Navigation pathname={pathname} destination={destination} bottomOffset={bottomOffset} /></Suspense>}
      {children}
    </DestinationContext.Provider>
  </div>;
}

function Trainer2Navigation({ pathname, destination, bottomOffset }: { pathname: string | null; destination: NavigationState; bottomOffset: number }) {
  const params = useSearchParams();
  const builderId = destination.builderId;
  const planId = pathname?.startsWith('/trainer2/dev/') && !destination.builder ? destination.planId ?? params.get('planId') : null;
  const training = planId ? `/trainer2/dev/drafts?planId=${encodeURIComponent(planId)}` : '/trainer2';
  const program = `${training}${planId ? '&' : '?'}view=program`;
  const active = pathname === '/trainer2/dev/drafts' && destination.builder ? 'Builder' : params.get('view') === 'program' ? 'Program' : 'Training';
  const items = [{ label: 'Training', href: training }, { label: 'Program', href: program },
    { label: 'Builder', href: `/trainer2/dev/drafts?view=builder${builderId ? `&planId=${encodeURIComponent(builderId)}` : ''}` }, { label: 'Settings', href: '/trainer2/auth' }];
  return <nav aria-label="Trainer2 navigation" className={styles.navigation} style={{ bottom: bottomOffset }}>
      <span className={styles.brand}>Trainer</span>
      {items.map(item => <Link key={item.label} href={item.href} prefetch={false} aria-current={active === item.label ? 'page' : undefined}
        onClick={event => { if (new URL(item.href, location.origin).href === location.href) event.preventDefault(); }}>{item.label}</Link>)}
    </nav>;
}
