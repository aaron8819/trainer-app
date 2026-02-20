# Documentation Index

## Active References

| Document | Purpose | Audience |
|----------|---------|----------|
| [specs/spec-v2.md](specs/spec-v2.md) | **v2 spec** (COMPLETE): engine KB alignment, exercise library, template mode, polish | Claude + developers |
| [specs/spec-v3.md](specs/spec-v3.md) | **v3 ideas**: training phases, indirect volume, exercise rotation, supersets | Claude + developers |
| [knowledgebase/](knowledgebase/) | Scientific foundations (hypertrophy & strength research) | Claude + developers |
| [architecture.md](architecture.md) | Engine behavior, guarantees, generation flow, module map, **periodization system** | Claude + developers |
| [plans/phase4-explainability-execution.md](plans/phase4-explainability-execution.md) | **Phase 4 (IN PROGRESS)**: Explainability system - KB citations, session context, exercise/prescription rationale (6 sub-phases) | Claude + developers |
| [plans/mobile-optimization.md](plans/mobile-optimization.md) | Phase-based mobile UX optimization plan with implementation/status tracking and artifact links | Claude + developers |
| [src-lib-reference.md](src-lib-reference.md) | Complete `src/lib` reference: module boundaries, contracts, and integration points across api/data/db/engine/exercise-library/settings/supabase/ui/validation | Claude + developers |
| [engine-prescription-progression-volume.md](engine-prescription-progression-volume.md) | Consolidated engine reference for `rules.ts`, `prescription.ts`, `progression.ts`, `apply-loads.ts`, `template-session.ts`, `sra.ts`, `volume.ts`, and `volume-landmarks.ts` | Claude + developers |
| [templatedocs/template-generation.md](templatedocs/template-generation.md) | Exact runtime template generation behavior (sets/reps/rest/loads/supersets) | Claude + developers |
| [templatedocs/template-prescription-assignment.md](templatedocs/template-prescription-assignment.md) | Exact assignment logic for sets, rep ranges, RPE, rest, and loads in template-generated workouts | Claude + developers |
| [templatedocs/template-score-report.md](templatedocs/template-score-report.md) | Current template scoring report and quality distribution | Claude + developers |
| [workout-data-flow-traceability.md](workout-data-flow-traceability.md) | End-to-end traceability for how settings, logs, baselines, and engine modules generate and adjust workouts | Claude + developers |
| [phase5-intent-rollout-runbook.md](phase5-intent-rollout-runbook.md) | Controlled rollout steps and KPI checkpoints for Phase 5 intent-default launch | Claude + developers |
| [template/exercise-selection-algorithm-spec.md](template/exercise-selection-algorithm-spec.md) | Deterministic hybrid selection spec for template auto-fill and intent generation (weights, calibration, rollout contracts) | Claude + developers |
| [template/phase5-intent-session-manual-review.md](template/phase5-intent-session-manual-review.md) | Full-session manual review artifact used for Phase 5 readiness sign-off | Claude + developers |
| [analysis/user-settings-downstream.md](analysis/user-settings-downstream.md) | How settings flow into engine and UI with owner example | Claude + developers |
| [decisions.md](decisions.md) | Architectural Decision Records (ADRs) | Claude + developers |
| [data-model.md](data-model.md) | Complete database schema reference | Claude + developers |
| [seeded-data.md](seeded-data.md) | Exercise catalog, equipment, muscles, aliases | Claude + developers |
| [tests/](tests/) | **Test suite documentation**: 610 tests across 44 files, E2E simulation, unit test catalog, patterns, debugging | Claude + developers |

## Project Configuration

| Document | Purpose |
|----------|---------|
| [`CLAUDE.md`](../../CLAUDE.md) | Claude Code instructions: commands, conventions, anti-patterns, testing |
| [`prisma/schema.prisma`](../prisma/schema.prisma) | Database schema (source of truth for DB structure) |

## Archive

Completed project documents. Preserved for historical reference.

| Document | What it was |
|----------|------------|
| [archive/periodization-phase1-plan.md](archive/periodization-phase1-plan.md) | Phase 1 periodization foundation implementation plan (2026-02-14) |
| [archive/comprehensive-exercise-db.md](archive/comprehensive-exercise-db.md) | 133-exercise JSON-driven DB replacement (2026-02-09) |
| [archive/engine-audit-remediation-2026-02-10.md](archive/engine-audit-remediation-2026-02-10.md) | Completion-aware history semantics remediation log (2026-02-10) |
| [archive/phase-3-template-mode-core.md](archive/phase-3-template-mode-core.md) | Template mode implementation plan (2026-02-08) |
| [archive/post-refactor-analysis.md](archive/post-refactor-analysis.md) | Post-refactor gap analysis and recommendations |
| [archive/template-follow-up-plan.md](archive/template-follow-up-plan.md) | Post-remediation follow-up implementation plan |
| [archive/template-generation-analysis.md](archive/template-generation-analysis.md) | Deep-dive analysis of template-generation behavior |
| [archive/template-remediation-plan.md](archive/template-remediation-plan.md) | Template remediation planning document |
| [archive/template-score-adjustments.md](archive/template-score-adjustments.md) | Historical score-weight and scoring adjustments |

## Multi-Step Work Pattern

For future complex work spanning multiple sessions, create these files at the **project root** (not in `docs/`):

| File | When to create | When to delete |
|------|---------------|----------------|
| `plan.md` | Starting a multi-step task | After work is complete |
| `status.md` | Tracking progress across sessions | After work is complete |

These are ephemeral — delete them when the work is done, and archive any durable insights into the appropriate reference doc.
