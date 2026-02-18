# Settings Cleanup Plan

**Date:** 2026-02-17
**Status:** ✅ Complete (2026-02-17)
**Source:** [user-settings-integration-analysis.md](../analysis/user-settings-integration-analysis.md)

## Overview

Three targeted cleanup phases following the Phase 4.6 schema cleanup. All changes are safe (backward-compat scaffolding removal, dead schema fields, dead parameter wiring). No behavior changes to user-visible features.

Estimated scope: ~150 lines removed, 2 schema migrations, 0 new features.

---

## Phase 1 — Remove `contraindications` Backward-Compat Field

**Why:** The `SelectionConstraints.contraindications?: Set<string>` field was marked `@deprecated` in ADR-063 during Phase 2. The split constraint sets (`painConflicts`, `userAvoids`, `equipmentUnavailable`) have been fully wired since then. The backward-compat union is now pure dead code executed on every workout generation.

**Risk:** Low. The optimizer checks `painConflicts` and `userAvoids` before reaching the compat fallback. Removing the field eliminates a redundant code path, not a load-bearing one.

### Steps

#### 1a. Remove from `SelectionConstraints` type

**File:** `src/lib/engine/selection-v2/types.ts`

Remove the deprecated field block:

```typescript
// DELETE THIS:
/**
 * @deprecated Use specific constraint sets (painConflicts, userAvoids, equipmentUnavailable) instead.
 * Maintained for backward compatibility during migration.
 * Will be removed in Phase 3.
 */
contraindications?: Set<string>;
```

#### 1b. Remove union construction from `template-session.ts`

**File:** `src/lib/api/template-session.ts`

Remove the backward-compat union block (~lines 149–153):

```typescript
// DELETE THIS:
// Backward compatibility: Union of all contraindications (deprecated)
contraindications: new Set([
  ...painFlagExerciseIds,
  ...(mapped.mappedPreferences?.avoidExerciseIds ?? []),
]),
```

#### 1c. Remove backward-compat check from `optimizer.ts`

**File:** `src/lib/engine/selection-v2/optimizer.ts`

Remove the fallback check (~lines 153–156):

```typescript
// DELETE THIS:
// 5. Backward compatibility: check deprecated contraindications set
if (objective.constraints.contraindications?.has(exercise.id)) {
  return "contraindicated"; // Generic fallback
}
```

#### 1d. Update test fixtures

Replace `contraindications: new Set()` with `painConflicts: new Set()` in all test fixtures. The value stays `new Set()` — only the key name changes.

**Files to update:**
- `src/lib/engine/selection-v2/test-utils.ts` — shared fixture builder (fixes all downstream tests)
- `src/lib/engine/selection-v2/beam-search.test.ts`
- `src/lib/engine/selection-v2/candidate.test.ts`
- `src/lib/engine/selection-v2/rationale.test.ts`
- `src/lib/engine/selection-v2/optimizer.test.ts` (also uses `contraindications` as a parameter to `createMockObjective` — update the builder signature)
- `src/lib/engine/selection-v2/integration.test.ts` (sets `objective.constraints.contraindications` directly — update to `painConflicts`)

#### 1e. Validate

```bash
npm test
npm run build
npm run lint
```

Expected: all 867 tests pass, build clean. No behavior change.

---

## Phase 2 — Remove Dead `_preferences` Wiring in `prescription.ts`

**Why:** `prescribeMainLiftSets` and `prescribeAccessorySets` accept `preferences?: UserPreferences` and pass it to `resolveTargetRpe`, which marks it `_preferences` (underscore = intentionally unused). This was placeholder wiring for a `rpeTargets` override feature that was never implemented and whose schema fields were dropped in Phase 4.6.

**Risk:** Low. Removing unused parameters is a pure refactor — no logic changes.

### Steps

#### 2a. Remove `_preferences` from `resolveTargetRpe`

**File:** `src/lib/engine/prescription.ts`

Remove `_preferences?: UserPreferences` parameter from `resolveTargetRpe` function signature and all three call sites within `prescribeMainLiftSets` and `prescribeAccessorySets`.

#### 2b. Remove `preferences` from `prescribeMainLiftSets` and `prescribeAccessorySets`

Remove the `preferences?: UserPreferences` parameter from both internal functions. They no longer need to accept it since they only pass it down to `resolveTargetRpe`.

#### 2c. Remove `preferences` from the public `prescribeSets` function

**File:** `src/lib/engine/prescription.ts`

Remove `preferences?: UserPreferences` from the exported `prescribeSets` function. Update all call sites.

**Call sites to update:**
- `src/lib/engine/template-session.ts` (engine layer)
- Any test files that pass preferences to `prescribeSets`

#### 2d. Decide on `UserPreferences` import

After removing from prescription, check if `UserPreferences` is still imported in `prescription.ts`. If not, remove the import.

**Note:** `UserPreferences` is still used by `template-session.ts` (engine), `workout-context.ts` (API), and `template-session.ts` (API) — the type itself is not being removed, only the prescription wiring.

#### 2e. Validate

```bash
npm test
npm run build
npx tsc --noEmit
```

Expected: all tests pass, build clean, no new tsc errors.

---

## Phase 3 — Drop Dead Schema Fields

**Why:** `Goals.proteinTarget` and `Constraints.equipmentNotes` are not referenced anywhere in `src/`. They exist only in the DB and schema.

**Risk:** Low — no code reads or writes these fields. Single migration.

### Steps

#### 3a. Edit `schema.prisma`

**File:** `prisma/schema.prisma`

Remove from `Goals`:
```prisma
// DELETE:
proteinTarget Int?
```

Remove from `Constraints`:
```prisma
// DELETE:
equipmentNotes String?
```

#### 3b. Create migration

Due to the shadow DB P3006 bug (Supabase), use the manual migration workflow:

```sql
-- prisma/migrations/20260217_drop_dead_preference_columns/migration.sql
ALTER TABLE "Goals" DROP COLUMN IF EXISTS "proteinTarget";
ALTER TABLE "Constraints" DROP COLUMN IF EXISTS "equipmentNotes";
```

Apply:
```bash
npx prisma db execute --file prisma/migrations/20260217_drop_dead_fields/migration.sql
npx prisma migrate resolve --applied 20260217_drop_dead_fields
npm run prisma:generate
```

#### 3c. Validate

```bash
npx prisma migrate status       # should show applied
npx prisma db pull --print      # verify columns are gone
npm run build
npm test
```

---

## Phase 4 (Optional) — `availableEquipment` Clarification

**Why:** `Constraints.availableEquipment` is always saved as `ALL_EQUIPMENT_TYPES` by the profile/setup route. No UI exposes it. The engine uses it, but since it's always the full set it's effectively a no-op constraint. This is intentional (same gym, all equipment), but misleading for anyone reading the schema.

**Action:** Add a comment to the schema field and the profile/setup route explaining the intent. No migration needed.

```prisma
// Always ALL_EQUIPMENT_TYPES — no UI for per-user filtering.
// Reserved for future multi-gym or home-gym support.
availableEquipment EquipmentType[] @default([])
```

---

## Execution Order

| Phase | Blocker? | Notes |
|-------|----------|-------|
| Phase 1 (contraindications) | None | Start here — highest signal-to-noise |
| Phase 2 (prescription wiring) | None | Independent of Phase 1 |
| Phase 3 (schema drops) | None | Independent; requires migration |
| Phase 4 (comment) | None | Trivial, do last |

Phases 1 and 2 can be done in either order. Phase 3 requires a DB migration. All four can be committed together or separately — each is self-contained.

---

## Success Criteria

- [x] `SelectionConstraints` type has no `contraindications` field
- [x] Optimizer has no `contraindications` fallback check
- [x] `template-session.ts` constructs no `contraindications` union
- [x] All test fixtures use `painConflicts` (not `contraindications`)
- [x] `prescribeSets` accepts no `preferences` parameter
- [x] `resolveTargetRpe` has no `_preferences` parameter
- [x] `Goals.proteinTarget` column does not exist in DB
- [x] `Constraints.equipmentNotes` column does not exist in DB
- [x] `npx prisma migrate status` shows all migrations applied
- [x] `npm run build` passes clean
- [x] `npm test` — all tests pass (867+)
- [x] `npm run lint` — no new errors

---

## Test Coverage Notes

No new tests needed — all changes are subtractive. The existing test suite will fail to compile if any call sites are missed, which is how you know Phase 2 is complete.

For Phase 1, the integration tests that set `contraindications` directly (e.g., `integration.test.ts:345`) need to be updated to use the correct specific set (`painConflicts` for pain flags, `userAvoids` for user preferences).
