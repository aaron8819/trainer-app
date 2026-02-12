# Phase 0 Baseline Checklist

## Snapshot

- Date: 2026-02-11
- Phase: `Phase 0` for mobile optimization
- Scope: non-functional baseline setup before mobile UI changes
- Baseline status: complete
- Fixture mode: current local data
- Dynamic fixtures used:
  - `workoutId`: `d1c312d3-f332-4e38-b05a-f47d6aea1a6d`
  - `templateId`: `7aa92b84-aeac-4cb0-aec4-a77e1a7bf748`

## Visual Regression Workflow Decision

- Decision: use deterministic route + viewport captures with fixed viewport dimensions and stable route inputs.
- Capture routes:
  - `/`
  - `/workout/[id]` (replace `[id]` with a stable workout id fixture)
  - `/log/[id]` (replace `[id]` with a stable workout id fixture)
  - `/templates`
  - `/templates/new`
  - `/templates/[id]/edit` (replace `[id]` with a stable template id fixture)
  - `/library`
  - `/analytics`
  - `/settings`
  - `/onboarding`
- Capture viewport matrix:
  - `320x568`
  - `360x800`
  - `390x844`
  - `414x896`
  - `768x1024`
  - `1024x768`
- Artifact folder convention:
  - `docs/plans/mobile-optimization-artifacts/phase-01/screenshots/before/<route>/<viewport>.png`
  - `docs/plans/mobile-optimization-artifacts/phase-01/screenshots/after/<route>/<viewport>.png`
- Baseline capture result:
  - Completed `60` screenshots (`10` routes x `6` viewports) under
    `docs/plans/mobile-optimization-artifacts/phase-01/screenshots/before/`.

## Behavior Freeze Checklist (Per Route)

| Route | Primary CTA present | Secondary CTA present | Loading state reachable | Empty state reachable | Success state reachable | Error state reachable |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/workout/[id]` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/log/[id]` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates/new` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/templates/[id]/edit` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/library` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/analytics` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/settings` | [x] | [x] | [x] | [x] | [x] | [x] |
| `/onboarding` | [x] | [x] | [x] | [x] | [x] | [x] |

Verification notes:
- Runtime verification via screenshot captures at all matrix viewports.
- State reachability verified from route/component branches (`loading`, `empty`, `success`, `error`)
  and exercised flows in the baseline journeys below.

## Bundle Baseline Artifacts

- Build output (default): `docs/plans/mobile-optimization-artifacts/phase-01/build-baseline-pre-phase1.txt`
- Build output (webpack): `docs/plans/mobile-optimization-artifacts/phase-01/build-baseline-pre-phase1-webpack.txt`
- Route JS baseline JSON:
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-baseline-pre-phase1.json`
- Route JS baseline Markdown:
  - `docs/plans/mobile-optimization-artifacts/phase-01/route-js-baseline-pre-phase1.md`

## Baseline Journey Friction Counts

| Journey | Baseline taps | Notes |
| --- | ---: | --- |
| Home -> generate workout -> save -> start log | 4 | `Generate Workout` -> `Skip` -> `Save Workout` -> `Start logging` (template preselected). |
| Open workout detail -> start log -> complete workout | 2 | `Start logging` -> `Mark workout completed`. |
| Open library -> filter -> open exercise sheet -> toggle favorite/avoid | 4 | `Favorites` filter chip -> open exercise card -> `Favorite` -> `Avoid`. |
| Open settings -> save profile -> save preferences | 2 | `Save profile` -> `Save preferences`. |
