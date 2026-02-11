# Trainer App v2 Spec

Master spec for three interconnected features: engine knowledgebase alignment, exercise library UI, and template-based training mode. Designed collaboratively via interview on 2026-02-08.

Reference: `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md` is the scientific foundation for all engine behavior.

Status note (2026-02-11): this document includes historical planning content for the deprecated auto/PPL path.
Current runtime is template-only (`/api/workouts/generate-from-template`), with `/api/workouts/generate` and `engine.ts` removed.
Use `docs/plans/template-only-deprecation-plan.md`, `docs/architecture.md`, and `docs/workout-data-flow-traceability.md` as source of truth for active behavior.

---

## Table of Contents

1. [Session Modes](#1-session-modes)
2. [Template Mode](#2-template-mode)
3. [Exercise Library](#3-exercise-library)
4. [Engine Knowledgebase Alignment](#4-engine-knowledgebase-alignment)
5. [Data Model Changes](#5-data-model-changes)
6. [Field Tuning](#6-field-tuning)
7. [PPL Split Queue Redesign](#7-ppl-split-queue-redesign)
8. [Phasing](#8-phasing)

---

## 1. Session Modes

The active runtime supports a single session-generation path (template mode). PPL mode content below is historical and retained for traceability.

### PPL Mode (historical; deprecated and removed)

Current flow: Check-in → Engine generates PPL workout → Preview → Save → Log.

Will be retrofitted with knowledgebase-aligned engine improvements (Phase 1).

### Template Mode (new)

Flow: Select a saved template → Engine applies fresh loads/reps/RPE → Preview → Save → Log.

- Templates store exercises and order only. The engine prescribes sets, reps, load, RPE, and rest fresh each time based on current training state.
- Session check-in (readiness/pain) still applies in template mode.
- Template sessions are logged to the same `Workout`/`SetLog` tables as PPL sessions.
- Template sessions do NOT advance the PPL split queue. Their completed-session history is still visible to the PPL engine for volume tracking and load progression.

---

## 2. Template Mode

### Template Data Model

New models:

```
WorkoutTemplate
  id, userId, name (e.g., "Heavy Back Day")
  targetMuscles (the muscles the user selected as the template goal)
  isStrict (bool: strict replay vs flexible/engine can substitute)
  createdAt, updatedAt

WorkoutTemplateExercise
  templateId, exerciseId, orderIndex
```

When a session is generated from a template, it creates a normal `Workout` linked back to the template (new FK: `Workout.templateId`).

### Template Management

Separate area in the app for template CRUD:

- **Browse**: List of saved templates, organized by target muscles / name
- **Create**: Two creation methods (see below)
- **Edit**: Reorder exercises, add/remove, rename, change target muscles
- **Delete**: With confirmation
- **Save-as-template**: Any completed workout can be saved as a new template (Phase 4)

### Template Creation Methods

**Custom** (build from scratch):
User picks exercises from the exercise library one by one, reorders as desired. Engine is not involved in selection.

**Smart Build** (engine-assisted):
User provides inputs, engine suggests a complete exercise list:

| Input | Required? | Description |
|-------|-----------|-------------|
| Target muscles | Yes | Hierarchical picker: coarse groups (chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves) with drill-down to fine-grained (front/side/rear delts, upper/lower back, etc.) |
| Training goal | Optional | Hypertrophy focus, strength focus, endurance |
| Time budget | Optional | e.g., "45 minutes" — engine caps exercise count |

User can then edit the suggested list before saving.

### Template Analysis ("Analyze Workout")

Before saving a template, user can trigger an analysis. The engine scores the template against its goals and provides suggestions.

**Scoring dimensions:**

1. **Volume adequacy** per target muscle (vs MEV/MAV from knowledgebase)
2. **Movement balance** (push:pull ratio, compound:isolation ratio)
3. **Lengthened-position coverage** per muscle (does the template include exercises that load at long muscle lengths?)
4. **SFR efficiency** (are high-fatigue exercises used where lower-fatigue alternatives exist?)
5. **Missing muscles** (e.g., template targets "back" but no rear delt isolation)

Output: A score summary + actionable suggestions (e.g., "Consider adding an overhead triceps extension for better long-head stimulus" or "Volume for biceps is below MEV — add 2 more sets").

### Template Session Generation

When the user selects a template for a session:

1. Check-in (readiness/pain) — same as PPL
2. Engine loads the template's exercise list
3. For each exercise, engine prescribes:
   - Sets and reps (based on goal, training age, position in mesocycle)
   - Load (from history → baseline → estimation, same progression system as PPL)
   - RPE target (based on mesocycle position)
   - Rest periods (based on exercise type per knowledgebase)
4. If `isStrict = false` (flexible mode): engine may substitute exercises for variety or to respect pain/injury constraints
5. SRA warning: if the user is hitting muscles that haven't recovered (based on SRA windows), surface a warning before generating

---

## 3. Exercise Library

### Overview

A global, browsable/filterable view of the full exercise catalog. Serves three roles:

1. **Discovery**: "What exercises hit rear delts?"
2. **Configuration**: Favorite/avoid, set baselines
3. **Reference**: Muscle targets, movement patterns, personal history

### Location

- Dedicated page (`/library`) in main nav
- Also surfaced inline when building templates (exercise picker)

### List View

Columns/info shown per exercise:
- Name
- Primary muscles
- Secondary muscles
- Compound vs isolation badge
- Movement pattern(s)

### Filtering & Sorting

| Filter | Type |
|--------|------|
| Muscle group (primary) | Multi-select, hierarchical |
| Compound vs isolation | Toggle |
| Movement pattern | Multi-select (horizontal push, vertical pull, squat, hinge, etc.) |
| Text search by name | Free text |

Filter semantics:
- OR within a filter category (e.g., selecting both `arms` and `back` returns either).
- AND across categories (e.g., `arms` + `flexion` returns only exercises matching both).
- Muscle filters use primary-muscle mappings.

Sorting: alphabetical, by muscle group, by movement pattern.

### Exercise Detail View

When tapping an exercise:

- **Muscles**: Primary and secondary, visually distinct
- **Movement patterns** (from `movementPatterns`)
- **Compound / isolation**
- **Stimulus bias** (mechanical, metabolic, stretch, stability)
- **Lengthened-position score** (once added)
- **Joint stress** (low/medium/high)
- **Variations** (tempo, paused, grip, angle)
- **Substitutions** (suggested swaps)
- **Personal history**: Last performed, best weight, recent trend
- **Actions**: Favorite / Avoid / Set baseline / Add to template

### Actions from Library

| Action | Description |
|--------|-------------|
| Favorite | Adds to `UserPreference.favoriteExerciseIds` (canonical) and mirrors name-based compatibility fields |
| Avoid | Adds to `UserPreference.avoidExerciseIds` (canonical) and mirrors name-based compatibility fields |
| Set/edit baseline | Opens baseline editor (weight range, rep range, top set) |
| Add to template | Pick an existing template or start a new one |
| View history | Navigate to exercise history (past workouts, load over time) |

### Real-Time DB Sync

The library reflects the current state of the `Exercise` table. Any changes to exercise data (seed updates, manual edits) are immediately visible. Single-user app, so no concurrency concerns.

---

## 4. Engine Knowledgebase Alignment

Retrofit both PPL and template engines to align with the hypertrophy/strength knowledgebase.

### 4.1 Volume Model

**Current (implemented)**: Enhanced per-muscle MRV caps are active in workout generation when mesocycle context is present (auto and template paths), with the 20% spike cap retained as a secondary safety net.

**Current limitation**: Cap enforcement currently uses direct primary-set counts. Indirect/effective-volume cap enforcement is a follow-up.

**Target model**: Muscle-specific volume landmarks from knowledgebase.

| Muscle Group | MV | MEV | MAV | MRV |
|---|---|---|---|---|
| Chest | 6 | 8-10 | 12-20 | 22 |
| Back | 6 | 8-10 | 14-22 | 25 |
| Front Delts | 0 | 0 | 6-8 | 12 |
| Side/Rear Delts | 6 | 8 | 16-22 | 26 |
| Quads | 6 | 8 | 12-18 | 20 |
| Hamstrings | 6 | 6 | 10-16 | 20 |
| Glutes | 0 | 0 | 4-12 | 16 |
| Biceps | 6 | 8 | 14-20 | 26 |
| Triceps | 4 | 6 | 10-14 | 18 |
| Calves | 6 | 8 | 12-16 | 20 |

The engine should:
- Track weekly sets per muscle group (counting both direct sets via PRIMARY role and acknowledging indirect volume)
- Target MAV range for each muscle
- Warn/cap at MRV
- Volume ramps +10-20% per week across a mesocycle, starting near MEV

### 4.2 Periodization

**Current**: Fixed 4-week cycle (intro/accumulate/intensify/deload) with simple RPE/sets modifiers.

**New**: Flexible mesocycle (3-6 weeks + deload) with RIR-based progression.

| Mesocycle Week | Target RIR | Volume Adjustment | Purpose |
|---|---|---|---|
| Week 1 | 3-4 RIR | Baseline (start near MEV) | Acclimate, establish baselines |
| Week 2-3 | 2-3 RIR | +1-2 sets/muscle vs prior week | Build working capacity |
| Week 4-5 | 1-2 RIR | +1-2 sets/muscle vs prior week | Peak stimulus |
| Final week | 0-1 RIR | Maintain or slight increase | Maximal stimulus before deload |
| Deload | 4-6 RIR | Reduce volume 40-60%, maintain intensity | Recovery; fatigue dissipation |

**Deload triggers** (reactive):
- 5+ consecutive sessions without progress on key lifts
- Persistent soreness beyond 72 hours
- Readiness check-in consistently low (1-2) for 4+ sessions
- Proactive: every 4-6 weeks regardless

### 4.3 Load Progression

System varies by training age (already stored in `Profile.trainingAge`):

| Training Age | System | Description |
|---|---|---|
| Beginner | Linear | Add weight every session (upper +2.5-5 lbs, lower +5-10 lbs) |
| Intermediate | Double progression | Hit top of rep range at target RIR → increase weight, reset to bottom of range |
| Advanced | Autoregulated / wave | RPE-based loading with periodic wave structures on main compounds |

**RPE adjustment**: If prescribed RPE differs from reported by 1 point, adjust ~4% (currently 2-3%, update to match KB).

**Rep range zones** (replace current simple goal-based ranges):
- ~50% of work in moderate zone (6-12 reps) — default for most exercises
- ~25% in heavy zone (1-5 reps) — main compound lifts
- ~25% in light zone (12-30+) — isolation exercises

Wider rep ranges for exercises with large relative weight jumps (e.g., lateral raises 10-20). Narrower ranges for exercises with small relative jumps (e.g., leg press 8-10).

### 4.4 Rest Periods

**Current**: Main lift 150s, compound 120s(?), isolation 75s.

**New** (from knowledgebase):

| Exercise Type | Rest Period | Rationale |
|---|---|---|
| Heavy compounds (1-5 reps) | 180-300s (3-5 min) | Full phosphocreatine + neural recovery |
| Moderate compounds (6-12 reps) | 120-180s (2-3 min) | Balance recovery and time |
| Isolation exercises | 60-120s (1-2 min) | Lower systemic demand |

### 4.5 Exercise Selection Enhancements

New scoring factors for exercise selection (both PPL accessory slots and Smart Build):

1. **SFR score**: Prefer high stimulus-to-fatigue ratio exercises, especially later in session
2. **Lengthened-position priority**: Bias toward exercises loading muscles at long lengths
3. **SRA awareness**: Don't select exercises for muscles that haven't recovered based on SRA windows
4. **Exercise rotation**: Maintain core movements for 2-3 mesocycles; rotate accessories each mesocycle
5. **Indirect volume accounting**: Front delts get massive volume from pressing — engine should recognize this and deprioritize direct front delt work

### 4.6 SRA-Based Recovery Tracking

New concept — track per-muscle recovery state:

| Muscle Category | Recovery Window | Optimal Frequency |
|---|---|---|
| Small (biceps, triceps, calves, side/rear delts) | 24-48h | 3-4x/week |
| Medium (chest, front delts, upper back/lats) | 48-72h | 2-3x/week |
| Large (quads, hamstrings, glutes) — heavy compounds | 72-96h+ | 1.5-2x/week |

Engine uses this to:
- Warn users in template mode if hitting under-recovered muscles
- Inform PPL split queue decisions
- Adjust volume down for muscles trained recently

---

## 5. Data Model Changes

### New Fields on Exercise

| Field | Type | Description |
|-------|------|-------------|
| `sfrScore` | Int (1-5) | Stimulus-to-fatigue ratio. 5 = high SFR (cables, machines, isolations), 1 = low SFR (heavy barbell compounds) |
| `lengthPositionScore` | Int (1-5) | How well the exercise loads the muscle at long length. 5 = excellent (incline curls, overhead extensions, seated leg curls), 1 = poor (short-range partials) |

### New Fields on Muscle

| Field | Type | Description |
|-------|------|-------------|
| `mv` | Int | Maintenance Volume (sets/week) |
| `mev` | Int | Minimum Effective Volume |
| `mav` | Int | Maximum Adaptive Volume (target) |
| `mrv` | Int | Maximum Recoverable Volume (ceiling) |
| `sraHours` | Int | Stimulus-Recovery-Adaptation window in hours |

### New Models

```
WorkoutTemplate
  id          String   @id @default(uuid())
  userId      String
  name        String
  targetMuscles String[]   (muscle names for template goal)
  isStrict    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

WorkoutTemplateExercise
  id          String   @id @default(uuid())
  templateId  String
  exerciseId  String
  orderIndex  Int

  @@unique([templateId, orderIndex])
```

### Modified Fields

| Model | Change | Reason |
|-------|--------|--------|
| `Exercise.movementPattern` | Deprecate → derive from `movementPatternsV2` | Consolidation; V2 is source of truth |
| `Exercise.movementPatternsV2` | Rename to `movementPatterns` | Cleaner name post-deprecation |
| `Exercise.isMainLift` + `isMainLiftEligible` | Collapse to single `isMainLiftEligible` | Simpler; the "can serve as main lift" concept is what matters |
| `Workout` | Add `templateId` FK (nullable) | Link sessions to templates |
| `Workout.advancesSplit` | Keep — template sessions set this to `false` | Prevents template sessions from advancing PPL queue |

### Removed Fields (after migration)

| Field | Reason |
|-------|--------|
| `Exercise.movementPattern` | Superseded by `movementPatterns` (renamed from V2) |
| `Exercise.isMainLift` | Collapsed into `isMainLiftEligible` |

---

## 6. Field Tuning

These fields need per-exercise differentiation. Currently most use defaults.

### fatigueCost (Int, 1-5)

Needs per-exercise tuning based on systemic and local fatigue:
- 5: Heavy barbell compounds (squat, deadlift)
- 4: Moderate compounds (bench, row, OHP)
- 3: Lighter compounds (dumbbell press, machine rows)
- 2: Standard isolations (curls, extensions, lateral raises)
- 1: Light isolation / stability (planks, face pulls, band work)

### timePerSetSec

Needs per-exercise tuning. Current blanket 120s for accessories is inaccurate:
- Main lifts (heavy compounds): 180-210s
- Compound accessories: 120-150s
- Standard isolations: 75-90s
- Light isolations / stability: 45-60s
- Warmup / mobility: 30-60s

### stimulusBias

Currently 22% coverage (40 of 180 exercises). Expand to all exercises. Every exercise should have at least one bias:
- MECHANICAL: Heavy compounds with high absolute tension
- STRETCH: Exercises loading at long muscle lengths
- METABOLIC: High-rep, pump-focused exercises
- STABILITY: Balance/stabilizer-dependent exercises

### contraindications

Currently 5% coverage (9 of 180 exercises). Critical safety gap. Expand to cover:
- **Knee**: Squats, lunges, leg extensions, leg press, Bulgarian split squats
- **Low back**: RDLs, deadlifts, barbell rows, good mornings, leg press
- **Shoulder**: Overhead movements, lateral raises (above 90deg), pec flies, dips, upright rows
- **Elbow**: All curl variations, skull crushers, close-grip bench
- **Hip**: Deep squats, hip thrusts, lunges, hip abduction/adduction

### sfrScore (new)

Score all exercises for stimulus-to-fatigue ratio:
- 5 (high SFR): Cable laterals, machine curls, leg extensions, pec deck
- 4: Dumbbell isolations, cable rows, machine presses
- 3: Dumbbell compounds, chest-supported rows
- 2: Standing barbell compounds (bench, OHP, barbell row)
- 1 (low SFR): Heavy barbell squats, deadlifts (high systemic fatigue)

### lengthPositionScore (new)

Score all exercises for lengthened-position loading:
- 5: Incline dumbbell curls, overhead triceps extensions, seated leg curls, cable flyes at full stretch, standing calf raises (deep dorsiflexion)
- 4: RDLs, deep squats, dumbbell presses (deeper stretch than barbell)
- 3: Standard full-ROM exercises (barbell bench, rows)
- 2: Machine exercises with partial ROM
- 1: Shortened-position exercises (top-half partials, pushdowns vs overhead)

---

## 7. PPL Split Queue Redesign

### Current Behavior

Perpetual PPL rotation via split queue. Manual sessions don't advance the queue. Split day is determined by queue position.

### New Behavior

The PPL split queue should be **history-based** rather than position-based.

**Algorithm:**
1. Look at the last 3 completed sessions (ALL modes — PPL and template)
2. Map each session's exercises to muscle groups (via `ExerciseMuscle` PRIMARY mappings)
3. Classify each session as push-dominant, pull-dominant, or legs-dominant based on which muscles were trained
4. The next PPL day = the split that was LEAST recently trained

**Muscle → Split mapping:**
- Push: Chest, Front Delts, Side Delts, Triceps
- Pull: Back, Upper Back, Rear Delts, Biceps
- Legs: Quads, Hamstrings, Glutes, Calves

**Edge cases:**
- If a template session mixes push and pull muscles, classify it by which split has more primary sets
- If no history exists, default to Push (start of rotation)
- Template sessions set `Workout.advancesSplit = false` and are excluded from split advancement/lookup

**SRA warning integration:**
When generating a PPL workout, if the selected split would hit muscles that haven't recovered (based on SRA windows from last session targeting those muscles), surface a warning: "Your chest was trained 24 hours ago and typically needs 48-72 hours to recover. Generate anyway?"

---

## 8. Phasing & Implementation Status

Status legend: [x] done, [~] partial/deferred, [ ] not started

### Phase 1 — Foundation (Engine + DB) — COMPLETE

**Goal**: Align engine with knowledgebase, tune exercise fields, update data model.

- [x] Add new DB fields: `sfrScore`, `lengthPositionScore` on Exercise; `mv`, `mev`, `mav`, `mrv`, `sraHours` on Muscle
- [x] Tune existing fields: `fatigueCost`, `timePerSetSec`, `stimulusBias`, `contraindications` for all exercises — comprehensive tuning for all 66 exercises in seed data
- [x] Deprecate `movementPattern` → derive from `movementPatternsV2` (rename to `movementPatterns`) — V1 field dropped, V2 renamed to `movementPatterns` (Phase 4)
- [x] Collapse `isMainLift` + `isMainLiftEligible` → single `isMainLiftEligible` — `isMainLift` dropped from Exercise model (Phase 4)
- [x] Implement muscle-specific volume model (MV/MEV/MAV/MRV tracking) — `VOLUME_LANDMARKS` + `EnhancedVolumeContext` in `volume.ts`
- [x] Implement flexible mesocycle periodization (RIR ramp, reactive deload triggers) — `getMesocyclePeriodization()` + `shouldDeload()` in `progression.ts`
- [x] Update load progression to vary by training age — `computeNextLoad()` dispatches: beginner (linear), intermediate (double), advanced (autoregulated)
- [x] Update rest periods to match knowledgebase tiers — `getRestSeconds()` in `prescription.ts` with fatigueCost-modulated tiers
- [x] Update RPE adjustment from 2-3% to ~4% per point — 0.04 (4%) in `progression.ts`
- [x] Implement SRA tracking (per-muscle recovery windows) — `sra.ts` module with `buildMuscleRecoveryMap()` + `generateSraWarnings()`
- [x] Redesign PPL split queue to be history-based — `getHistoryBasedSplitDay()` in `split-queue.ts`

### Phase 2 — Exercise Library UI — COMPLETE

**Goal**: Browsable, filterable exercise catalog with actions.

- [x] Library page (`/library`) with list view — `ExerciseLibraryShell` + `ExerciseList` components
- [x] Filtering: muscle group (hierarchical, multi-select), compound/isolation, movement pattern (multi-select), text search — `FilterBar` + `MuscleGroupChips` + `filtering.ts`
- [x] Exercise detail view: muscles, patterns, stimulus bias, joint stress, SFR/length-position scores, variations, substitutions — `ExerciseDetailSheet`
- [x] Actions: favorite, avoid, set baseline — API routes + `ExerciseDetailSheet` actions
- [x] Action: add to template — `AddToTemplateSheet` integrated in detail view (Phase 4)
- [x] Action: view history — `PersonalHistorySection` with trend + personal bests (Phase 4)
- [x] Sorting: 6 sort options (name, SFR, fatigue, stretch position, muscle group) (Phase 4)
- [x] Exercise detail: personal history — last 3 sessions, trend, personal bests (Phase 4)
- [x] Inline exercise picker component (reused in template builder) — `ExercisePicker` + `ExercisePickerTrigger` with collapsible advanced filters

### Phase 3 — Template Mode — COMPLETE

**Goal**: Full template creation, management, and session generation.

- [x] Template data model + migrations — `WorkoutTemplate` + `WorkoutTemplateExercise` models, `Workout.templateId` FK
- [x] Template management pages (browse, create, edit, delete) — `/templates`, `/templates/new`, `/templates/[id]/edit` + API CRUD
- [x] Custom creation (pick from library) — `TemplateForm` + `ExercisePicker` with reordering
- [x] Smart Build creation (engine-assisted) — core algorithm works (`smart-build.ts`); optional training goal + time budget inputs deferred to Phase 4
- [x] Template analysis scoring — all 6 dimensions implemented: muscle coverage, push/pull balance, compound/isolation ratio, movement diversity, lengthened-position coverage (`scoreLengthPosition`), SFR efficiency (`scoreSfrEfficiency`)
- [x] Session generation from template (engine prescribes loads/reps/RPE) — `generateWorkoutFromTemplate()` + `applyLoads()`
- [x] Template-only generation entry point on dashboard — `DashboardGenerateSection` renders `GenerateFromTemplateCard` only (PR1 deprecation cutover)
- [x] SRA warnings when generating sessions — warnings generated, returned in API, displayed in UI

### Phase 4 — Polish — COMPLETE

**Goal**: Quality-of-life features building on the foundation.

- [x] Smart Build: add optional training goal input (hypertrophy/strength/fat_loss bias) — goal-aware scoring + compound count adjustment
- [x] Smart Build: add optional time budget input (caps exercise count) — time-based trimming after ordering
- [x] Save-as-template from any completed workout — `SaveAsTemplateButton` with auto-derived target muscles
- [x] Flexible template mode (engine can substitute exercises for variety/injury) — `SubstitutionSuggestion` returned for pain-conflicting exercises
- [x] SRA-based guidance in workout review — `MuscleRecoveryPanel` on analytics Recovery tab
- [x] Volume tracking dashboard (sets/muscle/week vs landmarks) — `MuscleVolumeChart` + `WeeklyVolumeTrend` with MEV/MAV/MRV reference lines
- [x] Template analytics (usage frequency, muscle coverage trends) — `TemplateStatsSection` with completion rates
- [x] Exercise library: "add to template" action — `AddToTemplateSheet` in detail view
- [x] Exercise library: personal history view — `PersonalHistorySection` with trend + personal bests
- [x] Exercise library: sort by muscle group / SFR / fatigue / stretch position — 6 sort options in dropdown
- [x] Schema cleanup: dropped `movementPattern` V1, renamed `movementPatternsV2` → `movementPatterns`
- [x] Schema cleanup: dropped `Exercise.isMainLift`, consolidated to `isMainLiftEligible`

---

## Design Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Path A: retrofit PPL engine first, then build template mode on shared foundation | Avoid maintaining two divergent engines; knowledgebase improvements benefit all modes |
| D2 | Template mode stores exercises + order only; engine handles load/reps fresh each time | Allows workouts to evolve with the user's progression |
| D3 | All session history (PPL + template) feeds into load progression and volume tracking | A bench press is a bench press regardless of mode |
| D4 | Template sessions do not advance PPL split queue and are excluded from split advancement decisions via `advancesSplit: false` | PPL rotation should reflect advancing sessions only, while template sessions still contribute to recovery/progression history when completed |
| D5 | PPL split queue redesign: history-based (look at last 3 advancing completed sessions) rather than position-based | More intelligent scheduling with explicit completion and advancement semantics |
| D6 | Deprecate `movementPattern` in favor of `movementPatternsV2` (renamed `movementPatterns`) | Reduce field duplication; V2 is strictly more expressive |
| D7 | Collapse `isMainLift` + `isMainLiftEligible` into single `isMainLiftEligible` | Simpler model; the distinction was never exercised in practice |
| D8 | Exercise library is both standalone page and inline picker in template builder | Maximum reuse; users need it in both contexts |
| D9 | Template creation offers "Custom" (manual) and "Smart Build" (engine-assisted) modes | Different users / different contexts need different levels of automation |
| D10 | Template analysis scores against 5 dimensions: volume, balance, lengthened-position, SFR, muscle gaps | Grounded in knowledgebase principles |

---

*Open questions moved to [spec-v3.md](spec-v3.md).*


