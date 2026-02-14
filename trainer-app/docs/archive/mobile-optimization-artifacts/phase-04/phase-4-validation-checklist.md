# Phase 4 Validation Checklist

## Snapshot

- Date: 2026-02-11
- Phase: `Phase 4` (Library, Sheets, Settings, and Onboarding)
- Scope:
  - `/library`
  - `/settings`
  - `/onboarding`
- Functional scope change: none (UI-only)

## Screenshot Coverage

- Capture mode for this phase: deferred during implementation to reduce cycle time.
- Batched capture completed: 2026-02-11.
- Captured:
  - `docs/plans/mobile-optimization-artifacts/phase-04/screenshots/before/`
  - `docs/plans/mobile-optimization-artifacts/phase-04/screenshots/after/`
- Required viewports for touched routes:
  - `320x568`
  - `390x844`
  - `768x1024`

## Behavior Freeze (Touched Routes)

| Route | Primary CTA present | Secondary CTA present | Loading state reachable | Empty state reachable | Success state reachable | Error state reachable |
| --- | --- | --- | --- | --- | --- | --- |
| `/library` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/settings` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/onboarding` | [x] | [x] | [x] | [x] | [x] | [x] |

Verification notes:
- `/library` retains search/filter/sort flow, exercise detail open, and favorite/avoid toggles.
- `/settings` and `/onboarding` retain all profile and preference fields plus save actions.
- Exercise picker sheet open/close and selection behavior remains unchanged.

## Journey Tap Count Check

| Journey | Baseline taps | Post-phase4 taps | Delta |
| --- | ---: | ---: | ---: |
| Open library -> filter -> open exercise sheet -> toggle favorite/avoid | 4 | 4 | 0 |
| Open settings -> save profile -> save preferences | 2 | 2 | 0 |

## Performance and Build Artifacts

- Build output (baseline/default):
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-baseline-pre-phase4.txt`
- Build output (baseline/webpack):
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-baseline-pre-phase4-webpack.txt`
- Build output (post/default):
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-post-phase4.txt`
- Build output (post/webpack):
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-post-phase4-webpack.txt`
- Route JS baseline for phase:
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-baseline-pre-phase4.json`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-baseline-pre-phase4.md`
- Route JS post-phase4:
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-post-phase4.json`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-post-phase4.md`
- Route JS delta:
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-delta-phase4.md`
  - Result: all touched routes remain within the `+5%` budget.

## Phase 4 Sign-Off Notes

- Completed:
  - Library filter/readability improvements for mobile chip/search/sort ergonomics.
  - Exercise detail sheet overflow and sticky action tray hardening for narrow viewports.
  - Settings and onboarding mobile form rhythm/control sizing improvements (no field or behavior changes).
  - Batched screenshot captures for touched routes at `320`, `390`, and `768`.
- Pending before merge sign-off:
  - Physical-device keyboard overlap captures for:
    - iOS Safari (form numeric inputs and submit visibility)
    - Android Chrome (keyboard overlap with submit actions)
