# Template And Weekly Program Scoring (Current Behavior)

Last updated: 2026-02-10

This document reflects the current scoring implementation after follow-up Phases 1-5.

## Scope

There are now two scoring layers:

1. Template-level scorer (single session quality)
2. Weekly program scorer (rotation-level coverage/balance/diversity/volume)

## Source of Truth

- Template scorer:
- `src/lib/engine/template-analysis.ts`
- Weekly scorer:
- `src/lib/engine/weekly-program-analysis.ts`
- Weekly scorer data loader:
- `src/lib/api/weekly-program.ts`
- Weekly scorer endpoint:
- `src/app/api/analytics/program-weekly/route.ts`

## Labels

Both scorers use the same label bands:

- `Excellent`: `>=85`
- `Good`: `>=70`
- `Fair`: `>=55`
- `Needs Work`: `>=40`
- `Poor`: `<40`

## Template Scorer (v2)

## Inputs

Per exercise:

- `isCompound`
- `isMainLiftEligible` (when available)
- `movementPatterns`
- `muscles` (`primary`/`secondary`)
- `sfrScore`
- `lengthPositionScore`
- `fatigueCost`
- `orderIndex`

Template metadata:

- `intent` (`FULL_BODY | UPPER_LOWER | PUSH_PULL_LEGS | BODY_PART | CUSTOM`)

## Overall score

Weighted average, rounded/clamped to `0-100`.

Base weights:

- Muscle Coverage: `0.24`
- Push/Pull Balance: `0.12`
- Compound/Isolation: `0.12`
- Movement Diversity: `0.12`
- Lengthened Position: `0.14`
- SFR Efficiency: `0.14`
- Exercise Order: intent-adjusted
- `FULL_BODY` / `UPPER_LOWER`: `0.16` (strength-oriented)
- `CUSTOM`: `0.12` (neutral)
- `PUSH_PULL_LEGS` / `BODY_PART`: `0.08` (hypertrophy-oriented)
- Runtime note: intent-adjusted weights are normalized by the active-dimension total before final score calculation (including push/pull gating), so overall weighting still sums effectively to `1.0`.

Push/Pull is gated by intent/scope applicability:

- If not applicable, that dimension is excluded and weights are normalized by total included weight.

## Dimension behavior

### 1) Muscle Coverage

- Critical muscles are those with `MEV > 0` in `VOLUME_LANDMARKS`.
- Coverage is intent-scoped via split buckets (`push/pull/legs`).
- Credit:
- primary hit = `1.0`
- secondary hit = `0.4`
- Score = `80%` critical coverage + `20%` non-critical coverage.

### 2) Push/Pull Balance

- Uses primary-muscle bucket counts.
- Only applicable when scope includes both push and pull.
- Non-applicable templates get neutral `75` and are excluded from overall weighting.
- Applicable score targets a `1:1` push:pull session balance.

### 3) Compound/Isolation Ratio

- Intent-specific target ranges:
- `FULL_BODY`: `35-70`
- `UPPER_LOWER`: `35-75` (upper), `45-85` (lower)
- `PUSH_PULL_LEGS`: `25-75` (push/pull), `45-85` (legs)
- `BODY_PART`: `15-80`
- `CUSTOM`: `25-80`
- In-range scores `100`; out-of-range scales linearly.

### 4) Movement Pattern Diversity

- Expected pattern set is intent-scoped (not fixed full-body for all templates).
- Full-body expects core patterns; split/body-part expects scoped pattern set.
- Coverage target:
- `FULL_BODY`: target `5` expected patterns
- Other intents: `max(2, ceil(expected * 0.75))`
- Bonus: `+5` each for `rotation` and `anti_rotation` if present.

### 5) Lengthened-Position Coverage

- Uses average `lengthPositionScore` (default `3` when missing).
- Base maps 1-5 to 0-100.
- Bonus/penalty is ratio-normalized by exercise count:
- higher-length ratio increases score
- short-length ratio decreases score

### 6) SFR Efficiency

- Uses average `sfrScore` (default `3` when missing).
- Base maps 1-5 to 0-100.
- Bonus/penalty is ratio-normalized by exercise count.
- Low-SFR penalties apply only to low-SFR isolation movements.
- Low-SFR compounds are not blanket-penalized.

### 7) Exercise Order

- Exercises are sorted by `orderIndex`.
- Score penalizes upward `fatigueCost` transitions.
- Soft penalty is added when non-main-lift-eligible movements are ordered before main-lift-eligible movements (when eligibility metadata is present).
- Best score is achieved when fatigue cost trends down through the session.

## Suggestions

- Up to 3 suggestions are generated.
- Triggered by missing coverage, push/pull imbalance, ratio drift, missing movement patterns, low length/SFR, poor fatigue ordering, and main-lift-priority ordering violations.

## Weekly Program Scorer

Phase 5 introduced a rotation-level scorer to evaluate what template-level scoring cannot fully assess.

## Data selection

`loadWeeklyProgramInputs(...)` builds session inputs from templates:

- If `templateIds` query param is provided, those templates are scored.
- Otherwise, templates are selected by most recent update order, limited by `constraints.daysPerWeek`.
- Per-exercise set counts are estimated deterministically using `resolveSetCount(...)` with neutral fatigue defaults and user training age.

## Endpoint

- `GET /api/analytics/program-weekly`
- Optional query: `templateIds=id1,id2,id3`
- Response includes:
- `selection` metadata (days/week, training age, chosen templates)
- `analysis` (all weekly scores + suggestions)

## Weekly dimensions and weights

Weights:

- Weekly Muscle Coverage: `0.30`
- Weekly Push/Pull Balance: `0.20`
- Weekly Movement Pattern Diversity: `0.20`
- Weekly Volume Checks: `0.30`

### 1) Weekly Muscle Coverage

- Critical muscle list is `MEV > 0`.
- Weekly hit targets are muscle-class-sensitive:
- Small muscles (`Biceps`, `Triceps`, `Calves`, `Side Delts`, `Rear Delts`): `3-4` hits/week
- Medium muscles (`Chest`, `Lats`, `Upper Back`): `2-3` hits/week
- Large muscles (`Quads`, `Hamstrings`): `1.5-2` hits/week (implemented with integer thresholds)
- Fallback when class is unknown: `2` hits/week
- Credit:
- `1.0` for meeting class full-credit threshold
- `0.5` for meeting class partial-credit threshold
- `0` for no hits
- Weekly coverage output includes per-muscle target metadata (`targetWeeklyHitsByMuscle`) for transparent reporting.

### 2) Weekly Push/Pull Balance

- Uses primary-muscle set totals across all selected sessions.
- Target pull:push ratio range is `1.0` to `2.0`.
- In-range scores `100`; out-of-range scales down proportionally.
- If either side is zero, score is `0`.

### 3) Weekly Movement Pattern Diversity

- Core patterns: horizontal/vertical push/pull, squat, hinge, lunge, carry.
- Base score is covered-core proportion.
- Bonus patterns (`rotation`, `anti_rotation`) add `+5` each.

### 4) Weekly Volume Checks (vs landmarks)

Per muscle:

- `directSets` from primary-role exposure
- `indirectSets` from secondary-role exposure
- `effectiveSets = directSets + 0.3 * indirectSets`
- `indirectSetMultiplier` is included in each check output (currently global `0.3`)
- Zone:
- `below_mv`
- `mv_to_mev`
- `mev_to_mav`
- `mav_to_mrv`
- `above_mrv`

Critical-muscle scoring:

- `1.0` point when `effectiveSets` is within `MEV-MAV`
- `0.6` point when within `MV-MRV` but outside `MEV-MAV`
- `0` otherwise

## Determinism

Both scorers are deterministic for identical inputs:

- No random weighting or stochastic tie-break logic
- Sorted/normalized operations are used where ordering matters

## Reporting note

Static per-workout score tables from pre-v2 logic are intentionally removed. Current template scores depend on intent-aware scope and order-aware metadata, and weekly program scores depend on selected rotation templates and estimated weekly set exposure.
