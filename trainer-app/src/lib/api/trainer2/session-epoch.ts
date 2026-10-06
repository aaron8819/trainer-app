export const MAX_SESSION_EPOCH = 2147483647;

/** Reserve transition, mandatory setup and a subsequent revoke-all. Never wrap. */
export function assertEpochCapacity(epoch: number, increments = 1) {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > MAX_SESSION_EPOCH - increments)
    throw new Error("SESSION_EPOCH_EXHAUSTED");
}
