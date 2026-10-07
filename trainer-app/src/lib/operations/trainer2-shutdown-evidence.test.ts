// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { browserShutdownEvidence } from '../../../scripts/trainer2/browser-shutdown-evidence';

describe('browser shutdown evidence (pure, no process or browser APIs)', () => {
  it.each(['capture rejection', 'observation rejection', 'close did not settle'])(
    'keeps disposition unknown after mocked %s even with browser exit 0', async message => {
      const shutdown = vi.fn().mockRejectedValue(new Error(message));
      let result: Parameters<typeof browserShutdownEvidence>[0];
      await expect(shutdown()).rejects.toThrow(message);
      const receipt = { exitCode: 0, ...browserShutdownEvidence(result) };
      expect(receipt).toEqual({
        exitCode: 0, shutdownDisposition: 'unknown', forceFallback: null,
      });
    },
  );
  it('records graceful disposition only from established shutdown evidence', () => {
    expect(browserShutdownEvidence({ gracefulServerClose: true, forceFallback: false }))
      .toEqual({ shutdownDisposition: 'graceful', forceFallback: false });
  });
  it('retains an established fallback disposition without claiming forced termination', () => {
    expect(browserShutdownEvidence({ gracefulServerClose: false, forceFallback: true }))
      .toEqual({ shutdownDisposition: 'fallback', forceFallback: true });
  });
  it('does not call an inconclusive result graceful', () => {
    expect(browserShutdownEvidence({ gracefulServerClose: false, forceFallback: false }))
      .toEqual({ shutdownDisposition: 'unknown', forceFallback: false });
  });
});
