# Avoid Preferences Implementation Summary

**Date:** 2026-02-16
**Status:** Phase 1 Complete ✅ | Phase 2 Planned 📋

---

## What Was Implemented (Phase 1)

### Critical User Trust Issue: RESOLVED ✅

**Problem:** Users could explicitly avoid exercises but still receive them in workouts (2% soft penalty allowed avoided exercises to score 98th percentile).

**Solution:** User avoid preferences are now enforced as **hard constraints** (like equipment availability and pain conflicts).

### Changes Made

#### 1. Core Fix
**File:** [src/lib/api/template-session.ts:140](../../src/lib/api/template-session.ts#L140)

```typescript
// BEFORE:
contraindications: new Set(painFlagExerciseIds),

// AFTER:
contraindications: new Set([
  ...painFlagExerciseIds,
  ...(mapped.mappedPreferences?.avoidExerciseIds ?? []),
]),
```

**Impact:**
- Avoided exercises are now **impossible to select** (filtered before scoring)
- Works for both intent-based and template auto-fill generation
- No breaking changes

#### 2. Comprehensive Test Coverage
**File:** [src/lib/api/template-session.test.ts](../../src/lib/api/template-session.test.ts)

Added 6 new tests:
1. ✅ Enforces user avoid preferences as hard constraints
2. ✅ Combines pain flags and user avoids into contraindications
3. ✅ Handles undefined/null preferences gracefully
4. ✅ Handles empty avoid lists gracefully
5. ✅ Enforces avoid preferences in template mode with auto-fill
6. ✅ **Automatically substitutes avoided exercises with alternatives** (NEW)

**Substitution Test Validates:**
- When a chest exercise is avoided, another chest exercise is selected
- Beam search volume deficit scoring (40% weight) drives substitution
- Workout maintains adequate muscle coverage despite filtering

#### 3. Documentation
**File:** [docs/decisions.md](../decisions.md#adr-062)

**ADR-062:** Enforce User Avoid Preferences as Hard Constraints
- Research alignment (autoregulation & individualization principles)
- Implementation details
- Test coverage summary
- Trade-offs and future considerations

### Validation Results

| Check | Status | Details |
|-------|--------|---------|
| **Tests** | ✅ **PASS** | All 843 tests passing (including 6 new tests) |
| **Build** | ✅ **PASS** | Production build completes successfully |
| **TypeScript** | ⚠️ Pre-existing issues | Errors in unrelated explainability component tests |

---

## What's NOT Implemented (Phase 2)

### User Experience Gaps

While avoided exercises are now **correctly filtered**, users don't see:
1. **What was filtered:** "Which exercises did the app avoid for me?"
2. **Why it was filtered:** "Was this avoided due to my preferences or pain flags?"
3. **What was substituted:** "What exercise replaced the avoided one?"

### Example Scenario

**Current UX:**
- User avoids "Incline Dumbbell Curl" due to elbow discomfort
- Workout includes "Hammer Curl" (substitute)
- ❌ User doesn't see that their preference was honored

**Desired UX (Phase 2):**
- User sees: "✓ Avoided: Incline Dumbbell Curl (per your preferences)"
- User sees: "Selected: Hammer Curl (substitute for biceps volume)"
- ✅ User trusts the app is respecting their input

---

## Your Three Questions: Answered

### ✅ 1. Explainability - User should know if exercise was filtered

**Phase 1 Status:** Data is available but not surfaced to user
- `SelectionResult.rejected` array captures all filtered exercises with reasons
- But reason is generic: `"contraindicated"` (doesn't distinguish pain vs user avoid)

**Phase 2 Plan:** Surface filtered exercises in UI
- Split contraindications into `painConflicts`, `userAvoids`, `equipmentUnavailable`
- Update optimizer to return specific rejection reasons
- Create `FilteredExercisesCard` component showing filtered exercises grouped by reason
- **See:** [Phase 2 Plan](./phase2-avoid-preferences-explainability.md)

### ✅ 2. Substitution - Ensure similar exercise is selected

**Phase 1 Status:** Verified and working ✅
- Beam search volume deficit scoring (40% weight) automatically drives substitution
- When an exercise is filtered, the next-best candidate for that muscle group scores higher
- New test validates: "automatically substitutes avoided exercises with alternatives targeting same muscles"

**How it works:**
1. User avoids "Incline Dumbbell Curl" (bicep exercise)
2. Optimizer filters it before scoring (hard constraint)
3. Beam search runs on remaining exercises
4. Volume deficit for biceps is still high → other bicep exercises score well
5. "Hammer Curl" is selected as substitute

**No additional code needed** - substitution is inherent to the beam search algorithm.

### ✅ 3. Intent-based workouts - Is this working?

**Phase 1 Status:** Yes, already working ✅
- Both `generateSessionFromIntent()` and `generateSessionFromTemplate()` use the same constraint builder: `buildSelectionObjective()`
- User avoids are enforced in both paths
- Test coverage includes intent-based generation: "enforces user avoid preferences as hard constraints"

**Validation:**
```typescript
// template-session.test.ts:419-438
it("enforces user avoid preferences as hard constraints", async () => {
  mapPreferencesMock.mockReturnValue({
    avoidExerciseIds: [dumbbellPress.id],
  });

  const result = await generateSessionFromIntent("user-1", {
    intent: "push",
  });

  expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
  // ✅ Test passes
});
```

---

## Phase 2: Next Steps (Optional)

**When to implement:** When you want to enhance UX transparency (not blocking)

**Estimated effort:** 4-6 hours

**Priority:** P2 (User Experience Enhancement)

**See full plan:** [Phase 2 Implementation Plan](./phase2-avoid-preferences-explainability.md)

### Quick Summary

#### Backend Changes (2-3 hours)
1. Split `contraindications` into `painConflicts`, `userAvoids`, `equipmentUnavailable`
2. Update optimizer to return specific rejection reasons
3. Add `filteredExercises` to `WorkoutExplanation` API

#### Frontend Changes (2-3 hours)
4. Create `FilteredExercisesCard` component
5. Show grouped filtered exercises with user-friendly messages
6. Add to `ExplainabilityPanel`

#### Testing (30 min)
7. Unit tests for specific rejection reasons
8. Component tests for filtered exercises card
9. E2E test for full flow

### UI Mockup

```
┌─────────────────────────────────────────┐
│ Filtered Exercises                      │
├─────────────────────────────────────────┤
│ ✓ Your Preferences Honored:             │
│   • Incline Dumbbell Curl               │
│     (Avoided per your preferences)      │
│                                          │
│ ⚠️ Pain Conflicts:                       │
│   • Bench Press                         │
│     (Excluded due to recent pain)       │
└─────────────────────────────────────────┘
```

---

## Trade-offs & Decisions

### Why Split Phase 1 and Phase 2?

**Phase 1 (Critical):**
- Fixes user trust issue: avoided exercises are now impossible to select
- Low risk: 2-line code change, additive only
- High impact: Resolves critical bug

**Phase 2 (Enhancement):**
- Improves UX transparency: users see what was filtered and why
- Higher complexity: schema changes, UI components
- Lower urgency: Feature works correctly, just lacks visibility

**Decision:** Ship Phase 1 immediately, plan Phase 2 as UX enhancement.

### Why Not Use Separate API Fields Initially?

**Current approach:** Combine pain flags + user avoids into single `contraindications` set

**Alternative:** Pass as separate fields (`painConflicts`, `userAvoids`)

**Rationale for current approach:**
- Faster to implement (2 lines of code)
- Lower risk of breaking changes
- Can refactor in Phase 2 without affecting existing functionality
- Maintains backward compatibility

**Phase 2 will refactor:** See [Phase 2 Plan Section 1](./phase2-avoid-preferences-explainability.md#1-schema-changes-split-contraindications)

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [ADR-062](../decisions.md#adr-062) | Architectural decision record for Phase 1 |
| [Phase 2 Plan](./phase2-avoid-preferences-explainability.md) | Detailed implementation plan for explainability |
| [User Settings Analysis](../analysis/user-settings-integration-analysis.md) | Original gap analysis that identified this issue |
| [Architecture Docs](../architecture.md) | Engine behavior and selection flow |

---

## Success Metrics

### Phase 1 (Complete ✅)

| Metric | Status |
|--------|--------|
| Avoided exercises never selected | ✅ Verified by tests |
| No breaking changes | ✅ All 843 tests passing |
| Substitution works automatically | ✅ Verified by test |
| Build passes | ✅ Production build clean |
| Documentation complete | ✅ ADR-062 logged |

### Phase 2 (Planned 📋)

| Metric | Target |
|--------|--------|
| User sees filtered exercises in UI | Yes |
| Rejection reasons are specific | Yes (pain vs user avoid vs equipment) |
| No performance regression | <5ms overhead |
| User feedback positive | "I see the app respected my preferences" |

---

## Questions & Feedback

Have questions about Phase 1 or Phase 2? See:
- [Phase 2 Open Questions](./phase2-avoid-preferences-explainability.md#open-questions)
- [Phase 2 Risk Assessment](./phase2-avoid-preferences-explainability.md#risk-assessment)

**Ready to start Phase 2?** See the [implementation checklist](./phase2-avoid-preferences-explainability.md#implementation-checklist).

---

**End of Summary**
