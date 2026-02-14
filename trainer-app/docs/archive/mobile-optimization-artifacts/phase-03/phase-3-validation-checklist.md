# Phase 3 Validation Checklist

## Snapshot

- Date: 2026-02-11
- Phase: `Phase 3` (Template Flow Mobile Fit)
- Scope:
  - `/templates`
  - `/templates/new`
  - `/templates/[id]/edit`
  - `/` (`GenerateFromTemplateCard`)
- Functional scope change: none (UI-only)

## Screenshot Coverage

- Capture mode for this phase: deferred during implementation to reduce cycle time.
- Batched capture completed: 2026-02-11.
- Captured:
  - `docs/plans/mobile-optimization-artifacts/phase-03/screenshots/before/`
  - `docs/plans/mobile-optimization-artifacts/phase-03/screenshots/after/`
- Required viewports for touched routes:
  - `320x568`
  - `390x844`
  - `768x1024`

## Behavior Freeze (Touched Routes)

| Route | Primary CTA present | Secondary CTA present | Loading state reachable | Empty state reachable | Success state reachable | Error state reachable |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates/new` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates/[id]/edit` | [x] | [x] | [x] | [x] | [x] | [x] |

Verification notes:
- Template list preserves create/edit/delete actions and delete confirmation flow.
- Template form preserves add/reorder/remove/superset and submit/cancel flows.
- Generate-from-template keeps check-in, generate, save, and post-save links unchanged.

## Journey Tap Count Check

| Journey | Baseline taps | Post-phase3 taps | Delta |
| --- | ---: | ---: | ---: |
| Home -> generate workout -> save -> start log | 4 | 4 | 0 |

## Performance and Build Artifacts

- Build output (default):
  - `docs/plans/mobile-optimization-artifacts/phase-03/build-post-phase3.txt`
- Build output (webpack):
  - `docs/plans/mobile-optimization-artifacts/phase-03/build-post-phase3-webpack.txt`
- Route JS post-phase3:
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-post-phase3.json`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-post-phase3.md`
- Route JS baseline for phase:
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-baseline-pre-phase3.json`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-baseline-pre-phase3.md`
- Route JS delta:
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-delta-phase3.md`
  - Result: touched routes remain within the `+5%` budget.

## Phase 3 Sign-Off Notes

- Completed:
  - Template list and cards: reduced action crowding and improved chip/title wrapping on mobile.
  - Template form: replaced rigid two-column behavior with mobile stacking and improved ordering/superset controls.
  - Generate-from-template panel: clarified mobile CTA hierarchy for check-in, generate, save, and post-save actions.
  - Batched screenshot captures for touched routes at `320`, `390`, and `768`.
