# Template-Only Deprecation Plan (No Starter Templates)

## Status

- PR1 completed on 2026-02-11: dashboard generation UI is template-only, and home page split-preview plumbing was removed.
- PR2 completed on 2026-02-11: `/api/workouts/generate` was deprecated and then removed after soak.
- PR3 completed on 2026-02-11: onboarding/settings split UI removed; `splitType` became optional in setup validation with safe persistence fallback.
- PR4 completed on 2026-02-11: template API-path enhanced volume-cap parity verified and locked with tests.
- PR5 completed on 2026-02-11: dormant auto-generation engine path and heavy tests removed.

## Scope decision

- Deprecate PPL Auto/Manual/Bonus generation UX and API.
- Keep template generation as the only generation path.
- Keep `daysPerWeek` and `sessionMinutes`.
- Hide/de-emphasize `splitType` (do not remove DB column yet).
- Do not stop writing `splitType` until template intent fully replaces it for any remaining
  downstream consumers (weekly program scoring intent logic, split-based warning copy, etc.).
- Template generation remains user-directed: no SRA/volume-based accessory reordering or scoring.
  Only SRA warnings and volume-cap trimming apply.

## 1. UI Cutover (Template-Only Entry Point)

1. Update dashboard generation panel to template-only.
- Change `src/components/DashboardGenerateSection.tsx` to render only `GenerateFromTemplateCard`.
- Remove mode toggle and PPL label/button.
2. Remove split-queue preview plumbing from home page.
- Simplify `src/app/page.tsx` by removing `loadWorkoutContext` and `getSplitPreview` dependencies used only for PPL preview props.
3. Keep current no-template empty state.
- `src/components/GenerateFromTemplateCard.tsx` already has "No templates yet" and "Create Template"; keep this as-is (no starter templates added).

## 2. API Deprecation (Hard Stop for PPL Generate)

1. Deprecate endpoint `POST /api/workouts/generate`.
- In `src/app/api/workouts/generate/route.ts`, return `410` with clear message: "PPL generation deprecated; use /api/workouts/generate-from-template".
2. Remove UI caller.
- After step 1 UI cutover, no internal UI should call this endpoint.
3. Keep endpoint stub for one release cycle for safety, then delete route.

## 3. Settings/Onboarding Cleanup

1. Remove split UI from profile form.
- Edit `src/app/onboarding/ProfileForm.tsx`:
- Remove `splitType` input.
- Remove split mismatch warning (`getSplitMismatchWarning`).
- Rename section from "Schedule & Split" to "Schedule".
2. Update settings copy.
- Edit `src/app/settings/page.tsx` text to remove split wording.
3. Keep constraints persistence stable without DB migration.
- In `src/lib/validation.ts`, make `splitType` optional in `profileSetupSchema`.
- In `src/app/api/profile/setup/route.ts`, when `splitType` is absent, persist `CUSTOM` (or preserve existing value).
- Keep `sessionMinutes` and `daysPerWeek` required.

## 4. Remove Split-Specific UI Artifacts

1. Workout detail page cleanup.
- In `src/app/workout/[id]/page.tsx`, remove "Next auto day / Queue" and split-day narrative tied to PPL queue.
- Keep historical workout details/logging intact.
2. Remove split recommendation utility if unused.
- Delete `src/lib/settings/split-recommendation.ts` and tests once form no longer imports it.

## 5. Optional Deep Cleanup (After Soak)

1. Wire enhanced volume-cap parity into the template generation path (pre-`engine.ts` removal gate).
- Ensure template generation executes the same enhanced cap model in production calls:
  MRV primary cap + spike secondary safety net when mesocycle context is present.
- Verify `src/lib/api/template-session.ts` passes all required context so cap enforcement is active
  on template-generated workouts, not only in isolated engine tests.
- Add/adjust integration coverage to prove template generation trims at cap boundaries.
2. Remove dormant PPL engine path and heavy tests.
- Candidates: `src/components/GenerateWorkoutCard.tsx`, `src/lib/engine/engine.ts`, split queue modules/tests.
 - If `engine.ts` is removed, extract any shared helpers (fatigue derivation, volume context, etc.)
   into standalone modules first and confirm `template-session.ts` has no imports from `engine.ts`.
3. Remove `generateWorkoutSchema` if route removed and no callers remain.
- `src/lib/validation.ts`.

## 6. Validation Checklist

1. Dashboard only shows template generation.
2. No UI requests to `/api/workouts/generate`.
3. `/api/workouts/generate` route is removed after the deprecation soak window.
4. Onboarding/settings save works without `splitType` input.
5. Template generation, save, and logging still work end-to-end.
6. No-template user flow shows "Create Template" CTA (and nothing auto-generated).
7. Workout detail page no longer references split queue.
8. Template generation enforces enhanced volume caps in the API path
   (MRV primary cap + spike secondary safety net when mesocycle context is present).
9. Template intent is the only remaining split signal in downstream consumers
   (weekly program scoring, warning copy, analytics), or those consumers are removed.

## 7. PR Sequence (Recommended)

1. PR1: Completed.
2. PR2: Completed.
3. PR3: Completed.
4. PR4: Completed.
5. PR5: Completed.
