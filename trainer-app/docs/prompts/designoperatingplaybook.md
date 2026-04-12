# Front-End Design Operating Playbook

Owner: Aaron  
Purpose: High-signal operating context for future Codex sessions doing Trainer app UI audits, prompt design, component extraction, polish, and mobile-first cleanup.  
Scope: Front-end design guidance only. This document is not a runtime contract and must not override canonical app behavior in `docs/01-09`, `src/lib/*`, route handlers, Prisma, or validation contracts.

## 1. Executive Summary

The Trainer app front end is functional, coherent, and already shaped around the right product jobs: decide what to train next, understand program state, log sets quickly, review outcomes, and manage supporting surfaces like history, analytics, templates, and settings.

This is not a redesign-from-scratch project. The correct near-term strategy is targeted cleanup:

- Fix the most trusted mobile issue first: bottom navigation overload.
- Preserve the existing information architecture and workout logging flow.
- Extract small, presentational primitives only where repeated patterns are already obvious.
- Avoid business logic, read-model, route, training-engine, and workout-state changes.

Main design debt: component repetition, inconsistent presentational styling, some mobile density issues, and uneven primitive ownership. The app should move toward a compact, serious, premium design system without changing its product semantics.

## 2. Product Context for Design Work

This is a local-first personal hypertrophy/training app. The user is usually trying to answer one of four questions:

- What should I do now?
- What does my program/week need?
- How do I log this workout quickly?
- What did that session mean?

Action-first screens:

- Home: next action and continuity.
- Workout Logging: set entry, swap/add, finish/leave.
- Exercise Swap: choose a replacement safely.
- Session Closeout: review/skip/continue flow.
- Settings: configure inputs.

Analysis-first screens:

- Program: current mesocycle, current week, volume, and projections.
- Workout Detail / Review: session outcome and set history.
- Analytics: trend and longer-term interpretation.
- History: past session lookup and management.

Good design for this app:

- Serious, efficient, compact, not gamified.
- High clarity over decorative UI.
- Dense but readable.
- Status labels explain meaning, not color alone.
- Mobile logging prioritizes speed, tap targets, low scroll friction, and stable actions.
- Desktop supports scanning and comparison without stretching content.

## 3. Design Priorities

P0:

- Mobile bottom navigation overload. Seven tabs with fixed minimum width is too much for narrow mobile screens.
- Preserve app truth: no UI prompt should alter workout semantics, read models, routing, API contracts, or training-engine behavior.

P1:

- Mobile logging friction: keep active set entry fast and make repeated actions easy to reach.
- Component-system cleanup for repeated cards, badges, buttons, progress bars, section labels, and sheets.
- Program page mobile ordering and density, especially where current-week plan content is pushed below lower-priority overview content.

P2:

- Radius and card language polish.
- Status palette unification.
- Accessibility pass for progress bars, selected state semantics, dialog consistency, and focus behavior.
- Desktop polish after mobile and primitive cleanup.

Do not do yet:

- Broad visual redesign.
- New design language unrelated to the current app.
- Full component rewrite.
- Page restructuring that requires read-model changes.
- UI-local reinterpretation of progression, volume, mesocycle lifecycle, or session meaning.

## 4. Trusted Findings vs Unverified Findings

High-confidence / trusted:

- Mobile bottom nav is overloaded. Current nav has seven items and mobile links use `min-w-[4.25rem]`; this does not fit a 390px viewport cleanly. Relevant files: `src/components/navigation/AppNavigation.tsx`, `src/components/navigation/NavLink.tsx`.
- Repeated UI patterns are widespread: cards, pills, uppercase section labels, rounded buttons, progress bars, and status badges are hand-authored across pages/components.
- Existing shared primitives already exist and should be preserved, especially `SlideUpSheet`, `ProgramStatusCard`, `SessionContextCard`, `RecentWorkouts`, and logging components.
- Workout logging is intentionally mobile-first with large numeric controls and active-set-first flow.

Plausible but needs interactive verification:

- Logging primary action may sit too low on some mobile viewports after reps/load/RPE controls.
- Program mobile hierarchy may over-prioritize overview metrics relative to `Current Week Plan`.
- Some status colors likely need semantic consolidation across Program, Analytics, History, and logging.

Lower-confidence / screenshot-dependent:

- Broad app-wide horizontal clipping was observed in headless screenshots, but captures had enough environment artifacts that this should be verified with Playwright/browser inspection before treating it as a global P0.
- Exact mobile scroll friction in swap and closeout flows was not fully interactively tested.

Rejected or downgraded:

- "The app needs a redesign." Rejected. The app is coherent and should be refined, not rebuilt.
- "Visual failure is app-wide." Downgraded. Current evidence supports targeted mobile/nav/component cleanup, not a blanket failure claim.
- "Component extraction should happen before product-specific fixes." Rejected. Fix the trusted mobile nav issue first.

## 5. Current UI Strengths

Preserve:

- Home's next-action hierarchy: clear operational dashboard, not a marketing page.
- Program's desktop information architecture: overview, current-week plan, closeout, projection, volume details.
- Workout logging's active-set-first approach and large tap targets.
- Server-owned exercise swap preview and commit flow.
- Shared session summary pattern via `SessionContextCard`.
- `ProgramStatusCard` as a meaningful shared volume/program surface.
- `RecentWorkouts` and History sharing workout-list display helpers through `src/lib/ui`.
- `SlideUpSheet` as a useful mobile/desktop sheet primitive.
- Serious neutral visual tone: mostly white, slate, restrained status colors.

## 6. Current UI Weaknesses / Design Debt

Layout bugs:

- Mobile nav overload is confirmed.
- Possible horizontal containment issues should be verified before broad fixes.

Information architecture issues:

- Program mobile may need better prioritization of current-week action guidance.
- Logging screen may need action reachability refinement, not a full workflow rewrite.

Component-system gaps:

- No canonical `Button`, `Card`, `Badge`, `MetricCard`, `ProgressBar`, `Alert`, or `SectionHeader`.
- Similar UI is repeated locally across app pages and components.
- Status styles are partly centralized in domain-specific helpers but not in a presentational primitive.

Visual consistency issues:

- Heavy use of `rounded-full`, `rounded-2xl`, and `rounded-3xl`.
- Card styling varies by page.
- Badge sizing and tone vary across surfaces.
- Some buttons use `rounded-full`, some `rounded-lg`, some 40px, some 44px-plus.

Accessibility issues:

- Some progress bars are visual-only.
- Some selected/preset buttons should expose selected state.
- Custom confirmation dialog should be checked against shared dialog/sheet behavior.
- Color is usually paired with labels, but semantic consistency still needs review.

Mobile usability issues:

- Bottom navigation overload.
- Repeated workout logging actions may require more scrolling than ideal.
- Swap candidate rows are dense and confirmation buttons are smaller than the main logging tap target class.

## 7. Screen-by-Screen Design Intent

Home:

- Purpose: operational "what should I do now?"
- Primary question: what is my next training action?
- Emphasize: start/resume/generate, continuity, current week context, recent activity.
- Safe changes: card styling, button primitive, layout spacing, mobile containment.
- Risky changes: next-session logic, closeout visibility, gap-fill meaning.

Program:

- Purpose: mesocycle and current-week decision support.
- Primary question: where am I in the block and what does this week need?
- Emphasize: current-week slots, closeout status, projected landing, weighted volume.
- Safe changes: responsive ordering, metric card styling, visual density.
- Risky changes: slot sequencing, volume math, projected-week interpretation.

Workout Logging:

- Purpose: fast execution and set logging.
- Primary question: what set do I log now, and how fast can I do it?
- Emphasize: active set, reps/load/RPE controls, log action, queue, finish/leave.
- Safe changes: spacing, tap target consistency, sticky/nearby action presentation, sheet layout.
- Risky changes: set satisfaction rules, completion state, rest timer behavior, swap/add semantics.

Workout Detail / Review:

- Purpose: review planned/performed workout and meaning.
- Primary question: what happened, and what should I know next?
- Emphasize: session outcome, key lift takeaways, program impact, set log.
- Safe changes: card polish, summary density, badge consistency.
- Risky changes: progression interpretation, performed status meaning, receipt-first summary.

Exercise Swap:

- Purpose: safe in-session replacement.
- Primary question: what can I swap to without breaking the session?
- Emphasize: search, replacement reason, exact post-swap prescription, disabled confirm until preview is ready.
- Safe changes: sheet layout, candidate row density, button sizing.
- Risky changes: client-side eligibility, preview assumptions, swap persistence flow.

Session Closeout:

- Purpose: surface optional closeout/handoff workflow.
- Primary question: should I review, skip, or continue?
- Emphasize: closeout status, action, dismiss option.
- Safe changes: alert styling, button consistency.
- Risky changes: dismiss semantics, mesocycle lifecycle, handoff behavior.

Mobile Navigation / App Shell:

- Purpose: fast top-level routing.
- Primary question: where do I go next?
- Emphasize: fewer visible primary destinations or a compact overflow model.
- Safe changes: nav presentation and grouping.
- Risky changes: route semantics, active-state mapping for `/log/*`.

Analytics:

- Purpose: trend review, not immediate prescription.
- Primary question: what patterns are emerging over time?
- Emphasize: training consistency, volume trends, outcomes, recovery recency.
- Safe changes: chart/card polish, status badge consistency.
- Risky changes: metric semantics or conflating analytics with program prescription.

Settings:

- Purpose: configure profile/preferences.
- Primary question: what settings affect my training setup?
- Emphasize: clear forms, save state, validation feedback.
- Safe changes: form field primitive, section card consistency.
- Risky changes: schema, validation contracts, preference meaning.

History:

- Purpose: lookup and manage past sessions.
- Primary question: what did I do before?
- Emphasize: filtering, row scanning, status, deload/supplemental labels, actions.
- Safe changes: row/card styling, filter layout, badge primitive.
- Risky changes: workout classification, delete semantics, history read model.

## 8. Component System State

Existing reusable UI components:

- `SlideUpSheet`
- `ProgramStatusCard`
- `SessionContextCard`
- `RecentWorkouts`
- `CloseoutCard`
- `PostWorkoutInsights`
- `WorkoutActiveSetCard`
- `WorkoutExerciseQueue`
- `WorkoutFooter`
- `WorkoutCompletionDialog`
- `WorkoutRowActions`
- `TemplateCard`, `TemplateScoreBadge`, template shells
- Analytics panels and library cards

Duplicated patterns:

- Card shell
- Section header / eyebrow label
- Pill button
- Status badge
- Progress bar
- Metric tile
- Alert/callout
- Empty/loading/error card
- Bottom/sticky action bar

Canonical primitives to extract first:

- `Button`
- `Card`
- `SectionHeader`
- `StatusBadge`
- `ProgressBar`
- `MetricCard`
- `Alert`
- `FormField`
- `ConfirmDialog`, likely built around or aligned with `SlideUpSheet`

Composite components that should not be prematurely abstracted:

- `ProgramStatusCard`
- `WorkoutActiveSetCard`
- `WorkoutExerciseQueue`
- `RuntimeExerciseSwapSheet`
- `CompletedWorkoutReview`
- `PostWorkoutInsights`

These encode product-specific presentation and should be cleaned internally before being generalized.

## 9. Design System Direction

Visual tone:

- Premium, serious, modern, quiet.
- Avoid gamified visuals, excessive gradients, decorative blobs, and noisy color.

Density:

- Compact but not cramped.
- Mobile: prioritize action reachability and tap stability.
- Desktop: support scanning and comparison, avoid over-wide reading lines.

Spacing:

- Prefer a small, consistent spacing scale.
- Reduce one-off `mt-*`, `p-*`, and card nesting once primitives exist.
- Keep page max-width constraints.

Radius:

- Move toward a restrained radius scale.
- Keep pills where functionally appropriate for badges or compact controls.
- Reduce default reliance on `rounded-2xl`/`rounded-full` for everything.

Card language:

- Cards should frame meaningful units: session, set editor, current-week slot, metric, row group.
- Avoid cards inside cards unless the inner unit is an actual repeated item or control surface.

Button philosophy:

- One canonical primary action per decision area.
- Touch targets should be 44px-class on mobile.
- Use consistent variants: primary, secondary, subtle, danger, ghost.
- Avoid using button styling as arbitrary decoration.

Badge/status semantics:

- Status labels must carry meaning without color.
- Centralize semantic tones: neutral, success/productive, caution, danger, info, special.
- MEV/MAV/MRV states need one canonical UI tone map per use case.

Desktop vs mobile:

- Desktop can show more comparative context.
- Mobile should shorten hierarchy and keep execution actions close.
- Do not simply stack desktop cards on mobile if it buries the current action.

Accessibility:

- Labels on inputs.
- `aria-pressed` or equivalent for selectable presets.
- Progress bars need accessible values where meaningful.
- Dialog/sheet focus behavior should be verified.
- Contrast and disabled-state clarity should be checked.

## 10. Architecture / Safety Constraints for UI Work

Future UI sessions must preserve:

- Business logic.
- API contracts.
- Route semantics.
- Prisma schema and migrations.
- Read-model ownership in `src/lib/api` and `src/lib/ui`.
- Training-engine meaning in `src/lib/engine`.
- Receipt-first session truth.
- Workout logging state and set satisfaction semantics.
- Mesocycle lifecycle behavior.
- Slot sequencing and next-session derivation.
- Volume math and MEV/MAV/MRV classification.
- Exercise swap eligibility and preview ownership.

Do not:

- Recompute domain meaning in components.
- Introduce page-local progression or lifecycle rules.
- Change generated workout structure to satisfy a visual concern.
- Move business logic into routes/components.
- Collapse distinction between Program, Analytics, History, and Home.
- Prompt for "redesign this page" without scoped constraints and verification.

## 11. Prompting Playbook for Future Codex Sessions

Best prompt structure:

- Goal: state the exact UI outcome.
- Scope: list surfaces and files if known.
- Non-goals: explicitly forbid business logic/schema/API/read-model changes.
- Design direction: compact, serious, mobile-first, preserve existing IA.
- Safety: require seam review and nearby component/tests review.
- Verification: ask for screenshots or focused component tests where relevant.
- Output: specify whether to implement, audit only, or propose plan only.

How to scope safely:

- Prefer one surface or one primitive family per task.
- Use "presentational-only unless proven necessary."
- Require callout for any route/read-model/semantic boundary touched.
- If component extraction, start with one repeated pattern and migrate 1-2 consumers.

Component-first vs page-first:

- Page-first when the issue is a concrete UX problem, such as mobile nav overload or logging action reachability.
- Component-first when the same presentational pattern appears across multiple surfaces.
- Avoid component-first work when the pattern encodes domain-specific meaning.

Audit vs implementation:

- Audit prompt: no changes, inspect UI/code, separate verified from inferred.
- Implementation prompt: make minimal scoped changes, preserve semantics, verify.
- Design-system prompt: extract primitives only from existing repeated patterns, no visual reinvention.

Good prompt patterns:

- "Fix the mobile bottom nav overload without changing routes or active-state semantics."
- "Extract a presentational `Button` primitive and migrate only Home and Closeout actions."
- "Audit Program mobile hierarchy; do not implement; separate verified screenshots from code inferences."
- "Refine Workout Logging mobile density while preserving set logging behavior and existing hooks."
- "Add Playwright screenshots for Home, Program, Log, and Workout Review without changing app behavior."

Bad prompt patterns:

- "Redesign the whole app to look premium."
- "Make Program simpler by recalculating the important values in the component."
- "Unify all cards everywhere in one pass."
- "Move workout logic into the logging UI to make it easier."
- "Change status labels/colors freely across the app."
- "Refactor navigation, routes, and page structure together."

## 12. Recommended Workstreams

| Workstream | Goal | Confidence | Risk | Dependencies | Parallelizable |
|---|---|---:|---:|---|---|
| Mobile nav cleanup | Resolve overloaded 7-item bottom nav | High | Low-medium | None | Yes |
| Playwright audit harness | Repeatable screenshots and key flow checks | High | Low | None | Yes |
| UI primitive extraction | Button/Card/Badge/Progress/Alert basics | High | Medium | Prefer after nav | Partly |
| Logging UX refinement | Reduce mobile set-entry friction | Medium-high | Medium | Screenshot harness helpful | No |
| Program mobile ordering | Improve current-week scan on mobile | Medium | Medium | Playwright helpful | Yes |
| Status/badge unification | One semantic tone system | Medium | Medium | Primitive extraction | Partly |
| Storybook or `/dev/ui` gallery | Inspect primitives and composite states | Medium | Low-medium | Primitive decisions | Yes |
| Accessibility quick pass | ARIA/progress/dialog/selected states | Medium-high | Low | Can run anytime | Yes |

## 13. Prompt Templates

UI audit prompt:

```text
Audit the current UI for [surfaces]. Do not implement changes. Inspect the running app if possible, then review page/component composition. Separate trusted findings from plausible inferences. Focus on UX hierarchy, mobile behavior, component reuse, visual consistency, and accessibility. Preserve business logic, read models, routes, API contracts, and training semantics.
```

Component extraction prompt:

```text
Extract the smallest useful presentational primitive for [pattern]. Start from existing repeated code, do not invent a new design system. Migrate only [specific consumers]. Do not change domain behavior, props meaning, route semantics, read models, or API contracts. Verify with focused tests or screenshots where relevant.
```

Presentational cleanup prompt:

```text
Make a presentational-only cleanup to [surface/component] for [specific issue]. Preserve existing data flow, copy meaning, actions, and component boundaries. Do not alter business logic, hooks, API calls, route structure, or domain classifiers. Keep the change small and verify the affected surface.
```

Mobile UX refinement prompt:

```text
Refine the mobile UX for [screen/flow], especially [tap targets/action reachability/navigation/density]. Use the existing flow and components as the base. Do not redesign the page or change workout/program semantics. Inspect mobile viewport behavior and report what was verified.
```

Storybook or component gallery prompt:

```text
Create a minimal UI component inspection surface for [components]. Include representative states only. Do not change production behavior or domain logic. Prefer existing props/models and simple fixtures. The goal is future visual QA, not a new design framework.
```

Playwright audit prompt:

```text
Add a minimal Playwright audit harness for [routes/flows]. Capture desktop and mobile screenshots and, where safe, open key sheets/dialogs. Do not assert domain internals or mutate persistent data unless using controlled fixtures. Document how to run it and keep it separate from business tests.
```

## 14. Final Operating Rules

- Do not redesign from scratch.
- Fix the trusted mobile nav issue before broad visual polish.
- Preserve business logic, route semantics, read models, workout truth, and training-engine meaning.
- Use existing `src/lib/ui` and `src/lib/api` ownership instead of recomputing semantics in components.
- Prefer page-first fixes for concrete UX problems and component-first extraction for obvious repetition.
- Keep primitive extraction small and migrate only a few consumers at a time.
- Treat screenshot-only findings as provisional until verified interactively.
- Make mobile logging faster without changing how logging works.
- Keep the app serious, compact, clear, and training-focused.
- When in doubt, audit first, then implement the smallest safe presentational change.
