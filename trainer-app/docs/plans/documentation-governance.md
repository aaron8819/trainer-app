# Documentation Governance Plan

**Goal:** Keep documentation in sync with code throughout 14-week redesign
**Principle:** Docs are a deliverable, not an afterthought

---

## Documentation Types

### 1. **Specifications** (This Redesign)
- Location: `docs/plans/`
- Owner: PM + Engineering Lead
- Update: As design decisions change
- Lifecycle: Archive after Phase 5 completion

### 2. **Architecture Docs** (Source of Truth)
- Location: `docs/architecture.md`, `docs/data-model.md`
- Owner: Backend Lead
- Update: **REQUIRED** with every schema/engine change
- Lifecycle: Living documents

### 3. **API Reference** (Auto-generated preferred)
- Location: `docs/api/` (future) or inline JSDoc
- Owner: Backend engineers
- Update: With every route change
- Lifecycle: Living documents

### 4. **User Guides** (External-facing)
- Location: `docs/user-guides/` (future) or in-app
- Owner: PM + Frontend
- Update: When UX changes
- Lifecycle: Living documents

### 5. **CLAUDE.md** (AI Context)
- Location: `trainer-app/CLAUDE.md`
- Owner: Engineering Lead
- Update: When conventions change
- Lifecycle: Living document

### 6. **ADRs** (Decisions Log)
- Location: `docs/decisions.md`
- Owner: Engineering team (whoever makes decision)
- Update: When architectural decisions made
- Lifecycle: Append-only (never delete)

---

## Documentation Update Rules

### Rule 1: Code + Docs in Same PR

**Enforcement:**
```markdown
# PR Template (.github/pull_request_template.md)

## Checklist
- [ ] Code changes implemented
- [ ] Tests added/updated
- [ ] **Documentation updated** (architecture.md, data-model.md, or CLAUDE.md)
- [ ] ADR added if architectural decision made

## Documentation Changes
<!-- Describe what docs were updated and why -->

Required if:
- New schema tables/fields
- New API routes
- Changed engine behavior
- Deprecated old patterns
```

**Example:**
```markdown
# PR #123: Add TrainingBlock table

## Documentation Changes
✅ Updated `docs/data-model.md` - Added TrainingBlock schema
✅ Updated `docs/architecture.md` - Added block progression section
✅ Added ADR-032 - Why we use JSON for mainLifts field
✅ Updated `CLAUDE.md` - Removed reference to old engine.ts
```

### Rule 2: Documentation Debt is Tech Debt

**Treat as P1 bugs:**
- Docs contradicting code
- Broken doc links
- Outdated examples
- Missing ADRs for major decisions

**CI Check:**
```yaml
# .github/workflows/docs-check.yml

name: Documentation Check
on: [pull_request]

jobs:
  check-docs:
    runs-on: ubuntu-latest
    steps:
      # Check for broken internal links
      - name: Check markdown links
        run: |
          npm install -g markdown-link-check
          find docs/ -name "*.md" -exec markdown-link-check {} \;

      # Check for stale "Last verified" dates
      - name: Check architecture.md freshness
        run: |
          last_verified=$(grep "Last verified" docs/architecture.md | grep -oP "\d{4}-\d{2}-\d{2}")
          days_old=$(( ($(date +%s) - $(date -d "$last_verified" +%s)) / 86400 ))

          if [ "$days_old" -gt 30 ]; then
            echo "❌ architecture.md not verified in 30+ days"
            exit 1
          fi

      # Ensure ADRs are numbered sequentially
      - name: Check ADR numbering
        run: |
          # Extract ADR numbers from decisions.md
          # Verify sequential (no gaps)
          # (Implementation left as exercise)
```

### Rule 3: Phase Deliverables Include Docs

Each phase must deliver **code + tests + docs**:

| Phase | Code Deliverable | Documentation Deliverable |
|-------|------------------|---------------------------|
| Phase 1 | Macro/meso/block generation | ✅ Update `architecture.md` with periodization<br>✅ Update `data-model.md` with new tables<br>✅ Add ADRs for block progression decisions<br>✅ Update `CLAUDE.md` (remove engine.ts references) |
| Phase 2 | Multi-objective selection | ✅ Update `architecture.md` with selection algorithm<br>✅ Document selection weights in `plans/selection-optimization.md`<br>✅ Add ADR for beam search choice<br>✅ Create `docs/selection-guide.md` (how to tune) |
| Phase 3 | Autoregulation | ✅ Document Whoop integration in `integrations.md` (new)<br>✅ Update `architecture.md` with autoregulation flow<br>✅ Add ADRs for fatigue thresholds<br>✅ Create `docs/readiness-guide.md` (user-facing) |
| Phase 4 | Explainability | ✅ Update `architecture.md` with rationale generation<br>✅ Document KB citations in `knowledgebase/citations.md` (new)<br>✅ Update user guides with "Why this exercise?" |
| Phase 5 | Training age progression | ✅ Update `architecture.md` with detection algorithm<br>✅ Add ADRs for training age thresholds<br>✅ Update `CLAUDE.md` (final cleanup) |

---

## Documentation Workflow

### During Development

**Step 1: Update specs as you learn**
```bash
# If design decision changes during implementation:
git checkout docs/plans/periodization-system.md

# Update with actual implementation details
# Commit with code changes
git add docs/plans/periodization-system.md
git commit -m "feat: implement block progression (updated spec)"
```

**Step 2: Log decisions**
```markdown
# docs/decisions.md

## ADR-032: Use JSON for TrainingBlock.mainLifts (2026-02-15)

**Decision:** Store main lifts as `{ squat: "barbell_back_squat", ... }` JSON instead of separate table.

**Rationale:**
- Only 3-4 main lifts per block (small dataset)
- Schema flexibility (users may customize in future)
- Avoids join complexity in queries

**Alternatives Considered:**
- Separate `BlockMainLift` table (rejected: over-engineering)
- Array of exercise IDs (rejected: lose semantic labeling)
```

**Step 3: Update architecture docs**
```markdown
# docs/architecture.md

## Current runtime scope

- Active generation endpoints:
  - `POST /api/workouts/generate-from-template` (NEW: uses block context)
  - `POST /api/workouts/generate-from-intent` (NEW: uses block context)
- **DEPRECATED:** `POST /api/workouts/generate` (removed Week 14)

## Block Progression (NEW)

Workouts now generated within TrainingBlock context:
- Week 1: RIR 4, baseline volume
- Week 2: RIR 3.25, +10% volume
- Week 3: RIR 2.5, +20% volume
- Week 4: RIR 1.75, +30% volume
- Week 5: Deload (RIR 5, -50% volume)

Last verified against code: 2026-02-15
```

### End of Each Phase

**Documentation Review Checklist:**

```markdown
## Phase X Documentation Sign-Off

- [ ] `docs/architecture.md` updated with new behavior
- [ ] `docs/data-model.md` updated with schema changes
- [ ] ADRs logged for all major decisions (minimum 2-3 per phase)
- [ ] `CLAUDE.md` updated (patterns changed, anti-patterns added)
- [ ] Specs in `docs/plans/` reflect actual implementation (not original design)
- [ ] All doc links working (run markdown-link-check)
- [ ] "Last verified" date updated
- [ ] User-facing guides created (if UX changes)
```

**Review Responsible:** Engineering Lead
**Blocking:** Cannot proceed to next phase until docs signed off

---

## New Documentation to Create

### Immediate (Phase 1)

**1. `docs/integrations.md`** - External service integrations
```markdown
# External Integrations

## Whoop
- OAuth setup
- API endpoints used
- Token refresh flow
- Error handling

## (Future) Oura, Garmin, etc.
```

**2. `docs/src-lib-reference.md`** - UPDATE existing
```markdown
# src/lib Reference

## /engine (Pure computation, no DB)
- `periodization/` - Macro/meso/block generation
- `selection/` - Multi-objective exercise selection
- `readiness/` - Fatigue computation
- `rotation/` - Exercise rotation logic
...
```

**3. `docs/migration-history.md`** - NEW
```markdown
# Migration History

## 2026-02-14: Periodization System
- Added MacroCycle, Mesocycle, TrainingBlock tables
- Backfilled existing users
- Migration time: 4m 23s
- Issues: None
```

### Short-term (Phase 2-3)

**4. `docs/selection-tuning-guide.md`** - For future weight adjustments
```markdown
# Selection Weight Tuning

Current weights (as of 2026-02-21):
- volumeDeficitFill: 0.30
- sfrEfficiency: 0.20
- lengthenedBias: 0.15
...

How to tune:
1. Generate 50 sample workouts
2. Manually score quality (1-5)
3. Identify patterns in low-scoring workouts
4. Adjust weights incrementally (±0.05)
5. Re-test
```

**5. `docs/knowledgebase/citations.md`** - KB reference index
```markdown
# Knowledge Base Citations

## Lengthened Position Training

### Triceps
- **Maeo et al. 2023:** Overhead extensions → 40% more growth than pushdowns
- Study: https://pubmed.ncbi.nlm.nih.gov/36943275/
- Application: Prioritize overhead variations in selection

### Calves
- **Kassiano et al. 2023:** Lengthened partials → 15.2% vs 6.7% full ROM
- Study: https://pubmed.ncbi.nlm.nih.gov/37119445/
- Application: Emphasize deep stretch at bottom of calf raises

...
```

### Long-term (Phase 4-5)

**6. `docs/user-guides/`** - User-facing documentation (in-app or help site)
```markdown
# Why Am I Doing This Exercise?

Your workouts are based on peer-reviewed research...

[Screenshots of explainability panel]

Learn more: [Link to knowledge base]
```

---

## Automated Documentation Tools

### 1. API Documentation (Future)

```typescript
// Use TSDoc for auto-generated API docs

/**
 * Generates a macro cycle for a user based on training age and goals.
 *
 * @param userId - User ID
 * @returns MacroCycle with 3-4 mesocycles
 *
 * @example
 * ```ts
 * const macro = await createMacroCycleForUser('user-123')
 * console.log(macro.mesocycles.length) // 3
 * ```
 *
 * @see docs/periodization-system.md for algorithm details
 */
export async function createMacroCycleForUser(userId: string): Promise<MacroCycle>
```

```bash
# Generate API docs
npx typedoc --out docs/api src/lib/api/
```

### 2. Schema Documentation

```bash
# Auto-generate schema reference from Prisma
npx prisma-docs-generator

# Output: docs/schema.html
```

### 3. Stale Documentation Detection

```typescript
// scripts/check-stale-docs.ts

import { execSync } from 'child_process'

const DOCS_TO_CHECK = [
  'docs/architecture.md',
  'docs/data-model.md',
  'docs/src-lib-reference.md',
]

for (const doc of DOCS_TO_CHECK) {
  // Get last modified date
  const lastModified = execSync(`git log -1 --format=%cd --date=short ${doc}`)
    .toString()
    .trim()

  const daysOld = Math.floor(
    (Date.now() - new Date(lastModified).getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysOld > 30) {
    console.warn(`⚠️  ${doc} not updated in ${daysOld} days`)
  }
}
```

---

## Documentation Metrics

**Track:**
- Days since last architecture.md update (goal: < 7 days)
- Number of broken internal doc links (goal: 0)
- ADR count per phase (goal: 2-3 minimum)
- User guide coverage (goal: 100% of user-facing features)

**Review Cadence:**
- Weekly: Check for stale docs (in standup)
- End of phase: Full documentation audit
- Post-launch: User guide completeness review

---

## Archive Strategy

### What to Archive (End of Phase 5)

Move to `docs/archive/redesign-2026/`:
- All `docs/plans/*.md` (specs)
- Phase-specific implementation notes
- Migration scripts (keep for reference)

### What to Keep Active

- `docs/architecture.md` (updated with new system)
- `docs/data-model.md` (current schema)
- `docs/decisions.md` (all ADRs, append-only)
- `docs/knowledgebase/` (research never stale)
- `CLAUDE.md` (updated with new patterns)

---

## Documentation Ownership

| Document | Primary Owner | Update Trigger |
|----------|---------------|----------------|
| `architecture.md` | Backend Lead | Schema/engine change |
| `data-model.md` | Backend Lead | Prisma schema change |
| `decisions.md` | Decision maker | Architectural decision |
| `CLAUDE.md` | Engineering Lead | Convention change |
| `plans/*.md` | PM + Engineers | Design iteration |
| `knowledgebase/` | PM | New research published |
| User guides | PM + Frontend | UX change |

---

## Success Criteria

**Documentation is healthy when:**

✅ No broken internal links
✅ "Last verified" dates < 30 days old
✅ Every schema change has corresponding data-model.md update
✅ Every architectural decision has ADR
✅ No "TODO" or "TBD" in architecture docs
✅ Code reviewers can verify docs updated in PR

**Owner:** Engineering Lead
**Enforcement:** PR template + CI checks + phase gates
