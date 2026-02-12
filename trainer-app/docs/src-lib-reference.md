# `src/lib` Reference

Last verified against code: 2026-02-12

Comprehensive implementation reference for shared library code in `src/lib`.

This document complements:
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/seeded-data.md`

## Scope

Covered areas:
- `src/lib/api`
- `src/lib/data`
- `src/lib/db`
- `src/lib/engine`
- `src/lib/exercise-library`
- `src/lib/supabase`
- `src/lib/ui`
- `src/lib/validation.ts`

## Design Overview

```text
src/app routes/pages/components
  -> src/lib/api
  -> src/lib/validation
  -> src/lib/exercise-library
  -> src/lib/ui

src/lib/api
  -> src/lib/db
  -> src/lib/engine
```

## `api` (`src/lib/api`)

| File | Responsibility | Main exports |
|---|---|---|
| `src/lib/api/workout-context.ts` | Context loading, owner resolution, Prisma-to-engine mapping, load application wrapper | `resolveOwner`, `resolveUser`, `loadWorkoutContext`, `mapProfile`, `mapGoals`, `mapConstraints`, `mapExercises`, `mapHistory`, `mapPreferences`, `mapCheckIn`, `applyLoads`, `deriveWeekInBlock` |
| `src/lib/api/template-session.ts` | End-to-end template session generation | `generateSessionFromTemplate` |
| `src/lib/api/weekly-program-selection.ts` | Template selection helpers for weekly analysis (schedule-aware template picking + intent fallback order) | `selectTemplatesForWeeklyProgram`, `pickTemplateForSessionIntent` |
| `src/lib/api/intent-rollout.ts` | New-user default mode gating helpers controlled by rollout flag | `isIntentDefaultForNewUsersEnabled`, `shouldDefaultNewUserToIntent` |
| `src/lib/api/templates.ts` | Template CRUD + template scoring list | `loadTemplates`, `loadTemplateDetail`, `createTemplate`, `updateTemplate`, `loadTemplatesWithScores`, `deleteTemplate` |
| `src/lib/api/exercise-library.ts` | Exercise list/detail loading + substitute resolution | `loadExerciseLibrary`, `loadExerciseDetail` |
| `src/lib/api/baseline-updater.ts` | Baseline candidate evaluation and transactional upsert | `updateBaselinesFromWorkout` and helpers |
| `src/lib/api/analytics.ts` | Weekly muscle volume aggregation and landmark exposure | `computeWeeklyMuscleVolume`, `getVolumeLandmarks` |
| `src/lib/api/periodization.ts` | Week-in-block derivation | `deriveWeekInBlock` |
| `src/lib/api/weekly-program.ts` | Inputs for weekly program analysis | `loadWeeklyProgramInputs` |

Notes:
- Active generation paths include template mode (`generateSessionFromTemplate`) and intent mode (`/api/workouts/generate-from-intent`).
- Template generation response now includes advisory `volumePlanByMuscle` in addition to workout payload and warnings/suggestions.
- Intent generation uses shared deterministic selection with selector-owned set overrides and metadata persistence.
- `src/lib/api/split-preview.ts` is legacy helper code and not used by active routes/pages.

## `engine` (`src/lib/engine`)

Purpose:
- Pure training logic for template and intent generation, shared selection, prescription, volume/time enforcement, and load progression.

Active generator entrypoints:
- `generateWorkoutFromTemplate` in `src/lib/engine/template-session.ts`
- `selectExercises` in `src/lib/engine/exercise-selection.ts`
- `applyLoads` in `src/lib/engine/apply-loads.ts`

Removed/deprecated:
- `src/lib/engine/engine.ts` removed.
- Auto generation route `POST /api/workouts/generate` removed.

Core modules:

| Area | Files |
|---|---|
| Generation/runtime | `template-session.ts`, `exercise-selection.ts`, `apply-loads.ts`, `rules.ts`, `progression.ts` |
| Volume/recovery/time | `volume.ts`, `volume-landmarks.ts`, `sra.ts`, `timeboxing.ts`, `warmup-ramp.ts`, `history.ts` |
| Analysis/planning | `template-analysis.ts`, `weekly-program-analysis.ts`, `smart-build.ts` |
| Utilities/contracts | `types.ts`, `utils.ts`, `random.ts`, `sample-data.ts` |

Legacy engine files retained but not on active generation path:
- `split-queue.ts`
- `filtering.ts`

## `settings` (`src/lib/settings`)

Split recommendation helpers were removed as part of template-only deprecation cleanup.

## `validation` (`src/lib/validation.ts`)

Main schemas:

| Schema | Used by |
|---|---|
| `generateFromTemplateSchema` | `/api/workouts/generate-from-template` |
| `saveWorkoutSchema` | `/api/workouts/save` |
| `setLogSchema` | `/api/logs/set` |
| `analyticsSummarySchema` | `/api/analytics/summary` |
| `profileSetupSchema` | `/api/profile/setup` |
| `deleteWorkoutSchema` | `/api/workouts/delete` |
| `toggleFavoriteSchema` | `/api/exercises/[id]/favorite` |
| `toggleAvoidSchema` | `/api/exercises/[id]/avoid` |
| `upsertBaselineSchema` | `/api/baselines` |
| `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema` | `/api/templates` routes |
| `preferencesSchema` | `/api/preferences` |

Notable contract update:
- `profileSetupSchema.splitType` is optional and defaults safely at persistence time.

## `db`, `data`, `exercise-library`, `supabase`, `ui`

These areas remain structurally unchanged from prior documentation and continue to provide:
- Prisma client setup (`src/lib/db/prisma.ts`)
- optional sample fixtures (`src/lib/data/exercises.ts`)
- exercise list filtering/sorting helpers (`src/lib/exercise-library/*`)
- Supabase client wrappers (`src/lib/supabase/*`)
- workout section shaping helpers (`src/lib/ui/workout-sections.ts`)
