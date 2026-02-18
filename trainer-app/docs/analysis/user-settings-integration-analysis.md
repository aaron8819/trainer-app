# User Settings Integration Analysis

**Date:** 2026-02-16 (updated 2026-02-17)
**Status:** ✅ Phase 1 Complete | ✅ Phase 2 Complete | ✅ Phase 2b (Persistence) Complete | ✅ Phase 4.6 Schema Cleanup Complete | ✅ Settings Cleanup Complete

---

## Executive Summary

User settings (favorites/avoids) are fully wired end-to-end and correctly enforced as hard constraints. The schema is clean and all identified issues have been resolved. No remaining housekeeping work.

See [settings-cleanup-plan.md](../plans/settings-cleanup-plan.md) for the completed cleanup plan.

---

## Table of Contents

1. [Current Schema](#1-current-schema)
2. [Data Flow (end-to-end)](#2-data-flow-end-to-end)
3. [What Is Clean](#3-what-is-clean)
4. [Issues Found](#4-issues-found)
5. [Summary Table](#5-summary-table)
6. [Implementation History](#6-implementation-history)

---

## 1. Current Schema

### UserPreference Model (post Phase 4.6 cleanup)

```prisma
model UserPreference {
  userId              String   @id
  user                User     @relation(fields: [userId], references: [id])
  favoriteExerciseIds String[] @default([])
  avoidExerciseIds    String[] @default([])
  updatedAt           DateTime @updatedAt
}
```

Three fields. No dead columns. The 8 columns that were dropped in Phase 4.6:
- `favoriteExercises` (name-based, legacy)
- `avoidExercises` (name-based, legacy)
- `optionalConditioning`
- `rpeTargets`
- `progressionStyle`
- `benchFrequency`
- `squatFrequency`
- `deadliftFrequency`

### Engine Type Mapping

```typescript
// src/lib/engine/types.ts:104
export type UserPreferences = {
  favoriteExerciseIds?: string[];
  avoidExerciseIds?: string[];
};
```

Both schema fields map directly to engine types. No gap between what is stored and what is typed.

---

## 2. Data Flow (end-to-end)

### 2.1 Favorites — Soft Tiebreaker

```
UserPreference.favoriteExerciseIds (DB)
  ↓ mapPreferences() [workout-context.ts:284]
  ↓ UserPreferences.favoriteExerciseIds
  ↓ buildSelectionObjective() [template-session.ts:229]
  ↓ SelectionPreferences.favoriteExerciseIds (Set<string>)
  ↓ scoreUserPreference() [scoring.ts] — weight: 0.02
  ↓ BeamState.favoritesCount — tiebreaker within BEAM_TIEBREAKER_EPSILON (0.05)
```

Favorites receive the lowest scoring weight (2%) but act as a secondary tiebreaker when beam scores are within 5% of each other.

### 2.2 Avoids — Hard Constraint

```
UserPreference.avoidExerciseIds (DB)
  ↓ mapPreferences() [workout-context.ts:284]
  ↓ UserPreferences.avoidExerciseIds
  ↓ buildSelectionObjective() [template-session.ts:147]
  ↓ SelectionConstraints.userAvoids (Set<string>)          ← hard filter
  ↓ optimizer.ts → returns "user_avoided" → exercise excluded
```

Avoided exercises cannot be selected. The deprecated `contraindications` backward-compat union was removed in the settings cleanup (2026-02-17).

### 2.3 Settings Form Write Path

```
User fills ExercisePicker in Settings page
  ↓ Names → IDs via exercise lookup
  ↓ POST /api/preferences { favoriteExerciseIds, avoidExerciseIds }
  ↓ preferencesSchema validation (Zod)
  ↓ Mutual exclusion: avoids that are also favorites are stripped
  ↓ prisma.userPreference.upsert()
```

### 2.4 Exercise Library Toggle Write Path

```
User taps ★ or ✗ on ExerciseDetailSheet
  ↓ POST /api/exercises/[id]/favorite (or /avoid)
  ↓ Serializable transaction with 3-attempt retry loop
  ↓ computeExercisePreferenceToggle() — enforces mutual exclusion
  ↓ prisma.userPreference.update()
```

---

## 3. What Is Clean

| Component | Status | Notes |
|-----------|--------|-------|
| `UserPreference` schema | ✅ Clean | 3 fields, no dead columns |
| `UserPreferences` engine type | ✅ Clean | Direct mapping, no gaps |
| `mapPreferences()` | ✅ Clean | Simple passthrough normalizer |
| Preferences API route | ✅ Clean | Validates, enforces mutual exclusion |
| Toggle routes (favorite/avoid) | ✅ Clean | Serializable tx, retry logic |
| Mutual exclusion logic | ✅ Correct | Enforced in both bulk and toggle paths |
| `SelectionConstraints.userAvoids` | ✅ Correct | Hard constraint, used by optimizer |
| `SelectionConstraints.painConflicts` | ✅ Correct | Separate from user avoids |
| Favorites tiebreaker (beam search) | ✅ Correct | `favoritesCount` + epsilon comparison |
| Settings page | ✅ Wired | ProfileForm + BaselineSetupCard + UserPreferencesForm |

---

## 4. Issues Found

### ✅ Issue 1 (Resolved): `contraindications` Backward-Compat Field

**Status:** Removed 2026-02-17 (Settings Cleanup Phase 1).

`SelectionConstraints.contraindications?: Set<string>` was removed from the type, the optimizer fallback check was deleted, the union construction in `template-session.ts` was deleted, and all test fixtures were updated to use `painConflicts` / `userAvoids` / `equipmentUnavailable` directly.

---

### ✅ Issue 2 (Resolved): `_preferences` in `prescription.ts` — Dead Parameter Wiring

**Status:** Removed 2026-02-17 (Settings Cleanup Phase 2).

`UserPreferences` was removed from `prescribeSetsReps`, `prescribeMainLiftSets`, `prescribeAccessorySets`, and `resolveTargetRpe`. The `rpeTargets` override feature was never implemented and its schema fields were already dropped in Phase 4.6. No behavior change.

---

### ✅ Issue 3 (Resolved): Dead Schema Fields

**Status:** Dropped 2026-02-17 (Settings Cleanup Phase 3).

| Field | Model | Resolution |
|-------|-------|------------|
| `proteinTarget Int?` | `Goals` | Dropped via migration `20260217_drop_dead_goals_constraints` |
| `equipmentNotes String?` | `Constraints` | Dropped via migration `20260217_drop_dead_goals_constraints` |

---

### ✅ Issue 4 (Resolved): `availableEquipment` Removed Entirely

**Status:** Fully removed 2026-02-17 (ADR-067).

`availableEquipment` was always hardcoded to `ALL_EQUIPMENT_TYPES` — the filter was a no-op with no UI for per-user selection. The field was removed from the DB schema, engine `Constraints` type, `SelectionConstraints` (including `equipment: Set<EquipmentType>` and `equipmentUnavailable: Set<string>`), optimizer, all test fixtures, all mapping layers, and the profile setup route. Migration: `20260217_drop_equipment_constraint`.

---

### Issue 5 (Open): Single-Injury Limitation in Settings Page

`settings/page.tsx` uses `findFirst` for injuries — only the most recent active injury is shown in the form. The ProfileForm has one injury section. Multi-injury users can only manage one at a time.

This is a known product limitation, not an integration bug. No immediate action required.

---

## 5. Summary Table

| Issue | Priority | Status | Resolution |
|-------|----------|--------|------------|
| Remove `contraindications` compat field | P1 | ✅ Done | Removed (Settings Cleanup Phase 1, 2026-02-17) |
| Remove `_preferences` from prescription | P2 | ✅ Done | Removed (Settings Cleanup Phase 2, 2026-02-17) |
| Drop `Goals.proteinTarget` from schema | P2 | ✅ Done | Migration `20260217_drop_dead_goals_constraints` |
| Drop `Constraints.equipmentNotes` from schema | P2 | ✅ Done | Migration `20260217_drop_dead_goals_constraints` |
| `availableEquipment` removed | P3 | ✅ Done | Full removal — schema, engine, optimizer, all fixtures (ADR-067, 2026-02-17) |
| Single-injury UI gap | P4 | Open | Future improvement — known product limitation |

See [settings-cleanup-plan.md](../plans/settings-cleanup-plan.md) for the completed cleanup plan.

---

## 6. Implementation History

### ✅ Phase 1: Complete (2026-02-16) — ADR-062

**Implemented:** `avoidExerciseIds` added to `constraints.contraindications` → exercises are hard-filtered.

### ✅ Phase 2: Complete (2026-02-16) — ADR-063

**Implemented:**
- Split `contraindications` into `painConflicts`, `userAvoids`
- Specific rejection reasons: `"pain_conflict"`, `"user_avoided"`
- `summarizeFilteredExercises()` with user-friendly messages
- `FilteredExercisesCard` UI component

### ✅ Phase 2b: Complete (2026-02-17) — FilteredExercise DB Persistence

**Implemented:**
- `FilteredExercise` Prisma model (cascade delete on workout)
- Persisted inside existing `$transaction()` on workout save
- `generateWorkoutExplanation()` includes `filteredExercises: true`
- `WorkoutExplanation` client threads `filteredExercises` into `ExplainabilityPanel`
- `FilteredExercisesCard` now survives page refreshes

### ✅ Phase 4.6 Schema Cleanup: Complete (2026-02-17) — ADR-066+

**Implemented:**
- Dropped 8 dead columns from `UserPreference`
- Refactored `UserPreferencesForm` to ID-based (no name-based fields)
- Removed all name-based lookup logic from preferences route and `exercise-preferences.ts`
- Fixed 3 `BeamState` clone sites missing `favoritesCount` field

### ✅ P2 (Favorites Tiebreaker): Complete (2026-02-17)

**Implemented:**
- `BeamState.favoritesCount` tracked per beam state
- `BEAM_TIEBREAKER_EPSILON = 0.05` — beam pruning uses favorites as secondary sort within ε
- 2 tests: tiebreaker fires within ε, does NOT fire beyond ε

### ✅ Settings Cleanup: Complete (2026-02-17)

**Implemented:**
- **Phase 1:** Removed deprecated `contraindications?: Set<string>` from `SelectionConstraints`, deleted optimizer fallback, deleted template-session union construction, updated 8 test files to use canonical constraint fields
- **Phase 2:** Removed `preferences?: UserPreferences` from `prescribeSetsReps`, `prescribeMainLiftSets`, `prescribeAccessorySets`, and `resolveTargetRpe`; updated 8 prescription test call sites
- **Phase 3:** Dropped `Goals.proteinTarget` and `Constraints.equipmentNotes` via manual migration `20260217_drop_dead_goals_constraints`
- **Phase 4:** Added schema comment clarifying `availableEquipment` intent (subsequently removed in full — see ADR-067)

Result: 867/867 tests passing, build clean, no new lint errors. All integration issues resolved.

### ✅ Equipment Filter Removal: Complete (2026-02-17) — ADR-067

**Implemented:** Full removal of `availableEquipment` — was always a no-op (hardcoded to ALL_EQUIPMENT_TYPES). Removed from:
- DB schema + migration `20260217_drop_equipment_constraint`
- Engine `Constraints` type
- `SelectionConstraints` (`equipment`, `equipmentUnavailable` fields)
- `RejectionReason` (`"equipment_unavailable"` variant)
- Optimizer `hasAvailableEquipment()` function and check
- All test fixtures, mapping layers, profile route, `substitution.ts`, `session-context.ts`

Result: 862/862 tests passing (867 − 5 removed equipment tests), build clean, no new lint errors.

---

**End of Analysis**
