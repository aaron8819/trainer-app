/**
 * Shared test utilities for engine tests.
 */

const USE_REVISED_FAT_LOSS_POLICY_ENV = "USE_REVISED_FAT_LOSS_POLICY";

/**
 * Temporarily set/unset the USE_REVISED_FAT_LOSS_POLICY env var for the
 * duration of a test, then restore the previous value.
 */
export function withRevisedFatLossPolicy(value: string | undefined, run: () => void) {
  const previous = process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
  if (value === undefined) {
    delete process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
  } else {
    process.env[USE_REVISED_FAT_LOSS_POLICY_ENV] = value;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
    } else {
      process.env[USE_REVISED_FAT_LOSS_POLICY_ENV] = previous;
    }
  }
}
