# User Settings Simplification Implementation Plan

**Date:** 2026-02-10
**Source:** `docs/analysis/user-settings-simplification.md`

## Goal
Simplify user settings to capture only hard constraints and identity while moving programming decisions into the engine.

## Scope
- Remove unused or conflicting settings from UI, validation, and APIs.
- Update engine logic to own RPE assignment and progression model selection.
- Add split mismatch warning when split choice conflicts with days per week.
- Document migration plan and backward compatibility behavior.

## Non-Goals
- Rebuild the settings UI visual design.
- Add new nutrition features.
- Change exercise library data or template scoring logic beyond settings impacts.

## Dependencies
- Prisma schema changes for optional removal of deprecated columns.
- UI updates in onboarding and settings screens.
- Engine behavior updates in prescription and progression.

## Implementation Phases

### Phase 1: Audit and Baseline
1. Confirm current settings capture and persistence in `src/app/settings/page.tsx`, `src/app/onboarding/ProfileForm.tsx`, and `src/components/UserPreferencesForm.tsx`.
2. Confirm API payloads for profile and preferences in `src/app/api/profile/setup/route.ts` and `src/app/api/preferences/route.ts`.
3. List downstream readers in `src/lib/api/workout-context.ts`, `src/lib/engine/prescription.ts`, `src/lib/engine/progression.ts`, and `src/lib/engine/filtering.ts`.

### Phase 2: Engine Ownership of Programming Logic
1. RPE assignment:
   - Remove the `preferences.rpeTargets` override in `src/lib/engine/prescription.ts`.
   - Ensure target RPE is computed from training age, goal, readiness, isolation, and periodization only.
2. Progression model selection:
   - Implement per-training-age rules in `src/lib/engine/progression.ts` as defined in the simplification doc:
     - Beginner linear: increment load every session (+2.5–5 lbs upper, +5–10 lbs lower). After 2 consecutive sessions at the same load with no rep increase, auto-switch to double progression.
     - Intermediate double: hold load until all working sets hit `targetRepMax` at target RPE, then increment. If reps regress for 2+ consecutive sessions, flag deload.
     - Advanced periodized: load follows `backOffMultiplier` and `weekInBlock`. Deload week resets.
3. Secondary goal influence:
   - Wire `secondaryGoal` into exercise selection bias in `src/lib/engine/filtering.ts`.
   - Conditioning bias definition:
     - Boost selection priority for exercises with `splitTag: conditioning` (e.g., 2x weight).
     - Ensure at least one carry variant (farmer's walk, suitcase carry) is included in the candidate pool when equipment allows.
   - Strength bias definition:
     - Bias main lift selection toward `isMainLiftEligible` compounds.

### Phase 3: Settings Surface Simplification
1. Remove UI inputs for `rpeTargets`, `progressionStyle`, `benchFrequency`, `squatFrequency`, `deadliftFrequency` in `src/components/UserPreferencesForm.tsx`.
2. Remove UI inputs for `equipmentNotes` and `proteinTarget` in `src/app/onboarding/ProfileForm.tsx`.
3. Update settings defaults in `src/app/settings/page.tsx` to stop passing the removed fields.
4. Update Zod schemas:
   - Remove `equipmentNotes` and `proteinTarget` from `profileSetupSchema` in `src/lib/validation.ts`.
   - Remove `rpeTargets`, `progressionStyle`, and big-three frequency fields from `preferencesSchema` in `src/lib/validation.ts`.
5. Update API handlers:
   - Stop writing removed profile fields in `src/app/api/profile/setup/route.ts`.
   - Stop writing removed preference fields in `src/app/api/preferences/route.ts`.
6. Add split mismatch warning in settings or onboarding:
   - Implement a derived warning when `splitType` and `daysPerWeek` imply sub-2x frequency.
   - Use the recommendation table below for messaging.
   - Surface a non-blocking notice on the settings page near the split selector.

Split recommendation table (for warning copy):
- 2 days/week → Full Body
- 3 days/week → Full Body or Upper/Lower
- 4 days/week → Upper/Lower
- 5–6 days/week → PPL or Upper/Lower

Example warning copy:
`PPL with 3 days/week trains each muscle once per week. Consider Full Body or Upper/Lower for better weekly frequency.`

### Phase 4: Persistence and Migration
1. Soft-deprecate columns in Prisma:
   - Leave columns in place but stop writing to them.
   - Document that legacy data is ignored.
2. Optional cleanup migration:
   - Remove deprecated columns after one release cycle.
   - Update `prisma/schema.prisma` accordingly.

### Phase 5: Tests and Validation
1. Update tests that depend on removed fields in `src/lib/engine/*.test.ts` and any settings UI tests if present.
2. Add unit tests for new split warning logic and secondary goal bias behavior.
3. Add regression test: existing user with stored `rpeTargets` must receive engine-computed RPE values (no override).
4. Run `npm run test` and `npm run lint`.

### Phase 6: Documentation Updates
1. Update all relevant documentation after implementation is complete, with priority on:
   - `docs/template-generation.md`
   - `docs/template-prescription-assignment.md`
   - `docs/template-score-report.md`
   - `docs/user-settings-downstream.md`
   - `docs/analysis/user-settings-simplification.md`
   - `docs/analysis/user-settings-simplification-implementation-plan.md`

## Implementation Notes
- Backward compatibility: existing `rpeTargets` are ignored after engine changes.
- Settings data remains in the DB until a cleanup migration, avoiding destructive changes in the first pass.

## Acceptance Criteria
- Settings UI no longer shows fields removed in the simplification plan.
- APIs and validation do not accept or persist removed fields.
- RPE targets are computed solely by engine rules.
- Progression logic depends on `trainingAge`, not user preference fields.
- Split mismatch warning appears when a suboptimal split is selected.
- Secondary goal biases selection as documented.

## Files Likely To Change
- `src/components/UserPreferencesForm.tsx`
- `src/app/onboarding/ProfileForm.tsx`
- `src/app/settings/page.tsx`
- `src/lib/validation.ts`
- `src/app/api/profile/setup/route.ts`
- `src/app/api/preferences/route.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/progression.ts`
- `src/lib/engine/filtering.ts`
- `prisma/schema.prisma`
