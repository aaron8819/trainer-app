# Engine Architecture

Last verified against code: 2026-02-11

This document describes current runtime behavior for workout generation and load assignment.

For schema details, see `docs/data-model.md`.
For full end-to-end traceability, see `docs/workout-data-flow-traceability.md`.

## Current runtime scope

- Template generation is the only active generation path.
- Active generation endpoint: `POST /api/workouts/generate-from-template`.
- Deprecated auto endpoint `POST /api/workouts/generate` is removed.
- `src/lib/engine/engine.ts` is removed.

## Engine guarantees

### 1. Template orchestration

`generateSessionFromTemplate(...)` in `src/lib/api/template-session.ts`:

1. Loads template and workout context in parallel.
2. Maps Prisma records to engine types.
3. Derives `weekInBlock` and `mesocycleLength`.
4. Applies periodization with adaptive deload override (`shouldDeload`).
5. Calls `generateWorkoutFromTemplate(...)` in `template-session.ts`.
6. Calls `applyLoads(...)` for final load assignment and post-load budget safety trim.

### 2. Time budget enforcement

Timeboxing runs in two places:

1. `generateWorkoutFromTemplate(...)` pre-load trim using projected main-lift warmup ramps.
2. `applyLoads(...)` post-load trim when assigned warmups still exceed budget.

Main lifts are preserved during trimming.

### 3. Volume cap behavior

`enforceVolumeCaps(...)` supports:

- Enhanced context: per-muscle MRV cap.
- Standard context: 20% spike cap versus previous week baseline.

Template API path passes mesocycle context, so enhanced mode is active in production template generation.
Current cap limitation remains direct primary-set enforcement (effective-volume caps are a follow-up).

### 4. SRA behavior

SRA warnings are advisory:

- warnings are surfaced in response payload and notes.
- under-recovered muscles are soft-penalized in scoring.
- no hard SRA exclusion is applied.

### 5. Load assignment precedence

`applyLoads(...)` resolves load in this order:

1. progression from completed history (`computeNextLoad`)
2. baseline lookup
3. donor-based baseline estimation
4. bodyweight-ratio estimation
5. equipment default fallback

### 6. Completion-aware history

Completed sessions drive progression/volume recency logic.
Latest check-in is overlaid for readiness and pain flags.

## End-to-end generation flow

### Template mode (`POST /api/workouts/generate-from-template`)

```text
resolveOwner()
-> generateSessionFromTemplate(userId, templateId)
   -> loadTemplateDetail(...) + loadWorkoutContext(...) in parallel
   -> mapProfile/mapGoals/mapConstraints/mapExercises/mapHistory/mapPreferences/mapCheckIn
   -> deriveWeekInBlock(...) + getPeriodizationModifiers(...)
   -> if shouldDeload(history) and not already deload, override periodization to deload
   -> generateWorkoutFromTemplate(..., { sessionMinutes, weekInBlock, mesocycleLength, periodization, ... })
   -> applyLoads(...)
-> return { workout, templateId, sraWarnings, substitutions }
```

Notes:

- Template generation is user-directed and does not auto-select exercises.
- Template saves set `advancesSplit: false` for historical split queue isolation.

## Persistence and feedback flow

### Save workout (`POST /api/workouts/save`)

- Upserts `Workout`.
- Rewrites `WorkoutExercise` and `WorkoutSet` rows when exercises are supplied.
- Persists `WorkoutExercise.section` (`WARMUP | MAIN | ACCESSORY`) when provided.
- Runs `updateBaselinesFromWorkout(...)` in-transaction when status is `COMPLETED`.

### Log set (`POST /api/logs/set`)

- Upserts one `SetLog` per `WorkoutSet` (`workoutSetId` unique).
- Logged values feed future generation via `mapHistory(...)`.

## Module map (active runtime)

| Module | Responsibility |
|---|---|
| `template-session.ts` | Template workout orchestration |
| `apply-loads.ts` | Load assignment, warmup sets, post-load time trim |
| `volume.ts` | Volume context and cap enforcement |
| `timeboxing.ts` | Duration estimate and accessory trim priority |
| `warmup-ramp.ts` | Warmup ramp projection/assignment helpers |
| `sra.ts` | Recovery map and warnings |
| `substitution.ts` | Template flexible-mode substitute ranking |
| `rules.ts` | Rep ranges and periodization helpers |
| `progression.ts` | Next-load math and adaptive deload signal |
| `types.ts` | Engine contracts |

## Legacy modules retained but not on active generation path

- `split-queue.ts`
- `filtering.ts`
- `src/lib/api/split-preview.ts`

These remain in-repo for historical/tests/support code but are not referenced by active page/route generation flows.

## Known gaps

- Effective-volume cap enforcement is still a follow-up; current cap checks use direct primary-set counts.
- Pre-load and post-load timeboxing both remain by design for projection-versus-assignment drift safety.
