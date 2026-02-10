# Documentation Index

## Active References

| Document | Purpose | Audience |
|----------|---------|----------|
| [spec-v2.md](spec-v2.md) | **v2 spec** (COMPLETE): engine KB alignment, exercise library, template mode, polish | Claude + developers |
| [spec-v3.md](spec-v3.md) | **v3 ideas**: training phases, indirect volume, exercise rotation, supersets | Claude + developers |
| [knowledgebase/](knowledgebase/) | Scientific foundations (hypertrophy & strength research) | Claude + developers |
| [architecture.md](architecture.md) | Engine behavior, guarantees, generation flow, module map (v1) | Claude + developers |
| [template-generation.md](template-generation.md) | Exact runtime template generation behavior (sets/reps/rest/loads/supersets) | Claude + developers |
| [template-prescription-assignment.md](template-prescription-assignment.md) | Exact assignment logic for sets, rep ranges, RPE, rest, and loads in template-generated workouts | Claude + developers |
| [user-settings-downstream.md](user-settings-downstream.md) | How settings flow into engine and UI with owner example | Claude + developers |
| [analysis/template-follow-up-plan.md](analysis/template-follow-up-plan.md) | Post-remediation follow-up implementation plan from post-refactor analysis | Claude + developers |
| [decisions.md](decisions.md) | Architectural Decision Records (ADRs) | Claude + developers |
| [engine-audit-remediation-2026-02-10.md](engine-audit-remediation-2026-02-10.md) | Targeted remediation log for completion-aware history semantics in engine modules | Claude + developers |
| [data-model.md](data-model.md) | Complete database schema reference | Claude + developers |
| [seeded-data.md](seeded-data.md) | Exercise catalog, equipment, muscles, aliases | Claude + developers |

## Project Configuration

| Document | Purpose |
|----------|---------|
| [`CLAUDE.md`](../CLAUDE.md) | Claude Code instructions: commands, conventions, anti-patterns, testing |
| [`prisma/schema.prisma`](../prisma/schema.prisma) | Database schema (source of truth for DB structure) |

## Archive

Completed project documents. Preserved for historical reference.

| Document | What it was |
|----------|------------|
| [archive/comprehensive-exercise-db.md](archive/comprehensive-exercise-db.md) | 133-exercise JSON-driven DB replacement (2026-02-09) |
| [archive/phase-3-template-mode-core.md](archive/phase-3-template-mode-core.md) | Template mode implementation plan (2026-02-08) |
| [archive/engine_refactor_2.5.md](archive/engine_refactor_2.5.md) | Original refactor spec with implementation status |
| [archive/engine-and-data-model-analysis.md](archive/engine-and-data-model-analysis.md) | Audit with 22 recommendations (all resolved) |
| [archive/implementation-plan.md](archive/implementation-plan.md) | 8-phase execution plan (all phases complete) |

## Multi-Step Work Pattern

For future complex work spanning multiple sessions, create these files at the **project root** (not in `docs/`):

| File | When to create | When to delete |
|------|---------------|----------------|
| `plan.md` | Starting a multi-step task | After work is complete |
| `status.md` | Tracking progress across sessions | After work is complete |

These are ephemeral — delete them when the work is done, and archive any durable insights into the appropriate reference doc.
