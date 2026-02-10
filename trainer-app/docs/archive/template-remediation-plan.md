# Template Remediation Plan

**Date:** 2026-02-10  
**Scope:** Address high-priority findings from:
- `docs/analysis/template-generation-analysis.md`
- `docs/analysis/template-score-adjustments.md`

## Priority Summary

| Priority | Recommendation | Phase |
| --- | --- | --- |
| P0 | Hypertrophy RPE calibration by training age | 1 |
| P0 | Wire periodization into template generation path | 1 |
| P0 | Add superset support to templates + runtime | 2-3 |
| P1 | Fix split-penalizing scorer dimensions via template intent | 4 |
| P1 | Raise isolation rest floor from 60s to 75-90s | 1 |
| P1 | Add exercise order scoring (`fatigueCost` should trend down) | 4 |
| P1 | Enable template timeboxing and pass `isStrict` through | 1 |
| P2 | Accessory rep range (not fixed lower bound) | 5 |
| P2 | Weekly program scorer (coverage/balance at rotation level) | 5 |

## Phase 1: Generator Calibration and Wiring

### Objectives
- Improve immediate training stimulus quality.
- Ensure template path uses same periodization/timeboxing rigor as normal generation.

### Changes
1. Update hypertrophy target RPE to training-age-dependent logic in:
- `src/lib/engine/rules.ts`
- `src/lib/engine/prescription.ts`
2. Raise isolation rest floor from `60s` to `75-90s` in:
- `src/lib/engine/prescription.ts`
3. Wire periodization into template generation:
- `src/lib/api/template-session.ts` (derive week + call `getPeriodizationModifiers`)
4. Re-enable template timeboxing by passing `constraints.sessionMinutes`:
- `src/lib/api/template-session.ts`
5. Pass `template.isStrict` through to template engine:
- `src/lib/api/template-session.ts`

### Validation
- Extend tests in:
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/prescription.test.ts`

### Implementation Status (Completed 2026-02-10)

Implemented with confirmed decisions:
1. Isolation rest floor set to `75s`.
2. Hypertrophy RPE model set to Option B:
- Training-age base RPE table:
  - Beginner: `7.0`
  - Intermediate: `8.0`
  - Advanced: `8.5`
- Isolation accessory bump: `+0.5` RPE for hypertrophy accessories.

Code changes completed:
1. Template generation path now derives and passes periodization and `isStrict`, and enforces timeboxing via `constraints.sessionMinutes`:
- `src/lib/api/template-session.ts`
2. Shared target RPE resolver added for training-age-aware hypertrophy defaults:
- `src/lib/engine/rules.ts`
3. Prescription logic updated for training-age base RPE, isolation bump, and 75s isolation rest floor:
- `src/lib/engine/prescription.ts`
4. Generator call sites updated to mark isolation accessories:
- `src/lib/engine/engine.ts`
- `src/lib/engine/template-session.ts`
5. Load fallback target-RPE logic aligned with new model:
- `src/lib/engine/apply-loads.ts`

Validation completed:
1. Updated tests:
- `src/lib/engine/prescription.test.ts`
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/rules.test.ts`
- `src/lib/engine/engine.test.ts`
2. Command run:
- `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts src/lib/engine/rules.test.ts src/lib/engine/engine.test.ts`
3. Result:
- `4` test files passed, `56` tests passed.

## Phase 2: Schema Foundation for Supersets and Intent

### Objectives
- Add metadata required by scorer v2 and superset runtime behavior.

### Changes
1. Prisma model changes:
- Add `WorkoutTemplate.intent` enum field.
- Add `WorkoutTemplateExercise.supersetGroup Int?`.
- File: `prisma/schema.prisma`
2. API + validation changes:
- `src/lib/validation.ts`
- `src/lib/api/templates.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/templates/[id]/route.ts`
3. Template UI updates:
- `src/components/templates/TemplateForm.tsx`
- `src/app/templates/new/page.tsx`
- `src/app/templates/[id]/edit/page.tsx`

### Migration Notes
- Backfill existing templates with `intent = CUSTOM` unless explicit mapping is safe.
- Keep migration additive and backward compatible.

### Implementation Status (Completed 2026-02-10)

Schema + migration:
1. Added `TemplateIntent` enum and `WorkoutTemplate.intent` with default `CUSTOM`.
2. Added `WorkoutTemplateExercise.supersetGroup Int?`.
3. Added migration:
- `prisma/migrations/20260210_template_intent_superset/migration.sql`
4. Regenerated Prisma client:
- `npx prisma generate`

Validation + API:
1. Extended template schemas with:
- `intent` on create/update.
- `supersetGroup` on template exercises.
2. Persisted and returned `intent` + `supersetGroup` in template API data layer.
3. Files:
- `src/lib/validation.ts`
- `src/lib/api/templates.ts`

Template UI:
1. Added template intent selector in form.
2. Added per-exercise optional superset group input (`SS`).
3. Edit flow now hydrates and preserves:
- `intent`
- `isStrict`
- `supersetGroup`
4. Files:
- `src/components/templates/TemplateForm.tsx`
- `src/app/templates/[id]/edit/page.tsx`
- `src/app/templates/page.tsx`
- `src/components/templates/TemplateListShell.tsx`
- `src/components/templates/TemplateCard.tsx`

Validation coverage:
1. Added schema tests:
- `src/lib/validation.template.test.ts`
2. Verified:
- `npx tsc --noEmit`
- `npm run test -- src/lib/validation.template.test.ts`

## Phase 3: Superset Runtime Implementation

### Objectives
- Enable superset grouping and recover template time-efficiency intent.

### Changes
1. Carry `supersetGroup` through template exercise inputs:
- `src/lib/engine/template-session.ts`
- `src/lib/api/template-session.ts`
2. Implement grouped superset execution logic for paired accessories.
3. Update estimated duration logic to account for shared rest:
- `src/lib/engine/timeboxing.ts`
4. Surface superset metadata in output (notes/labels) for UI clarity.

### Validation
- Add/update tests in:
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/timeboxing.test.ts`

### Implementation Status (Completed 2026-02-10)

Runtime plumbing + metadata:
1. Carried `supersetGroup` from template DB rows into engine inputs:
- `src/lib/api/template-session.ts`
2. Extended runtime exercise types/inputs to preserve superset metadata:
- `src/lib/engine/types.ts`
- `src/lib/engine/template-session.ts`
3. Added accessory-only superset labeling in generated workout output (`notes`):
- `src/lib/engine/template-session.ts`

Superset execution + timing behavior:
1. Added accessory-pair superset handling in duration estimation:
- Valid only when exactly 2 accessory exercises share a `supersetGroup`.
- Main lifts are excluded from superset timing behavior.
2. Implemented shared-rest timing per superset round:
- Pair round time = work(A) + work(B) + `max(restA, restB)`.
3. Preserved backward compatibility:
- Exercises without `supersetGroup` follow the exact existing timing path.
- Non-pair or malformed groups fall back to normal per-exercise timing.
4. File:
- `src/lib/engine/timeboxing.ts`

Validation completed:
1. Updated tests:
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/timeboxing.test.ts` (new)
2. Command run:
- `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/timeboxing.test.ts`
3. Result:
- `2` test files passed, `16` tests passed.

## Phase 4: Scorer v2 (Intent-Aware, Generation-Aware)

### Objectives
- Stop penalizing split templates for full-body expectations.
- Align scoring with what templates actually control (selection + order).

### Changes
1. Introduce intent-aware scoring inputs and dimension gating:
- `src/lib/engine/template-analysis.ts`
2. Scope dimensions by intent:
- Muscle coverage
- Push/pull balance
- Movement diversity expectations
- Compound/isolation ratio ranges
3. Add exercise-order dimension:
- Prefer decreasing `fatigueCost` across `orderIndex`.
4. Normalize/cap bonus inflation:
- Lengthened position bonus
- SFR bonus
5. Remove low-SFR blanket penalty for compounds.

### Validation
- Update:
- `src/lib/engine/template-analysis.test.ts`
- `src/components/templates/TemplateAnalysisPanel.tsx`

### Implementation Status (Completed 2026-02-10)

Scorer v2 core:
1. Reworked template analysis to intent-aware scoring with dynamic scope and gating:
- `FULL_BODY`, `UPPER_LOWER`, `PUSH_PULL_LEGS`, `BODY_PART`, `CUSTOM`
- Push/pull balance is gated when not applicable for single-direction sessions.
2. Added intent-scoped expectations for:
- Muscle coverage targets.
- Movement pattern diversity denominator.
- Compound/isolation target ranges by template context.
3. Added exercise-order dimension:
- New score prefers non-increasing `fatigueCost` across `orderIndex`.
4. Normalized bonus inflation and SFR penalties:
- Lengthened-position and SFR bonuses now ratio-based vs. count inflation.
- Low-SFR penalty no longer applies broadly to compounds.
5. File:
- `src/lib/engine/template-analysis.ts`

Wiring updates:
1. Template list scoring now passes intent and order-aware metadata (`sfrScore`, `lengthPositionScore`, `fatigueCost`, `orderIndex`) into analysis:
- `src/lib/api/templates.ts`
2. Template editor analysis panel now passes `intent`, `orderIndex`, and displays exercise-order score:
- `src/components/templates/TemplateAnalysisPanel.tsx`
- `src/components/templates/TemplateForm.tsx`

Validation completed:
1. Updated tests:
- `src/lib/engine/template-analysis.test.ts`
2. Command run:
- `npm run test -- src/lib/engine/template-analysis.test.ts src/lib/engine/smart-build.test.ts src/lib/engine/template-session.test.ts src/lib/engine/timeboxing.test.ts`
3. Result:
- `4` test files passed, `54` tests passed.
4. Typecheck:
- `npx tsc --noEmit`
- Result: pass.

## Phase 5: Secondary Enhancements

### Changes
1. Accessory rep prescription as range (for double progression support):
- `src/lib/engine/prescription.ts`
- `src/lib/engine/types.ts`
2. Weekly program scorer (new module + endpoint) for:
- Weekly muscle coverage
- Weekly push/pull balance
- Weekly movement pattern diversity
- Weekly per-muscle volume checks

### Implementation Status (Completed 2026-02-10)

Accessory rep range support:
1. Extended runtime set type with optional `targetRepRange` while preserving `targetReps` for backward compatibility.
2. Accessory prescriptions now include:
- `targetReps` = lower bound (legacy-compatible display/log/load behavior).
- `targetRepRange` = `{ min, max }` for double-progression-ready consumers.
3. Added shared resolver for rep targeting fallbacks used by existing flows:
- `resolveSetTargetReps(...)` in `src/lib/engine/prescription.ts`
4. Preserved deterministic behavior and compatibility in existing generation/runtime paths:
- `src/lib/engine/engine.ts`
- `src/lib/engine/template-session.ts`
- `src/lib/engine/timeboxing.ts`

Weekly program scorer:
1. Added new deterministic weekly scorer module:
- `src/lib/engine/weekly-program-analysis.ts`
2. Scorer dimensions implemented:
- Weekly muscle coverage
- Weekly push/pull balance
- Weekly movement pattern diversity
- Weekly per-muscle volume checks vs `VOLUME_LANDMARKS`
3. Added weekly scorer data loader from template rotation context:
- `src/lib/api/weekly-program.ts`
4. Added new API endpoint:
- `GET /api/analytics/program-weekly`
- `src/app/api/analytics/program-weekly/route.ts`

Validation completed:
1. Updated/added tests:
- `src/lib/engine/prescription.test.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`
2. Commands run:
- `npm run test -- src/lib/engine/prescription.test.ts src/lib/engine/weekly-program-analysis.test.ts`
- `npm run test -- src/lib/engine/timeboxing.test.ts src/lib/engine/template-session.test.ts`
- `npx tsc --noEmit`
3. Result:
- Tests pass (`4` files, `35` tests total across targeted runs).
- Typecheck pass.

## Remediation Completion Check (2026-02-10)

1. Phase 1: Addressed and validated.
2. Phase 2: Addressed and validated.
3. Phase 3: Addressed and validated.
4. Phase 4: Addressed and validated.
5. Phase 5: Addressed and validated.

All items in this remediation plan are now implemented and have passing focused validation coverage documented per phase.

## Recommended PR Split

1. PR1: Phase 1 only.
2. PR2: Phase 2 schema/API/UI foundations.
3. PR3: Phase 3 superset runtime.
4. PR4: Phase 4 scorer v2.
5. PR5: Phase 5 secondary enhancements.

This order front-loads highest-impact training quality fixes while containing risk from schema and scorer redesign.
