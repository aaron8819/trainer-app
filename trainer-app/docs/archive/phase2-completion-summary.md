# Phase 2: Avoid Preferences Explainability - Completion Summary

**Date:** 2026-02-16
**Status:** ✅ COMPLETE
**Time Spent:** ~4 hours

---

## What Was Implemented

Phase 2 enhanced workout explainability by splitting generic "contraindications" into specific rejection reasons, allowing users to see why exercises were filtered.

### Core Changes

#### 1. Schema Enhancement
**File:** `src/lib/engine/selection-v2/types.ts`

Split `SelectionConstraints.contraindications` into:
- `painConflicts: Set<string>` - Exercises excluded due to pain flags
- `userAvoids: Set<string>` - Exercises explicitly avoided by user
- `equipmentUnavailable: Set<string>` - Exercises requiring unavailable equipment

Maintained backward compatibility by keeping deprecated `contraindications` field.

#### 2. Specific Rejection Reasons
**File:** `src/lib/engine/selection-v2/optimizer.ts`

Updated `checkHardConstraints()` to return specific reasons:
- Checks `painConflicts` → returns `"pain_conflict"`
- Checks `userAvoids` → returns `"user_avoided"`
- Checks `equipmentUnavailable` → returns `"equipment_unavailable"`
- Priority: pain > user avoid > equipment > generic fallback

#### 3. Explainability Function
**File:** `src/lib/engine/explainability/session-context.ts`

Added `summarizeFilteredExercises()`:
```typescript
export function summarizeFilteredExercises(
  rejected: RejectedExercise[]
): FilteredExerciseSummary[]
```

Maps rejection reasons to user-friendly messages:
- `"user_avoided"` → "Avoided per your preferences"
- `"pain_conflict"` → "Excluded due to recent pain signals"
- `"equipment_unavailable"` → "Equipment not available"

#### 4. UI Component
**File:** `src/components/explainability/FilteredExercisesCard.tsx`

New component displaying filtered exercises grouped by reason:
- ✓ icon for user avoids ("Your Preferences Honored")
- ⚠️ icon for pain conflicts
- 🏋️ icon for equipment unavailable
- ℹ️ icon for other filters

Integrated into `ExplainabilityPanel` between session context and coach messages.

#### 5. Type Extensions
**File:** `src/lib/engine/explainability/types.ts`

Added:
- `FilteredExerciseSummary` type with `exerciseId`, `exerciseName`, `reason`, `userFriendlyMessage`
- Extended `WorkoutExplanation` with optional `filteredExercises` field

---

## Test Coverage

Added **19 new tests** across 3 files:

### Optimizer Tests (4 tests)
- Returns `"pain_conflict"` for exercises in `painConflicts` set
- Returns `"user_avoided"` for exercises in `userAvoids` set
- Prioritizes `painConflicts` over `userAvoids` when in both
- Handles multiple rejection reasons for different exercises

### Explainability Tests (7 tests)
- Summarizes user_avoided with correct message
- Summarizes pain_conflict with correct message
- Summarizes equipment_unavailable with correct message
- Handles contraindicated with generic message
- Handles mixed rejection reasons
- Handles empty rejected array
- Provides generic fallback for other reasons

### Component Tests (8 tests)
- Renders nothing when empty
- Renders user avoided exercises correctly
- Renders pain conflict exercises correctly
- Renders equipment unavailable exercises correctly
- Groups by rejection reason
- Handles multiple in same category
- Handles "Other Filters" section
- Renders introduction text

**Result:** All 863 tests passing (including 19 new tests)

---

## Validation

✅ **Tests:** All 863 tests passing
✅ **Build:** Production build completes successfully
✅ **TypeScript:** No type errors
✅ **Backward Compatibility:** Deprecated field maintains compatibility

---

## Files Modified

**Engine (6 files):**
- `src/lib/engine/selection-v2/types.ts` - Schema changes
- `src/lib/engine/selection-v2/optimizer.ts` - Specific rejection logic
- `src/lib/engine/selection-v2/test-utils.ts` - Test fixture updates
- `src/lib/engine/explainability/session-context.ts` - New function
- `src/lib/engine/explainability/types.ts` - New types
- `src/lib/engine/explainability/index.ts` - Barrel exports

**API (2 files):**
- `src/lib/api/template-session.ts` - Constraint builder
- `src/lib/api/explainability.ts` - Fixture updates

**UI (2 files):**
- `src/components/explainability/FilteredExercisesCard.tsx` - New component
- `src/components/explainability/ExplainabilityPanel.tsx` - Integration

**Tests (3 files):**
- `src/lib/engine/selection-v2/optimizer.test.ts` - 4 new tests
- `src/lib/engine/explainability/session-context.test.ts` - 7 new tests
- `src/components/explainability/FilteredExercisesCard.test.tsx` - 8 new tests (new file)

**Documentation (1 file):**
- `docs/decisions.md` - ADR-063

**Total:** 14 files modified, 3 files created

---

## Impact

### User Experience
✅ **Transparency:** Users see which exercises were filtered and why
✅ **Trust:** Users verify their preferences were honored
✅ **Clarity:** Grouped display makes it easy to scan filtered exercises

### Developer Experience
✅ **Debuggability:** Distinguish between filtering sources
✅ **Explainability:** Rich data for future UX enhancements
✅ **Maintainability:** Clear separation of concerns

### System Quality
✅ **Type Safety:** Strongly typed rejection reasons
✅ **Test Coverage:** Comprehensive test suite (19 new tests)
✅ **Backward Compatibility:** No breaking changes

---

## Next Steps (Phase 3 - Optional)

**Priority:** P3 (Future Enhancement)

1. **Smart Substitution Recommendations:**
   - Show why substitute was selected
   - Link filtered exercise to substitute
   - Example: "Incline Dumbbell Curl → Hammer Curl (high SFR, targets biceps, recently unused)"

2. **User Preference Management UI:**
   - Show count of avoided exercises in settings
   - "Un-avoid this exercise" quick action
   - Warning: "You're avoiding 15+ exercises, may limit variety"

3. **Exercise-Specific Contraindications:**
   - DB schema: `Exercise.contraindications` (e.g., "shoulder impingement")
   - User profile: `UserProfile.conditions`
   - Automatic filtering based on user conditions

4. **Deprecation Cleanup:**
   - Remove deprecated `contraindications` field
   - Update all references to use specific constraint sets

---

## Related Documents

- [ADR-062: Enforce User Avoid Preferences as Hard Constraints](../decisions.md#adr-062)
- [ADR-063: Split Contraindications for Enhanced Explainability](../decisions.md#adr-063)
- [Phase 2 Implementation Plan](./phase2-avoid-preferences-explainability.md)
- [User Settings Integration Analysis](../analysis/user-settings-integration-analysis.md)

---

## Follow-Up: API Response Integration (2026-02-16)

After Phase 2 completion, we discovered that filtered exercises weren't appearing in the UI during manual testing because they weren't being returned in the generation API response.

**Quick Fix Implemented (Option B):**
- Updated `generateSessionFromIntent` to extract `SelectionResult.rejected` and pass through `summarizeFilteredExercises()`
- Modified `finalizePostLoadResult` to accept and return `filteredExercises`
- Updated `/api/workouts/generate-from-intent` route to include `filteredExercises` in response
- **Result:** Filtered exercises now appear in generation API response

**Current Limitation:**
- Filtered exercises are NOT persisted to database
- They appear in API response but not when viewing saved workout detail pages
- For full persistence, see "Next Steps (Phase 3)" below

**Files Modified:**
- `src/lib/api/template-session.ts` - Integration logic
- `src/app/api/workouts/generate-from-intent/route.ts` - Response field
- `src/app/api/workouts/save/route.ts` - Lint fix

**Validation:**
- ✅ All 863 tests passing
- ✅ Build succeeds
- ✅ TypeScript clean
- ✅ Lint clean

See [avoid-preferences-implementation-summary.md](./avoid-preferences-implementation-summary.md) for testing instructions.

---

**Status:** Phase 2 complete and production-ready ✅ + API response integration complete ✅
