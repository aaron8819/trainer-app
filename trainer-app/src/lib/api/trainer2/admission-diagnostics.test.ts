import { expect, it } from 'vitest';
import { infrastructureReason } from './admission-diagnostics';
it('classifies known infrastructure failures without exposing exception text',()=>{
  expect(infrastructureReason(new Error('timeout exceeded when trying to connect'))).toBe('POOL_ACQUIRE_TIMEOUT');
  expect(infrastructureReason(new Error('Connection terminated due to connection timeout'))).toBe('CONNECTION_TIMEOUT');
  expect(infrastructureReason(new Error('postgresql://private cookie-private'))).toBe('UNCLASSIFIED');
});
