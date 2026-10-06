import { describe, expect, it } from 'vitest';
import { assertEpochCapacity, MAX_SESSION_EPOCH } from './session-epoch';
describe('session epoch capacity', () => {
  it.each([0, 1, MAX_SESSION_EPOCH - 1])('allows an ordinary increment from %s', epoch => {
    expect(() => assertEpochCapacity(epoch)).not.toThrow();
  });
  it.each([-1, 0.5, NaN, MAX_SESSION_EPOCH, MAX_SESSION_EPOCH + 1])('rejects unsafe increment from %s', epoch => {
    expect(() => assertEpochCapacity(epoch)).toThrow('SESSION_EPOCH_EXHAUSTED');
  });
});
