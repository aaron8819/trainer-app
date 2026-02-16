# Phase 4: Explainability System - Implementation Plan

**Status:** Ready for Execution
**Estimated Duration:** 12-14 days (6 sub-phases × 2-3 days each)
**Created:** 2026-02-16
**Strategy:** Clean cutover with incremental delivery

---

## Context

**Problem:** The Trainer app generates intelligent workouts using periodization, multi-objective selection, and autoregulation—but users don't understand *why* specific exercises, sets, reps, or loads were chosen. This "black box" experience limits trust and educational value.

**Solution:** Phase 4 adds transparent, coach-like explanations at three levels:
1. **Session context** - "Why this workout today?" (block phase, volume status, readiness, progression)
2. **Exercise rationale** - "Why these exercises?" (selection factors, research citations, alternatives)
3. **Prescription rationale** - "Why these sets/reps/loads?" (periodization, progression, training age)

**Evidence:** Research shows that explainable AI increases user trust, adherence, and learning. KB citations (Maeo 2023, Pedrosa 2023, etc.) provide scientific backing for exercise selection.

**Current State:**
- ✅ MVP string-based rationale exists (`selection-v2/rationale.ts`)
- ✅ UI parsing utilities exist (`lib/ui/explainability.ts`)
- ✅ Workout display page has basic "Why" section
- ✅ Autoregulation already generates fatigue explanations
- 🔨 Need: Session context, KB citations, coach messages, prescription rationale, enhanced UI

---

## Architecture Overview

### New Module Structure

```
src/lib/engine/explainability/         # Pure engine layer (no DB/I/O)
├── index.ts                           # Barrel exports
├── types.ts                           # WorkoutExplanation, ExerciseRationale, etc.
├── session-context.ts                 # Block phase, volume, readiness explanation
├── exercise-rationale.ts              # Per-exercise selection factors + KB citations
├── prescription-rationale.ts          # Sets/reps/load/RIR/rest explanation
├── coach-messages.ts                  # Encouragement, warnings, milestones
├── knowledge-base.ts                  # Citation database (Maeo, Pedrosa, etc.)
└── utils.ts                           # Formatting helpers

src/lib/api/
└── explainability.ts                  # API orchestration (DB → engine types)

src/app/api/workouts/[id]/explanation/
└── route.ts                           # GET endpoint for workout explanation

src/components/explainability/         # React UI components
├── ExplainabilityPanel.tsx
├── SessionContextCard.tsx
├── CoachMessageCard.tsx
├── ExerciseRationaleCard.tsx
└── PrescriptionDetails.tsx
```

---

## Implementation Phases

### Phase 4.1: Foundation & Types (Days 1-2)

**Goal:** Define type system, build knowledge base, create utilities.

**Deliverables:**
1. **Types module** (`explainability/types.ts`)
2. **Knowledge base** (`explainability/knowledge-base.ts`) - 10-15 core citations from KB report
3. **Utilities** (`explainability/utils.ts`)

**Tests:** 15+ tests

**Phase 4.1 Completion Checklist:**
- [ ] All tests passing (15+ new tests)
- [ ] Build/lint/tsc clean
- [ ] Documentation updated:
  - [ ] ADR-049: "Phase 4.1: Explainability foundation and KB citation database"
  - [ ] `docs/architecture.md`: Add "Explainability System" section
  - [ ] `docs/index.md`: Add link to phase4-explainability-execution.md
- [ ] Commit: `feat(phase4.1): explainability foundation - types, KB citations, utilities`

---

### Phase 4.2: Session Context Explanation (Days 3-4)

**Goal:** Generate macro-level "Why this workout today?" explanation.

**Deliverables:**
1. **Session context module** (`explainability/session-context.ts`)
   - `explainSessionContext()`, `describeBlockGoal()`, `describeVolumeProgress()`, etc.

**Tests:** 20+ tests

**Phase 4.2 Completion Checklist:**
- [x] All tests passing (84 cumulative: 59 existing + 25 new)
- [x] Build/lint/tsc clean
- [x] Documentation updated:
  - [x] ADR-050: "Phase 4.2: Session context explanation with block-aware narrative"
  - [x] `docs/architecture.md`: Add session context flow diagram
- [x] Commit: `feat(phase4.2): session context explanation - block phase, volume, readiness`

---

### Phase 4.3: Exercise Rationale & KB Citations (Days 5-7)

**Goal:** Generate per-exercise rationale with research-backed citations.

**Deliverables:**
1. **Exercise rationale module** (`explainability/exercise-rationale.ts`)
2. **Enhanced KB matching** (`knowledge-base.ts`)

**Tests:** 25+ tests

**Phase 4.3 Completion Checklist:**
- [x] All tests passing (741 cumulative, 23 new for exercise-rationale)
- [x] Build/lint/tsc clean
- [x] Documentation updated:
  - [x] ADR-051: "Phase 4.3: Exercise rationale with KB citations and alternatives"
  - [x] `docs/architecture.md`: Add exercise rationale flow + KB citation mapping table
  - [x] ~~`docs/seeded-data.md`~~: KB citation mapping table added to architecture.md instead (seeded-data.md doesn't exist yet)
- [x] Legacy cleanup:
  - [x] Evaluated: `selection-v2/rationale.ts` coexists for backward compatibility
  - [x] Clean cutover deferred to Phase 4.6 (no breaking changes now)
- [x] Commit: `feat(phase4.3): exercise rationale with KB citations - Maeo, Pedrosa, Kassiano`

---

### Phase 4.4: Prescription Rationale (Days 8-9)

**Goal:** Explain why specific sets/reps/load/RIR/rest were prescribed.

**Deliverables:**
1. **Prescription rationale module** (`explainability/prescription-rationale.ts`)

**Tests:** 41 tests (✅ Complete)

**Phase 4.4 Completion Checklist:**
- [x] All tests passing (148 cumulative, 41 new)
- [x] Build/lint/tsc clean (pre-existing errors unrelated to this phase)
- [x] Documentation updated:
  - [x] ADR-053: "Phase 4.4: Prescription rationale - sets/reps/load/RIR/rest"
  - [x] `docs/architecture.md`: Add prescription rationale integration
- [x] Commit: `feat(phase4.4): prescription rationale - explain sets/reps/load/RIR/rest` (25e491c)

---

### Phase 4.5: Coach Messages & API Integration (Days 10-11)

**Goal:** Generate coach-like messages and build API orchestration.

**Deliverables:**
1. **Coach messages module** (`explainability/coach-messages.ts`)
2. **API orchestration** (`lib/api/explainability.ts`)
3. **API route** (`app/api/workouts/[id]/explanation/route.ts`)

**Tests:** 25+ tests

**Phase 4.5 Completion Checklist:**
- [ ] All tests passing (105+ cumulative)
- [ ] Build/lint/tsc clean
- [ ] API endpoint functional: `GET /api/workouts/[id]/explanation`
- [ ] Documentation updated:
  - [ ] ADR-053: "Phase 4.5: Coach messages and API orchestration"
  - [ ] `docs/architecture.md`: Add API integration flow diagram
  - [ ] `docs/data-model.md`: Note on-demand generation (no new DB fields)
- [ ] Commit: `feat(phase4.5): coach messages and API endpoint - complete pipeline`

---

### Phase 4.6: UI Components & Migration (Days 12-14)

**Goal:** Build React components and migrate workout display page.

**Deliverables:**
1. **React components** (ExplainabilityPanel, SessionContextCard, etc.)
2. **Workout page migration** (`app/workout/[id]/page.tsx`)
3. **E2E tests**

**Phase 4.6 Completion Checklist:**
- [ ] All tests passing (130+ cumulative, including E2E)
- [ ] Build/lint/tsc clean
- [ ] Manual QA passed (see below)
- [ ] Documentation updated:
  - [ ] ADR-054: "Phase 4.6: ExplainabilityPanel UI and workout page migration"
  - [ ] `docs/architecture.md`: Add UI component architecture
  - [ ] `docs/plans/redesign-overview.md`: Mark Phase 4 complete
- [ ] **Legacy cleanup (CRITICAL):**
  - [ ] Remove old "Why" section from `workout/[id]/page.tsx` (lines 414-468)
  - [ ] Remove old decision summary code (lines 446-466)
  - [ ] Verify no dead code references
  - [ ] Simplify `lib/ui/explainability.ts` if old parsing functions obsolete
  - [ ] Update tests to use ExplainabilityPanel
- [ ] Commit: `feat(phase4.6): ExplainabilityPanel UI - clean cutover from legacy`

**Manual QA Checklist:**
- [ ] Session context displays correctly
- [ ] KB citations appear for lengthened exercises
- [ ] Coach messages show for PRs/low readiness
- [ ] Prescription rationale explains sets/reps/load/RIR
- [ ] Collapsible sections work smoothly
- [ ] Mobile responsive
- [ ] Citation links open in new tab
- [ ] No regressions
- [ ] Old "Why" section completely removed

---

## Knowledge Base Starter Citations (10-15 studies)

From `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`:

**Lengthened Position:**
1. Maeo et al. 2023 - Overhead triceps extensions (+40% growth vs pushdowns)
2. Pedrosa et al. 2022 - Lengthened partial leg extensions (~2× quad hypertrophy)
3. Wolf et al. 2023 - Lengthened-position meta-analysis

**Volume:**
4. Schoenfeld, Ogborn & Krieger 2017 - Volume dose-response (0.37%/set)
5. Pelland et al. 2024 - Bayesian meta-analysis confirming volume

**Proximity to Failure:**
6. Robinson et al. 2024 - Proximity to failure dose-response
7. Refalo et al. 2023/2024 - 0 RIR vs 1-2 RIR similar hypertrophy

**Rest & Periodization:**
8. Schoenfeld et al. 2016 - 3 min > 1 min for strength/hypertrophy
9. Rhea & Alderman 2004 - Periodization superior (ES = 0.84)

**Exercise Selection:**
10. Haugen et al. 2023 - Free weights vs machines (no difference)

---

## Success Metrics

**Functional:**
- ✅ All 6 sub-phases complete
- ✅ API endpoint returns complete explanation
- ✅ ExplainabilityPanel renders with all sections
- ✅ KB citations display
- ✅ Legacy "Why" section removed (clean cutover)

**Technical:**
- ✅ 130+ tests passing (60+ new)
- ✅ 90%+ engine coverage
- ✅ No Prisma in `src/lib/engine/explainability/`
- ✅ Build/lint/tsc clean

**Documentation:**
- ✅ 6 ADRs (049-054)
- ✅ architecture.md updated
- ✅ redesign-overview.md updated

---

## Session Handoff Prompt

```
Continue Phase 4 (Explainability) implementation. Current phase: [4.X].

Reference: docs/plans/phase4-explainability-execution.md

Last completed: [brief status]

Next steps:
1. [Next deliverable from plan]
2. Run tests after each module
3. Update docs per phase checklist
4. Clean up legacy code in phase 4.6

Key reminders:
- No Prisma imports in engine/explainability/
- Update architecture.md + ADR after each phase
- Clean cutover: remove old "Why" section in 4.6
```

---

**Timeline:** 12-14 days | **Tests:** 130+ (60+ new) | **ADRs:** 6 (049-054)