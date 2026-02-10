# Engine Audit Remediation (2026-02-10)

## Scope

This document records remediation for the engine audit findings in `src/lib/engine`.

## Findings Addressed

1. Non-completed workouts were influencing progression and volume logic.
2. Fatigue derivation depended on array order instead of workout date recency.
3. Split advancement required `status === "COMPLETED"` and ignored legacy entries with `completed: true`.

## Changes Implemented

### 1) Shared history semantics

Added `src/lib/engine/history.ts` with shared helpers:

- `isCompletedHistoryEntry`
- `sortHistoryByDateDesc`
- `filterCompletedHistory`
- `getMostRecentHistoryEntry`

These helpers are now used in:

- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/volume.ts`
- `src/lib/engine/filtering.ts`
- `src/lib/engine/split-queue.ts`
- `src/lib/engine/utils.ts`

### 2) Completion-aware progression and volume

- `buildHistoryIndex` in `apply-loads.ts` now only uses completed history entries.
- `buildVolumeContext` in `volume.ts` now excludes non-completed entries.
- `findStalledExercises` in `filtering.ts` now excludes non-completed entries.
- `buildRecencyIndex` in `utils.ts` now excludes non-completed entries.

### 3) Date-stable fatigue derivation

- `deriveFatigueState` in `volume.ts` now selects the most recent workout by date, independent of input array order.

### 4) Legacy-compatible split advancement

- `getSplitDayIndex` in `split-queue.ts` now counts entries where:
  - `status === "COMPLETED"` OR `completed === true`
  - and `advancesSplit !== false`
- `getHistoryBasedSplitDay` uses the same completed-entry helper.

## Regression Tests Added

- `src/lib/engine/apply-loads.test.ts`
  - `ignores non-completed history entries when deriving next load`
- `src/lib/engine/volume.test.ts`
  - `excludes non-completed workouts from recent and previous volume`
  - `uses the most recent workout by date regardless of input array order`
- `src/lib/engine/split-queue.test.ts`
  - `counts legacy completed entries without a status value`
- `src/lib/engine/utils.test.ts`
  - `ignores non-completed entries for recency`

## Validation

Executed after changes:

- `npm run test -- src/lib/engine --run` -> 16 files, 212 tests passed
- `npm run lint -- src/lib/engine` -> passed
- `npx tsc --noEmit` -> passed
