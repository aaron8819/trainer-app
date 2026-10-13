'use client';

import Link from 'next/link';
import { createContext, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useVisualViewportMetrics } from '@/lib/ui/use-visual-viewport-metrics';
import styles from './Trainer2Shell.module.css';

type Destination = { planId?: string; builder: boolean; logging?: boolean };
type NavigationState = Destination & { builderId?: string };
const DestinationContext = createContext<((value: Destination) => void) | null>(null);
// Presentation context only. The existing controllers still own drafts and commands.
export function useTrainer2Destination(planId: string | undefined, builder = false, logging = false) {
  const report = useContext(DestinationContext);
  useEffect(() => { report?.({ planId, builder, logging }); }, [report, planId, builder, logging]);
}

export function Trainer2Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { keyboardOpen, bottomOffset } = useVisualViewportMetrics();
  const [destination, setDestination] = useState<NavigationState>({ builder: false });
  const report = useCallback((value: Destination) => setDestination(previous => ({ ...value,
    builderId: value.builder ? value.planId : previous.builderId === value.planId ? undefined : previous.builderId })), []);
  const auth = pathname === '/trainer2/auth' || pathname?.startsWith('/trainer2/auth/');
  const logging = destination.logging && /^\/trainer2\/dev\/executions\/[^/]+$/.test(pathname ?? '');
  return <div className={styles.shell} data-trainer2-shell data-auth={auth || undefined}
    data-logging={logging || undefined} data-keyboard={keyboardOpen || undefined}>
    <DestinationContext.Provider value={report}>
      {!auth && !logging && <Suspense><Trainer2Navigation pathname={pathname} destination={destination} bottomOffset={bottomOffset} /></Suspense>}
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
        onClick={event => { if (new URL(item.href, location.origin).href === location.href) event.preventDefault(); }}>
        <NavigationIcon label={item.label} /><span>{item.label}</span>
      </Link>)}
    </nav>;
}

function NavigationIcon({ label }: { label: string }) {
  return <svg className={styles.navIcon} aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {label === 'Training' && <g fill="currentColor" stroke="none">
      <rect x="2" y="7" width="3" height="10" rx="1.5" /><rect x="5" y="4" width="3" height="16" rx="1.5" />
      <rect x="8" y="10.5" width="8" height="3" /><rect x="16" y="4" width="3" height="16" rx="1.5" />
      <rect x="19" y="7" width="3" height="10" rx="1.5" />
    </g>}
    {label === 'Program' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 12h8M8 16h8M8 8h2" /></>}
    {label === 'Builder' && <><path d="M4 21h16M5 21v-6M10 21V9M15 21v-9M20 21V3" /></>}
    {label === 'Settings' && <><path d="m9.5 3 .5-1h4l.5 3 2 1.2 2.8-.9 2 3.4-2.3 2v2.6l2.3 2-2 3.4-2.8-.9-2 1.2-.5 3h-4l-.5-3-2-1.2-2.8.9-2-3.4 2.3-2v-2.6l-2.3-2 2-3.4 2.8.9 2-1.2z" />
      <circle cx="12" cy="12" r="3" /></>}
  </svg>;
}
