# Implementation Phases: 14-Week Execution Plan

**Project:** Training System Redesign
**Duration:** 14 weeks (Q2 2026) - ORIGINAL PLAN
**Team:** Engine + API + UI + QA
**Status:** ARCHIVED - Superseded by actual implementation (see redesign-overview.md)

> **NOTE:** This document represents the ORIGINAL 14-week phased rollout plan.
> Actual implementation took 2 days (2026-02-14 to 2026-02-15) with clean cutover instead of dual-mode operation.
> See [redesign-overview.md](./redesign-overview.md) for actual progress, completion dates, and metrics.

---

## Overview

This document provides a detailed week-by-week execution plan for implementing the periodization-first training system redesign across 5 phases.

**Delivery Strategy (ORIGINAL PLAN - NOT EXECUTED):** Incremental releases with feature flags, alpha/beta/GA rollout, backward compatibility maintained until Phase 5.

---

## Phase Breakdown

| Phase | Duration | Focus | Deliverables |
|-------|----------|-------|--------------|
| Phase 1 | Weeks 1-4 | Periodization Foundation | Macro/meso/block schema, generation engine, migration script |
| Phase 2 | Weeks 5-7 | Selection Intelligence | Multi-objective selection, rotation strategy, indirect volume |
| Phase 3 | Weeks 8-10 | Autoregulation | Whoop integration, readiness assessment, stall interventions |
| Phase 4 | Weeks 11-12 | Explainability | Rationale generation, coach messages, KB citations |
| Phase 5 | Weeks 13-14 | Training Age Progression | Auto-detection, scheme adaptation, launch prep |

---

## Phase 1: Periodization Foundation (Weeks 1-4)

### Week 1: Schema Design & Migration Prep

**Goals:**
- Finalize schema design
- Create migration scripts
- Set up dual-mode architecture

**Tasks:**

**Day 1-2: Schema Review**
- [ ] Review `data-model-changes.md` with team
- [ ] Validate JSON structure for `mainLifts`, `accessoryPool`, `rotationPolicy`
- [ ] Confirm JSONB performance implications
- [ ] Design dual-mode flag system

**Day 3-4: Migration Scripts**
- [ ] Write `20260214_add_periodization` migration
- [ ] Write `20260214_extend_workout` migration
- [ ] Write backfill script (`backfill-periodization.ts`)
- [ ] Write validation script (`validate-migration.ts`)

**Day 5: Testing**
- [ ] Dry-run on staging DB
- [ ] Validate backfill with 10 test users
- [ ] Measure migration time (target: < 5 min for 10k users)

**Deliverables:**
- ✅ Schema PR with migrations
- ✅ Backfill script (tested)
- ✅ Validation script

---

### Week 2: Macro Cycle Generation

**Goals:**
- Implement macro/meso/block generation engine
- Wire into API layer
- Basic UI display

**Tasks:**

**Day 1-2: Engine Implementation**
- [ ] Implement `generate-macro.ts` (see `periodization-system.md`)
- [ ] Implement `buildMesocycles()` and `buildBlocksForMeso()`
- [ ] Unit tests for all block progression types (beginner/intermediate/advanced)
- [ ] Test mesocycle transitions

**Day 3-4: API Layer**
- [ ] Create `src/lib/api/periodization.ts`
- [ ] Implement `createMacroCycleForUser()`
- [ ] Create route `POST /api/periodization/macro`
- [ ] Add training age assessment (`assessTrainingAge()`)

**Day 5: UI Component**
- [ ] Create `BlockContextBanner.tsx`
- [ ] Display "Week X of [Block Type]" on workout page
- [ ] Show volume/intensity targets

**Deliverables:**
- ✅ Macro generation engine (95% test coverage)
- ✅ API + route
- ✅ Basic UI display

---

### Week 3: Block-Aware Prescription

**Goals:**
- Integrate block context into set/rep/RIR prescription
- Update workout generation to use block progression
- Testing across block types

**Tasks:**

**Day 1-2: Prescription Engine**
- [ ] Implement `prescribeWithBlockContext()`
- [ ] RIR interpolation across weeks (`lerp(rirStart, rirEnd, progress)`)
- [ ] Volume ramp application (`sets * weeklyVolumeRamp^weekInBlock`)
- [ ] Rep range derivation from `intensityBias`

**Day 3: Integration**
- [ ] Update `generateSessionFromTemplate()` to accept block context
- [ ] Modify existing template generation to query active block
- [ ] Wire block context into load assignment

**Day 4-5: Testing**
- [ ] Integration tests: full block progression (accumulation → deload)
- [ ] Verify RIR ramps correctly (4 → 1 over 4 weeks)
- [ ] Verify volume increases (baseline → +10% → +20% → +30%)
- [ ] Edge case: incomplete blocks, block transitions

**Deliverables:**
- ✅ Block-aware prescription
- ✅ Updated template generation
- ✅ Integration tests passing

---

### Week 4: Migration & Alpha Launch

**Goals:**
- Run production migration
- Launch alpha to internal team
- Monitoring + feedback

**Tasks:**

**Day 1-2: Migration Execution**
- [ ] Backup production DB
- [ ] Run migration on production
- [ ] Execute backfill script
- [ ] Run validation script
- [ ] Monitor for errors (24-hour watch)

**Day 3: Alpha Onboarding**
- [ ] Create 5 test accounts (beginner/intermediate/advanced)
- [ ] Generate macros for each
- [ ] Document alpha test plan
- [ ] Distribute to team

**Day 4-5: Feedback & Iteration**
- [ ] Collect alpha feedback
- [ ] Fix critical bugs
- [ ] Tune block durations/progression
- [ ] Performance profiling (DB query times)

**Deliverables:**
- ✅ Production migration complete
- ✅ Alpha running (5 users)
- ✅ Feedback log

**Phase 1 Gate:**
- All tests passing
- Alpha users can generate/complete workouts
- No data corruption

---

## Phase 2: Selection Intelligence (Weeks 5-7)

### Week 5: Multi-Objective Selection

**Goals:**
- Implement beam search selection
- Indirect volume accounting
- Scoring functions

**Tasks:**

**Day 1-2: Core Algorithm**
- [ ] Implement `buildCandidate()` with scoring
- [ ] Implement `scoreDeficitFill()` with indirect volume
- [ ] Implement `scoreSraAlignment()`, `scoreRotationNovelty()`, etc.
- [ ] Unit tests for each scoring function

**Day 3-4: Beam Search**
- [ ] Implement `beamSearchSelection()`
- [ ] Constraint satisfaction checks
- [ ] Pareto-optimality detection (for explainability)
- [ ] Performance testing (target: < 100ms)

**Day 5: Integration**
- [ ] Replace `selectExercises()` call in template/intent generation
- [ ] Build `SelectionObjective` from workout context
- [ ] Integration test: selection satisfies all constraints

**Deliverables:**
- ✅ Multi-objective selection engine
- ✅ Integrated into generation flow
- ✅ Performance < 100ms

---

### Week 6: Exercise Rotation Strategy

**Goals:**
- Implement rotation memory
- Performance trend tracking
- Variation substitution

**Tasks:**

**Day 1-2: ExerciseExposure Logic**
- [ ] Implement `updateExerciseExposure()` (post-workout hook)
- [ ] Implement `assessPerformanceTrend()` (linear regression)
- [ ] Update exposure on every completed workout
- [ ] Backfill existing exposure data

**Day 3: Rotation Selection**
- [ ] Implement `selectWithRotation()` for each classification
- [ ] Core movements: maintain or rotate on stall
- [ ] Primary accessories: 4-week cadence
- [ ] Secondary accessories: 2-week cadence with novelty ratio

**Day 4-5: Variation Database**
- [ ] Build `EXERCISE_VARIATIONS` array (squat/bench/deadlift variations)
- [ ] Implement `suggestVariation()` (stall/pain/novelty)
- [ ] UI notification component for rotations

**Deliverables:**
- ✅ Exercise rotation working
- ✅ Variation suggestions
- ✅ UI notifications

---

### Week 7: Testing & Tuning

**Goals:**
- End-to-end testing of Phase 2
- Tune selection weights
- Beta launch prep

**Tasks:**

**Day 1-2: Integration Testing**
- [ ] Test: selection fills volume deficits efficiently
- [ ] Test: no front delt accessories after heavy bench
- [ ] Test: exercises rotate every 3-4 weeks
- [ ] Test: stalled exercises trigger variation swap

**Day 3: Weight Tuning**
- [ ] Generate 50 sample workouts
- [ ] Manually review for quality
- [ ] Adjust `objective.weights` based on outcomes
- [ ] Re-test with new weights

**Day 4-5: Beta Preparation**
- [ ] Create beta user docs
- [ ] Set up beta feedback form
- [ ] Prepare 50 beta invites
- [ ] Feature flag setup

**Deliverables:**
- ✅ Phase 2 integration tests passing
- ✅ Weights tuned
- ✅ Beta ready

**Phase 2 Gate:**
- Selection quality verified manually
- Rotation working correctly
- Performance acceptable

---

## Phase 3: Autoregulation (Weeks 8-10)

### Week 8: Readiness Assessment

**Goals:**
- Whoop OAuth integration
- Readiness signal collection
- Fatigue score computation

**Tasks:**

**Day 1-2: Whoop Integration**
- [ ] Register Whoop OAuth app
- [ ] Implement `fetchWhoopRecovery()`
- [ ] Implement token refresh flow
- [ ] Create `UserIntegration` table
- [ ] Connection UI (OAuth flow)

**Day 3: Readiness Collection**
- [ ] Create `ReadinessCheckIn.tsx` component
- [ ] Subjective inputs: readiness, motivation, soreness
- [ ] Route: `POST /api/readiness/submit`
- [ ] Persist `ReadinessSignal`

**Day 4-5: Fatigue Scoring**
- [ ] Implement `computeFatigueScore()`
- [ ] Whoop + subjective + performance weighting
- [ ] Per-muscle fatigue from soreness
- [ ] Unit tests for all signal types

**Deliverables:**
- ✅ Whoop connected (for willing users)
- ✅ Readiness check-in working
- ✅ Fatigue score computed

---

### Week 9: Workout Autoregulation

**Goals:**
- Auto-scale intensity based on fatigue
- Deload triggering
- Stall detection

**Tasks:**

**Day 1-2: Autoregulation Logic**
- [ ] Implement `autoregulateWorkout()`
- [ ] Scale down: 90% load, +1 RIR
- [ ] Reduce volume: drop 1-2 sets
- [ ] Trigger deload: 50% volume, 60% load
- [ ] Unit tests for all actions

**Day 3: Stall Detection**
- [ ] Implement `detectStalls()`
- [ ] Count weeks without progress (PR tracking)
- [ ] Implement `suggestIntervention()` (escalation ladder)
- [ ] Unit tests: microload → deload → variation → reset

**Day 4-5: Integration**
- [ ] Wire autoregulation into generation flow
- [ ] Apply before returning workout
- [ ] Persist `autoregulationLog` to Workout
- [ ] UI: show "Workout auto-scaled" message

**Deliverables:**
- ✅ Autoregulation working
- ✅ Stall interventions implemented
- ✅ UI messages

---

### Week 10: Testing & Refinement

**Goals:**
- Validate autoregulation accuracy
- Tune thresholds
- User testing

**Tasks:**

**Day 1-2: Algorithm Validation**
- [ ] Simulate 100 workout scenarios (high/low fatigue)
- [ ] Verify autoregulation triggers appropriately
- [ ] Check for false positives (over-deloading)
- [ ] Tune thresholds (conservative/moderate/aggressive)

**Day 3: User Testing**
- [ ] 10 beta users with Whoop
- [ ] Collect subjective feedback on auto-scaling
- [ ] Survey: "Did today's workout feel right?"
- [ ] Iterate based on feedback

**Day 4-5: Edge Cases**
- [ ] Test: user overrides auto-scale
- [ ] Test: Whoop disconnects mid-week
- [ ] Test: persistent stall across 8 weeks
- [ ] Test: conflicting signals (Whoop high, subjective low)

**Deliverables:**
- ✅ Autoregulation validated
- ✅ User feedback positive (80%+)
- ✅ Edge cases handled

**Phase 3 Gate:**
- Autoregulation improves user experience
- No regressions in workout quality
- Whoop integration stable

---

## Phase 4: Explainability (Weeks 11-12)

### Week 11: Rationale Generation

**Goals:**
- Implement all explainability functions
- Build KB citation database
- Testing

**Tasks:**

**Day 1-2: Session Context**
- [ ] Implement `explainSessionContext()`
- [ ] Block goal descriptions
- [ ] Volume progress summaries
- [ ] Readiness assessments
- [ ] Progression narratives

**Day 3: Exercise Rationale**
- [ ] Implement `explainExerciseSelection()`
- [ ] Format reasons (deficit fill, lengthened bias, etc.)
- [ ] Extract KB citations (Maeo 2023, Kassiano 2023, etc.)
- [ ] Build citation database (map exercises → studies)

**Day 4-5: Prescription Rationale**
- [ ] Implement `explainPrescription()`
- [ ] Explain sets, reps, load, RIR, rest
- [ ] Coach message generation
- [ ] Unit tests for all generators

**Deliverables:**
- ✅ All rationale generators implemented
- ✅ KB citation database complete
- ✅ Unit tests passing

---

### Week 12: UI Integration & Polish

**Goals:**
- Build explainability UI components
- User testing
- Final polish

**Tasks:**

**Day 1-2: UI Components**
- [ ] Create `ExplainabilityPanel.tsx`
- [ ] Session context display
- [ ] Per-exercise rationale cards
- [ ] Coach message cards
- [ ] KB citation modals (with links)

**Day 3: Integration**
- [ ] Wire rationale into workout generation
- [ ] Persist to `selectionRationale` field
- [ ] Display on workout page
- [ ] Mobile optimization

**Day 4-5: User Testing**
- [ ] 20 users test explainability feature
- [ ] Survey: "Do you understand why you're doing each exercise?"
- [ ] Target: 90%+ comprehension
- [ ] Iterate messaging based on feedback

**Deliverables:**
- ✅ Explainability UI complete
- ✅ User comprehension >90%
- ✅ Mobile-optimized

**Phase 4 Gate:**
- Users understand workout rationale
- KB citations accurate
- No performance issues

---

## Phase 5: Training Age Progression & Launch (Weeks 13-14)

### Week 13: Training Age System

**Goals:**
- Auto-detect training age transitions
- Adapt progression schemes
- Milestone communication

**Tasks:**

**Day 1-2: Detection Algorithm**
- [ ] Implement `assessTrainingAge()`
- [ ] Analyze progression rate (session/week/month)
- [ ] Analyze consistency (completion rate)
- [ ] Detect transitions (beginner → intermediate → advanced)

**Day 3: Progression Adaptation**
- [ ] Update `computeNextLoad()` to dispatch by training age
- [ ] Beginner: linear progression
- [ ] Intermediate: double progression
- [ ] Advanced: block periodized + APRE
- [ ] Unit tests for all schemes

**Day 4-5: Milestone Communication**
- [ ] Detect training age transitions
- [ ] Generate milestone message ("Congrats! You're now intermediate")
- [ ] Update user profile automatically
- [ ] UI notification

**Deliverables:**
- ✅ Training age detection
- ✅ Progression schemes adapted
- ✅ Milestones communicated

---

### Week 14: Launch Preparation & GA

**Goals:**
- Final QA
- Performance optimization
- General availability launch

**Tasks:**

**Day 1: Final QA**
- [ ] Run full regression test suite
- [ ] Load testing (100 concurrent users)
- [ ] DB query performance audit
- [ ] Security review (OAuth tokens, user data)

**Day 2: Documentation**
- [ ] Update user-facing docs
- [ ] Create "What's New" announcement
- [ ] Record demo video
- [ ] Update FAQ

**Day 3: Migration Plan**
- [ ] Migrate all beta users to new system
- [ ] Verify no data loss
- [ ] Automated migration script for remaining users
- [ ] Rollback plan documented

**Day 4: Launch**
- [ ] Deploy to production
- [ ] Enable feature flags for all users
- [ ] Monitor error rates (target: < 0.1%)
- [ ] Monitor performance (p95 < 500ms)

**Day 5: Post-Launch**
- [ ] Support monitoring (first 48 hours)
- [ ] Hot-fix any critical bugs
- [ ] Collect user feedback
- [ ] Celebrate! 🎉

**Deliverables:**
- ✅ GA launch complete
- ✅ All users migrated
- ✅ Error rate < 0.1%
- ✅ Positive user feedback

**Phase 5 Gate:**
- Zero critical bugs
- Performance acceptable
- User satisfaction high

---

## Resource Allocation

### Team Composition

| Role | Allocation | Responsibilities |
|------|-----------|------------------|
| **Backend Engineer** (2) | Full-time | Schema, engine, API, migrations |
| **Frontend Engineer** (1) | Full-time | UI components, mobile optimization |
| **QA Engineer** (1) | 50% | Testing, validation, user testing coordination |
| **Product Manager** (1) | 25% | Requirements, user feedback, launch coordination |

### Weekly Capacity

- **Backend:** 80 hours/week (2 engineers)
- **Frontend:** 40 hours/week (1 engineer)
- **QA:** 20 hours/week (0.5 engineer)
- **PM:** 10 hours/week (0.25 PM)

**Total:** 150 hours/week × 14 weeks = 2,100 hours

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Migration data corruption | Low | Critical | Dual-mode, backups, validation script | Backend |
| Whoop API rate limits | Medium | Medium | Cache responses, graceful degradation | Backend |
| Selection performance < 100ms | Low | High | Benchmark early, optimize solver | Backend |
| User confusion with new concepts | High | Medium | Explainability first, onboarding flow | PM + Frontend |
| Beta users churn | Medium | Low | Clear communication, manual support | PM |
| Training age detection inaccurate | Medium | Medium | Conservative thresholds, manual override | Backend |
| Scope creep | Medium | High | Strict phase gates, defer nice-to-haves | PM |

---

## Success Metrics

### Technical Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Test coverage | 287 tests | 400+ tests | `npm test -- --coverage` |
| Migration time | N/A | < 5 min | Production migration log |
| Selection latency | N/A | < 100ms | APM (p95) |
| Workout generation latency | ~200ms | < 300ms | APM (p95) |
| Error rate | 0.05% | < 0.1% | Sentry |

### Product Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| 90-day retention | 60% | 75% (+15pp) | Analytics |
| Monthly PRs per user | 4 | 5 (+25%) | DB query |
| Workout completion rate | 75% | 93% (+18pp) | DB query |
| App rating | 4.2⭐ | 4.5⭐ | App Store/Play Store |
| User comprehension (survey) | N/A | 90%+ | Post-launch survey |

---

## Communication Plan

### Internal Updates

- **Daily:** Slack standup (blockers, progress)
- **Weekly:** Team sync (Friday 2pm, demo progress)
- **Bi-weekly:** Stakeholder update (exec summary)

### User Communication

- **Week 4:** Alpha announcement (5 users)
- **Week 7:** Beta announcement (50 users)
- **Week 14:** GA launch announcement (all users)
- **Post-launch:** "What's New" in-app tour

---

## Post-Launch (Weeks 15+)

### Immediate (Weeks 15-16)

- Monitor metrics daily
- Hot-fix critical bugs
- Collect user feedback (NPS survey)
- Iterate on messaging/UX

### Short-term (Weeks 17-20)

- Tune selection weights based on outcomes
- Expand exercise variation database
- Add more KB citations
- Performance optimization

### Long-term (Q3 2026+)

- VBT integration (velocity-based training)
- Nutrition integration (protein/calories display)
- Social features (block-based challenges)
- Coach marketplace (sell custom programs)

---

## Appendix: Weekly Standup Template

```markdown
## Week X Standup

**Phase:** [Phase name]

**Completed:**
- [ ] Task 1
- [ ] Task 2

**In Progress:**
- [ ] Task 3 (blocked by: [blocker])

**Next Week:**
- [ ] Task 4
- [ ] Task 5

**Risks/Blockers:**
- [Risk description]

**Metrics:**
- Test coverage: X%
- Performance: Xms
```

---

**Document Owner:** PM
**Last Updated:** 2026-02-14
**Next Review:** Week 1 (Phase 1 kickoff)
