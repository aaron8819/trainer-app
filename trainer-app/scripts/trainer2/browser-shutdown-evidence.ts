type BrowserShutdownResult = { gracefulServerClose: boolean; forceFallback: boolean };

export function browserShutdownEvidence(result: BrowserShutdownResult | undefined): {
  shutdownDisposition: 'graceful' | 'fallback' | 'unknown';
  forceFallback: boolean | null;
} {
  if (!result) return { shutdownDisposition: 'unknown', forceFallback: null };
  return {
    shutdownDisposition: result.forceFallback ? 'fallback' :
      result.gracefulServerClose ? 'graceful' : 'unknown',
    forceFallback: result.forceFallback,
  };
}
