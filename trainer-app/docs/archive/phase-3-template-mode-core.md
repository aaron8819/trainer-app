# Phase 3: Template Mode (Core)

## Context

Phase 3 Step 1 (Template CRUD API) is done — 5 endpoints, API layer, Zod schemas, DB schema. This plan covers the remaining core features: template UI, template session generation engine, and dashboard mode selector. Smart Build and Template Analysis are deferred to Phase 3b.

## Step 1: Engine — `generateWorkoutFromTemplate()`

New pure engine module for generating a `WorkoutPlan` from a template's exercise list.

**Create:** `src/lib/engine/template-session.ts`

```
generateWorkoutFromTemplate(
  templateExercises: TemplateExerciseInput[],
  options: GenerateFromTemplateOptions
): WorkoutPlan
```

- For each template exercise: call `prescribeSetsReps()` + `getRestSeconds()` to build `WorkoutExercise`
- `isMainLift` defaults to `exercise.isMainLiftEligible ?? exercise.isMainLift`
- Derive fatigue state from history + check-in via `deriveFatigueState()`
- Build SRA warnings via `buildMuscleRecoveryMap()` + `generateSraWarnings()`
- Compute `estimateWorkoutMinutes()` — report but don't trim (user chose the exercises)
- Partition into `mainLifts` / `accessories` by `isMainLift` flag
- No warmup block (templates are explicit)

**Modify:** `src/lib/engine/index.ts` — add `export * from "./template-session"`

**Create:** `src/lib/engine/template-session.test.ts` — 6+ test cases:
- Basic generation (3 exercises in, 3 out with correct sets)
- Main lift vs accessory prescription (4 sets vs 3)
- Fatigue adjustment (low readiness reduces sets)
- SRA warnings when muscles recently trained
- Estimated minutes is reasonable
- Empty template returns valid empty plan

**Reuses:** `prescribeSetsReps`, `getRestSeconds`, `deriveFatigueState`, `estimateWorkoutMinutes`, `buildMuscleRecoveryMap`, `generateSraWarnings`, `createId` — all from existing engine modules.

## Step 2: API Layer — Template Session Generation Route

Wire engine function to DB. Load template + workout context, map to engine types, call engine + `applyLoads()`.

**Create:** `src/lib/api/template-session.ts`
- `generateSessionFromTemplate(userId, templateId)` → `{ workout, templateId } | { error }`
- Load template detail + workout context in parallel
- Map template exercises to engine `TemplateExerciseInput[]` via `mapExercises()` exerciseById lookup
- Call `generateWorkoutFromTemplate()` then `applyLoads()` (from workout-context.ts)
- Pass `sessionMinutes: undefined` to skip timeboxing trim on loads

**Create:** `src/app/api/workouts/generate-from-template/route.ts`
- `POST` handler: validate with `generateFromTemplateSchema`, resolve user, call API, return plan

**Modify:** `src/lib/validation.ts`
- Add `generateFromTemplateSchema = z.object({ userId: z.string().optional(), templateId: z.string() })`
- Add `templateId: z.string().optional()` to `saveWorkoutSchema`

**Modify:** `src/app/api/workouts/save/route.ts`
- Pass `templateId` through to both create and update branches of the upsert
- Set `advancesSplit` from payload (template sessions send `false`)

## Step 3: Navigation — Add "Templates" Tab

**Modify:** `src/components/navigation/AppNavigation.tsx`
- Add `TemplatesIcon` SVG (grid/clipboard icon)
- Add 5th entry to `NAV_ITEMS`: `{ href: "/templates", label: "Templates", icon: <TemplatesIcon /> }`
- Position after Home, before Library

## Step 4: Template List Page (`/templates`)

**Create:** `src/app/templates/page.tsx` — server page
- Load templates via `loadTemplates(userId)`
- Pass to `TemplateListShell`

**Create:** `src/components/templates/TemplateListShell.tsx` — client shell
- State: `templates[]`, `deleteTarget`, `deleting`
- Renders: "Create Template" link → `/templates/new`
- Empty state with dashed border
- List of `TemplateCard` components
- Delete confirmation via `SlideUpSheet` (reuse existing component)

**Create:** `src/components/templates/TemplateCard.tsx`
- Shows: name, exercise count, target muscles
- Actions: Edit link → `/templates/[id]/edit`, Delete button

## Step 5: Template Create Page (`/templates/new`)

**Create:** `src/app/templates/new/page.tsx` — server page
- Load exercise library for the picker

**Create:** `src/components/templates/TemplateForm.tsx` — shared create/edit form
- Props: `mode`, `initialName?`, `initialTargetMuscles?`, `initialExercises?`, `templateId?`, `exercises`
- State: `name`, `targetMuscles`, `selectedExercises[]` (with exerciseId + name + orderIndex)
- Uses `ExercisePicker` (multi mode) — maps names → IDs via loaded exercise list
- Exercise ordering: up/down buttons + remove per exercise
- Target muscles: optional multi-select chips (coarse groups)
- Submit: POST `/api/templates` (create) or PUT `/api/templates/[id]` (edit)
- Redirect to `/templates` on success

**Key detail:** ExercisePicker works with names. TemplateForm maintains `exerciseByName` map from loaded exercises to resolve IDs when selection changes.

## Step 6: Template Edit Page (`/templates/[id]/edit`)

**Create:** `src/app/templates/[id]/edit/page.tsx`
- Load template detail + exercise library
- Map template exercises to `initialExercises` format
- Render `TemplateForm` in `"edit"` mode with pre-populated values

## Step 7: Dashboard Mode Selector + Template Generation UI

**Create:** `src/components/DashboardGenerateSection.tsx` — client wrapper
- State: `mode: "ppl" | "template"` (local useState, no persistence needed yet)
- Renders pill toggle (PPL Auto / Template)
- Conditionally renders `GenerateWorkoutCard` or `GenerateFromTemplateCard`

**Create:** `src/components/GenerateFromTemplateCard.tsx`
- Template selector dropdown (from server-loaded template summaries)
- Same check-in flow as `GenerateWorkoutCard` (reuse `SessionCheckInForm`)
- Calls `POST /api/workouts/generate-from-template` with `{ templateId }`
- Workout preview: same exercise card layout as `GenerateWorkoutCard`
- Save: calls `POST /api/workouts/save` with `templateId` + `advancesSplit: false`
- Success: links to workout view + log

**Modify:** `src/app/page.tsx`
- Load templates alongside existing data: `loadTemplates(targetUserId)`
- Replace `<GenerateWorkoutCard>` with `<DashboardGenerateSection>` wrapper
- Pass `templates`, `nextAutoLabel`, `queuePreview` as props

## Files Summary

| New Files (12) | Purpose |
|---|---|
| `src/lib/engine/template-session.ts` | Pure engine: template → WorkoutPlan |
| `src/lib/engine/template-session.test.ts` | Engine tests |
| `src/lib/api/template-session.ts` | API: load template + context → engine → loads |
| `src/app/api/workouts/generate-from-template/route.ts` | HTTP route |
| `src/app/templates/page.tsx` | Template list page |
| `src/app/templates/new/page.tsx` | Create template page |
| `src/app/templates/[id]/edit/page.tsx` | Edit template page |
| `src/components/templates/TemplateListShell.tsx` | List shell (client) |
| `src/components/templates/TemplateCard.tsx` | Template card |
| `src/components/templates/TemplateForm.tsx` | Shared create/edit form |
| `src/components/DashboardGenerateSection.tsx` | Mode toggle wrapper |
| `src/components/GenerateFromTemplateCard.tsx` | Template generation card |

| Modified Files (5) | Change |
|---|---|
| `src/lib/engine/index.ts` | Export template-session |
| `src/lib/validation.ts` | Add generateFromTemplateSchema, templateId to save schema |
| `src/app/api/workouts/save/route.ts` | Pass templateId through upsert |
| `src/components/navigation/AppNavigation.tsx` | Add Templates tab |
| `src/app/page.tsx` | Mode selector integration |

## Verification

1. **Build:** `npm run build` — no type errors
2. **Tests:** `npm test` — all existing + new template-session tests pass
3. **Lint:** `npm run lint` — no new issues
4. **Manual E2E:**
   - Navigate to Templates tab → see empty state
   - Create template with 4-5 exercises → verify appears in list
   - Edit template: rename, reorder, add/remove exercise → verify changes persist
   - Delete template → confirm dialog → template removed
   - Dashboard: switch to Template mode → select template → check-in → generate
   - Verify exercises match template, loads assigned, estimated time shown
   - Save workout → verify in recent workouts, `advancesSplit = false`
   - Switch to PPL mode → generate → verify split queue not affected by template session
