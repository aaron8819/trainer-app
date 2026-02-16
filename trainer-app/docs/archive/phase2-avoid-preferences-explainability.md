# Phase 2: Avoid Preferences Explainability Enhancement

**Status:** Planning
**Priority:** P2 (User Experience Enhancement)
**Estimated Effort:** 4-6 hours
**Prerequisite:** Phase 1 Complete (ADR-062) ✅

---

## Context

**Phase 1 Completion (2026-02-16):**
- ✅ User avoid preferences now enforced as hard constraints
- ✅ Avoided exercises never selected in workouts
- ✅ Substitution logic verified (beam search automatically selects alternatives)
- ✅ 6 comprehensive tests passing
- ✅ ADR-062 documented

**Phase 2 Goals:**
- Enhance explainability to show WHY exercises were filtered
- Distinguish between rejection reasons (pain flags vs user avoids vs equipment)
- Surface filtered exercises in UI with user-friendly messages

---

## Problem Statement

### Current Behavior

When an exercise is filtered as a contraindication:
1. **Rejection reason is generic:** `"contraindicated"` (doesn't specify why)
2. **No UI visibility:** Users don't see what was filtered or why
3. **Lost context:** Multiple contraindication sources (pain flags, user avoids) are conflated

### User Experience Gap

**Scenario:** User avoids "Incline Dumbbell Curl" due to elbow discomfort.

**Current UX:**
- Exercise is silently filtered
- User sees other bicep exercises in workout
- No indication that their preference was honored

**Desired UX:**
- User sees: "✓ Avoided: Incline Dumbbell Curl (per your preferences)"
- User understands: System respected their input
- User sees: "Selected: Hammer Curl (substitute for biceps volume)"

---

## Technical Design

### 1. Schema Changes: Split Contraindications

**Current:**
```typescript
interface SelectionConstraints {
  contraindications: Set<string>; // Generic set
}
```

**Proposed:**
```typescript
interface SelectionConstraints {
  // Separate sets for different contraindication sources
  painConflicts: Set<string>;           // From pain flags (SessionCheckIn)
  userAvoids: Set<string>;              // From UserPreference.avoidExerciseIds
  equipmentUnavailable: Set<string>;    // From Exercise equipment vs constraints
  otherContraindications?: Set<string>; // Future: exercise-specific contraindications
}
```

**Rationale:**
- Enables specific rejection reasons
- Supports targeted explainability messages
- Maintains backward compatibility (can derive union set if needed)

---

### 2. Optimizer Changes: Specific Rejection Reasons

**File:** `src/lib/engine/selection-v2/optimizer.ts`

**Current (Line 138-141):**
```typescript
// Generic check
if (objective.constraints.contraindications.has(exercise.id)) {
  return "contraindicated";
}
```

**Proposed:**
```typescript
// Specific checks with specific reasons
if (objective.constraints.painConflicts.has(exercise.id)) {
  return "pain_conflict";
}

if (objective.constraints.userAvoids.has(exercise.id)) {
  return "user_avoided";
}

if (objective.constraints.equipmentUnavailable.has(exercise.id)) {
  return "equipment_unavailable";
}

if (objective.constraints.otherContraindications?.has(exercise.id)) {
  return "contraindicated"; // Generic fallback
}
```

**Type System Already Supports This:**
```typescript
// types.ts:303-314 (existing)
export type RejectionReason =
  | "user_avoided"         // ✅ Already defined!
  | "pain_conflict"        // ✅ Already defined!
  | "equipment_unavailable" // ✅ Already defined!
  | "contraindicated"      // Generic fallback
  | ...
```

---

### 3. API Layer Changes: Build Separate Constraint Sets

**File:** `src/lib/api/template-session.ts`

**Current (Line 140-143):**
```typescript
contraindications: new Set([
  ...painFlagExerciseIds,
  ...(mapped.mappedPreferences?.avoidExerciseIds ?? []),
]),
```

**Proposed:**
```typescript
painConflicts: new Set(painFlagExerciseIds),
userAvoids: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
equipmentUnavailable: new Set(), // Future: pre-filter unavailable exercises
```

**Migration Path:**
1. Add new fields alongside `contraindications`
2. Update optimizer to check new fields first
3. Keep `contraindications` as union for backward compatibility
4. Remove `contraindications` in Phase 3

---

### 4. Explainability Changes: Surface Rejected Exercises

**File:** `src/lib/engine/explainability/session-context.ts`

**New Function:**
```typescript
export interface FilteredExerciseSummary {
  exerciseId: string;
  exerciseName: string;
  reason: RejectionReason;
  userFriendlyMessage: string;
}

export function summarizeFilteredExercises(
  rejected: RejectedExercise[],
  exerciseLibrary: Exercise[]
): FilteredExerciseSummary[] {
  return rejected.map((item) => {
    const exercise = exerciseLibrary.find((ex) => ex.id === item.exercise.id);
    const name = exercise?.name ?? "Unknown Exercise";

    let message: string;
    switch (item.reason) {
      case "user_avoided":
        message = `Avoided per your preferences`;
        break;
      case "pain_conflict":
        message = `Excluded due to recent pain signals`;
        break;
      case "equipment_unavailable":
        message = `Equipment not available`;
        break;
      default:
        message = `Filtered (${item.reason})`;
    }

    return {
      exerciseId: item.exercise.id,
      exerciseName: name,
      reason: item.reason,
      userFriendlyMessage: message,
    };
  });
}
```

**Add to WorkoutExplanation:**
```typescript
export interface WorkoutExplanation {
  sessionContext: SessionContext;
  coachMessages: CoachMessage[];
  exerciseRationale: Map<string, ExerciseRationale>;
  prescriptionRationale: Map<string, PrescriptionRationale>;
  filteredExercises?: FilteredExerciseSummary[]; // ← New field
}
```

---

### 5. UI Changes: Display Filtered Exercises

**Component:** `src/components/explainability/FilteredExercisesCard.tsx` (new)

**Design:**
```tsx
export function FilteredExercisesCard({
  filteredExercises,
}: {
  filteredExercises: FilteredExerciseSummary[];
}) {
  if (filteredExercises.length === 0) return null;

  const userAvoids = filteredExercises.filter((ex) => ex.reason === "user_avoided");
  const painConflicts = filteredExercises.filter((ex) => ex.reason === "pain_conflict");
  const other = filteredExercises.filter(
    (ex) => ex.reason !== "user_avoided" && ex.reason !== "pain_conflict"
  );

  return (
    <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
      <h3 className="font-medium text-sm text-gray-700 mb-2">
        Filtered Exercises
      </h3>

      {userAvoids.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-600 font-medium">✓ Your Preferences Honored:</p>
          <ul className="text-xs text-gray-700 ml-4 list-disc">
            {userAvoids.map((ex) => (
              <li key={ex.exerciseId}>
                {ex.exerciseName} <span className="text-gray-500">({ex.userFriendlyMessage})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {painConflicts.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-600 font-medium">⚠️ Pain Conflicts:</p>
          <ul className="text-xs text-gray-700 ml-4 list-disc">
            {painConflicts.map((ex) => (
              <li key={ex.exerciseId}>
                {ex.exerciseName} <span className="text-gray-500">({ex.userFriendlyMessage})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {other.length > 0 && (
        <div>
          <p className="text-xs text-gray-600 font-medium">Other Filters:</p>
          <ul className="text-xs text-gray-700 ml-4 list-disc">
            {other.map((ex) => (
              <li key={ex.exerciseId}>
                {ex.exerciseName} <span className="text-gray-500">({ex.userFriendlyMessage})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

**Integration Point:**
Add to `ExplainabilityPanel.tsx` (after SessionContextCard):

```tsx
{explanation.filteredExercises && explanation.filteredExercises.length > 0 && (
  <FilteredExercisesCard filteredExercises={explanation.filteredExercises} />
)}
```

---

## Implementation Checklist

### Phase 2.1: Schema Changes (1-2 hours)

- [ ] Update `SelectionConstraints` interface in `selection-v2/types.ts`
  - [ ] Add `painConflicts: Set<string>`
  - [ ] Add `userAvoids: Set<string>`
  - [ ] Add `equipmentUnavailable: Set<string>`
  - [ ] Mark `contraindications` as `@deprecated` with migration comment
- [ ] Update constraint builder in `template-session.ts:buildSelectionObjective()`
  - [ ] Populate `painConflicts` from pain flags
  - [ ] Populate `userAvoids` from preferences
  - [ ] Keep `contraindications` as union for backward compatibility
- [ ] Update all test fixtures to include new fields

### Phase 2.2: Optimizer Changes (30 min)

- [ ] Update `checkHardConstraints()` in `optimizer.ts`
  - [ ] Check `painConflicts` → return `"pain_conflict"`
  - [ ] Check `userAvoids` → return `"user_avoided"`
  - [ ] Check `equipmentUnavailable` → return `"equipment_unavailable"`
- [ ] Add unit tests for specific rejection reasons
  - [ ] Test: pain conflict returns "pain_conflict"
  - [ ] Test: user avoid returns "user_avoided"
  - [ ] Test: equipment unavailable returns "equipment_unavailable"

### Phase 2.3: Explainability Changes (1 hour)

- [ ] Add `summarizeFilteredExercises()` to `session-context.ts`
- [ ] Update `WorkoutExplanation` interface to include `filteredExercises`
- [ ] Update `generateWorkoutExplanation()` in `api/explainability.ts`
  - [ ] Pass `SelectionResult.rejected` to `summarizeFilteredExercises()`
  - [ ] Include result in `WorkoutExplanation`
- [ ] Add unit tests for `summarizeFilteredExercises()`
  - [ ] Test: user_avoided → "Avoided per your preferences"
  - [ ] Test: pain_conflict → "Excluded due to recent pain signals"
  - [ ] Test: equipment_unavailable → "Equipment not available"

### Phase 2.4: UI Changes (2-3 hours)

- [ ] Create `FilteredExercisesCard.tsx` component
  - [ ] Design: collapsible card with grouped filters
  - [ ] Group by reason: user avoids, pain conflicts, other
  - [ ] User-friendly icons and messaging
- [ ] Add to `ExplainabilityPanel.tsx`
  - [ ] Render after `SessionContextCard`
  - [ ] Only show if filtered exercises exist
- [ ] Add component tests
  - [ ] Test: groups exercises by reason
  - [ ] Test: shows user-friendly messages
  - [ ] Test: handles empty filtered list
  - [ ] Test: renders icons correctly

### Phase 2.5: Integration Testing (30 min)

- [ ] End-to-end test: User avoids exercise
  - [ ] Generate workout with avoided exercise
  - [ ] Verify `filteredExercises` includes avoided exercise
  - [ ] Verify reason is "user_avoided"
  - [ ] Verify UI shows "✓ Your Preferences Honored"
- [ ] End-to-end test: Pain conflict + user avoid
  - [ ] Generate workout with both filters
  - [ ] Verify both appear in `filteredExercises`
  - [ ] Verify distinct messages in UI

---

## Rollout Strategy

### Stage 1: Backend (No UI Changes)
1. Deploy schema changes with backward compatibility
2. Deploy optimizer changes
3. Monitor: Verify rejection reasons are correct in logs
4. **Risk:** Low (additive changes only)

### Stage 2: Explainability API (No UI Changes)
1. Deploy explainability changes
2. Monitor: Verify `filteredExercises` appears in API responses
3. **Risk:** Low (new field, doesn't break existing consumers)

### Stage 3: UI Changes (User-Facing)
1. Deploy `FilteredExercisesCard` component
2. Monitor: User feedback on clarity/usefulness
3. Iterate: Adjust messaging based on user feedback
4. **Risk:** Low (additive UI element, doesn't block existing features)

### Stage 4: Deprecation (Future)
1. Remove deprecated `contraindications` field
2. Update all references to use specific constraint sets
3. **Risk:** Medium (breaking change, coordinate with API versioning)

---

## Testing Strategy

### Unit Tests (Required)

1. **Optimizer Tests:** `optimizer.test.ts`
   - Specific rejection reasons returned correctly
   - Backward compatibility with union constraint set

2. **Explainability Tests:** `session-context.test.ts`
   - `summarizeFilteredExercises()` groups correctly
   - User-friendly messages generated correctly

3. **Component Tests:** `FilteredExercisesCard.test.tsx`
   - Renders grouped exercises
   - Shows correct icons and messages
   - Handles edge cases (empty list, single reason, mixed reasons)

### Integration Tests (Required)

1. **API Test:** `template-session.test.ts`
   - Verify `filteredExercises` in workout explanation
   - Verify rejection reasons are correct

2. **End-to-End Test:** `end-to-end-simulation.test.ts`
   - User avoids exercise → workout respects preference → UI shows confirmation
   - Pain conflict → workout excludes exercise → UI shows warning

---

## Success Metrics

### Functional Metrics (Validation)
- ✅ All tests pass (unit + integration + E2E)
- ✅ Build passes with no TypeScript errors
- ✅ No breaking changes to existing API contracts

### UX Metrics (Post-Deployment)
- 📊 User feedback: "I see that the app respected my preferences"
- 📊 Support tickets: Reduced questions about "why isn't this exercise avoided?"
- 📊 Engagement: Users interact with filtered exercises card (expand/collapse)

### Performance Metrics (Monitoring)
- ⚡ No measurable performance impact (<5ms overhead)
- ⚡ Explainability API response time remains <200ms

---

## Future Enhancements (Phase 3+)

### Phase 3: Smart Substitution Recommendations
- Show why substitute was selected: "Hammer Curl selected (high SFR, targets biceps, recently unused)"
- Link filtered exercise to its substitute: "Incline Dumbbell Curl → Hammer Curl"

### Phase 4: User Preference Management UI
- Show count of avoided exercises in settings
- Quick action: "Un-avoid this exercise" from filtered list
- Warning: "You're avoiding 15+ exercises, this may limit workout variety"

### Phase 5: Exercise-Specific Contraindications
- Database schema: `Exercise.contraindications` (e.g., "shoulder impingement", "lower back issues")
- User profile: `UserProfile.conditions` (e.g., "shoulder impingement")
- Automatic filtering: If user has condition, filter exercises contraindicated for that condition

---

## Dependencies

### Required Before Starting
- ✅ Phase 1 complete (ADR-062)
- ✅ All Phase 1 tests passing
- ✅ Build passing

### Parallel Work Possible
- ✅ Can work on Phase 2.1-2.3 (backend) while UI team works on Phase 2.4
- ✅ Can deploy backend changes before UI changes

### Blocked By
- None (Phase 2 is independent)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking change to `SelectionConstraints` | Medium | High | Keep deprecated `contraindications` field for backward compatibility |
| UI cluttered with too many filtered exercises | Low | Medium | Collapse by default, show count badge |
| User confusion about rejection reasons | Low | Low | Clear, friendly messaging with icons |
| Performance regression | Very Low | Low | Minimal overhead (just field splitting), monitor metrics |

---

## Open Questions

1. **Should we show filtered exercises for template mode?**
   - Current plan: Yes, but collapsed by default
   - Rationale: User may not realize their template conflicts with preferences

2. **Should we limit the number of filtered exercises shown?**
   - Current plan: Show all, grouped by reason
   - Alternative: "Top 5 filtered exercises" + "X more" expandable

3. **Should we add a "Why was this suggested?" for substitutes?**
   - Current plan: Defer to Phase 3
   - Rationale: Phase 2 focuses on filtering transparency, Phase 3 on substitution transparency

4. **Should we add analytics tracking for filtered exercises?**
   - Current plan: Yes (count of filtered exercises per workout)
   - Use case: Identify users who avoid too many exercises (UX intervention needed)

---

## Documentation Updates Required

- [ ] Update `docs/architecture.md` (Section: Exercise Selection)
  - [ ] Document constraint splitting
  - [ ] Update selection flow diagram
- [ ] Update `docs/decisions.md` (New ADR)
  - [ ] ADR-063: Split Contraindications for Enhanced Explainability
- [ ] Update `docs/index.md` (Phase 2 status)
- [ ] Update `docs/analysis/user-settings-integration-analysis.md`
  - [ ] Mark explainability gap as "In Progress (Phase 2)"

---

## Estimated Timeline

| Phase | Effort | Start | End |
|-------|--------|-------|-----|
| Phase 2.1 (Schema) | 1-2h | - | - |
| Phase 2.2 (Optimizer) | 30min | - | - |
| Phase 2.3 (Explainability) | 1h | - | - |
| Phase 2.4 (UI) | 2-3h | - | - |
| Phase 2.5 (Testing) | 30min | - | - |
| **Total** | **4-6h** | - | - |

---

## Related Documents

- [ADR-062: Enforce User Avoid Preferences as Hard Constraints](../decisions.md#adr-062)
- [User Settings Integration Analysis](../analysis/user-settings-integration-analysis.md)
- [Selection V2 Architecture](../architecture.md#selection-v2-multi-objective-beam-search)
- [Explainability Phase 4 Plan](./phase4-explainability-execution.md)

---

**End of Plan**
