# Training System Redesign: Documentation Index

**Last Updated:** 2026-02-15

This directory contains the complete planning and implementation documentation for the Training System Redesign (Phases 1-5).

---

## Quick Navigation

### Overview & Status

📋 **[redesign-overview.md](./redesign-overview.md)** - Executive summary, phase roadmap, migration strategy
- Start here for big-picture understanding
- Current status: Phase 2 complete, Phase 3 in planning

### Completed Phases

✅ **[Phase 1 Completion Report](./phase1-completion-report.md)** - Periodization Foundation (2026-02-14)
- Schema, block progression, training age templates
- 81 tests, 4 ADRs, full integration
- Status: Production-ready

✅ **[Phase 2 Completion Report](./phase2-completion-report.md)** - Selection Intelligence (2026-02-14)
- Beam search optimizer, indirect volume, rotation tracking
- 99 tests, 7 ADRs, 3,100+ lines removed
- Status: Production-ready (1 minor test issue documented)

✅ **[Phases 1-2 Verification Summary](./phases1-2-verification-summary.md)** - Independent verification (2026-02-15)
- Test coverage: 596/597 passing (99.8%)
- Performance: <5ms overhead
- Evidence-based validation complete

✅ **[Phase 3 Completion Report](./phase3-completion-report.md)** - Autoregulation & Readiness (2026-02-15)
- Multi-modal fatigue scoring, 4-level autoregulation, 5-level stall intervention
- 59 tests (100% pass rate), 5 ADRs, stubbed Whoop integration
- Status: Core complete, pending manual UI testing

✅ **[Phase 3 Verification Summary](./phase3-verification-summary.md)** - Independent verification (2026-02-15)
- Test coverage: 59/59 passing (100%)
- Deferred items from Phase 1-2 checked
- Known issues: 1 test page build error (non-blocking)

### Upcoming Phases

📅 **[Phase 4: Explainability](./explainability-system.md)** - Coach-like communication
- Per-exercise rationale, KB citations, "Why this workout?" UI
- Timeline: 2 weeks

📅 **[Phase 5: Training Age Progression](./implementation-phases.md)** - Auto-adapt to user advancement
- Progression scheme adaptation, milestone communication
- Timeline: 2 weeks

---

## System Design Specs

### Core Architecture

📐 **[periodization-system.md](./periodization-system.md)** - Macro/meso/block structure
- Evidence-based block templates
- Training age progression
- Volume/intensity modulation

📐 **[selection-optimization.md](./selection-optimization.md)** - Multi-objective exercise selection
- Beam search algorithm
- 7 weighted objectives
- Constraint satisfaction

📐 **[rotation-variation.md](./rotation-variation.md)** - Exercise rotation strategy
- 4-12 week rotation policy
- Exposure tracking
- Novelty scoring

### Integration Systems

📐 **[autoregulation-readiness.md](./autoregulation-readiness.md)** - Readiness signals and auto-scaling
- Whoop integration
- Fatigue management
- Stall intervention ladder

📐 **[explainability-system.md](./explainability-system.md)** - User-facing rationale generation
- Per-exercise reasoning
- Session context
- KB citation framework

---

## Technical Documentation

### Schema & Data

📊 **[data-model-changes.md](./data-model-changes.md)** - Database schema evolution
- Migration strategy
- Relationship diagrams
- Backward compatibility

### Process & Standards

📋 **[implementation-phases.md](./implementation-phases.md)** - Phased rollout plan
- Timeline and dependencies
- Risk mitigation
- Success criteria

📋 **[documentation-governance.md](./documentation-governance.md)** - Documentation standards
- Update protocols
- Review process
- Deprecation rules

📋 **[deprecation-strategy.md](./deprecation-strategy.md)** - Legacy code removal
- Migration paths
- Compatibility windows
- Clean cutover approach (no production users)

---

## Phase Status Matrix

| Phase | Planning | Implementation | Testing | Documentation | Status |
|-------|----------|----------------|---------|---------------|--------|
| **Phase 1: Periodization** | ✅ | ✅ | ✅ (81 tests) | ✅ | **COMPLETE** |
| **Phase 2: Selection** | ✅ | ✅ | ✅ (99 tests) | ✅ | **COMPLETE** |
| **Phase 3: Autoregulation** | ✅ | ✅ | ✅ (59 tests) | ✅ | **COMPLETE*** |
| **Phase 4: Explainability** | ✅ | ⏳ | ⏳ | ⏳ | **PLANNED** |
| **Phase 5: Training Age** | ✅ | ⏳ | ⏳ | ⏳ | **PLANNED** |

\* Phase 3: Core complete, manual UI testing pending

**Legend:** ✅ Complete | ⏳ Not Started | 🔄 In Progress

---

## Key Metrics (Phases 1-3)

### Test Coverage

- **Total Tests:** 656 (597 pre-Phase 3 + 59 readiness)
- **Pass Rate:** 99.8% (655/656 passing)
- **New Tests (Phase 3):** 59 (20 compute-fatigue + 19 autoregulate + 20 stall-intervention)
- **Coverage:** 95%+ on all new modules

### Code Quality

- **Lines Added (Phase 3):** ~2,970 (readiness engine + API + routes + tests)
- **Lines Added (Total):** ~7,445 (Phases 1-3 combined)
- **Lines Removed:** 3,148 (legacy selection, Phase 2)
- **Net Change:** +4,297 lines (significant feature expansion)
- **Test LOC:** +4,080 (+97% test coverage increase)

### Performance

- **Workout Generation:** +8ms (+17% from baseline) - acceptable
  - Phase 1: +3ms (periodization)
  - Phase 2: +2ms (selection-v2)
  - Phase 3: +5ms (autoregulation, when signal exists)
- **Build Time:** +0.3s (+4%) - stable

### Documentation

- **ADRs Created:** 16 (ADR-032 through ADR-047)
- **Completion Reports:** 3 (Phase 1, 2, 3)
- **Verification Reports:** 2 (Phases 1-2, Phase 3)
- **Architecture Docs Updated:** 3 (architecture.md, data-model.md, decisions.md)

---

## Evidence-Based Validation

All implementations validated against:

- ✅ **Renaissance Periodization (RP)** - Volume landmarks, indirect volume multiplier, MRV enforcement
- ✅ **Eric Helms** - Training age templates, exercise variation, periodization structure
- ✅ **Mike Israetel** - SFR prioritization, mesocycle design, fatigue management
- ✅ **Brad Schoenfeld** - Lengthened-position bias, hypertrophy mechanisms

---

## Next Steps

### Immediate (Phase 3 Cleanup)

1. Fix test page build error (`test-readiness/page.tsx`) - 5 minutes
2. Create migration file for ReadinessSignal + UserIntegration - 10 minutes
3. Manual UI testing (readiness form, autoregulation display, stall interventions)
4. Update architecture.md with autoregulation section

### Phase 3.5 (Optional - Whoop OAuth)

1. Setup Whoop developer account
2. Implement OAuth authorization code flow
3. Store tokens in UserIntegration
4. Fetch daily recovery data + auto-refresh
5. Timeline: 1-2 weeks

### Phase 4 Kickoff

1. Review [explainability-system.md](./explainability-system.md)
2. Design "Why this workout?" UI panel
3. KB citation integration
4. Timeline: 2 weeks

---

## Related Documentation

### Main Docs

- [docs/index.md](../index.md) - Documentation map
- [docs/architecture.md](../architecture.md) - Engine behavior source of truth
- [docs/decisions.md](../decisions.md) - All ADRs (42 total)
- [docs/data-model.md](../data-model.md) - Complete schema reference

### Project Root

- [CLAUDE.md](../../CLAUDE.md) - Project conventions and instructions

---

## Questions or Feedback

For questions about the redesign:
1. Check relevant spec in this directory
2. Review ADRs in [docs/decisions.md](../decisions.md)
3. Consult [docs/architecture.md](../architecture.md) for implementation details

For bugs or issues:
1. Report at https://github.com/anthropics/claude-code/issues
2. Include phase number and relevant ADR references
