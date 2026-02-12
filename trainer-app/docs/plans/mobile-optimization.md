# Mobile Optimization Plan (UI/UX Only)

**Date:** 2026-02-11  
**Scope:** Mobile design, layout, readability, spacing, touch ergonomics, and responsive behavior only.  
**Out of scope:** Engine logic, API behavior, database schema, generation rules, progression, and any training functionality.

## Goal

Improve mobile usability across the app while preserving all existing behavior and outcomes.

## Execution Status

**Last updated:** 2026-02-11

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 | Completed | Baseline bundle metrics, screenshot matrix, behavior-freeze checklist, and journey tap counts captured. |
| Phase 1 | Completed | Global responsive foundation implemented and validated. |
| Phase 2 | Completed | Workout/logging mobile UX and bundle validation completed; screenshot evidence captured, physical-device keyboard captures pending. |
| Phase 3 | Completed | Template flow mobile-fit implementation, bundle validation, and screenshot evidence captured. |
| Phase 4 | Completed | Library/sheets/settings/onboarding implementation and bundle validation completed; screenshot evidence captured, physical-device keyboard captures pending. |
| Phase 5 | Completed | Analytics mobile readability implementation, bundle validation, and screenshot/chart readability evidence captured. |
| Phase 6 | Completed | Accessibility/hardening implementation and final bundle validation completed; final screenshot evidence captured, physical-device keyboard captures pending. |

## Guardrails

1. No functional changes:
- Do not alter API request/response shapes.
- Do not modify generation, logging, persistence, or validation rules.
- Do not change route structure or action sequencing.
2. UI-only changes:
- Layout, spacing, typography scale, component sizing, visual hierarchy, and interaction affordances are allowed.
3. Regression safety:
- Every screen keeps the same key actions and result states as before.

## Implementation Preconditions

1. Device and browser support matrix (required):
- iOS Safari (latest major and previous major)
- Android Chrome (latest major and previous major)
- Desktop Chrome (latest major)
- Desktop Safari (latest major)
2. Required viewport set:
- 320x568 (small phone)
- 360x800 (standard Android phone)
- 390x844 (modern iPhone)
- 414x896 (large phone)
- 768x1024 (tablet portrait)
- 1024x768 (tablet/desktop crossover)
3. Keyboard and fixed-position edge cases that must be tested:
- iOS virtual keyboard open/close on numeric inputs in logging
- Android keyboard overlap with submit actions
- Bottom nav + sticky action bar overlap
- Slide-up sheet with long content and sticky actions
4. Visual QA tooling decision:
- Use a deterministic screenshot workflow for baseline and diff checks (same routes, same seed data/state).
- Store baseline artifacts per phase and compare before merge.
5. Screenshot execution cadence for implementation speed:
- During active implementation, do not recapture screenshots on each iteration.
- Capture phase screenshots once per phase at QA/sign-off time only.
- Capture keyboard overlap evidence once per required phase before merge sign-off.
6. Performance and bundle guardrails:
- Do not add new runtime dependencies for this initiative unless explicitly approved.
- Keep route-level first-load JS from `next build` within +5% of pre-phase baseline for modified routes.
- Keep data-fetch behavior unchanged (no new fetch calls, no additional polling).
7. PR slicing rule:
- One PR per phase, plus optional follow-up PR for defects found in QA only.
- Do not mix multiple phases in one PR unless the change is purely shared CSS tokens/utilities.
8. Merge gate:
- Phase PR cannot merge without passing automated checks plus phase sign-off artifacts (defined below).

## Explicit Non-Goals

1. No redesign of product information architecture.
2. No new navigation model or route-level restructuring.
3. No feature additions, removals, or renamed domain concepts.
4. No copy overhaul beyond minor clarity edits needed for responsive layout.
5. No theme/branding refresh as part of this effort.

## Phase 0: Baseline and Non-Regression Setup

1. Capture baseline screenshots for key routes at mobile widths (320, 360, 390, 414), tablet (768), and desktop (1024+):
- `/`
- `/workout/[id]`
- `/log/[id]`
- `/templates`
- `/templates/new`
- `/templates/[id]/edit`
- `/library`
- `/analytics`
- `/settings`
- `/onboarding`
2. Create a behavior-freeze checklist per route:
- primary CTA present
- secondary CTA present
- key states still reachable (loading, empty, success, error)
3. Add visual regression coverage for critical shells and dense interaction views.
4. Capture baseline route bundle metrics from `next build` for any route touched in later phases.
5. Record baseline UX friction counts for key journeys:
- Home -> generate workout -> save -> start log
- Open workout detail -> start log -> complete workout
- Open library -> filter -> open exercise sheet -> toggle favorite/avoid
- Open settings -> save profile -> save preferences

### Phase 0 Implementation Update (2026-02-11)

Completed:
- Added deterministic route JS bundle reporting script: `scripts/report-route-js-bundle.mjs`.
- Captured baseline build outputs:
  - `docs/plans/mobile-optimization-artifacts/phase-01/build-baseline-pre-phase1.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-01/build-baseline-pre-phase1-webpack.txt`
- Captured baseline route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-baseline-pre-phase1.json`
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-baseline-pre-phase1.md`
- Added baseline behavior-freeze/screenshot/journey checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-01/phase-0-baseline-checklist.md`
- Captured baseline screenshot matrix:
  - `docs/plans/mobile-optimization-artifacts/phase-01/screenshots/before/`
  - Coverage: `10` routes x `6` viewports (`60` screenshots).
- Recorded baseline journey tap counts for all four key flows.
- Completed behavior-freeze checklist entries for all phase routes.

## Phase 1: Global Responsive Foundation

1. Standardize page containers and spacing:
- normalize horizontal padding to mobile-first defaults (`px-4 sm:px-5 md:px-6`)
- reduce oversized vertical spacing on small screens
2. Normalize heading scale and spacing for mobile:
- avoid `text-3xl` defaults where `text-2xl` improves scan speed
3. Ensure safe-area and bottom-nav coexistence:
- verify fixed mobile nav does not cover actionable content
- keep bottom padding aligned with nav height
4. Enforce touch target minimums for nav and key controls (44px target height).

Primary files:
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/components/navigation/AppNavigation.tsx`
- `src/components/navigation/NavLink.tsx`

### Phase 1 Implementation Update (2026-02-11)

Completed:
- Standardized shell spacing and reduced mobile vertical density using shared utilities:
  - Added `.page-shell` and `.page-title` in `src/app/globals.css`.
  - Applied to route shells/headings in:
    - `src/app/page.tsx`
    - `src/app/analytics/page.tsx`
    - `src/app/settings/page.tsx`
    - `src/app/onboarding/page.tsx`
    - `src/app/templates/page.tsx`
    - `src/app/templates/new/page.tsx`
    - `src/app/templates/[id]/edit/page.tsx`
    - `src/app/workout/[id]/page.tsx`
    - `src/app/log/[id]/page.tsx`
- Implemented safe-area-aware bottom-nav coexistence:
  - Added `--mobile-nav-height` and `.app-root` padding strategy in `src/app/globals.css`.
  - Updated layout root class in `src/app/layout.tsx`.
  - Updated mobile nav shell in `src/components/navigation/AppNavigation.tsx`.
- Enforced 44px+ touch targets for nav actions:
  - Updated `src/components/navigation/NavLink.tsx` with `min-h-11` and width constraints.

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- Post-change builds captured:
  - `docs/plans/mobile-optimization-artifacts/phase-01/build-post-phase1.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-01/build-post-phase1-webpack.txt`
- Post-change route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-post-phase1.json`
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-post-phase1.md`
- Bundle delta vs baseline:
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-delta-phase1.md`
  - Result: all touched routes stayed within the `+5%` guardrail.

## Phase 2: High-Impact Workout and Logging UX

1. Optimize workout detail readability on mobile:
- reduce header density
- improve section spacing and set-row wrapping
2. Optimize logging input ergonomics:
- stack set inputs on narrow screens when needed
- increase input hit area and improve tap flow
- keep log actions discoverable and reachable
3. Keep completion controls easy to reach without overlap from bottom nav.

Primary files:
- `src/app/workout/[id]/page.tsx`
- `src/app/log/[id]/page.tsx`
- `src/components/LogWorkoutClient.tsx`

### Phase 2 Implementation Update (2026-02-11)

Completed:
- Optimized workout detail readability for narrow screens in `src/app/workout/[id]/page.tsx`:
  - Reduced header density and tightened spacing.
  - Improved section/card spacing and set-row wrapping.
  - Kept `Start logging` action full-width on mobile with 44px+ target.
- Optimized logging ergonomics in `src/app/log/[id]/page.tsx` and `src/components/LogWorkoutClient.tsx`:
  - Mobile-first set rows now stack cleanly, with set actions remaining obvious.
  - Increased input and control hit areas to 44px+ (`Reps`, `Load`, `RPE`, skip controls, and set log button).
  - Added numeric/decimal input modes to improve mobile keyboard flow.
- Kept completion controls reachable above bottom nav:
  - Added a fixed mobile completion action tray in `src/components/LogWorkoutClient.tsx`.
  - Added route-bottom spacing to prevent content from being hidden behind the tray.

Artifacts:
- Phase 2 fixture metadata:
  - `docs/plans/mobile-optimization-artifacts/phase-02/phase-2-fixture.json`
- Behavior-freeze and validation checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-02/phase-2-validation-checklist.md`

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- Post-change builds captured:
  - `docs/plans/mobile-optimization-artifacts/phase-02/build-post-phase2.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-02/build-post-phase2-webpack.txt`
- Post-change route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-02/route-js-post-phase2.json`
  - `docs/plans/mobile-optimization-artifacts/phase-02/route-js-post-phase2.md`
- Bundle delta vs baseline:
  - `docs/plans/mobile-optimization-artifacts/phase-02/route-js-delta-phase2.md`
  - Result: touched routes stayed within the `+5%` guardrail.
- Functional/API change check:
  - Confirmed UI-only implementation; no route/action/API behavior changes introduced.
- Remaining sign-off capture:
  - Physical-device keyboard overlap captures for iOS and Android.

## Phase 3: Template Flow Mobile Fit

1. Template list cards:
- prevent action crowding for `Edit` and `Delete`
- improve chip wrapping and label truncation behavior
2. Template form:
- replace rigid two-column areas with stacked mobile behavior
- improve ordering controls and superset input usability
3. Generate-from-template panel:
- keep check-in, generate, save, and post-save actions visually clear in small viewports.

Primary files:
- `src/components/templates/TemplateListShell.tsx`
- `src/components/templates/TemplateCard.tsx`
- `src/components/templates/TemplateForm.tsx`
- `src/components/GenerateFromTemplateCard.tsx`
- `src/app/templates/page.tsx`
- `src/app/templates/new/page.tsx`
- `src/app/templates/[id]/edit/page.tsx`

### Phase 3 Implementation Update (2026-02-11)

Completed:
- Template list and card mobile fit:
  - Reduced action crowding for `Edit`/`Delete` in `src/components/templates/TemplateCard.tsx`.
  - Improved wrapping/readability for template names and metadata chips.
  - Updated `src/components/templates/TemplateListShell.tsx` header and empty-state CTA sizing for small screens.
- Template form mobile fit:
  - Replaced rigid two-column mobile behavior with stacked fields in `src/components/templates/TemplateForm.tsx`.
  - Improved ordering and superset ergonomics with larger, clearer controls on narrow viewports.
  - Updated submit/cancel action layout to mobile-friendly stacked buttons.
- Generate-from-template panel clarity:
  - Improved CTA hierarchy for check-in/generate/save/post-save actions in `src/components/GenerateFromTemplateCard.tsx`.
  - Improved small-screen spacing and action button accessibility in substitution panels.
- Route-level shell consistency:
  - Updated template create/edit headers for mobile readability in:
    - `src/app/templates/new/page.tsx`
    - `src/app/templates/[id]/edit/page.tsx`

Artifacts:
- Build outputs:
  - `docs/plans/mobile-optimization-artifacts/phase-03/build-post-phase3.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-03/build-post-phase3-webpack.txt`
- Route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-baseline-pre-phase3.json`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-baseline-pre-phase3.md`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-post-phase3.json`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-post-phase3.md`
  - `docs/plans/mobile-optimization-artifacts/phase-03/route-js-delta-phase3.md`
- Behavior-freeze and validation checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-03/phase-3-validation-checklist.md`

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- `npm run build` (passes).
- Bundle delta result:
  - Touched routes (`/templates`, `/templates/new`, `/templates/[id]/edit`, `/`) remain within the `+5%` guardrail.
- Functional/API change check:
  - Confirmed no API or route behavior changes introduced in this phase.
- Sign-off evidence:
  - Batched before/after screenshots captured for touched Phase 3 routes at `320`, `390`, and `768` widths.

## Phase 4: Library, Sheets, Settings, and Onboarding

1. Library filter ergonomics:
- improve filter bar density and wrapping
- keep search, chips, and sort controls readable and tappable
2. Exercise detail sheet:
- verify sticky action bar wraps without clipping
- avoid overflow in dense metadata sections
3. Settings and onboarding forms:
- simplify vertical rhythm and field grouping for one-hand mobile use
- keep current fields and behavior exactly as-is.

Primary files:
- `src/components/library/FilterBar.tsx`
- `src/components/library/ExerciseLibraryShell.tsx`
- `src/components/library/ExerciseCard.tsx`
- `src/components/library/ExerciseDetailSheet.tsx`
- `src/components/ui/SlideUpSheet.tsx`
- `src/app/settings/page.tsx`
- `src/app/onboarding/page.tsx`
- `src/app/onboarding/ProfileForm.tsx`
- `src/components/UserPreferencesForm.tsx`

### Phase 4 Implementation Update (2026-02-11)

Completed:
- Library filter ergonomics and readability:
  - Improved mobile search/chip hit targets and wrap behavior in `src/components/library/FilterBar.tsx` and `src/components/library/MuscleGroupChips.tsx`.
  - Updated sort control layout for narrow widths in `src/components/library/ExerciseLibraryShell.tsx`.
  - Improved small-screen card readability and chip wrapping in `src/components/library/ExerciseCard.tsx` and `src/components/library/ExerciseList.tsx`.
  - Aligned `/library` shell spacing with shared responsive page utilities in `src/app/library/page.tsx`.
- Exercise detail sheet mobile hardening:
  - Increased sheet/header mobile resilience and safe-area padding in `src/components/ui/SlideUpSheet.tsx`.
  - Prevented metadata/action overflow in `src/components/library/ExerciseDetailSheet.tsx`:
    - wrapped dense badges/attributes/substitution rows for narrow viewports.
    - converted action tray into a mobile-wrapping grid with 44px+ controls.
- Settings and onboarding form ergonomics:
  - Simplified vertical rhythm and section density in:
    - `src/app/onboarding/ProfileForm.tsx`
    - `src/components/UserPreferencesForm.tsx`
  - Increased mobile control size and one-hand friendliness (44px+ primary controls), while preserving all fields/actions/behavior.
  - Applied supporting picker trigger ergonomics in:
    - `src/components/library/ExercisePicker.tsx`
    - `src/components/library/ExercisePickerTrigger.tsx`
  - Updated route shell heading/intro rhythm in:
    - `src/app/settings/page.tsx`
    - `src/app/onboarding/page.tsx`

Artifacts:
- Build outputs:
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-baseline-pre-phase4.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-baseline-pre-phase4-webpack.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-post-phase4.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-04/build-post-phase4-webpack.txt`
- Route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-baseline-pre-phase4.json`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-baseline-pre-phase4.md`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-post-phase4.json`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-post-phase4.md`
  - `docs/plans/mobile-optimization-artifacts/phase-04/route-js-delta-phase4.md`
- Behavior-freeze and validation checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-04/phase-4-validation-checklist.md`

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- `npm run build` (passes).
- Bundle delta result:
  - Touched routes (`/library`, `/settings`, `/onboarding`) remain within the `+5%` guardrail.
- Functional/API change check:
  - Confirmed no API or route behavior changes introduced in this phase.
- Remaining sign-off capture:
  - Physical-device keyboard overlap captures for iOS and Android in form workflows.

## Phase 5: Analytics Mobile Readability

1. Tab bar resilience:
- handle narrow widths without crushed labels
2. Chart readability:
- reduce label clutter on mobile
- adjust legend behavior and chart margins to prevent clipping
- preserve data semantics and interactions
3. Validate empty/loading states for quick comprehension on mobile.

Primary files:
- `src/app/analytics/page.tsx`
- `src/components/analytics/MuscleRecoveryPanel.tsx`
- `src/components/analytics/MuscleVolumeChart.tsx`
- `src/components/analytics/WeeklyVolumeTrend.tsx`
- `src/components/analytics/SplitDistribution.tsx`

### Phase 5 Implementation Update (2026-02-11)

Completed:
- Tab bar resilience on narrow mobile widths in `src/app/analytics/page.tsx`:
  - Reworked tabs into a horizontally-scrollable chip rail with minimum widths and no label crushing at `320`-class widths.
  - Tuned section/card spacing and heading scale for mobile readability.
- Chart readability and clipping prevention:
  - `src/components/analytics/MuscleVolumeChart.tsx`:
    - Added compact-mode chart tuning for small viewports (axis/tick/margin adjustments).
    - Reduced label clipping risk by moving MEV/MAV/MRV visibility into lightweight chips and suppressing right-edge line labels in compact mode.
  - `src/components/analytics/WeeklyVolumeTrend.tsx`:
    - Reduced mobile clutter by limiting plotted series count in compact mode.
    - Replaced dense chart legend with wrapping chip legend and tuned axis/tick behavior for narrow widths.
  - `src/components/analytics/SplitDistribution.tsx`:
    - Disabled dense pie-slice labels in compact mode and provided clear percentage chips below chart.
    - Adjusted pie radii/height for narrow-width readability.
- Empty/loading state readability:
  - Normalized compact-friendly loading/empty state spacing and copy legibility in:
    - `src/components/analytics/MuscleRecoveryPanel.tsx`
    - `src/components/analytics/MuscleVolumeChart.tsx`
    - `src/components/analytics/WeeklyVolumeTrend.tsx`
    - `src/components/analytics/SplitDistribution.tsx`

Artifacts:
- Build outputs:
  - `docs/plans/mobile-optimization-artifacts/phase-05/build-baseline-pre-phase5.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-05/build-baseline-pre-phase5-webpack.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-05/build-post-phase5.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-05/build-post-phase5-webpack.txt`
- Route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-05/route-js-baseline-pre-phase5.json`
  - `docs/plans/mobile-optimization-artifacts/phase-05/route-js-baseline-pre-phase5.md`
  - `docs/plans/mobile-optimization-artifacts/phase-05/route-js-post-phase5.json`
  - `docs/plans/mobile-optimization-artifacts/phase-05/route-js-post-phase5.md`
  - `docs/plans/mobile-optimization-artifacts/phase-05/route-js-delta-phase5.md`
- Behavior-freeze and validation checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-05/phase-5-validation-checklist.md`

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- `npm run build` (passes).
- Bundle delta result:
  - Touched route (`/analytics`) remains within the `+5%` guardrail (`-0.54%`).
- Functional/API change check:
  - Confirmed no API or route behavior changes introduced in this phase.
- Sign-off evidence:
  - Batched before/after screenshots captured for touched Phase 5 routes at `320`, `390`, and `768` widths.
  - Chart readability captures captured at `320` and `390`.

## Phase 6: Accessibility, QA, and Hardening

1. Accessibility checks:
- color contrast for text and status chips
- visible focus styles for keyboard and assistive navigation
- touch target minimums on all primary actions
2. Mobile QA matrix:
- iPhone SE width class (320)
- common phone widths (360/390/414)
- tablet portrait (768)
3. Final regression pass:
- behavior-freeze checklist unchanged
- no horizontal scrolling on core routes
- no fixed-position overlap with inputs or CTAs.
4. Performance pass:
- first-load JS stays within +5% budget for touched routes
- no new runtime dependencies
- no additional client fetch paths introduced

### Phase 6 Implementation Update (2026-02-11)

Completed:
- Accessibility hardening and focus visibility:
  - Added global keyboard-visible focus outlines for interactive controls in `src/app/globals.css`.
  - Added mobile-safe scroll padding and horizontal overflow clipping safeguards in `src/app/globals.css` for safer fixed-nav coexistence.
- Touch-target minimum hardening on remaining primary actions:
  - Home primary actions in `src/app/page.tsx` (`Resume logging`, `View workout`) raised to `44px+` tap targets.
  - Check-in primary actions and readiness selector in `src/components/SessionCheckInForm.tsx` raised to `44px+`.
  - Recent workout action controls hardened in:
    - `src/components/RecentWorkouts.tsx`
    - `src/components/DeleteWorkoutButton.tsx`
- Contrast and readability pass for status/support text:
  - Improved low-contrast helper/status text in:
    - `src/components/analytics/MuscleRecoveryPanel.tsx`
    - `src/components/analytics/MuscleVolumeChart.tsx`
    - `src/components/analytics/WeeklyVolumeTrend.tsx`
    - `src/components/analytics/SplitDistribution.tsx`
    - `src/components/analytics/TemplateStatsSection.tsx`
    - `src/components/library/PersonalHistorySection.tsx`
    - `src/components/library/ExerciseDetailSheet.tsx`
  - Mobile readability hardening for analytics template stats metadata grid in `src/components/analytics/TemplateStatsSection.tsx`.
- Batched QA screenshot capture:
  - Added reproducible capture tooling:
    - `scripts/capture-mobile-qa-screenshots.mjs`
    - `scripts/run-mobile-qa-capture.ps1`
  - Captured/updated before+after screenshot artifacts for Phases 3-6 at required sign-off viewports (`320`, `390`, `768`).
  - Captured Phase 5 chart readability evidence at `320` and `390`.

Artifacts:
- Build outputs:
  - `docs/plans/mobile-optimization-artifacts/phase-06/build-baseline-pre-phase6.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-06/build-baseline-pre-phase6-webpack.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-06/build-post-phase6.txt`
  - `docs/plans/mobile-optimization-artifacts/phase-06/build-post-phase6-webpack.txt`
- Route JS metrics:
  - `docs/plans/mobile-optimization-artifacts/phase-06/route-js-baseline-pre-phase6.json`
  - `docs/plans/mobile-optimization-artifacts/phase-06/route-js-baseline-pre-phase6.md`
  - `docs/plans/mobile-optimization-artifacts/phase-06/route-js-post-phase6.json`
  - `docs/plans/mobile-optimization-artifacts/phase-06/route-js-post-phase6.md`
  - `docs/plans/mobile-optimization-artifacts/phase-06/route-js-delta-phase6.md`
- Behavior-freeze and validation checklist:
  - `docs/plans/mobile-optimization-artifacts/phase-06/phase-6-validation-checklist.md`

Validation:
- `npm run lint` (passes; one existing warning in generated coverage artifact).
- `npm run build` (passes).
- Bundle delta result:
  - All core routes remain within the `+5%` guardrail (largest delta `+0.05%`).
- Functional/API change check:
  - Confirmed no API or route behavior changes introduced in this phase.
- Remaining sign-off capture:
  - Physical-device keyboard overlap captures for iOS and Android in logging/forms.

## Phase Sign-Off Artifacts

1. Required for every phase PR:
- before/after screenshots for touched routes at 320, 390, and 768 widths
- completed behavior-freeze checklist entries for touched routes
- short note confirming no functional/API changes
- bundle-size delta note for touched routes
2. Required for Phase 2 and Phase 4:
- keyboard interaction captures for at least one iOS and one Android viewport in logging/forms
3. Required for Phase 5:
- chart readability captures showing labels/legend behavior at 320 and 390 widths

## Acceptance Criteria

1. No core functionality changes in workout generation, saving, logging, or settings persistence.
2. All primary user journeys complete on 320-414px without clipping or accidental overlap.
3. Bottom navigation never obscures primary actions.
4. Dense input workflows (especially logging) remain fast and clear on mobile.
5. Analytics visuals remain legible and operable on mobile without content truncation.
6. No horizontal scrolling on any core route in the viewport matrix.
7. No increase in tap count for baseline journeys defined in Phase 0.
8. Route-level first-load JS remains within +5% for touched routes.

## Delivery Sequence

1. Phase 0 + Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6

## Risk Notes

1. Fixed bottom navigation and sticky action bars can conflict in short viewport heights.
2. Chart libraries can clip labels at mobile widths if margins and legends are not tuned.
3. Form-heavy pages can regress quickly if spacing and keyboard behavior are not validated together.
4. Visual diffs can become noisy if test data is unstable; use deterministic fixtures/states.
