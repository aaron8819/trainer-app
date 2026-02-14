# Legacy Code Deprecation Strategy (Pre-Launch)

**Context:** App is NOT live, zero production users
**Goal:** Clean cut-over with NO dual-mode complexity
**Principle:** Delete old code immediately as new code replaces it

---

## Simplified Approach

Since there are no users to migrate:

❌ ~~Feature flags~~ (not needed)
❌ ~~Gradual rollout~~ (not needed)
❌ ~~Force migration scripts~~ (not needed)
❌ ~~Backward compatibility~~ (not needed)

✅ **Just replace and delete**

---

## Phase-by-Phase Deletion Plan

### Phase 1: Periodization Foundation (Weeks 1-4)

**Replace:**
- ❌ Delete: `src/lib/engine/engine.ts` + tests
  - ✅ Replaced by: `src/lib/engine/periodization/generate-macro.ts`
  - ✅ Replaced by: `src/lib/engine/template-session.ts`

**When to delete:** As soon as `generateSessionFromTemplate()` in `template-session.ts` works end-to-end

**Verification:**
```bash
# After deletion, ensure:
npm run build  # Must succeed
npm test       # All tests pass
npm run lint   # No errors

# Search for orphaned imports
rg "from.*engine.ts" --type ts
# Should return: No matches
```

---

### Phase 2: Selection Optimization (Weeks 5-7)

**Replace:**
- ❌ Delete: `src/lib/engine/filtering.ts` + tests
  - ✅ Replaced by: `src/lib/engine/selection/optimizer.ts`
  - ✅ Replaced by: `src/lib/engine/selection/beam-search.ts`

- ❌ Delete: `src/lib/engine/split-queue.ts` (if not needed for history classification)
  - ✅ Replaced by: Block-based progression in `periodization/`

**When to delete:** As soon as new selection is integrated into `template-session.ts`

---

### Phase 3: Autoregulation (Weeks 8-10)

**No deletions** - This is new functionality, not replacing anything

---

### Phase 4: Explainability (Weeks 11-12)

**No deletions** - This is new functionality, not replacing anything

---

### Phase 5: Training Age Progression (Weeks 13-14)

**Replace:**
- ❌ Delete: Any remaining V1 progression logic (if exists)
  - ✅ Replaced by: `src/lib/engine/progression.ts` (training-age-aware)

**Final cleanup:**
- ❌ Delete: `docs/archive/` old specs (optional - can keep for reference)
- ❌ Delete: Any `_v1` / `_v2` suffixes in function names
- ❌ Delete: Dead imports, unused types

---

## Deletion Checklist (Per File)

Before deleting any file:

```markdown
- [ ] New replacement exists and is tested
- [ ] All routes/API handlers updated to use new code
- [ ] All imports updated (search codebase for old imports)
- [ ] Tests updated (no references to deleted functions)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] No TODO comments saying "replace with old system"
```

**Example:**

```bash
# Deleting src/lib/engine/engine.ts

# 1. Search for all imports
rg "from.*engine" --type ts
# Result: 3 files found

# 2. Update imports in those files
# Before: import { generateWorkout } from './engine'
# After:  import { generateSessionFromTemplate } from './template-session'

# 3. Delete file
rm src/lib/engine/engine.ts
rm src/lib/engine/engine.test.ts

# 4. Verify
npm run build && npm test

# 5. Commit
git add .
git commit -m "refactor: replace engine.ts with template-session.ts

- Deleted legacy generateWorkout (engine.ts)
- All routes now use generateSessionFromTemplate
- Tests updated and passing"
```

---

## Git Strategy

### Option A: Delete in Same PR (Recommended)

```bash
# Single atomic PR per replacement

git checkout -b refactor/replace-engine-with-periodization

# 1. Implement new system
# 2. Update all call sites
# 3. Delete old file
# 4. Commit everything together

git add .
git commit -m "refactor: replace engine.ts with periodization system

Added:
- src/lib/engine/periodization/generate-macro.ts
- src/lib/engine/template-session.ts
- Tests for block progression

Deleted:
- src/lib/engine/engine.ts (replaced by template-session.ts)

All routes updated, tests passing."
```

**Benefits:**
- Clean history
- No in-between state where both exist
- Easy to review (see old → new in one PR)

### Option B: Delete in Follow-up PR

```bash
# PR 1: Add new system (old still exists)
git commit -m "feat: add periodization system"

# PR 2: Cut over to new system
git commit -m "refactor: migrate to periodization system"

# PR 3: Delete old system
git commit -m "refactor: remove legacy engine.ts"
```

**Benefits:**
- Smaller PRs
- Can validate new system before deleting old

**Drawback:**
- Period where both exist (confusing, risk of using wrong one)

**Recommendation:** Use Option A (atomic replacement)

---

## Dead Code Detection

### Automated Tools

```bash
# Find unused exports
npx ts-prune | grep engine.ts

# Find unused imports
npx eslint --rule 'no-unused-vars: error'

# Find files not imported anywhere
npx unimported
```

### Manual Verification

```bash
# Before deleting a file, verify no references:

# 1. Check imports
rg "from ['\"].*engine" src/

# 2. Check dynamic imports
rg "import\(.*engine" src/

# 3. Check comments/docs
rg "engine\.ts" docs/

# 4. Check tests
rg "engine" src/**/*.test.ts
```

---

## What NOT to Delete (Keep These)

### Keep: Core Engine Utilities

✅ **Keep** (still used):
- `src/lib/engine/types.ts` - Core types (Exercise, Workout, etc.)
- `src/lib/engine/utils.ts` - Shared utilities (normalizeName, etc.)
- `src/lib/engine/random.ts` - Seeded PRNG for tests
- `src/lib/engine/rules.ts` - Rep ranges, rest periods
- `src/lib/engine/volume-landmarks.ts` - MEV/MAV/MRV data
- `src/lib/engine/sra.ts` - Recovery tracking
- `src/lib/engine/prescription.ts` - Set/rep prescription
- `src/lib/engine/apply-loads.ts` - Load assignment
- `src/lib/engine/warmup-ramp.ts` - Warmup sets
- `src/lib/engine/timeboxing.ts` - Duration estimation

### Delete: Replaced Modules

❌ **Delete**:
- `src/lib/engine/engine.ts` - Main generation (replaced by template-session.ts)
- `src/lib/engine/filtering.ts` - Exercise selection (replaced by selection/optimizer.ts)
- `src/lib/engine/split-queue.ts` - Split logic (replaced by block progression)
- `src/lib/api/split-preview.ts` - Old split preview API

### Maybe Delete: Review First

⚠️ **Review** (decide if still needed):
- `src/lib/engine/substitution.ts` - Template flexible mode (might still use)
- Any `sample-data.ts` test fixtures (update for new system or delete)

---

## CLAUDE.md Updates

As you delete files, update anti-patterns:

```markdown
# BEFORE (current CLAUDE.md)

### Anti-Patterns (Don't Do These)

- **Don't add DB/Prisma imports to `src/lib/engine/`**
- **Don't reset the split queue weekly**
- ~~**Don't use engine.ts for new features**~~ (OUTDATED - file doesn't exist anymore)

# AFTER (updated CLAUDE.md)

### Anti-Patterns (Don't Do These)

- **Don't add DB/Prisma imports to `src/lib/engine/`**
- **Don't bypass block context** - All workouts must be generated within a TrainingBlock
- **Don't create workouts without periodization context** - Use generateSessionFromTemplate
```

---

## Documentation Updates

### After Each Deletion

Update these docs:

1. **`docs/architecture.md`**
   ```markdown
   ## Module map (active runtime)

   | Module | Responsibility |
   |---|---|
   | ~~`engine.ts`~~ (DELETED) | ~~Workout generation~~ |
   | `template-session.ts` | Block-aware workout generation |
   | `periodization/generate-macro.ts` | Macro cycle creation |
   ...
   ```

2. **`docs/decisions.md`**
   ```markdown
   ## ADR-033: Removed legacy engine.ts (2026-02-18)

   **Decision:** Deleted `src/lib/engine/engine.ts` and replaced with periodization system.

   **Rationale:**
   - No users to migrate (pre-launch)
   - Periodization system is more sophisticated
   - Avoids dual-mode complexity

   **What was lost:** Nothing - all functionality replaced
   ```

3. **`CLAUDE.md`**
   - Update module references
   - Remove anti-patterns for deleted code
   - Add new patterns for periodization

---

## Rollback Plan (If Needed)

If you delete something and regret it:

```bash
# Git tracks everything - easy to restore

# Find the deletion commit
git log --all --oneline -- src/lib/engine/engine.ts

# Restore the file from that commit
git checkout <commit-hash>^ -- src/lib/engine/engine.ts

# Or restore entire commit
git revert <commit-hash>
```

**Better approach:** Don't delete until you're confident

**Validation before deletion:**
1. New system works end-to-end
2. All tests passing
3. Manual testing successful
4. Code reviewed and approved

---

## Timeline (Simplified)

| Week | Delete |
|------|--------|
| Week 1-2 | Nothing (building new system) |
| Week 3 | `engine.ts` (once template-session.ts works) |
| Week 4 | Final Phase 1 cleanup |
| Week 6 | `filtering.ts` (once selection/optimizer.ts works) |
| Week 7 | `split-queue.ts` (if not needed) |
| Week 14 | Final cleanup (dead imports, unused types, _v1/_v2 suffixes) |

**No hard deadline** - Delete when confident, not on a schedule

---

## Success Criteria

**Clean codebase = Zero legacy files remaining**

✅ `engine.ts` deleted
✅ `filtering.ts` deleted
✅ No `_v1` / `_v2` suffixes
✅ No feature flags
✅ No "TODO: migrate to new system" comments
✅ All imports point to new modules
✅ Documentation updated
✅ Tests passing

**Much simpler than user migration!**

---

## Quick Reference: "Should I Delete This?"

```
Is there a working replacement?
  ├─ NO  → Don't delete yet
  └─ YES → Is it tested?
      ├─ NO  → Don't delete yet
      └─ YES → Are all imports updated?
          ├─ NO  → Update imports first
          └─ YES → ✅ Safe to delete
```

---

**Owner:** You (solo developer)
**Enforcement:** Code review with yourself, CI checks
**Timeline:** Flexible - delete as you replace
