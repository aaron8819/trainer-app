# Explainability Phase 2 Metadata Contract

This document defines the phase-2 metadata shape for explainability surfaces.

## Implemented Fields

The following fields now flow through generation responses and can be persisted in `selectionMetadata`:

- `adaptiveDeloadApplied: boolean`
  - True when adaptive deload logic is active for the generated session.
- `periodizationWeek: number`
  - Current week index used for periodization decisions during generation.

Both fields are attached in `template-session` finalization and returned from:

- `POST /api/workouts/generate-from-intent`
- `POST /api/workouts/generate-from-template`

## Planned Fields

These fields are part of the phase-2 target contract but are not yet implemented:

- `loadSourceByExerciseId: Record<string, "history" | "baseline" | "donor" | "bodyweight" | "default">`
  - UI use: per-exercise load source badges.
- `trimmedExerciseReasons: Record<string, "time_cap" | "volume_cap" | "safety_trim">`
  - UI use: explicit explanation when accessories are removed.
- `hardFilterSummary: Record<string, number>`
  - UI use: aggregate “not selected because” reasons without exposing full candidate diagnostics.

## UI Usage Notes

- Workout detail should read these values from saved `selectionMetadata` and degrade gracefully if missing.
- Preview cards can render these values directly from generation API responses before save.
- All user-facing text should use plain-language labels, not raw engine field names.
