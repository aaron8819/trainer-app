# Workout Data Flow and Traceability

Last verified against code: 2026-02-11
Audience: engineers and system designers.

## 1) Purpose and scope

This document describes the runtime data flow for template-only workout generation and adaptation.

It covers:
- Template generation (`/api/workouts/generate-from-template`)
- Workout persistence (`/api/workouts/save`)
- Set logging (`/api/logs/set`)
- Baseline adaptation and progression loops

It does not cover deprecated auto-generation behavior except where explicitly marked as historical.

## 2) Runtime status

- Active generation endpoint: `POST /api/workouts/generate-from-template`
- Deprecated endpoint `POST /api/workouts/generate` is removed.
- `src/lib/engine/engine.ts` is removed.

## 3) High-level architecture

```text
Settings + Preferences + History + CheckIn + Exercise Catalog + Template
  -> Context Mapping (src/lib/api/workout-context.ts)
  -> Template Engine (src/lib/engine/template-session.ts)
  -> Load Assignment (src/lib/engine/apply-loads.ts)
  -> Save Workout (/api/workouts/save)
  -> Log Sets (/api/logs/set)
  -> Baseline/History Update
  -> Next generation reads updated state
```

## 4) Canonical entities in the loop

Inputs:
- `Profile`, `Goals`, `Constraints`, `UserPreference`, `Injury`, `SessionCheckIn`
- `Exercise` catalog + muscle/equipment relations
- Recent `Workout`/`WorkoutExercise`/`WorkoutSet` + latest `SetLog`
- `Baseline`
- `WorkoutTemplate` + `WorkoutTemplateExercise`

Outputs:
- Generated `Workout` plan payload
- Persisted `Workout`, `WorkoutExercise`, `WorkoutSet`
- `SetLog`
- Updated `Baseline` on completion

## 5) End-to-end generation trace

Source: `src/app/api/workouts/generate-from-template/route.ts`, `src/lib/api/template-session.ts`

```text
POST /api/workouts/generate-from-template
  -> resolveOwner()
  -> generateSessionFromTemplate(userId, templateId)
     -> loadTemplateDetail(templateId, userId)
     -> loadWorkoutContext(userId)
     -> mapProfile/mapGoals/mapConstraints/mapExercises/mapHistory/mapPreferences/mapCheckIn
     -> deriveWeekInBlock(now, activeProgramBlock, workouts)
     -> getPeriodizationModifiers(weekInBlock, primaryGoal)
     -> if shouldDeload(history) and not already deload, override periodization to deload
     -> generateWorkoutFromTemplate(..., { sessionMinutes, weekInBlock, mesocycleLength, periodization, ... })
     -> applyLoads(...)
  -> return { workout, templateId, sraWarnings, substitutions }
```

## 6) Behavior checkpoints

### 6.1 Template intent and exercise source

- Exercises come from the selected template in saved order.
- No auto split-day queue is consulted in active generation.

### 6.2 Volume/time controls

- Pre-load timeboxing in template engine trims accessories when projected minutes exceed budget.
- `applyLoads(...)` performs post-load safety-net time trim.
- Enhanced volume caps are active in template API path when mesocycle context is present:
  - MRV primary cap
  - 20% spike cap secondary safety net

### 6.3 Recovery and substitutions

- SRA remains advisory (warnings + scoring influence, no hard exclusion).
- Flexible templates (`isStrict === false`) return substitute suggestions for pain conflicts.

### 6.4 Save/log feedback loop

- `POST /api/workouts/save` persists workout/exercises/sets and sections.
- Completed saves trigger baseline update transactionally.
- `POST /api/logs/set` upserts per-set performance logs.

## 7) Historical notes (non-active)

The following are retained in-repo for historical/test contexts and are not part of active generation path:
- `src/lib/engine/split-queue.ts`
- `src/lib/engine/filtering.ts`
- `src/lib/api/split-preview.ts`

Deprecated route/module removed:
- `src/app/api/workouts/generate/route.ts`
- `src/lib/engine/engine.ts`

## 8) Known gaps

- Volume caps currently enforce direct primary-set counts; indirect/effective-volume cap enforcement is still a follow-up.
