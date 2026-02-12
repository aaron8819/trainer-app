# Exercise Selection Algorithm Spec (Hybrid)

Date: 2026-02-12  
Status: Implemented through Phase 5 rollout controls (history-backed weekly scoring + gated new-user default + KPI tracking + manual session review pack)  

## 1. Purpose

Define a concrete, deterministic exercise selection algorithm that supports:

- Template mode with optional pinned + auto fill (advisory volume model).
- Intent-driven mode with engine-owned selection and set allocation (prescriptive volume model).

This spec is designed to reuse existing engine modules where possible:

- `buildVolumeContext`, `getTargetVolume`, `enforceVolumeCaps` (`src/lib/engine/volume.ts`)
- `estimateWorkoutMinutes`, `trimAccessoriesByPriority`, `scoreAccessoryRetention` (`src/lib/engine/timeboxing.ts`)
- prescription/load stack in `src/lib/engine/prescription.ts` and `src/lib/engine/apply-loads.ts`

## 2. Non-Goals

- Replacing current prescription, load progression, deload, or timeboxing engines.
- Removing manual templates.
- Building a separate Rotation entity in V1.

## 3. Modes

### 3.1 Template Mode (Advisory Volume)

- User supplies full template or pins some exercises and enables auto-fill.
- Engine selects only non-pinned slots.
- Set-count logic remains current template path behavior (`resolveSetCount`-based).
- Engine returns volume adequacy feedback (`target`, `planned`, `delta`) but does not force full deficit closure.

### 3.2 Intent Mode (Prescriptive Volume)

- User supplies intent (and optional pins), time budget, and constraints.
- Engine selects all non-pinned exercises.
- Engine allocates sets to close weekly dose gaps within constraints.

## 4. Inputs and Outputs

### 4.1 Selection Input

```ts
type SelectionInput = {
  mode: "template" | "intent";
  intent: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  targetMuscles?: string[]; // required when intent === "body_part"
  pinnedExerciseIds?: string[]; // maxPinned = max(1, targetSlotCount - 2)
  templateExerciseIds?: string[]; // template mode only
  weekInBlock: number;
  mesocycleLength: number;
  sessionMinutes: number;
  trainingAge: "beginner" | "intermediate" | "advanced";
  goals: { primary: string; secondary?: string };
  constraints: {
    availableEquipment: string[];
    daysPerWeek: number;
  };
  program?: { id: string; weeklySchedule?: string[] }; // active program context
  preferences?: {
    favoriteExerciseIds?: string[];
    avoidExerciseIds?: string[];
  };
  fatigueState: {
    readinessScore: 1 | 2 | 3 | 4 | 5;
    painFlags?: Record<string, 0 | 1 | 2 | 3>;
  };
  history: WorkoutHistoryEntry[];
  exerciseLibrary: Exercise[];
};
```

### 4.2 Selection Output

```ts
type SelectionOutput = {
  selectedExerciseIds: string[];
  mainLiftIds: string[];
  accessoryIds: string[];
  perExerciseSetTargets: Record<string, number>; // prescriptive in intent mode
  volumePlanByMuscle: Record<string, { target: number; planned: number; delta: number }>;
  rationale: Record<
    string,
    {
      score: number;
      components: Record<string, number>;
      hardFilterPass: boolean;
      selectedStep: "pin" | "anchor" | "main_pick" | "accessory_pick";
    }
  >;
};
```

## 5. Candidate Pipeline

### 5.1 Hard Filters (exclude candidate)

A candidate is removed if any condition fails:

- Equipment not available (`bodyweight` candidates bypass equipment gating).
- Explicitly avoided by user.
- Contraindicated for active pain flags.
- Accessory phase only (goal-specific): exclude exercises with `sfrScore <= 1` when `goals.primary` is `hypertrophy` or `fat_loss` (missing `sfrScore` defaults to `3` and passes).
- Not compatible with mode slot type (main/accessory phase rules).
- Main-lift phase only: not `isMainLiftEligible` or no rep-range overlap with goal main range.

### 5.2 Soft Scoring Features

Each surviving candidate gets a weighted score.

Normalized component range: `[-1, 1]` unless noted.

- `muscleDeficitScore`: how much weekly deficit this exercise can close.
- `targetednessScore`: bonus when candidate directly targets highest remaining-deficit muscle.
- `sfrScore`: normalized from metadata (`(sfrScore - 3) / 2`).
- `lengthenedScore`: normalized from metadata (`(lengthPositionScore - 3) / 2`).
- `recencyPenalty`: higher penalty if used recently across all intents (7-day scope).
- `preferenceScore`: favorite boost, neutral otherwise.
- `movementDiversityScore`: bonus when adding uncovered movement patterns.
- `continuityScore`: bonus if candidate is an established anchor (progression continuity).
- `timeFitScore`: penalty when projected duration margin is low (lightweight running estimate).
- `fatigueCostPenalty`: higher penalty for high fatigue cost when readiness is low.
- `redundancyPenalty`: penalizes repeated same-muscle same-pattern stacking.

### 5.3 Weighted Formula

```text
score(c) =
  w_muscleDeficit(slotProgress) * muscleDeficitScore(c)
+ 0.9 * targetednessScore(c)
+ w_sfr(slotProgress) * sfrScore(c)
+ 0.8 * lengthenedScore(c)
+ 1.0 * preferenceScore(c)
+ 0.9 * movementDiversityScore(c)
+ 1.1 * continuityScore(c)
+ 0.6 * timeFitScore(c)
- 1.2 * recencyPenalty(c)
- w_redundancy(slotProgress) * redundancyPenalty(c)
- w_fatigue(slotProgress) * fatigueCostPenalty(c)
```

`slotProgress` is `filledAccessorySlots / totalAccessorySlots` (clamped `[0, 1]`) and applies to accessory-phase scoring only.

Accessory dynamic weights (implemented):

- `w_muscleDeficit(p) = lerp(3.0, 2.0, p)`
- `w_sfr(p) = lerp(1.2, 1.8, p)`
- `w_redundancy(p) = lerp(1.0, 1.5, p)`
- `w_fatigue(p) = lerp(1.3, 2.0, p)`

Main-phase scoring keeps fixed baseline weights.

Notes:

- Keep deterministic ordering with tie-breakers:
1. higher score
2. lower fatigue cost
3. alphabetical exercise name
- This mirrors the current retention scoring pattern but in selection direction (add-best vs trim-worst).

### 5.4 Component Definitions (Concrete)

Use provisional set count during scoring:

- `provisionalSets = 4` for main-lift phase
- `provisionalSets = 3` for accessory phase

Definitions:

1. `muscleDeficitScore(c)`: for each muscle `m` hit by candidate `c`, compute `remaining_m = max(0, target_m - plannedEffectiveSets_m)`, `need_m = clamp(remaining_m / max(1, target_m), 0, 1)`, `contrib_m = 1.0` for primary and `0.3` for secondary, and `dose_m = contrib_m * provisionalSets`; then `muscleDeficitScore = clamp(sum(need_m * dose_m) / 4, -1, 1)`.
2. `targetednessScore(c)`: `+0.3` when one of candidate primary muscles is currently the highest remaining-deficit muscle; otherwise `0.0`.
3. `recencyPenalty(c)` uses all intents in a rolling 7-day window: `1.0` if used in last 48h, `0.7` if 48-96h, `0.4` if 96-168h, else `0.0`.
4. `preferenceScore(c)`: `+1.0` if favorite, else `0.0`.
5. `movementDiversityScore(c)`: `+1.0` if it adds uncovered core pattern, `+0.5` for uncovered non-core pattern, `-0.5` if it duplicates covered pattern without adding muscle coverage.
6. `continuityScore(c)`: `+1.0` if auto-anchor (`>=2` of last `3` same-intent sessions), `+0.4` if recently seen with positive trend, else `0.0`.
7. `timeFitScore(c)`: `+1.0` if projected time is <= `budget - 5` min, `0.0` if within budget, `-1.0` if above budget; use lightweight running tally during selection and reserve full `estimateWorkoutMinutes` for post-fill safety.
8. `fatigueCostPenalty(c)`: `base = clamp((fatigueCost - 1) / 4, 0, 1)` multiplied by readiness factor (`1.0` when readiness <= `2`, `0.5` when readiness = `3`, `0.2` when readiness >= `4`).
9. `redundancyPenalty(c)`: based on overlap count of primary muscle plus dominant pattern in selected list (`0.5` on second overlap, `1.0` on third or more).

### 5.5 Weight Calibration Protocol (Required Before Freeze)

Before freezing production weights, run scenario walkthroughs against real workout history and seeded exercise metadata:

1. `push` week-3 intermediate scenario: verify ranking among bench, incline DB press, cable fly, lateral raise.
2. `pull` deficit scenario: biceps below target while lats are at target; verify a curl can outrank a row.
3. `legs` recency scenario: recent hack squat session; verify recency can shift toward front squat or leg press.
4. `full_body` time-constrained scenario: verify late-slot ranking prefers high-SFR, low-fatigue accessories.

Add slot-position multipliers during calibration if needed:

- Early accessory slots: prioritize deficit closure (`muscleDeficitScore` dominant).
- Late accessory slots: increase relative weight of SFR, fatigue, and diversity.
- Keep V1 on continuous scoring; only introduce explicit phase-boundary logic if calibration shows persistent over-selection of compounds in late accessory slots.

Calibration run status (2026-02-12, real seeded library via `scripts/calibrate-selection-weights.ts`):

- PASS: push week-3 scenario (post-main-lift side-delt deficit can validly outrank chest accessories; ranking now matches training-quality expectation for this setup).
- PASS: pull deficit scenario (`Cable Curl` outranks `Seated Cable Row` when lats are near target).
- PASS: legs recency scenario (recent `Hack Squat` history shifts rank toward alternatives such as `Leg Press`).
- PASS: full-body late-slot scenario (late-slot ranking now favors lower-fatigue, high-SFR options; moderate-fatigue compounds receive non-zero fatigue penalties).

Conclusion before Phase 5 default-to-intent:

- Weight calibration prerequisite is complete (`4/4` scenarios pass) with real seeded exercise metadata.
- Remaining known Phase-5 prerequisites have now been closed:
  - Weekly analysis Option A added (history-backed estimation for non-template scheduled intents).
  - New-user default flip gated behind feature flag with KPI reporting.
  - Full-session manual ranking review artifact generated (`docs/template/phase5-intent-session-manual-review.md`).

## 6. Selection Order (Greedy Re-Scoring)

Selection is sequential because each pick changes deficits, pattern coverage, and remaining time.

1. Resolve pins (user-specified, validated by hard filters).
2. Resolve auto-anchors for non-pinned slots; an anchor is an exercise seen in at least `2` of the last `3` same-intent sessions.
3. Apply anchor eviction at mesocycle boundary: when `weekInBlock === 0`, non-pinned anchors lose continuity bonus for first `1-2` sessions of the new block.
4. Main-lift phase: fill up to `2` main-lift slots after pins and anchors, re-scoring after each pick.
5. Accessory phase (continuous scoring): fill accessory slots one-by-one with re-scoring after each pick; pass current accessory slot index into scoring so dynamic weights can use `slotProgress`.
6. Post-fill optimization (V1.1 fast-follow): optionally run superset auto-pairing for antagonist-compatible accessories, then re-estimate time.
7. Post-fill safety: run `enforceVolumeCaps` then timeboxing trim with full `estimateWorkoutMinutes` and `trimAccessoriesByPriority`.

Complexity:

- `O(poolSize * slotCount)` with small pool and slot counts, acceptable for runtime API.
- In-loop `timeFitScore` should use a lightweight running estimate and intentionally exclude warmup ramps; warmup-aware timing is enforced in post-fill safety.

### 6.1 Deterministic Pseudocode

```ts
function selectExercises(input: SelectionInput): SelectionOutput {
  const state = initSelectionState(input);
  applyPins(state);
  applyAutoAnchors(state);

  while (state.mainSlotsRemaining > 0) {
    const candidates = buildMainCandidates(state, input);
    const scored = scoreCandidates(candidates, state, input, "main");
    const pick = pickBestDeterministic(scored);
    if (!pick) break;
    addExerciseToState(state, pick, "main_pick");
  }

  while (state.accessorySlotsRemaining > 0) {
    const candidates = buildAccessoryCandidates(state, input);
    const scored = scoreCandidates(candidates, state, input, "accessory");
    const pick = pickBestDeterministic(scored);
    if (!pick) break;
    addExerciseToState(state, pick, "accessory_pick");
  }

  if (enableSupersetAutoPairing) autoPairSupersets(state); // optional V1.1
  enforceVolumeCapsOnState(state);
  trimToTimeBudget(state);
  assignSetsAndPrescription(state, input.mode); // intent mode uses set-count override into prescription
  return buildOutput(state);
}
```

## 7. Slot Targets by Intent

Initial target shape before time trim:

- `push`: 1-2 main, 3-5 accessories
- `pull`: 1-2 main, 3-5 accessories
- `legs`: 1-2 main, 3-5 accessories
- `upper`: 1-2 main, 4-6 accessories
- `lower`: 1-2 main, 3-5 accessories
- `full_body`: 1-2 main, 4-6 accessories
- `body_part`: 0-2 main, 4-6 accessories

Timeboxing can reduce accessory count.

### 7.1 `body_part` Intent Rules

`body_part` mode has additional constraints:

1. `targetMuscles` is required.
2. If no main-lift-eligible exercise matches `targetMuscles`, session may run with `0` main lifts (all-accessory).
3. Enforce per-session direct-set soft caps during allocation to avoid diminishing returns: large muscles `10` direct sets/session, small muscles `8` direct sets/session.
4. If session cap is reached while weekly deficit remains, defer remaining deficit to next session in weekly schedule.

## 8. Volume Logic Decision (Explicit)

### 8.1 Template Mode

- Keep current set assignment pipeline.
- Add feedback only: `volumePlanByMuscle` returned in generation response.

### 8.2 Intent Mode

- Use prescriptive dose allocation.

Per muscle:

1. `target = getTargetVolume(landmark, weekInBlock, mesocycleLength)`
2. `planned = effectiveWeeklySets(history + selectedSessionDraft)`
3. `remaining = max(0, target - planned)`

Per exercise set allocation:

1. Start all selected exercises at `2` working sets.
2. Compute marginal deficit closure from adding one set to each exercise, where primary contribution is `1.0` and secondary contribution is `0.3`.
3. Iteratively add sets to highest marginal-closure exercise.
4. Clamp per-exercise sets by training age: beginner max `4`, intermediate max `5`, advanced max `6`.
5. Stop when all critical muscle deficits are closed or time limit is reached.
6. Run `enforceVolumeCaps` as final ceiling check.

Deterministic set-allocation pseudocode:

```ts
while (deficitsRemain(1.0) && timeAllowsOneMoreSet()) {
  const ranked = selectedExercises
    .filter((ex) => ex.sets < maxSetsByAge(trainingAge))
    .map((ex) => ({ ex, gain: marginalDeficitClosure(ex) }))
    .sort(byGainThenOrderIndexThenName);
  if (ranked.length === 0 || ranked[0].gain <= 0) break;
  ranked[0].ex.sets += 1;
  updateDeficits(ranked[0].ex, 1); // updates primary and secondary muscles in accumulated planned state
}
```

`deficitsRemain(minEffectiveSetGap = 1.0)` should only continue when at least one critical muscle has `remaining >= minEffectiveSetGap`, avoiding chasing fractional deficits with full sets.

`updateDeficits` must update all muscles touched by the added set:

```ts
function updateDeficits(exercise: Exercise, addedSets = 1) {
  for (const muscle of exercise.primaryMuscles ?? []) {
    state.plannedEffective[muscle] = (state.plannedEffective[muscle] ?? 0) + addedSets * 1.0;
  }
  for (const muscle of exercise.secondaryMuscles ?? []) {
    state.plannedEffective[muscle] =
      (state.plannedEffective[muscle] ?? 0) + addedSets * INDIRECT_SET_MULTIPLIER;
  }
}
```

### 8.3 Selection-to-Prescription Handoff

Selection engine owns:

- selected exercise list and order
- exercise role (`main` or `accessory`)
- set counts via `perExerciseSetTargets`

Prescription engine owns (existing behavior):

- target reps and rep ranges
- target RPE
- rest seconds

Intent-mode integration contract:

1. Selection returns `perExerciseSetTargets`.
2. Prescription runs per exercise with set-count override.
3. Load assignment remains unchanged.

Implementation recommendation:

- Add optional `overrideSetCount?: number` to `prescribeSetsReps`.
- If `overrideSetCount` is present, skip `resolveSetCount` and use override.
- Template mode does not pass override, preserving existing behavior.

## 9. Cold Start Protocol

Selection unlock is staged. Avoid full auto with zero signal.

- Stage 0 (new user): use curated starter sessions from `trainer-app/docs/knowledgebase/workouts.md` mapped by intent.
- Stage 1 unlock criteria: at least `4` completed sessions and at least `2` check-ins; then allow auto-fill for non-anchor accessory slots only.
  - Stage 0 bypass (experienced cold start): promote directly to Stage 1 when all are true: `trainingAge` is `intermediate` or `advanced`, at least `3` baselines exist for `isMainLiftEligible` exercises, and each counted baseline has a non-null `workingWeightMin` or `topSetWeight`.
  - When Stage 0 bypass is applied, selection metadata includes `coldStartBypass: "baseline_experienced"` alongside `coldStartStage`.
- Stage 2 unlock criteria: at least `12` completed sessions plus stable baselines on core movements; then allow full intent-driven selection.
  - Stable baseline signal (Phase 4 implementation): at least `3` main-lift-eligible exercises with a stored baseline and at least `2` completed workouts containing logged performance (`actualLoad` + `actualReps`) for each exercise.

Fallback rule:

- If candidate pool after hard filters is too small, fallback to safest starter-session variant for that intent.

## 10. Persistence and API Contracts

### 10.1 Schema Changes (V1)

- Add `Workout.sessionIntent` (enum aligned to intent list).
- Add `INTENT` to `WorkoutSelectionMode`.
- Add `weeklySchedule` (ordered intent array) to `Program` (authoritative schedule owner).
- Add `Workout.selectionMetadata` JSON for rationale traceability (optional but recommended).

Analytics note:

- Keep JSON in V1 for iteration speed.
- Add normalized `SelectionReason` table in V2 if aggregate queryability becomes limiting.

Semantics:

- Intent-driven sessions set `selectionMode = INTENT`.
- Intent-driven sessions set `sessionIntent` directly from request.
- `advancesSplit` remains `true` for intent-driven sessions (they are split-driving sessions).
- Template-generated sessions keep current behavior unless explicitly changed by product decision.
- Intent generation now includes `selection.coldStartStage` in the selection metadata payload; this is persisted through save via `Workout.selectionMetadata`.
- Intent generation metadata now also includes `selection.coldStartProtocolEnabled` and `selection.effectiveColdStartStage` so diagnostics reflect the stage actually enforced by selection when the feature flag is on/off.
- Cold-start staged unlock behavior is currently controlled by `USE_INTENT_COLD_START_PROTOCOL` (off by default unless explicitly enabled).

### 10.2 Endpoint Surfaces

- `POST /api/workouts/generate-from-template`
- Add optional `pinnedExerciseIds` and `autoFillUnpinned`.
- Return `volumePlanByMuscle`.
- `POST /api/workouts/generate-from-intent`
- Request contains intent plus optional pins and standard context.
- Validate `targetMuscles` when `intent = body_part`.
- Uses the same selection core as template auto-fill with `templateExerciseIds = []`.

## 11. Observability and KPIs

Track per mode and intent:

- `volumeAdherenceAccuracy`: `plannedSets / targetSets` by muscle per week.
- pre-start edit rate.
- mid-workout substitution rate.
- completion rate.
- 4-week retention.
- anchor progression trend.
- pain/conflict incidence.

Success threshold for defaulting new users to intent mode:

- no regression in completion and retention
- improved volume adherence
- reduced pre-start edits

Phase-5 readiness note:

- Weekly analysis now includes history-backed estimation for scheduled intent slots that do not have template matches (Option A), preventing false "below target" warnings in mixed template+intent rotations.
- Default-mode rollout for new users is gated via `USE_INTENT_DEFAULT_FOR_NEW_USERS`; KPIs are available from analytics summary grouped by `selectionMode` and `sessionIntent`.

## 12. Rollout Sequence

1. Phase 1: template scoring improvements + `volumePlanByMuscle` in generation response.
2. Phase 2: shared selection engine + pinned auto-fill (template) + intent endpoint (same core).
3. Phase 3: add weekly schedule field and proactive weekly analysis at schedule setup.
4. Phase 4: ship cold-start staged unlock + anchor persistence logic.
5. Phase 5: KPI-gated default to intent for new users.

## 13. Implementation Notes

- Reuse existing helpers instead of net-new logic where possible: scoring shape from `scoreAccessoryRetention`, cap enforcement from `enforceVolumeCaps`, and trimming from `trimAccessoriesByPriority`.
- Keep selection deterministic (no random weighted pick in API path).
- Keep template mode backward compatible: if no auto-fill inputs, behavior remains unchanged.
- Enforce dynamic pin ceiling per generated slot count (`maxPinned = max(1, targetSlotCount - 2)`).
